/**
 * The interpreter bundle the game runs every tool with (T-1): committed and
 * current; in the real sandbox it runs a graph given as data under that
 * tool's derived manifest, and the sandbox, not the graph, decides the origins.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CapabilityError, createSandbox, type HostWeb } from "@swarm-press/sandbox";
import { buildRuntime, RUNTIME } from "../scripts/build-runtime.ts";
import type { RunResult } from "../src/interpret.ts";
import { runGraph } from "../src/interpret.ts";
import { FakeHost, FERRY_URL, VERNAZZA, fixture, goldenManifests, siteTypes, tool } from "./helpers.ts";

const code = readFileSync(RUNTIME, "utf8");

function web(origin: string, body: string): HostWeb {
  return async (req) => {
    if (new URL(req.url).origin !== origin) throw new Error(`stub: ${req.url}`);
    return { status: 200, headers: { "content-type": "application/json" }, body };
  };
}

async function run(id: string, input: unknown, w: HostWeb, origins?: string[]) {
  const m = goldenManifests()[id];
  const sb = await createSandbox({ capabilities: m.capabilities, origins: origins ?? m.origins, host: { web: w } });
  try {
    await sb.load(code, "toolgraph-runtime.js");
    return await sb.call<RunResult>("runTool", { tool: "run", input: { graph: tool(id), types: siteTypes(), input } });
  } finally {
    sb.dispose();
  }
}

describe("the toolgraph runtime bundle", () => {
  test("is committed and up to date, without Zod", async () => {
    expect(await buildRuntime()).toBe(code);
    expect(code).not.toContain("ZodError");
  });

  test("runs a graph given as data, like the in-process interpreter", async () => {
    const timetable = fixture("ferry-timetable.json");
    const r = await run("ferry-times", { village: VERNAZZA }, web("https://www.navigazionegolfodeipoeti.it", timetable));
    expect(r.ok).toBe(true);
    const local = await runGraph(tool("ferry-times"), siteTypes(), { village: VERNAZZA }, new FakeHost({ web: { [FERRY_URL]: timetable } }));
    expect(r.outputs).toEqual(local.outputs);
  });

  test("the sandbox refuses an origin the tool's manifest does not grant", async () => {
    const timetable = fixture("ferry-timetable.json");
    await expect(run("ferry-times", { village: VERNAZZA }, web("https://www.navigazionegolfodeipoeti.it", timetable), ["https://elsewhere.example.com"])).rejects.toBeInstanceOf(CapabilityError);
  });
});
