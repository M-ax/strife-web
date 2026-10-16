import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { uploadMultipart } from "../scripts/multipart-upload.mjs";
import uploadWorker from "../scripts/multipart-worker.mjs";

test("temporary upload service is closed by default, expires, and binds one key", async () => {
  const env = {
    UPLOAD_TOKEN: "test-capability", UPLOAD_EXPIRES: String(Date.now() + 60000),
    OBJECT_KEY: "releases/1.0.0/Strife-Setup.exe", OBJECT_BYTES: "9",
    OBJECT_SHA256: "a".repeat(64), OBJECT_CONTENT_TYPE: "application/octet-stream",
    RELEASES: { async head(key) { assert.equal(key, env.OBJECT_KEY); return { size: 9 }; } },
  };
  const request = (headers = {}) => new Request("https://upload.example/head?key=unrelated", { headers });
  assert.equal((await uploadWorker.fetch(request(), env)).status, 401);
  assert.equal((await uploadWorker.fetch(request({ Authorization: "Bearer test-capability" }), { ...env, UPLOAD_EXPIRES: undefined })).status, 401);
  assert.equal((await uploadWorker.fetch(request({ Authorization: "Bearer test-capability" }), { ...env, UPLOAD_EXPIRES: "0" })).status, 401);
  const result = await uploadWorker.fetch(request({ Authorization: "Bearer test-capability" }), env);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).size, 9);
});

test("multipart upload orders bounded parts and completes the full object", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "strife-upload-"));
  try {
    const file = path.join(directory, "setup.exe");
    const bytes = Buffer.from("123456789");
    await writeFile(file, bytes);
    const parts = [];
    const item = { key: "releases/test/setup.exe", filename: "setup.exe", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "application/octet-stream" };
    await uploadMultipart({
      head: async () => null,
      createMultipartUpload: async (key, options) => {
        assert.equal(key, item.key);
        assert.equal(options.customMetadata.sha256, item.sha256);
        return {
          async uploadPart(number, buffer) { parts.push(Buffer.from(buffer)); return { partNumber: number, etag: String(number) }; },
          async complete(sent) {
            assert.deepEqual(sent.map(part => part.partNumber), [1, 2, 3]);
            assert.deepEqual(Buffer.concat(parts), bytes);
            return { size: bytes.length };
          },
          async abort() { assert.fail("unexpected abort"); },
        };
      },
    }, file, item, 4);
    await assert.rejects(uploadMultipart({ head: async () => ({ size: 1 }) }, file, item), /overwrite/);
    let aborted = false;
    await assert.rejects(uploadMultipart({
      head: async () => null,
      createMultipartUpload: async () => ({
        uploadPart: async () => { throw new Error("network failure"); },
        abort: async () => { aborted = true; },
      }),
    }, file, item, 4), /network failure/);
    assert.equal(aborted, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
