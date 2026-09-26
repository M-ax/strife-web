import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
if (!["--local", "--remote"].includes(mode))
  throw new Error("Specify --local or --remote.");
const release = JSON.parse(
  await readFile(path.join(root, "release.json"), "utf8"),
);
if (
  !/^[\w.-]+\.zip$/.test(release.filename) ||
  release.key !== "releases/" + release.version + "/" + release.filename
)
  throw new Error("Invalid release path.");
const archive = path.join(root, "releases", release.filename);
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
if (
  (await stat(archive)).size !== release.bytes ||
  hash.digest("hex") !== release.sha256
)
  throw new Error(
    "Archive does not match release.json. Refusing to upload it.",
  );
const args = [
  path.join(root, "node_modules/wrangler/bin/wrangler.js"),
  "r2",
  "object",
  "put",
  "strife-releases/" + release.key,
  "--file",
  archive,
  "--content-type",
  "application/zip",
  mode,
];
const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
