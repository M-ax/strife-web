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

const frameworks = [
  { name: "Microsoft.NETCore.App", version: "10.0.0" },
  { name: "Microsoft.AspNetCore.App", version: "10.0.1" },
];
const schema2 = { ...manifest, schema: 2, dotNetFrameworks: frameworks };

test("schema 2 accepts exactly both supported frameworks in either order", () => {
  for (const dotNetFrameworks of [
    frameworks, [...frameworks].reverse(),
    frameworks.map(framework => ({ ...framework, version: "0.2147483647.0" })),
  ]) {
    const value = { ...schema2, dotNetFrameworks };
    assert.deepEqual(verifyUpdate(envelope(value), publicKey, now), value);
  }
});

test("schema 1 rejects non-null framework declarations instead of treating them as legacy", () => {
  assert.deepEqual(verifyUpdate(envelope({ ...manifest, dotNetFrameworks: null }), publicKey, now),
    { ...manifest, dotNetFrameworks: null });
  for (const dotNetFrameworks of [frameworks, [], {}, false, 0, ""]) {
    assert.throws(() => verifyUpdate(envelope({ ...manifest, dotNetFrameworks }), publicKey, now),
      /metadata/);
  }
});

test("schema 2 rejects missing, malformed, unsupported, or duplicate framework declarations", () => {
  for (const dotNetFrameworks of [
    undefined, null, {}, "frameworks", [], [frameworks[0]],
    [...frameworks, frameworks[0]], [frameworks[0], frameworks[0]],
    [frameworks[1], frameworks[1]],
    [frameworks[0], { ...frameworks[1], name: "Microsoft.WindowsDesktop.App" }],
    [frameworks[0], { ...frameworks[1], name: "microsoft.aspnetcore.app" }],
    [frameworks[0], null], [frameworks[0], []], [frameworks[0], "framework"],
    [frameworks[0], {}],
  ]) {
    assert.throws(() => verifyUpdate(envelope({ ...schema2, dotNetFrameworks }), publicKey, now),
      /metadata/);
  }
  assert.throws(() => verifyUpdate(envelope({ ...schema2, schema: 3 }), publicKey, now), /metadata/);
});

test("schema 2 requires stable three-component versions bounded by Int32", () => {
  for (const version of [
    undefined, null, 10, {}, "", "10", "10.0", "10.0.0.0", "10.0.0-preview.1",
    "10.0.0+build", "-1.0.0", "+1.0.0", " 10.0.0", "10.0.0\n", "1e1.0.0",
    "2147483648.0.0", "0.2147483648.0", "0.0.2147483648", "99999999999999999999.0.0",
  ]) {
    const dotNetFrameworks = [{ ...frameworks[0], version }, frameworks[1]];
    assert.throws(() => verifyUpdate(envelope({ ...schema2, dotNetFrameworks }), publicKey, now),
      /metadata/, `version: ${JSON.stringify(version)}`);
  }
});

test("schema 2 retains signature, freshness, and package metadata validation", () => {
  const changed = envelope(schema2);
  changed.payload = Buffer.from(JSON.stringify({ ...schema2, dotNetFrameworks: [] })).toString("base64");
  assert.throws(() => verifyUpdate(changed, publicKey, now), /signature/);
  assert.throws(() => verifyUpdate(envelope(schema2)), /signature/);
  for (const patch of [
    { bytes: 0 }, { fileName: "../payload.exe" }, { sha256: "z".repeat(64) },
    { sourceRef: "main" }, { expiresAt: new Date(now - 1).toISOString() },
  ]) {
    assert.throws(() => verifyUpdate(envelope({ ...schema2, ...patch }), publicKey, now), /metadata/);
  }
  const expired = { ...schema2, expiresAt: new Date(now - 1).toISOString() };
  assert.deepEqual(verifyUpdate(envelope(expired), publicKey, now, false), expired);
});
