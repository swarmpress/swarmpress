/**
 * Writes `packages/sdk/schemas/*.schema.json` from the zod sources in
 * `src/schemas.ts`. With `--check`, exits 1 when a committed file drifts.
 *
 *   bun scripts/export-json-schema.ts [--check]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { JSON_SCHEMAS } from "../src/schemas.ts";
import { SDK_VERSION } from "../src/version.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const check = process.argv.includes("--check");

export function render(name: string): string {
  const schema = JSON_SCHEMAS[name as keyof typeof JSON_SCHEMAS];
  const json = zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema7" }) as Record<string, unknown>;
  const doc = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `https://simpress.dev/sdk/${SDK_VERSION}/${name}`,
    title: name.replace(".schema.json", ""),
    ...json,
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

let drift = 0;
await mkdir(outDir, { recursive: true });
for (const name of Object.keys(JSON_SCHEMAS)) {
  const path = join(outDir, name);
  const next = render(name);
  if (check) {
    const cur = await readFile(path, "utf8").catch(() => "");
    if (cur !== next) {
      console.error(`drift: schemas/${name} differs from src/schemas.ts (run: pnpm --filter @simpress/sdk export)`);
      drift++;
    }
  } else {
    await writeFile(path, next);
    console.log(`wrote schemas/${name}`);
  }
}
if (drift) process.exit(1);
if (check) console.log(`schemas up to date (${Object.keys(JSON_SCHEMAS).length} files)`);
