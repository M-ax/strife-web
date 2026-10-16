import { open } from "node:fs/promises";
import { createHash } from "node:crypto";

// The caller verifies every local package before any remote mutation.
// Use bounded, ordered parts rather than buffering an installer in memory.
export async function uploadMultipart(bucket, filename, item, partSize = 8 * 1024 * 1024) {
  const existing = await bucket.head(item.key);
  if (existing) {
    if (existing.size === item.bytes && (existing.customMetadata?.sha256 === item.sha256
        || !existing.customMetadata?.sha256 && await bucket.matchesExisting?.(item))) {
      console.log(`Already uploaded ${item.filename}.`);
      return;
    }
    throw new Error(`Refusing to overwrite existing release object: ${item.key}`);
  }
  const upload = await bucket.createMultipartUpload(item.key, {
    httpMetadata: { contentType: item.contentType },
    customMetadata: { sha256: item.sha256 },
  });
  try {
    const file = await open(filename, "r");
    const parts = [];
    const hash = createHash("sha256");
    try {
      let position = 0;
      while (position < item.bytes) {
        const buffer = Buffer.alloc(Math.min(partSize, item.bytes - position));
        let filled = 0;
        while (filled < buffer.length) {
          const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, position + filled);
          if (!bytesRead) throw new Error("Release file changed during upload.");
          filled += bytesRead;
        }
        hash.update(buffer);
        parts.push(await upload.uploadPart(parts.length + 1, buffer));
        position += filled;
        console.log(`${item.filename}: ${position}/${item.bytes} bytes uploaded.`);
      }
      if ((await file.stat()).size !== item.bytes) throw new Error("Release file changed during upload.");
      if (hash.digest("hex") !== item.sha256) throw new Error("Release file changed during upload.");
    } finally { await file.close(); }
    const object = await upload.complete(parts);
    if (object.size !== item.bytes) throw new Error("R2 multipart completion returned the wrong size.");
  } catch (error) {
    await upload.abort().catch(() => {});
    throw error;
  }
}
