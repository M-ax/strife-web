import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import release from "../release.json" with { type: "json" };

const origin = process.argv[2] || "https://strife.zip";
const response = await fetch(new URL("/api/release", origin));
assert.equal(response.status, 200, "release API status");
const catalog = await response.json();
assert.equal(catalog.version, release.version, "deployed version");
assert.equal(
  catalog.downloads.length,
  release.downloads.length,
  "package count",
);

for (const item of release.downloads) {
  const remote = catalog.downloads.find((entry) => entry.id === item.id);
  assert.ok(remote?.available, `${item.id} is available`);
  for (const field of ["filename", "bytes", "sha256", "contentType"])
    assert.equal(remote[field], item[field], `${item.id}: ${field}`);
  const url = new URL("/download/" + item.id, origin);
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200, `${item.id}: HEAD`);
  assert.equal(head.headers.get("Content-Length"), String(item.bytes));
  assert.equal(head.headers.get("Content-Type"), item.contentType);
  assert.equal(
    head.headers.get("Content-Disposition"),
    `attachment; filename="${item.filename}"`,
  );
  const partial = await fetch(url, { headers: { Range: "bytes=0-3" } });
  assert.equal(partial.status, 206, `${item.id}: resumable download`);
  assert.equal(partial.headers.get("Content-Range"), `bytes 0-3/${item.bytes}`);
  assert.equal((await partial.arrayBuffer()).byteLength, 4);
  const checksum = await fetch(
    new URL("/download/" + item.id + ".sha256", origin),
  );
  assert.equal(checksum.status, 200);
  assert.equal(await checksum.text(), `${item.sha256}  ${item.filename}\n`);
  const download = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  assert.equal(download.status, 200, `${item.id}: full download`);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of download.body) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  assert.equal(bytes, item.bytes, `${item.id}: downloaded byte count`);
  assert.equal(
    hash.digest("hex"),
    item.sha256,
    `${item.id}: downloaded SHA-256`,
  );
  console.log(
    `Verified ${item.filename}: ${bytes} bytes, SHA-256, headers and ranges.`,
  );
}
