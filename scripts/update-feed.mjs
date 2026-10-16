import { readFile } from "node:fs/promises";
import { constants, verify } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicKey = await readFile(path.join(root, "scripts/update-key.pem"), "utf8");

export function verifyUpdate(envelope, key = publicKey, now = Date.now(), requireFresh = true) {
  if (JSON.stringify(envelope).length > 32768) throw new Error("Oversized update feed.");
  const payload = Buffer.from(envelope.payload, "base64");
  if (!verify("sha256", payload, {
    key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
  }, Buffer.from(envelope.signature, "base64"))) throw new Error("Invalid update signature.");
  const value = JSON.parse(payload);
  const issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt);
  if (value.schema !== 1 || !["stable", "preview"].includes(value.channel)
      || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(value.version)
      || (value.channel === "stable" && value.version.includes("-"))
      || value.fileName !== `Strife-${value.version}-full.nupkg`
      || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 1073741824
      || !/^[a-f0-9]{64}$/.test(value.sha256) || !/^[a-f0-9]{40}$/.test(value.sourceRef)
      || !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 600000
      || (requireFresh && expires <= now) || expires <= issued || expires > issued + 45 * 86400000
      || !Number.isInteger(value.minimumWindowsBuild) || value.minimumWindowsBuild < 19041
      || !/^\d+\.\d+\.\d+\.\d+$/.test(value.minimumVcRuntime)) throw new Error("Invalid or expired update metadata.");
  return value;
}

export function updateDownload(manifest) {
  return {
    id: `update-${manifest.channel}`,
    platform: "Windows x64 update",
    filename: manifest.fileName,
    key: `releases/${manifest.version}/${manifest.fileName}`,
    bytes: manifest.bytes, sha256: manifest.sha256,
    contentType: "application/octet-stream",
  };
}

export async function readUpdates() {
  const { feeds } = JSON.parse(await readFile(path.join(root, "updates.json"), "utf8"));
  if (!Array.isArray(feeds) || feeds.length > 2) throw new Error("Invalid update feed catalog.");
  const channels = new Set();
  return feeds.map(envelope => {
    const manifest = verifyUpdate(envelope);
    if (channels.has(manifest.channel)) throw new Error("Duplicate update channel.");
    channels.add(manifest.channel);
    return { envelope, manifest, download: updateDownload(manifest) };
  });
}
