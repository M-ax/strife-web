// Ephemeral upload service. It starts closed, accepts one exact immutable key,
// requires a random secret, expires automatically, and is deleted after upload.
const partSize = 8 * 1024 * 1024;
export default {
  async fetch(request, env) {
    const expires = Number(env.UPLOAD_EXPIRES);
    if (!env.UPLOAD_TOKEN) return new Response("Upload secret is not ready", { status: 401 });
    if (!Number.isFinite(expires) || Date.now() >= expires) return new Response("Upload session expired or unconfigured", { status: 401 });
    if (request.headers.get("Authorization") !== `Bearer ${env.UPLOAD_TOKEN}`) return new Response("Unauthorized", { status: 401 });
    if (!/^releases\/[\w.-]+\/[\w.-]+$/.test(env.OBJECT_KEY)
        || !/^[a-f0-9]{64}$/.test(env.OBJECT_SHA256)) return new Response("Not configured", { status: 503 });
    const total = Number(env.OBJECT_BYTES);
    if (!Number.isSafeInteger(total) || total < 1 || total > 1073741824) return new Response("Invalid size", { status: 503 });
    const url = new URL(request.url);
    const bucket = env.RELEASES;
    if (url.pathname === "/head" && request.method === "GET") {
      const object = await bucket.head(env.OBJECT_KEY);
      return Response.json(object ? { size: object.size, customMetadata: object.customMetadata } : null);
    }
    if (url.pathname === "/existing" && request.method === "GET") {
      const object = await bucket.get(env.OBJECT_KEY);
      return object ? new Response(object.body, { headers: {
        "Content-Type": "application/octet-stream", "Content-Length": String(object.size),
      } }) : new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/create" && request.method === "POST") {
      if (await bucket.head(env.OBJECT_KEY)) return new Response("Object already exists", { status: 409 });
      const upload = await bucket.createMultipartUpload(env.OBJECT_KEY, {
        httpMetadata: { contentType: env.OBJECT_CONTENT_TYPE },
        customMetadata: { sha256: env.OBJECT_SHA256 },
      });
      return Response.json({ uploadId: upload.uploadId });
    }
    const id = url.searchParams.get("uploadId");
    if (!id || id.length > 2048) return new Response("Invalid upload", { status: 400 });
    const upload = bucket.resumeMultipartUpload(env.OBJECT_KEY, id);
    if (url.pathname === "/part" && request.method === "PUT") {
      const number = Number(url.searchParams.get("number"));
      const length = Math.min(partSize, total - (number - 1) * partSize);
      if (!Number.isInteger(number) || number < 1 || number > Math.ceil(total / partSize)
          || Number(request.headers.get("Content-Length")) !== length) return new Response("Invalid part", { status: 400 });
      return Response.json(await upload.uploadPart(number, request.body));
    }
    if (url.pathname === "/complete" && request.method === "POST") {
      const length = Number(request.headers.get("Content-Length"));
      if (length < 2 || length > 65536) return new Response("Invalid length", { status: 413 });
      const parts = await request.json();
      if (!Array.isArray(parts) || parts.length !== Math.ceil(total / partSize)
          || parts.some((part, index) => !part || part.partNumber !== index + 1 || typeof part.etag !== "string" || !part.etag.length || part.etag.length > 256))
        return new Response("Invalid parts", { status: 400 });
      if (await bucket.head(env.OBJECT_KEY)) return new Response("Object already exists", { status: 409 });
      return Response.json({ size: (await upload.complete(parts)).size });
    }
    if (url.pathname === "/abort" && request.method === "DELETE") {
      await upload.abort();
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  },
};
