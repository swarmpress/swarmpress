import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifestSchema } from "@simpress/sdk";
import { main } from "../src/cli.ts";
import type { Out } from "../src/commands.ts";
import { logger } from "../src/engine.ts";
import type { Extension } from "../src/extension.ts";

export const ROOT = join(import.meta.dir, "..", "..", "..");
export const EXAMPLES = join(ROOT, "examples", "extensions");
export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export async function simpress(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const o: string[] = [];
  const e: string[] = [];
  const sink: Out = { log: (l) => o.push(l), error: (l) => e.push(l) };
  const code = await main(argv, sink);
  return { code, out: o.join("\n"), err: e.join("\n") };
}

export function tempDir(prefix = "simpress-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function ext(manifest: Record<string, unknown>): Extension {
  return {
    dir: "/nonexistent",
    manifest: ManifestSchema.parse({ id: "com.example.t", name: "T", version: "0.1.0", sdk: "^0.1.0", ...manifest }),
    content: [],
    packHash: "",
    files: [],
  };
}

export const log = logger().host("t");
