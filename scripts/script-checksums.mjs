import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const names = ["mumble.sh", "helltube.sh", "doctor.sh"];
const lines = [];
for (const name of names) {
  const bytes = await readFile(
    new URL(`../public/scripts/${name}`, import.meta.url),
  );
  if (bytes.includes(13)) throw new Error(`${name} must use LF line endings.`);
  lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
}
const file = new URL("../public/scripts/SHA256SUMS", import.meta.url);
const expected = lines.join("");
if (process.argv.includes("--check")) {
  if ((await readFile(file, "utf8")) !== expected)
    throw new Error(
      "Script checksums are stale. Run npm run scripts:checksums.",
    );
  console.log("Bootstrap script checksums match.");
} else {
  await writeFile(file, expected);
  console.log("Wrote public script checksums.");
}
