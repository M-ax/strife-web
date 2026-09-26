import { copyFile, mkdir } from "node:fs/promises";

await mkdir("public/fonts", { recursive: true });
for (const [family, weight] of [
  ["barlow-condensed", 800],
  ["dm-sans", 400],
  ["dm-sans", 500],
  ["dm-sans", 700],
]) {
  const file = family + "-latin-" + weight + "-normal.woff2";
  await copyFile(
    "node_modules/@fontsource/" + family + "/files/" + file,
    "public/fonts/" + file,
  );
}
for (const family of ["barlow-condensed", "dm-sans"]) {
  await copyFile(
    "node_modules/@fontsource/" + family + "/LICENSE",
    "public/fonts/" + family + "-LICENSE.txt",
  );
}
console.log("Self-hosted fonts and licenses copied.");
