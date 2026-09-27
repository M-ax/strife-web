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
const types = new Map([
  ["windows-x64", "application/vnd.microsoft.portable-executable"],
  ["windows-x64-portable", "application/zip"],
  ["linux-x64", "application/gzip"],
  ["macos-arm64", "application/zip"],
  ["macos-x64", "application/zip"],
]);
if (
  !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(
    release.version,
  ) ||
  !Array.isArray(release.downloads) ||
  !release.downloads.length
)
  throw new Error("Invalid release manifest.");
const ids = new Set();
// Check every package before uploading any part of a release.
for (const item of release.downloads) {
  if (
    !types.has(item.id) ||
    ids.has(item.id) ||
    item.contentType !== types.get(item.id) ||
    !/^[\w.-]+\.(?:zip|exe|tar\.gz)$/.test(item.filename) ||
    item.key !== `releases/${release.version}/${item.filename}`
  )
    throw new Error("Invalid release path or platform.");
  ids.add(item.id);
  const archive = path.join(root, "releases", item.filename);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (
    (await stat(archive)).size !== item.bytes ||
    hash.digest("hex") !== item.sha256
  )
    throw new Error(`Archive does not match release.json: ${item.filename}`);
}
for (const item of release.downloads) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/wrangler/bin/wrangler.js"),
      "r2",
      "object",
      "put",
      "strife-releases/" + item.key,
      "--file",
      path.join(root, "releases", item.filename),
      "--content-type",
      item.contentType,
      mode,
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
