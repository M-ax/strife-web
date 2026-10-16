import { readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyUpdate } from "./update-feed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [source] = process.argv.slice(2);
if (!source) throw new Error("Usage: import-update.mjs ARTIFACT_DIRECTORY");
const release = JSON.parse(await readFile(path.join(root, "release.json"), "utf8"));
const channel = release.version.includes("-") ? "preview" : "stable";
const envelope = JSON.parse(await readFile(path.join(source, `windows-${channel}.json`), "utf8"));
const manifest = verifyUpdate(envelope);
if (manifest.version !== release.version || manifest.sourceRef !== release.sourceRef || manifest.channel !== channel)
  throw new Error("Update feed must describe the imported release's exact version and commit.");
const archive = path.join(source, manifest.fileName);
async function hash(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
if ((await stat(archive)).size !== manifest.bytes || await hash(archive) !== manifest.sha256)
  throw new Error("Update package does not match signed metadata.");
const destination = path.join(root, "releases", manifest.fileName);
try { await copyFile(archive, destination, constants.COPYFILE_EXCL); }
catch (error) {
  if (error.code !== "EEXIST" || await hash(destination) !== manifest.sha256) throw error;
}
const previous = JSON.parse(await readFile(path.join(root, "updates.json"), "utf8"));
// Verify retained channels too; publishing must not silently retain expired feeds.
const feeds = previous.feeds.filter(item => verifyUpdate(item, undefined, Date.now(), false).channel !== channel);
for (const item of feeds) verifyUpdate(item);
feeds.push(envelope);
await writeFile(path.join(root, "updates.json"), JSON.stringify({ feeds }, null, 2) + "\n");
console.log(`Imported authenticated ${channel} updater package for ${manifest.version}.`);
