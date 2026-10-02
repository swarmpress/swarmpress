/**
 * Makes `bun test --reporter=junit` output linkable by Cockpit: Bun sets each
 * testcase's classname to its describe() block, Cockpit expects the test file
 * path (relative to the package, like vitest). Rewrites classname to the
 * enclosing <testsuite file="…">.
 *
 *   bun ../sdk/scripts/bun-junit.ts reports/junit.xml
 */
import { readFile, writeFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) {
  console.error("usage: bun-junit.ts <junit.xml>");
  process.exit(2);
}
const xml = await readFile(path, "utf8").catch(() => null);
if (xml === null) {
  console.error(`bun-junit: ${path} not found (did bun test run?)`);
  process.exit(1);
}
let file = "";
const out = xml.replace(/<testsuite\b[^>]*>|<testcase\b[^>]*>/g, (tag) => {
  if (tag.startsWith("<testsuite")) {
    file = /\bfile="([^"]*)"/.exec(tag)?.[1] ?? file;
    return tag;
  }
  return file ? tag.replace(/\bclassname="[^"]*"/, `classname="${file}"`) : tag;
});
await writeFile(path, out);
