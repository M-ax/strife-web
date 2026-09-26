import release from "../release.json" with { type: "json" };

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
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Download on a coffee break. | Strife</title><link rel="stylesheet" href="/style.css"><link rel="icon" href="/assets/favicon.svg"></head><body><main class="error-page wrap"><a class="brand" href="/"><img src="/assets/mark.svg" width="36" height="36" alt="">STRIFE.</a><h1>The download is<br>on a coffee break.</h1><p>The Windows build is temporarily unavailable. Try again shortly, or grab the source while we get our act together.</p><a class="button button-dark" href="https://github.com/M-ax/strife">Get the source <span aria-hidden="true">↗</span></a><p><a href="/#download">Back to Strife</a></p></main></body></html>',
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

async function currentObject(env: Env): Promise<R2Object | null> {
  if (!release.bytes || !/^[a-f0-9]{64}$/.test(release.sha256)) return null;
  const object = await env.RELEASES.head(release.key);
  return object?.size === release.bytes ? object : null;
}

async function download(request: Request, env: Env): Promise<Response> {
  const object = await currentObject(env);
  if (!object) return unavailable();
  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="' + release.filename + '"',
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
  const body = await env.RELEASES.get(release.key, {
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
    const object = await currentObject(env);
    return Response.json(
      {
        version: release.version,
        platform: release.platform,
        filename: release.filename,
        bytes: release.bytes,
        sha256: release.sha256,
        publishedAt: release.publishedAt,
        available: object !== null,
        url: "/download/windows-x64",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (path === "/download/windows-x64") return download(request, env);
  if (path === "/download/windows-x64.sha256") {
    if (!(await currentObject(env))) return unavailable();
    const text = release.sha256 + "  " + release.filename + "\n";
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="' + release.filename + '.sha256"',
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
