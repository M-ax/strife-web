import { createReadStream, constants } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [source, version] = process.argv.slice(2);
if (
  !source ||
  !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(version ?? "")
)
  throw new Error(
    "Usage: node scripts/import-release.mjs ARTIFACT_DIRECTORY VERSION",
  );

const targets = [
  [
    "windows-x64",
    "Windows x64",
    "win-x64-Setup.exe",
    "application/vnd.microsoft.portable-executable",
  ],
  [
    "windows-x64-portable",
    "Windows x64 portable",
    "win-x64.zip",
    "application/zip",
  ],
  ["linux-x64", "Linux x64", "linux-x64.tar.gz", "application/gzip"],
  ["macos-arm64", "macOS Apple Silicon", "osx-arm64.zip", "application/zip"],
  ["macos-x64", "macOS Intel", "osx-x64.zip", "application/zip"],
];
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// Validate the complete set before copying or changing the advertised release.
const downloads = await Promise.all(
  targets.map(async ([id, platform, suffix, contentType]) => {
    const filename = `Strife-${version}-${suffix}`;
    const archive = path.resolve(source, filename);
    const info = await stat(archive);
    if (!info.isFile() || !info.size)
      throw new Error(`Missing package: ${filename}`);
    return {
      id,
      platform,
      filename,
      key: `releases/${version}/${filename}`,
      bytes: info.size,
      sha256: await sha256(archive),
      contentType,
    };
  }),
);
const destination = path.join(root, "releases");
await mkdir(destination, { recursive: true });
for (const item of downloads) {
  const archive = path.join(destination, item.filename);
  try {
    await copyFile(
      path.resolve(source, item.filename),
      archive,
      constants.COPYFILE_EXCL,
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if ((await sha256(archive)) !== item.sha256)
      throw new Error(
        `Version already exists with different bytes: ${item.filename}. Choose a new version.`,
      );
  }
  await writeFile(archive + ".sha256", `${item.sha256}  ${item.filename}\n`);
}
let publishedAt = new Date().toISOString().slice(0, 10);
const previous = JSON.parse(
  await readFile(path.join(root, "release.json"), "utf8"),
);
if (previous.version === version) publishedAt = previous.publishedAt;
await writeFile(
  path.join(root, "release.json"),
  JSON.stringify({ version, publishedAt, downloads }, null, 2) + "\n",
);
console.log(`Imported ${downloads.length} verified packages for ${version}.`);
