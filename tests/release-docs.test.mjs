import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../release.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextVersion = "9.8.7-preview.42";
const nextRef = "releases/v9.8.7-preview.42";

function nextRelease() {
  return {
    ...manifest,
    version: nextVersion,
    sourceRef: nextRef,
    downloads: manifest.downloads.map((item) => ({
      ...item,
      filename: item.filename.replace(manifest.version, nextVersion),
      key: item.key.replaceAll(manifest.version, nextVersion),
    })),
  };
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "strife-release-docs-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "scripts"));
  await mkdir(path.join(directory, "public", "wiki"), { recursive: true });
  for (const file of [
    "release.json",
    "scripts/release-docs.mjs",
    "scripts/import-release.mjs",
    "public/index.html",
    "public/wiki/index.html",
  ])
    await cp(path.join(root, file), path.join(directory, file));
  return directory;
}

function run(directory, script, ...args) {
  const result = spawnSync(
    process.execPath,
    [path.join(directory, "scripts", script), ...args],
    {
      cwd: tmpdir(), // Tools resolve the repository from their own location.
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.ifError(result.error);
  return { ...result, output: result.stdout + result.stderr };
}

async function writeManifest(directory, release) {
  await writeFile(
    path.join(directory, "release.json"),
    JSON.stringify(release),
  );
}

async function artifacts(directory, release) {
  const source = path.join(directory, "artifacts");
  await mkdir(source);
  for (const item of release.downloads)
    await writeFile(path.join(source, item.filename), `fixture for ${item.id}`);
  return source;
}

test("release docs check accepts the committed website", async (t) => {
  const directory = await fixture(t);
  const result = run(directory, "release-docs.mjs", "--check");
  assert.equal(result.status, 0, result.output);
});

test("refreshes a new build across nested pages, checks without writing, and is idempotent", async (t) => {
  const directory = await fixture(t);
  const wiki = path.join(directory, "public/wiki/index.html");
  const before = await readFile(wiki, "utf8");
  const nested = path.join(directory, "public/wiki/install/mac.html");
  await mkdir(path.dirname(nested));
  await writeFile(
    nested,
    "<code><!-- release:filename:macos-x64 -->old.zip<!-- /release -->.sha256</code>",
  );
  await writeManifest(directory, nextRelease());
  const check = run(directory, "release-docs.mjs", "--check");
  assert.equal(check.status, 1);
  assert.match(check.output, /Stale release references.*release:docs/);
  assert.equal(await readFile(wiki, "utf8"), before);

  const update = run(directory, "release-docs.mjs");
  assert.equal(update.status, 0, update.output);
  const after = await readFile(wiki, "utf8");
  assert.ok(!after.includes(manifest.version));
  for (const id of ["windows-x64", "linux-x64", "macos-arm64"])
    assert.ok(
      after.includes(
        nextRelease().downloads.find((item) => item.id === id).filename,
      ),
    );
  assert.ok(
    after.includes(`<!-- release:version -->${nextVersion}<!-- /release -->`),
  );
  assert.ok(after.includes(`/blob/${nextRef}/docs/releases.md`));
  assert.ok(after.includes(`/blob/${nextRef}/README.md`));
  assert.equal(
    after.match(/Last reviewed:.*?<\/time>/)[0],
    before.match(/Last reviewed:.*?<\/time>/)[0],
  );
  assert.equal(
    after.match(/https:\/\/github.com\/M-ax\/helltube\/tree\/\w+/)[0],
    before.match(/https:\/\/github.com\/M-ax\/helltube\/tree\/\w+/)[0],
  );
  assert.ok(
    (
      await readFile(path.join(directory, "public/index.html"), "utf8")
    ).includes(`/blob/${nextRef}/docs/releases.md`),
  );
  assert.ok(
    (await readFile(nested, "utf8")).includes(
      `Strife-${nextVersion}-osx-x64.zip<!-- /release -->.sha256`,
    ),
  );
  assert.equal(run(directory, "release-docs.mjs", "--check").status, 0);
  const again = run(directory, "release-docs.mjs");
  assert.equal(again.status, 0, again.output);
  assert.match(again.output, /0 pages updated/);
  assert.equal(await readFile(wiki, "utf8"), after);
});

test("invalid references or metadata fail before updating any page", async (t) => {
  const cases = [
    [
      "unknown marker",
      "<!-- release:filename:missing -->old<!-- /release -->",
      /Unknown release marker/,
    ],
    [
      "unclosed marker",
      "<!-- release:version -->old",
      /Malformed release marker/,
    ],
    [
      "nested marker",
      "<!-- release:version --><!-- release:version -->old<!-- /release --><!-- /release -->",
      /cannot be nested/,
    ],
    [
      "unmarked version",
      "<p>Strife 0.0.1</p>",
      /Unmanaged Strife build reference/,
    ],
    [
      "unmarked archive",
      "<code>Strife-0.0.1-osx-x64.zip</code>",
      /Unmanaged Strife build reference/,
    ],
    [
      "unmarked source link",
      '<a href="https://github.com/M-ax/strife/blob/main/docs/releases.md">Guide</a>',
      /Unmanaged Strife build reference/,
    ],
    [
      "bad doc path",
      '<a data-release-doc="../other" href="old">Guide</a>',
      /Invalid release documentation path/,
    ],
    [
      "missing href",
      '<a data-release-doc="README.md">Guide</a>',
      /needs one double-quoted href/,
    ],
    [
      "bad source ref",
      "",
      /sourceRef/,
      (release) => {
        release.sourceRef = "../main";
      },
    ],
    [
      "missing download",
      "",
      /Unknown release marker/,
      (release) => {
        release.downloads = release.downloads.filter(
          (item) => item.id !== "linux-x64",
        );
      },
    ],
    [
      "invalid filename",
      "",
      /Invalid or duplicate release download/,
      (release) => {
        release.downloads[0].filename = "../file.exe";
      },
    ],
    [
      "duplicate download",
      "",
      /Invalid or duplicate release download/,
      (release) => {
        release.downloads.push(release.downloads[0]);
      },
    ],
  ];
  for (const [name, html, message, mutate] of cases) {
    await t.test(name, async (t) => {
      const directory = await fixture(t);
      const wiki = path.join(directory, "public/wiki/index.html");
      const before = await readFile(wiki, "utf8");
      const release = nextRelease();
      mutate?.(release);
      await writeManifest(directory, release);
      await writeFile(path.join(directory, "public/z-invalid.html"), html);
      const result = run(directory, "release-docs.mjs");
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, message);
      assert.equal(await readFile(wiki, "utf8"), before);
    });
  }
});

test("release import requires build provenance, updates docs, and preserves same-version provenance", async (t) => {
  const directory = await fixture(t);
  const source = await artifacts(directory, nextRelease());
  const missingRef = run(directory, "import-release.mjs", source, nextVersion);
  assert.equal(missingRef.status, 1);
  assert.match(missingRef.output, /new release requires SOURCE_REF/);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, "release.json"), "utf8")),
    manifest,
  );
  const imported = run(
    directory,
    "import-release.mjs",
    source,
    nextVersion,
    nextRef,
  );
  assert.equal(imported.status, 0, imported.output);
  const release = JSON.parse(
    await readFile(path.join(directory, "release.json"), "utf8"),
  );
  assert.equal(release.version, nextVersion);
  assert.equal(release.sourceRef, nextRef);
  assert.equal(run(directory, "release-docs.mjs", "--check").status, 0);
  for (const item of release.downloads) {
    assert.equal(
      await readFile(path.join(directory, "releases", item.filename), "utf8"),
      `fixture for ${item.id}`,
    );
    assert.equal(
      await readFile(
        path.join(directory, "releases", item.filename + ".sha256"),
        "utf8",
      ),
      `${item.sha256}  ${item.filename}\n`,
    );
  }
  release.publishedAt = "2025-01-02";
  await writeManifest(directory, release);
  const repeated = run(directory, "import-release.mjs", source, nextVersion);
  assert.equal(repeated.status, 0, repeated.output);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, "release.json"), "utf8")),
    release,
  );
});

test("release import rejects broken docs before changing the manifest or copying archives", async (t) => {
  const directory = await fixture(t);
  const source = await artifacts(directory, nextRelease());
  await writeFile(
    path.join(directory, "public/broken.html"),
    "<!-- release:unknown -->old<!-- /release -->",
  );
  const result = run(
    directory,
    "import-release.mjs",
    source,
    nextVersion,
    nextRef,
  );
  assert.equal(result.status, 1);
  assert.match(result.output, /Unknown release marker/);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, "release.json"), "utf8")),
    manifest,
  );
  await assert.rejects(
    readFile(
      path.join(directory, "releases", nextRelease().downloads[0].filename),
    ),
    { code: "ENOENT" },
  );
});
