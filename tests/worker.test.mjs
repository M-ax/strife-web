import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { parseRange } from "../src/worker.ts";
import manifest from "../release.json" with { type: "json" };
const release = manifest.downloads.find(
  (item) => item.id === "windows-x64-portable",
);

const metadata = {
  size: release.bytes,
  etag: "release-etag",
  httpEtag: '"release-etag"',
  uploaded: new Date("2026-09-26T12:00:00Z"),
};
function environment(object = metadata) {
  const reads = [];
  return {
    reads,
    RELEASES: {
      async head(key) {
        const item = manifest.downloads.find((item) => item.key === key);
        assert.ok(item, "only catalog keys are read");
        return key === release.key ? object : { ...metadata, size: item.bytes };
      },
      async get(key, options) {
        assert.equal(key, release.key);
        reads.push(options);
        return {
          ...metadata,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([80, 75, 3, 4]));
              controller.close();
            },
          }),
        };
      },
    },
    ASSETS: {
      async fetch() {
        return new Response("Missing page", { status: 404 });
      },
    },
  };
}
const request = (path, init) => new Request("https://strife.zip" + path, init);

test("unpublished and mismatched releases are unavailable, with a useful download page", async () => {
  for (const object of [null, { ...metadata, size: 1 }]) {
    const env = environment(object);
    const catalog = await worker.fetch(request("/api/release"), env);
    assert.equal(
      (await catalog.json()).downloads.find((item) => item.id === release.id)
        .available,
      false,
    );
    const download = await worker.fetch(
      request("/download/windows-x64-portable"),
      env,
    );
    assert.equal(download.status, 503);
    assert.match(await download.text(), /coffee break/);
    assert.equal(download.headers.get("Cache-Control"), "no-store");
  }
});
test("catalog exposes current version, integrity hash, and availability", async () => {
  const response = await worker.fetch(request("/api/release"), environment());
  const catalog = await response.json();
  assert.equal(catalog.version, manifest.version);
  assert.deepEqual(
    catalog.downloads.find((item) => item.id === release.id).sha256,
    release.sha256,
  );
  assert.ok(catalog.downloads.every((item) => item.available));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});
test("download HEAD reports the ZIP metadata without reading its body", async () => {
  const env = environment();
  const response = await worker.fetch(
    request("/download/windows-x64-portable", { method: "HEAD" }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("Content-Length"), String(release.bytes));
  assert.equal(
    response.headers.get("Content-Disposition"),
    'attachment; filename="' + release.filename + '"',
  );
  assert.equal(env.reads.length, 0);
});
test("valid byte ranges stream a resumable partial ZIP", async () => {
  const env = environment();
  const response = await worker.fetch(
    request("/download/windows-x64-portable", {
      headers: { Range: "bytes=0-3" },
    }),
    env,
  );
  assert.equal(response.status, 206);
  assert.equal(
    response.headers.get("Content-Range"),
    "bytes 0-3/" + release.bytes,
  );
  assert.equal(response.headers.get("Content-Length"), "4");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [80, 75, 3, 4],
  );
  assert.deepEqual(env.reads[0], {
    range: { offset: 0, length: 4 },
    onlyIf: { etagMatches: metadata.etag },
  });
});
test("suffix, open-ended and overshooting ranges are normalized", () => {
  assert.deepEqual(parseRange("bytes=-20", 100), { offset: 80, length: 20 });
  assert.deepEqual(parseRange("bytes=80-", 100), { offset: 80, length: 20 });
  assert.deepEqual(parseRange("bytes=80-120", 100), { offset: 80, length: 20 });
  assert.deepEqual(parseRange("bytes=-200", 100), { offset: 0, length: 100 });
});
test("invalid and multipart ranges produce 416 without reading R2", async () => {
  for (const range of [
    "bytes=-0",
    "bytes=9-2",
    "bytes=-",
    "items=0-3",
    "bytes=0-3,6-9",
    "bytes=999999999999999999999-",
  ]) {
    const env = environment();
    const response = await worker.fetch(
      request("/download/windows-x64-portable", { headers: { Range: range } }),
      env,
    );
    assert.equal(response.status, 416, range);
    assert.equal(
      response.headers.get("Content-Range"),
      "bytes */" + release.bytes,
    );
    assert.equal(env.reads.length, 0);
  }
});
test("a changed If-Range validator falls back to a complete response", async () => {
  const env = environment();
  const response = await worker.fetch(
    request("/download/windows-x64-portable", {
      headers: { Range: "bytes=0-3", "If-Range": '"older-build"' },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Range"), null);
  assert.equal(env.reads[0].range, undefined);
});
test("matching cache validators avoid a download body", async () => {
  const env = environment();
  const response = await worker.fetch(
    request("/download/windows-x64-portable", {
      headers: { "If-None-Match": 'W/"release-etag"' },
    }),
    env,
  );
  assert.equal(response.status, 304);
  assert.equal(response.body, null);
  assert.equal(env.reads.length, 0);
});
test("checksums are downloadable and HEAD is empty", async () => {
  const response = await worker.fetch(
    request("/download/windows-x64-portable.sha256"),
    environment(),
  );
  assert.equal(
    await response.text(),
    release.sha256 + "  " + release.filename + "\n",
  );
  const head = await worker.fetch(
    request("/api/release", { method: "HEAD" }),
    environment(),
  );
  assert.equal(head.body, null);
});
test("unknown downloads cannot select arbitrary bucket keys", async () => {
  const response = await worker.fetch(
    request("/download/private.zip"),
    environment(),
  );
  assert.equal(response.status, 404);
  assert.match(
    response.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
});
test("write methods and bucket failures are handled without exposing internals", async () => {
  const rejected = await worker.fetch(
    request("/download/windows-x64-portable", { method: "POST" }),
    environment(),
  );
  assert.equal(rejected.status, 405);
  const env = environment();
  env.RELEASES.head = async () => {
    throw new Error("private infrastructure details");
  };
  const response = await worker.fetch(
    request("/download/windows-x64-portable"),
    env,
  );
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private infrastructure/);
});

for (const item of manifest.downloads) {
  test(item.platform + " has the correct headers and checksum", async () => {
    const response = await worker.fetch(
      request("/download/" + item.id, { method: "HEAD" }),
      environment(),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), item.contentType);
    assert.equal(response.headers.get("Content-Length"), String(item.bytes));
    assert.equal(
      response.headers.get("Content-Disposition"),
      'attachment; filename="' + item.filename + '"',
    );
    const checksum = await worker.fetch(
      request("/download/" + item.id + ".sha256"),
      environment(),
    );
    assert.equal(
      await checksum.text(),
      item.sha256 + "  " + item.filename + "\n",
    );
  });
}
test("one missing or failing platform leaves other downloads available", async () => {
  for (const fail of [false, true]) {
    const env = environment();
    const head = env.RELEASES.head;
    env.RELEASES.head = async (key) => {
      if (key === release.key) {
        if (fail) throw new Error("R2 temporarily unavailable");
        return null;
      }
      return head(key);
    };
    const response = await worker.fetch(request("/api/release"), env);
    const catalog = await response.json();
    assert.equal(response.status, 200);
    for (const item of catalog.downloads)
      assert.equal(item.available, item.id !== release.id);
    assert.ok(catalog.downloads.every((item) => !("key" in item)));
  }
});
test("a replaced object between HEAD and GET fails safely", async () => {
  const env = environment();
  env.RELEASES.get = async () => metadata;
  const response = await worker.fetch(request("/download/" + release.id), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
