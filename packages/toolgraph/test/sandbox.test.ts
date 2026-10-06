/**
 * End to end: a tool's entry source, bundled the way `swarmpress build` does
 * (packages/runner `buildBundle`), runs inside the real QuickJS sandbox with
 * the capabilities and origins of its Rust-derived golden manifest.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle, diagnostics, loadExtension, logger } from "@swarm-press/runner";
import { CapabilityError, createSandbox, type HostLlm, type HostWeb } from "@swarm-press/sandbox";
import { toolEntrySource } from "../src/compile.ts";
import type { ToolGraph } from "../src/graph.ts";
import { runGraph, type RunResult } from "../src/interpret.ts";
import { ARTICLE, FERRY_URL, FakeHost, VERNAZZA, WEATHER_URL, fixture, goldenManifests, siteTypes, tool } from "./helpers.ts";

const SKILL = join(import.meta.dir, "..", "src", "skill.ts");
const types = siteTypes();
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** An extension folder (golden manifest + generated tool.js), loaded and bundled by the runner. */
async function bundle(id: string, graph: ToolGraph = tool(id)) {
  const dir = mkdtempSync(join(tmpdir(), `toolgraph-${id}-`));
  dirs.push(dir);
  const manifest = goldenManifests()[id];
  writeFileSync(join(dir, "swarmpress.ext.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, "tool.js"), toolEntrySource(graph, types, { importFrom: SKILL }));
  const diag = diagnostics();
  const ext = await loadExtension(dir, diag);
  expect(diag.errors).toEqual([]);
  const { code } = await buildBundle(ext!);
  return { ext: ext!, code };
}

/** A web stub that answers only its own origin (the network is never reached). */
function webStub(origin: string, body: string, seen: string[]): HostWeb {
  return async (req) => {
    seen.push(req.url);
    if (new URL(req.url).origin !== origin) throw new Error(`stub: ${req.url} is not ${origin}`);
    return { status: 200, headers: { "content-type": "application/json" }, body };
  };
}

async function runInSandbox(id: string, input: unknown, host: { web?: HostWeb; llm?: HostLlm }, graph?: ToolGraph): Promise<RunResult> {
  const { ext, code } = await bundle(id, graph);
  const sb = await createSandbox({
    capabilities: ext.manifest.capabilities,
    origins: ext.manifest.origins,
    host: { ...host, log: logger().host(ext.manifest.id) },
  });
  try {
    await sb.load(code, `${ext.manifest.id}.js`);
    return await sb.call<RunResult>("runTool", { tool: id, input });
  } finally {
    sb.dispose();
  }
}

const hashes = (r: RunResult) => r.trace.map((t) => [t.node, t.state, t.in_sha, t.out_sha]);

describe("a tool graph in the QuickJS sandbox", () => {
  test("the bundle carries the interpreter but not Zod, and describes one tool", async () => {
    const { ext, code } = await bundle("ferry-times");
    expect(code).not.toContain("ZodError");
    const sb = await createSandbox({ capabilities: ext.manifest.capabilities, origins: ext.manifest.origins, host: {} });
    try {
      await sb.load(code);
      const d = await sb.call<any>("describe");
      expect(Object.keys(d.tools)).toEqual(["ferry-times"]);
      expect(d.tools["ferry-times"].input).toMatchObject({ type: "object", additionalProperties: false, required: ["village"] });
    } finally {
      sb.dispose();
    }
  });

  test("ferry-times runs with the golden manifest's origins and matches the in-process run", async () => {
    const seen: string[] = [];
    const timetable = fixture("ferry-timetable.json");
    const r = await runInSandbox("ferry-times", { village: VERNAZZA }, { web: webStub("https://www.navigazionegolfodeipoeti.it", timetable, seen) });
    expect(r.error).toBeUndefined();
    expect(seen).toEqual([FERRY_URL]);
    const local = await runGraph(tool("ferry-times"), types, { village: VERNAZZA }, new FakeHost({ web: { [FERRY_URL]: timetable } }));
    expect(r.outputs).toEqual(local.outputs);
    expect(hashes(r)).toEqual(hashes(local));
    expect(r.recorded).toEqual(local.recorded);
  });

  test("weather fills {city} inside the sandbox", async () => {
    const seen: string[] = [];
    const r = await runInSandbox("weather", { city: "La Spezia" }, { web: webStub("https://api.open-meteo.com", fixture("weather.json"), seen) });
    expect(seen).toEqual([WEATHER_URL("La Spezia")]);
    expect(r.outputs).toEqual({ weather: { temperature: 21.5, condition: "sunny" } });
  });

  test("story-teaser reaches the LLM through the llm:low capability", async () => {
    const tiers: string[] = [];
    const llm: HostLlm = async (req) => {
      tiers.push(req.tier);
      return { text: fixture("teaser-reply.txt") };
    };
    const r = await runInSandbox("story-teaser", { article: ARTICLE }, { llm });
    expect(tiers).toEqual(["low"]);
    expect(r.outputs).toEqual({ teaser: JSON.parse(fixture("teaser-reply.txt")) });
  });

  test("a fetch to an origin outside the manifest fails with the sandbox's CapabilityError", async () => {
    const g = tool("ferry-times");
    const rogue: ToolGraph = {
      ...g,
      nodes: g.nodes.map((n) => (n.kind === "connector" ? { ...n, url: "https://evil.example/orari.json" } : n)),
    };
    const seen: string[] = [];
    const run = runInSandbox("ferry-times", { village: VERNAZZA }, { web: webStub("https://www.navigazionegolfodeipoeti.it", "{}", seen) }, rogue);
    await expect(run).rejects.toBeInstanceOf(CapabilityError);
    await expect(run).rejects.toThrow("not in the manifest's origins");
    expect(seen).toEqual([]);
  });

  test("without the web capability the connector fails with CapabilityError too", async () => {
    const { code } = await bundle("ferry-times");
    const sb = await createSandbox({ capabilities: [], host: { web: webStub("https://www.navigazionegolfodeipoeti.it", "{}", []) } });
    try {
      await sb.load(code);
      await expect(sb.call("runTool", { tool: "ferry-times", input: { village: VERNAZZA } })).rejects.toBeInstanceOf(CapabilityError);
    } finally {
      sb.dispose();
    }
  });
});
