/**
 * n8n compatibility (FEAT-096, ADR-0076): workflows import node for node and
 * run with n8n's item semantics; expressions and Code nodes run in a real
 * capability-less QuickJS sandbox. The imported graphs are written to
 * crates/blueprint/tests/fixtures/n8n/ (with BLESS=1), where the Rust checker
 * confirms them (crates/blueprint/tests/n8n.rs).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseToolGraph, ToolGraphSchema } from "../src/graph.ts";
import { runGraph } from "../src/interpret.ts";
import { importN8n, type N8nWorkflow } from "../src/import/n8n.ts";
import { parseTemplate, nativeSteps, referencedNodes, resolveParams } from "../src/n8n/expr.ts";
import { unsupportedReason, urlOrigin } from "../src/n8n/catalogue.ts";
import { N8N_PRELUDE } from "../src/n8n/prelude.ts";
import { FakeHost, sandboxCode } from "./helpers.ts";

const fixture = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dir, `fixtures/n8n/${name}.json`), "utf8")) as N8nWorkflow;
const GOLDEN = resolve(import.meta.dir, "../../../crates/blueprint/tests/fixtures/n8n");

function golden(id: string, value: unknown) {
  const path = `${GOLDEN}/${id}.json`;
  const text = JSON.stringify(value, null, 2) + "\n";
  if (process.env.BLESS) writeFileSync(path, text);
  expect(readFileSync(path, "utf8")).toBe(text);
}

const run = (name: string, host: FakeHost, input: Record<string, unknown> = {}) => {
  const out = importN8n(fixture(name), name);
  return runGraph(parseToolGraph(JSON.stringify(out.graph)), out.types, input, host);
};

describe("expressions", () => {
  test("templates: one part keeps its value, text renders as n8n does", () => {
    expect(parseTemplate("literal")).toBeNull();
    expect(parseTemplate("={{ $json.a }}")).toEqual({ parts: [{ js: "$json.a" }], single: true });
    expect(parseTemplate("=Hi {{ $json.name }}!")).toEqual({ parts: ["Hi ", { js: "$json.name" }, "!"], single: false });
    expect(parseTemplate("={{ { a: { b: 1 } }.a.b }}")?.parts).toEqual([{ js: "{ a: { b: 1 } }.a.b" }]);
    expect(parseTemplate('={{ "}}".length }}')?.parts).toEqual([{ js: '"}}".length' }]);
    expect(() => parseTemplate("={{ $json.a")).toThrow("unclosed");
  });

  test("a part that reads the item is native; anything else is JavaScript", () => {
    expect(nativeSteps("$json.a.b[0]")).toEqual(["a", "b", 0]);
    expect(nativeSteps('$json["first name"]')).toEqual(["first name"]);
    expect(nativeSteps("$input.item.json.x")).toEqual(["x"]);
    expect(nativeSteps("$json.a.toUpperCase()")).toBeNull();
    expect(nativeSteps("$('Node').item.json.a")).toBeNull();
    expect(referencedNodes(`$('Get trails').first().json.x + $node["Old one"].json.y + $items("Third")`)).toEqual(["Get trails", "Old one", "Third"]);
  });

  test("native templates never reach the sandbox; JavaScript ones run there in one call", async () => {
    let calls = 0;
    const js = async (task: Parameters<Parameters<typeof resolveParams>[2]>[0]) => {
      calls++;
      return (await sandboxCode(N8N_PRELUDE, task)) as unknown[][];
    };
    const ctx = { nodes: { Prev: [{ city: "Vernazza" }] }, node: "Here", workflow: { id: "w", name: "W" } };
    const items = [{ name: "ada", n: 2 }, { name: "bob", n: 3 }];
    const plain = await resolveParams({ who: "={{ $json.name }}", lit: "x" }, items, js, ctx);
    expect(plain).toEqual([{ who: "ada", lit: "x" }, { who: "bob", lit: "x" }]);
    expect(calls).toBe(0);
    const got = await resolveParams(
      { up: "={{ $json.name.toTitleCase() }}", sum: "={{ $json.n * 10 }}", text: "=Hi {{ $json.name }} from {{ $('Prev').first().json.city }}", d: "={{ $now.year > 2000 }}", none: "={{ $json.missing }}" },
      items,
      js,
      ctx,
    );
    expect(calls).toBe(1);
    expect(got[0]).toEqual({ up: "Ada", sum: 20, text: "Hi ada from Vernazza", d: true, none: undefined });
    expect(got[1].sum).toBe(30);
  });

  test("the sandbox has n8n's helpers and DateTime, and refuses the world", async () => {
    const ev = async (js: string, item: Record<string, unknown> = {}) =>
      ((await sandboxCode(N8N_PRELUDE, { op: "exprs", items: [item], templates: [{ parts: [{ js }], single: true }], nodes: {}, node: "n", workflow: { id: "w", name: "W" } })) as unknown[][])[0][0];
    expect(await ev("'https://www.cinqueterre.travel/en'.extractDomain()")).toBe("cinqueterre.travel");
    expect(await ev("[3, 1, 3].unique().sum()")).toBe(4);
    expect(await ev("[{a:1},{a:2}].pluck('a')")).toEqual([1, 2]);
    expect(await ev("(2.345).round(2)")).toBe(2.35);
    expect(await ev("DateTime.fromISO('2026-10-08T10:30:00Z').plus({ days: 3 }).toFormat('yyyy-LL-dd HH:mm EEE')")).toBe("2026-10-11 10:30 Sun");
    expect(await ev("DateTime.fromISO('2026-10-08T10:30:00Z').startOf('month').toISO()")).toBe("2026-10-01T00:00:00.000+00:00");
    expect(await ev("$ifEmpty($json.x, 'none')")).toBe("none");
    await expect(ev("$env.SECRET")).rejects.toThrow("$env is not available");
    await expect(ev("typeof fetch")).resolves.toBe("undefined");
    await expect(ev("typeof swarmpress")).resolves.toBe("undefined");
    await expect(ev("require('fs')")).rejects.toThrow("without modules");
  });

  test("URL origins: literal hosts, computed hosts reach anywhere, the rest is invalid", () => {
    expect(urlOrigin("https://api.example.com/v1/x")).toEqual({ origin: "https://api.example.com" });
    expect(urlOrigin("=https://api.example.com/v1/{{ $json.id }}")).toEqual({ origin: "https://api.example.com" });
    expect(urlOrigin("={{ $json.link }}")).toBe("any");
    expect(urlOrigin("=https://{{ $json.host }}/x")).toBe("any");
    expect(urlOrigin("/relative")).toBeNull();
    expect(unsupportedReason("n8n-nodes-base.code", 2, { language: "python" })).toContain("JavaScript only");
    expect(unsupportedReason("n8n-nodes-base.httpRequest", 4.2, { options: { pagination: { pagination: {} } } })).toBe("pagination");
    expect(unsupportedReason("n8n-nodes-base.slack", 2, {})).toBe("no swarm.press equivalent");
  });
});

describe("importN8n", () => {
  test("an RSS digest: every node kept as itself", () => {
    const out = importN8n(fixture("news-digest"), "news-digest");
    const g = ToolGraphSchema.parse(out.graph);
    expect(g.triggers).toEqual([{ kind: "on-demand" }]);
    expect(g.nodes.map((n) => [n.id, n.kind, "type" in n ? n.type : null])).toEqual([
      ["rss-read", "n8n", "n8n-nodes-base.rssFeedRead"],
      ["limit", "n8n", "n8n-nodes-base.limit"],
      ["edit-fields", "n8n", "n8n-nodes-base.set"],
      ["edit-fields-out", "output", null],
    ]);
    expect(g.outputs).toEqual({ edit_fields: "Json[]" });
    expect(out.issues).toEqual([]);
    golden("news-digest", { graph: out.graph, types: out.types });
  });

  test("a webhook flow: input, branches joined by a merge, the response as an output", () => {
    const out = importN8n(fixture("lead-intake"), "lead-intake");
    const g = ToolGraphSchema.parse(out.graph);
    expect(g.inputs).toEqual({ request: "Json" });
    expect(g.outputs).toEqual({ response: "Json[]" });
    expect(g.edges).toContainEqual(["big-deal.out", "priority.in"]);
    expect(g.edges).toContainEqual(["big-deal.out1", "standard.in"]);
    expect(g.edges).toContainEqual(["standard.out", "merge.in1"]);
    expect(out.mapping.find((m) => m.node === "Sticky Note")).toBeUndefined();
    expect(out.issues).toEqual([]);
    golden("lead-intake", { graph: out.graph, types: out.types });
  });

  test("Loop Over Items is flattened, model sub-nodes dropped, the schedule kept in game days", () => {
    const out = importN8n(fixture("trail-roundup"), "trail-roundup");
    const g = ToolGraphSchema.parse(out.graph);
    expect(g.triggers).toEqual([{ kind: "schedule", every_game_days: 7 }]);
    expect(g.nodes.some((n) => n.id === "openai-chat-model")).toBe(false);
    expect(g.edges).toContainEqual(["loop-over-items.out", "line.in"]);
    expect(g.edges).toContainEqual(["line.out", "aggregate.in"]);
    expect(g.edges.some(([, to]) => to.startsWith("loop-over-items.") && !to.endsWith(".in"))).toBe(false);
    expect(out.mapping.find((m) => m.node === "Loop Over Items")?.as).toBe("flattened");
    expect(out.mapping.find((m) => m.node === "OpenAI Chat Model")?.as).toBe("dropped");
    expect(out.issues.map((i) => i.code)).toEqual(["note"]);
    golden("trail-roundup", { graph: out.graph, types: out.types });
  });

  test("what cannot run is sealed with its reason; a disabled node passes through", () => {
    const out = importN8n(fixture("sealed-mix"), "sealed-mix");
    expect(out.issues.map((i) => [i.code, i.node])).toEqual([
      ["sealed", "Python"],
      ["needs-credential", "Slack"],
      ["sealed", "Slack"],
      ["note", "Old step"],
    ]);
    expect(out.mapping.map((m) => m.as)).toEqual(["trigger", "sealed", "sealed", "n8n"]);
    const old = out.graph.nodes.find((n) => n.id === "old-step") as { type: string };
    expect(old.type).toBe("n8n-nodes-base.noOp");
    golden("sealed-mix", { graph: out.graph, types: out.types });
  });

  test("the weather alert's Code step is no longer sealed", () => {
    const out = importN8n(fixture("weather-alert"), "weather-alert");
    expect(out.issues).toEqual([]);
    golden("weather-alert", { graph: out.graph, types: out.types });
  });
});

describe("running imported workflows", () => {
  test("the RSS digest", async () => {
    const items = Array.from({ length: 7 }, (_, i) => `<item><title>Story ${i}</title><link>https://www.ansa.it/s/${i}</link></item>`).join("");
    const host = new FakeHost({ http: { "https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml": `<?xml version="1.0"?><rss><channel>${items}</channel></rss>` } });
    const r = await run("news-digest", host);
    expect(r.error).toBeUndefined();
    expect(r.outputs.edit_fields).toEqual(Array.from({ length: 5 }, (_, i) => ({ title: `Story ${i}`, link: `https://www.ansa.it/s/${i}` })));
    expect(host.calls.filter((c) => c.startsWith("code"))).toEqual([]);
  });

  test("the weather alert runs its IF and Code node only when it is hot", async () => {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=44.1&longitude=9.7&current=temperature_2m";
    const hot = await run("weather-alert", new FakeHost({ http: { [url]: JSON.stringify({ current: { temperature_2m: 33.5 } }) } }));
    expect(hot.error).toBeUndefined();
    expect(hot.outputs.format_alert).toEqual([{ text: "Hot: 33.5" }]);
    const mild = await run("weather-alert", new FakeHost({ http: { [url]: JSON.stringify({ current: { temperature_2m: 21 } }) } }));
    expect(mild.ok).toBe(false);
    expect(mild.error).toBe("no-output:format_alert");
  });

  test("the lead intake: expressions, a JSON POST, IF v2 over another node's item, Code per item, merge, response", async () => {
    const crm = "https://api.example-crm.com/v1/companies/lookup";
    const host = new FakeHost({
      http: {
        [`POST ${crm}`]: (req) => {
          const domain = (JSON.parse(req.body ?? "{}") as { domain: string }).domain;
          return { body: JSON.stringify({ company: domain === "bigco.com" ? { name: "BigCo", size: "enterprise" } : { name: "Small Ltd", size: "small" } }) };
        },
      },
    });
    const big = await run("lead-intake", host, { request: { body: { email: "  Ada@BigCo.com ", seats: 12 }, headers: {}, query: {} } });
    expect(big.error).toBeUndefined();
    expect(big.outputs.response).toEqual([{ email: "ada@bigco.com", company: "BigCo", tier: "priority", score: 24 }]);
    expect(host.requests[0]).toMatchObject({ method: "POST", url: crm, body: '{"domain":"bigco.com"}', headers: { "X-Api-Key": "demo-key", "content-type": "application/json" } });
    const small = await run("lead-intake", host, { request: { body: { email: "bo@small.io", seats: 3 } } });
    expect(small.outputs.response).toEqual([{ email: "bo@small.io", company: "Small Ltd", tier: "standard" }]);
  });

  test("the trail roundup: split, filter, sort, the flattened loop, aggregate, the hosted model, Code with $now", async () => {
    const trails = [
      { name: "sentiero azzurro", km: 12.04, status: "open", village: "Monterosso" },
      { name: "via dell'amore", km: 1, status: "open", village: "Riomaggiore" },
      { name: "path 593v", km: 4.66, status: "closed", village: "Corniglia" },
      { name: "path 531", km: 5.5, status: "OPEN", village: "Vernazza" },
    ];
    const host = new FakeHost({
      http: { "https://trails.example.org/api/trails": JSON.stringify({ updated: "2026-10-01", trails }) },
      llm: ["Lace up: the coast is waiting."],
    });
    const r = await run("trail-roundup", host);
    expect(r.error).toBeUndefined();
    const [out] = r.outputs.compose as Array<Record<string, unknown>>;
    expect(out.lines).toEqual(["Sentiero Azzurro (12 km, Monterosso)", "Path 531 (5.5 km, Vernazza)"]);
    expect(out.count).toBe(2);
    expect(out.intro).toBe("Lace up: the coast is waiting.");
    expect(String(out.headline)).toMatch(/^Trails of the week \d{4}-\d{2}-\d{2}$/);
    expect(host.prompts[0]).toBe("You write for a travel site about the Cinque Terre.\n\nWrite one sentence inviting hikers to these trails: Sentiero Azzurro (12 km, Monterosso); Path 531 (5.5 km, Vernazza)");
    expect(host.calls.filter((c) => c === "llm mid")).toHaveLength(1);
  });

  test("a replay reuses the recorded requests, model replies and code", async () => {
    const host = new FakeHost({
      http: { "https://trails.example.org/api/trails": JSON.stringify({ updated: "x", trails: [{ name: "a", km: 9, status: "open", village: "V" }] }) },
      llm: ["Go."],
    });
    const out = importN8n(fixture("trail-roundup"), "trail-roundup");
    const g = parseToolGraph(JSON.stringify(out.graph));
    const first = await runGraph(g, {}, {}, host);
    expect(first.ok).toBe(true);
    const quiet = new FakeHost();
    const again = await runGraph(g, {}, {}, quiet, { replay: first.recorded });
    expect(again.error).toBeUndefined();
    expect(again.outputs).toEqual(first.outputs);
    expect(quiet.calls).toEqual([]);
  });

  test("a failing request fails the node, unless the node continues on fail", async () => {
    const wf = fixture("news-digest");
    const host = new FakeHost({ http: { "https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml": { status: 503, body: "down" } } });
    const r = await runGraph(parseToolGraph(JSON.stringify(importN8n(wf, "d").graph)), {}, {}, host);
    expect(r.error).toBe("rss-read: GET https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml: HTTP 503");
    (wf.nodes[1] as { onError?: string }).onError = "continueRegularOutput";
    const g = importN8n(wf, "d").graph;
    const ok = await runGraph(parseToolGraph(JSON.stringify(g)), {}, {}, host);
    expect(ok.outputs.edit_fields).toEqual([{}]);
  });

  test("a sealed node fails loudly if it ever runs", async () => {
    const r = await run("sealed-mix", new FakeHost());
    expect(r.ok).toBe(false);
    expect(r.error).toContain("python Code node is not supported");
  });

  test("Code cannot reach past its sandbox, and a runaway loop is stopped", async () => {
    const wf: N8nWorkflow = {
      name: "Escape",
      nodes: [{ name: "Code", type: "n8n-nodes-base.code", typeVersion: 2, parameters: { jsCode: "return [{ json: { f: typeof fetch, s: typeof swarmpress, g: Object.keys(globalThis).filter(k => !k.startsWith('$')).sort().join(',') } }];" } }],
      connections: {},
    };
    const r = await runGraph(parseToolGraph(JSON.stringify(importN8n(wf, "escape").graph)), {}, {}, new FakeHost());
    expect(r.error).toBeUndefined();
    expect(r.outputs.code).toEqual([{ f: "undefined", s: "undefined", g: "Bun,console,ext" }]);
    wf.nodes[0].parameters = { jsCode: "while (true) {}" };
    const spin = await runGraph(parseToolGraph(JSON.stringify(importN8n(wf, "escape").graph)), {}, {}, new FakeHost());
    expect(spin.ok).toBe(false);
    expect(spin.error).toMatch(/budget/);
  }, 30_000);
});
