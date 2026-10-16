import assert from "node:assert/strict";
import test from "node:test";
import { constants, generateKeyPairSync, sign } from "node:crypto";
import { verifyUpdate, updateDownload } from "../scripts/update-feed.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const now = Date.now();
const manifest = {
  schema: 1, channel: "preview", version: "0.1.0-preview.7",
  fileName: "Strife-0.1.0-preview.7-full.nupkg", bytes: 100,
  sha256: "a".repeat(64), sourceRef: "b".repeat(40),
  issuedAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 86400000).toISOString(),
  minimumWindowsBuild: 19041, minimumVcRuntime: "14.40.33810.0",
};
function envelope(value) {
  const payload = Buffer.from(JSON.stringify(value));
  return { payload: payload.toString("base64"), signature: sign("sha256", payload, {
    key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
  }).toString("base64") };
}
test("OTA feed binds immutable package bytes and provenance to a trusted signature", () => {
  assert.deepEqual(verifyUpdate(envelope(manifest), publicKey, now), manifest);
  assert.equal(updateDownload(manifest).key, `releases/${manifest.version}/${manifest.fileName}`);
  const changed = envelope(manifest);
  changed.payload = Buffer.from(JSON.stringify({ ...manifest, sha256: "c".repeat(64) })).toString("base64");
  assert.throws(() => verifyUpdate(changed, publicKey, now), /signature/);
  assert.throws(() => verifyUpdate(envelope(manifest)), /signature/);
});
test("OTA feed rejects expired, malformed, and unsafe signed metadata", () => {
  for (const patch of [
    { schema: 2 }, { channel: "unknown" }, { channel: "stable" }, { bytes: 0 },
    { bytes: 2 ** 40 }, { fileName: "../payload.exe" }, { sha256: "z".repeat(64) },
    { sourceRef: "main" }, { expiresAt: new Date(now - 1).toISOString() },
    { issuedAt: new Date(now + 3600000).toISOString() },
    { expiresAt: new Date(now + 46 * 86400000).toISOString() },
  ]) assert.throws(() => verifyUpdate(envelope({ ...manifest, ...patch }), publicKey, now));
});
