#!/usr/bin/env bun
/**
 * swarmpress — the headless swarm.press host (ADR-0042).
 *
 *   bun packages/runner/src/cli.ts <command> …     (Node 22+: node packages/runner/src/cli.ts …)
 */
import { pathToFileURL } from "node:url";
import { SDK_VERSION } from "@swarm-press/sdk";
import { cmdBuild, cmdCheck, cmdNew, cmdPack, cmdRun, cmdTest, consoleOut, type Out } from "./commands.ts";
import { TEMPLATE_KINDS } from "./templates.ts";
import { REPO_ROOT } from "./wasm.ts";
import { runConformance } from "./wordpress.ts";

export const USAGE = `swarmpress ${SDK_VERSION} — headless swarm.press host and extension toolkit

usage:
  swarmpress new <kind> <dir>        scaffold an extension (${TEMPLATE_KINDS.join(" | ")})
  swarmpress check <dir>             manifest, schemas, sdk range, capabilities, bundle exports, determinism replay
  swarmpress build <dir>             bundle entry.bundle into dist/ext.bundle.js (one IIFE, sets globalThis.ext)
  swarmpress run [options]           run the wasm sim headless and drive extensions through the sandbox
      --seed <u64>                 world seed (default 42)
      --days <n>                   game days to fast-forward (default 1)
      --ext <dir>                  load an extension (repeatable)
      --world demo|empty           starting world (default demo)
      --web fixtures|live          fixture-backed fetch (default) or the real network
      --json                       print one JSON report instead of text
  swarmpress test <dir>              run every *.scenario.json under <dir>
  swarmpress pack <dir> [--out f]    check, build and write <id>-<version>.swarmpress.tgz with sha256 integrity
  swarmpress wp-conformance          the WordPress sandbox's conformance suite against a fresh Node WordPress
      --junit <file>               JUnit report (default reports/wp-conformance.xml)
      --bench <file>               benchmark document (default reports/wp-seam-sandbox.json)

The client-wasm build must exist (cargo xtask wasm) for run, test and sim-rule checks.
wp-conformance needs \`cargo xtask sandbox-fetch --node\` and \`cargo build -p storage-api --bin swarmpress-storage\`.`;

export async function main(argv: string[], out: Out = consoleOut): Promise<number> {
  const [cmd, ...rest] = argv;
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      const boolean = k === "json" || k === "help";
      const v = inline ?? (boolean ? "true" : rest[++i]);
      if (v === undefined) {
        out.error(`swarmpress: --${k} needs a value`);
        return 2;
      }
      flags.set(k, [...(flags.get(k) ?? []), v]);
    } else positional.push(a);
  }
  const one = (k: string) => flags.get(k)?.at(-1);
  const needDir = (what: string) => {
    if (!positional[0]) throw new UsageError(`swarmpress ${what}: missing <dir>`);
    return positional[0];
  };
  try {
    switch (cmd) {
      case "new":
        if (positional.length < 2) throw new UsageError("swarmpress new: usage: swarmpress new <kind> <dir>");
        return await cmdNew(positional[0], positional[1], out);
      case "check":
        return await cmdCheck(needDir("check"), out);
      case "build":
        return await cmdBuild(needDir("build"), out);
      case "test":
        return await cmdTest(needDir("test"), out);
      case "pack":
        return await cmdPack(needDir("pack"), out, one("out"));
      case "run": {
        const seedS = one("seed") ?? "42";
        const daysS = one("days") ?? "1";
        if (!/^\d{1,20}$/.test(seedS) || BigInt(seedS) > 0xffff_ffff_ffff_ffffn) throw new UsageError(`--seed must be a u64, got ${seedS}`);
        if (!/^\d+$/.test(daysS) || Number(daysS) > 3650) throw new UsageError(`--days must be 0..3650, got ${daysS}`);
        const web = one("web") ?? "fixtures";
        if (web !== "fixtures" && web !== "live") throw new UsageError(`--web must be fixtures or live`);
        const world = one("world") ?? "demo";
        if (world !== "demo" && world !== "empty") throw new UsageError(`--world must be demo or empty`);
        return await cmdRun(
          { seed: BigInt(seedS), days: Number(daysS), exts: [...(flags.get("ext") ?? []), ...positional], json: flags.has("json"), web, world },
          out,
        );
      }
      case "wp-conformance":
        return await runConformance({
          root: REPO_ROOT,
          junit: one("junit") ?? "reports/wp-conformance.xml",
          bench: one("bench") ?? "reports/wp-seam-sandbox.json",
          log: (line) => out.error(line),
        });
      case undefined:
      case "help":
      case "--help":
      case "-h":
        out.log(USAGE);
        return cmd === undefined ? 2 : 0;
      default:
        throw new UsageError(`swarmpress: unknown command "${cmd}"`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      out.error(e.message);
      out.error("run `swarmpress help` for usage");
      return 2;
    }
    out.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

class UsageError extends Error {}

const meta = import.meta as ImportMeta & { main?: boolean };
if (meta.main ?? (!!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  process.exit(await main(process.argv.slice(2)));
}
