import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/;

function releaseValues(release) {
  if (!versionPattern.test(release.version ?? ""))
    throw new Error("Invalid release.json version.");
  if (
    typeof release.sourceRef !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(release.sourceRef) ||
    release.sourceRef.includes("..") ||
    release.sourceRef.split("/").some((part) => !part || part === ".")
  )
    throw new Error(
      "release.json sourceRef must be a Strife commit, tag, or branch.",
    );
  if (!Array.isArray(release.downloads) || !release.downloads.length)
    throw new Error("release.json must contain downloads.");
  const values = new Map([["version", release.version]]);
  for (const item of release.downloads) {
    const key = `filename:${item.id}`;
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id ?? "") ||
      typeof item.filename !== "string" ||
      !item.filename.startsWith(`Strife-${release.version}-`) ||
      !/^[A-Za-z0-9._-]+$/.test(item.filename) ||
      values.has(key)
    )
      throw new Error(`Invalid or duplicate release download: ${item.id}`);
    values.set(key, item.filename);
  }
  return values;
}

function renderReferences(html, release, values) {
  // Inline comments do not add whitespace to copied shell commands.
  const block = /<!-- release:([^\r\n]*?) -->([\s\S]*?)<!-- \/release -->/g;
  const renderBlock = (_match, key, previous) => {
    if (!values.has(key)) throw new Error(`Unknown release marker: ${key}`);
    if (/<!--\s*\/?release/.test(previous))
      throw new Error("Release markers cannot be nested.");
    return `<!-- release:${key} -->${values.get(key)}<!-- /release -->`;
  };
  let rendered = html.replace(block, renderBlock);
  let unmanaged = html.replace(block, "");
  if (/<!--\s*\/?release\b/.test(unmanaged))
    throw new Error(
      "Malformed release marker; use <!-- release:KEY -->value<!-- /release -->.",
    );

  const anchor = /<a\b[^>]*>/g;
  const renderAnchor = (tag) => {
    if (!/\bdata-release-doc\b/.test(tag)) return tag;
    const docs = [...tag.matchAll(/\bdata-release-doc="([^"]*)"/g)];
    if (docs.length !== 1)
      throw new Error("Use one double-quoted data-release-doc per link.");
    const doc = docs[0][1];
    if (
      !/^[A-Za-z0-9._/-]+$/.test(doc) ||
      doc.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error(`Invalid release documentation path: ${doc}`);
    if ([...tag.matchAll(/\shref="[^"]*"/g)].length !== 1)
      throw new Error("A data-release-doc link needs one double-quoted href.");
    const ref = release.sourceRef.split("/").map(encodeURIComponent).join("/");
    return tag.replace(
      /(\shref=")[^"]*(")/,
      `$1https://github.com/M-ax/strife/blob/${ref}/${doc}$2`,
    );
  };
  rendered = rendered.replace(anchor, renderAnchor);
  unmanaged = unmanaged.replace(anchor, (tag) => {
    if (!/\bdata-release-doc\b/.test(tag)) return tag;
    renderAnchor(tag);
    return "";
  });
  if (/\bdata-release-doc\b/.test(unmanaged))
    throw new Error("data-release-doc must be on an anchor element.");
  // Catch new hard-coded references on any page, not only existing wiki sections.
  if (
    /\bStrife(?:-|\s+)\d+\.\d+\.\d+/.test(unmanaged) ||
    /https:\/\/github\.com\/M-ax\/strife\/(?:blob|tree)\//.test(unmanaged)
  )
    throw new Error(
      "Unmanaged Strife build reference; add a release marker or data-release-doc link.",
    );
  return rendered;
}

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(file)));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(file);
  }
  return files.sort();
}

// Plan every page before writing anything, including during a release import.
export async function planReleaseDocs(directory, release) {
  const values = releaseValues(release);
  const changes = [];
  for (const file of await htmlFiles(path.join(directory, "public"))) {
    const html = await readFile(file, "utf8");
    let content;
    try {
      content = renderReferences(html, release, values);
    } catch (error) {
      throw new Error(`${path.relative(directory, file)}: ${error.message}`);
    }
    if (content !== html) changes.push({ file, content });
  }
  return changes;
}

export async function writeReleaseDocs(changes) {
  for (const { file, content } of changes) await writeFile(file, content);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
      throw new Error("Usage: node scripts/release-docs.mjs [--check]");
    const release = JSON.parse(
      await readFile(path.join(root, "release.json"), "utf8"),
    );
    const changes = await planReleaseDocs(root, release);
    if (args.includes("--check") && changes.length)
      throw new Error(
        `Stale release references: ${changes.map(({ file }) => path.relative(root, file)).join(", ")}. Run npm run release:docs.`,
      );
    if (!args.includes("--check")) await writeReleaseDocs(changes);
    console.log(
      `Release references match ${release.version} (${changes.length} pages updated).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
