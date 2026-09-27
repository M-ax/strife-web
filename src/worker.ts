import release from "../release.json" with { type: "json" };

interface Download {
  id: string;
  platform: string;
  filename: string;
  key: string;
  bytes: number;
  sha256: string;
  contentType: string;
}

const downloads: Download[] = release.downloads;

interface Env {
  ASSETS: Fetcher;
  RELEASES: R2Bucket;
}

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

function unavailable(): Response {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111113"><meta name="color-scheme" content="dark"><meta name="robots" content="noindex"><title>Download on a coffee break. | Strife</title><link rel="stylesheet" href="/style.css"><link rel="icon" href="/assets/favicon.svg?v=orange-mark"></head><body><main class="error-page wrap"><a class="brand" href="/"><img src="/assets/mark.svg?v=orange-mark" width="36" height="36" alt="">STRIFE.</a><h1>The download is<br>on a coffee break.</h1><p>This build is temporarily unavailable. Try again shortly, or grab the source while we get our act together.</p><a class="button button-primary" href="https://github.com/M-ax/strife">Get the source <span aria-hidden="true">↗</span></a><p><a href="/#download">Back to Strife</a></p></main></body></html>',
    {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "300",
      },
    },
  );
}

export function parseRange(
  value: string,
  size: number,
): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start
  )
    return null;
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

function matchesEtag(value: string | null, etag: string): boolean {
  return (
    value
      ?.split(",")
      .some(
        (item) =>
          item.trim() === "*" || item.trim().replace(/^W\//, "") === etag,
      ) ?? false
  );
}

async function currentObject(
  env: Env,
  item: Download,
): Promise<R2Object | null> {
  if (!item.bytes || !/^[a-f0-9]{64}$/.test(item.sha256)) return null;
  const object = await env.RELEASES.head(item.key);
  return object?.size === item.bytes ? object : null;
}

async function download(
  request: Request,
  env: Env,
  item: Download,
): Promise<Response> {
  const object = await currentObject(env, item);
  if (!object) return unavailable();
  const headers = new Headers({
    "Content-Type": item.contentType,
    "Content-Disposition": 'attachment; filename="' + item.filename + '"',
    "Accept-Ranges": "bytes",
    ETag: object.httpEtag,
    "Last-Modified": object.uploaded.toUTCString(),
    "Cache-Control": "public, max-age=0, must-revalidate",
  });
  if (matchesEtag(request.headers.get("If-None-Match"), object.httpEtag))
    return new Response(null, { status: 304, headers });

  let range: { offset: number; length: number } | undefined;
  const rangeHeader = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  const sameEntity =
    !ifRange ||
    ifRange === object.httpEtag ||
    ifRange === object.uploaded.toUTCString();
  if (request.method === "GET" && rangeHeader && sameEntity) {
    const parsed = parseRange(rangeHeader, object.size);
    if (!parsed) {
      headers.set("Content-Range", "bytes */" + object.size);
      return new Response(null, { status: 416, headers });
    }
    range = parsed;
    headers.set(
      "Content-Range",
      "bytes " +
        range.offset +
        "-" +
        (range.offset + range.length - 1) +
        "/" +
        object.size,
    );
  }
  headers.set("Content-Length", String(range?.length ?? object.size));
  if (request.method === "HEAD") return new Response(null, { headers });
  // Keys are immutable; pin the read to the HEAD result to avoid a torn resume
  // if someone nevertheless replaces an object during a request.
  const body = await env.RELEASES.get(item.key, {
    range,
    onlyIf: { etagMatches: object.etag },
  });
  if (!body || !("body" in body)) return unavailable();
  return new Response(body.body, { status: range ? 206 : 200, headers });
}

async function route(request: Request, env: Env): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(
      "This site is strictly a look-and-download situation.",
      { status: 405, headers: { Allow: "GET, HEAD" } },
    );
  const path = new URL(request.url).pathname;
  if (path === "/api/release") {
    const catalog = await Promise.all(
      downloads.map(async (item) => {
        // One unavailable platform must not hide the other downloads.
        const object = await currentObject(env, item).catch(() => null);
        const { key: _key, ...metadata } = item;
        return {
          ...metadata,
          available: object !== null,
          url: "/download/" + item.id,
        };
      }),
    );
    return Response.json(
      {
        version: release.version,
        publishedAt: release.publishedAt,
        available: catalog.some((item) => item.available),
        downloads: catalog,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const item = downloads.find(
    (item) =>
      path === "/download/" + item.id ||
      path === "/download/" + item.id + ".sha256",
  );
  if (item && !path.endsWith(".sha256")) return download(request, env, item);
  if (item) {
    if (!(await currentObject(env, item))) return unavailable();
    const text = item.sha256 + "  " + item.filename + "\n";
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="' + item.filename + '.sha256"',
        "Cache-Control": "no-store",
        "Content-Length": String(new TextEncoder().encode(text).length),
      },
    });
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch {
      response =
        new URL(request.url).pathname === "/api/release"
          ? Response.json(
              { available: false },
              { status: 503, headers: { "Cache-Control": "no-store" } },
            )
          : unavailable();
    }
    const result = new Response(
      request.method === "HEAD" ? null : response.body,
      response,
    );
    for (const [name, value] of Object.entries(securityHeaders))
      result.headers.set(name, value);
    return result;
  },
} satisfies ExportedHandler<Env>;
