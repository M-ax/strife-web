import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { uploadMultipart } from "./multipart-upload.mjs";

export async function uploadRemoteRelease(root, filename, item) {
  const name = `strife-upload-${randomBytes(8).toString("hex")}`;
  const token = randomBytes(32).toString("hex");
  const cli = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  const config = path.join(root, "scripts/r2-upload.wrangler.jsonc");
  function wrangler(args, input) {
    const result = spawnSync(process.execPath, [cli, ...args, "--config", config, "--name", name],
      { cwd: root, input, encoding: "utf8", windowsHide: true, timeout: 180000 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Temporary upload Worker command failed: ${args[0]}`);
    return result.stdout;
  }
  try {
    const output = wrangler(["deploy",
      "--var", `OBJECT_KEY:${item.key}`, "--var", `OBJECT_BYTES:${item.bytes}`,
      "--var", `OBJECT_SHA256:${item.sha256}`, "--var", `OBJECT_CONTENT_TYPE:${item.contentType}`,
      "--var", `UPLOAD_EXPIRES:${Date.now() + 30 * 60 * 1000}`]);
    const url = output.match(new RegExp(`https://${name}\\.[a-z0-9-]+\\.workers\\.dev`))?.[0];
    if (!url) throw new Error("Cannot find temporary upload Worker URL.");
    // stdin goes directly to Cloudflare's secret store, never to a file or argv.
    wrangler(["secret", "put", "UPLOAD_TOKEN"], token);
    async function responseFor(route, method = "GET", body, timeout = 120000) {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(url + route, {
          method, headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-store" }, body,
          redirect: "error", signal: AbortSignal.timeout(timeout),
        });
        if (response.ok) return response;
        const error = await response.text();
        // Serving edges can converge at different times after secret creation.
        // This exact guard runs before *any* R2 operation, so retrying it is safe
        // even for create/complete. Never retry ambiguous mutation failures.
        const notReady = response.status === 401 && error === "Upload secret is not ready";
        const transientRead = method === "GET" && (response.status === 404 || response.status === 429 || response.status >= 500);
        if (attempt < 29 && (notReady || transientRead)) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        throw new Error(`Multipart ${method} failed: HTTP ${response.status}: ${error.slice(0, 200)}`);
      }
    }
    async function call(route, method = "GET", body) {
      const response = await responseFor(route, method, body);
      return response.status === 204 ? null : response.json();
    }
    const bucket = {
      head: () => call("/head"),
      async matchesExisting() {
        // Recover an upload whose REST response was lost, without overwriting an
        // immutable object or trusting an unsigned size-only comparison.
        const response = await responseFor("/existing", "GET", undefined, 600000);
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > item.bytes) throw new Error("Existing release is larger than expected.");
          hash.update(chunk);
        }
        return bytes === item.bytes && hash.digest("hex") === item.sha256;
      },
      async createMultipartUpload() {
        const { uploadId } = await call("/create", "POST");
        const query = "?uploadId=" + encodeURIComponent(uploadId);
        return {
          uploadPart: (number, buffer) => call("/part" + query + "&number=" + number, "PUT", buffer),
          complete: parts => call("/complete" + query, "POST", JSON.stringify(parts)),
          abort: () => call("/abort" + query, "DELETE"),
        };
      },
    };
    await uploadMultipart(bucket, filename, item);
  } finally {
    // The service also denies all requests after 30 minutes if cleanup fails.
    try { wrangler(["delete", "--force"]); }
    catch (error) { throw new Error(`Remove temporary Worker ${name} in Cloudflare; it expires automatically. ${error.message}`); }
  }
}
