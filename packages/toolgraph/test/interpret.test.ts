import { describe, expect, test } from "bun:test";
import { canonicalJson, sha256Hex } from "@swarm-press/sdk/runtime";
import { parseToolGraph, type ToolGraph } from "../src/graph.ts";
import { parseFeed, runGraph, topoOrder, type ToolHost } from "../src/interpret.ts";
import { TypeRegistry } from "../src/types.ts";
import { ARTICLE, FERRY_URL, FakeHost, VERNAZZA, WEATHER_URL, fixture, siteTypes, tool } from "./helpers.ts";

const types = siteTypes();
const reg = TypeRegistry.withSite(types);
const sha = (v: unknown) => sha256Hex(canonicalJson(v));
const TIMETABLE = fixture("ferry-timetable.json");
const WEATHER = fixture("weather.json");
const TEASER = fixture("teaser-reply.txt").trim();
const INVALID = fixture("teaser-reply-invalid.txt").trim();

/** A graph with Rust's defaults, from its parts. */
function graph(parts: Partial<ToolGraph> & Pick<ToolGraph, "nodes" | "edges" | "outputs">): ToolGraph {
  return parseToolGraph({ format: "swarmpress.tool.v1", id: "t", name: { en: "T" }, ...parts });
}

const withFailure = (g: ToolGraph, failure: Partial<ToolGraph["failure"]>): ToolGraph => ({ ...g, failure: { ...g.failure, ...failure } });
const withLimits = (g: ToolGraph, limits: Partial<ToolGraph["limits"]>): ToolGraph => ({ ...g, limits: { ...g.limits, ...limits } });

describe("ferry-times", () => {
  test("filters by the village slug and limits to 6, exactly", async () => {
    const host = new FakeHost({ web: { [FERRY_URL]: TIMETABLE } });
    const r = await runGraph(tool("ferry-times"), types, { village: VERNAZZA }, host);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.outputs).toEqual({
      departures: [
        { time: "09:05", to: "Portovenere" },
        { time: "09:40", to: "Monterosso" },
        { time: "10:25", to: "Portovenere" },
        { time: "11:00", to: "Monterosso" },
        { time: "11:45", to: "La Spezia" },
        { time: "12:30", to: "Monterosso" },
      ],
    });
    expect(host.calls).toEqual([`fetch ${FERRY_URL}`]);
    expect(r.recorded).toEqual({ fetch: JSON.parse(TIMETABLE) });
    expect(r.keepLast).toBeUndefined();
  });

  test("another village gets its own departures", async () => {
    const host = new FakeHost({ web: { [FERRY_URL]: TIMETABLE } });
    const r = await runGraph(tool("ferry-times"), types, { village: { slug: "monterosso", name: "Monterosso" } }, host);
    expect(r.outputs.departures).toEqual([
      { time: "08:50", to: "Portovenere" },
      { time: "17:10", to: "La Spezia" },
    ]);
  });

  test("the trace runs in Rust topo() order, with input and output hashes", async () => {
    const g = tool("ferry-times");
    const r = await runGraph(g, types, { village: VERNAZZA }, new FakeHost({ web: { [FERRY_URL]: TIMETABLE } }));
    expect(topoOrder(g)).toEqual(["in", "fetch", "rows", "here", "shape", "first", "out"]);
    expect(r.trace.map((t) => t.node)).toEqual(topoOrder(g));
    expect(r.trace.every((t) => t.state === "ok" && t.ms === 0)).toBe(true);
    const by = Object.fromEntries(r.trace.map((t) => [t.node, t]));
    expect(by.in.in_sha).toBe(sha({ village: VERNAZZA }));
    expect(by.in.out_sha).toBe(sha(VERNAZZA));
    expect(by.fetch.in_sha).toBe(sha({}));
    expect(by.fetch.out_sha).toBe(sha(JSON.parse(TIMETABLE)));
    expect(by.here.in_sha).toBe(sha({ in: JSON.parse(TIMETABLE).departures, param: VERNAZZA }));
    expect(by.out.out_sha).toBe(sha(r.outputs.departures));
    for (const t of r.trace) expect(t.out_sha).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an injected clock times each node", async () => {
    let now = 1000;
    const r = await runGraph(tool("ferry-times"), types, { village: VERNAZZA }, new FakeHost({ web: { [FERRY_URL]: TIMETABLE } }), {
      clock: () => (now += 5),
    });
    expect(r.trace.map((t) => t.ms)).toEqual([5, 5, 5, 5, 5, 5, 5]);
  });

  test("the fetch limit (1) stops the retry, and keep-last is reported", async () => {
    const host = new FakeHost({ web: { [FERRY_URL]: [new Error("ECONNRESET"), TIMETABLE] } });
    const r = await runGraph(tool("ferry-times"), types, { village: VERNAZZA }, host);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("limit:fetches_per_run");
    expect(r.keepLast).toBe(true);
    expect(r.outputs).toEqual({});
    expect(host.calls).toEqual([`fetch ${FERRY_URL}`]);
    expect(r.trace.at(-1)).toMatchObject({ node: "fetch", state: "failed", out_sha: null });
  });

  test("a response that does not fit FerryTimetable fails with field paths", async () => {
    const bad = JSON.stringify({ departures: [{ stop: "vernazza", dep: 905, dest: "Monterosso" }] });
    const r = await runGraph(withFailure(tool("ferry-times"), { retries: 0 }), types, { village: VERNAZZA }, new FakeHost({ web: { [FERRY_URL]: bad } }));
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ path: "$.departures[0].dep", message: "expected a string, found an integer" }]);
    expect(r.error).toContain("$.departures[0].dep");
    expect(r.trace.at(-1)?.issues).toEqual(r.issues);
  });

  test("the tool input is validated by path, and unknown inputs are rejected", async () => {
    const host = new FakeHost();
    const r = await runGraph(tool("ferry-times"), types, { village: { slug: "vernazza" } }, host);
    expect(r).toMatchObject({ ok: false, issues: [{ path: "village.name", message: "missing" }] });
    expect(r.error).toStartWith("bad-input:village");
    const r2 = await runGraph(tool("ferry-times"), types, { village: VERNAZZA, extra: 1 }, host);
    expect(r2.error).toStartWith("bad-input:extra");
    expect(host.calls).toEqual([]);
  });
});

describe("weather", () => {
  test("fills {city} from the params port, URL-encoded", async () => {
    const host = new FakeHost({ web: { [WEATHER_URL("La Spezia")]: WEATHER } });
    const r = await runGraph(tool("weather"), types, { city: "La Spezia" }, host);
    expect(r.ok).toBe(true);
    expect(host.calls).toEqual(["fetch https://api.open-meteo.com/v1/current?city=La%20Spezia"]);
    expect(r.outputs).toEqual({ weather: { temperature: 21.5, condition: "sunny" } });
  });

  test("failure.retries retries a connector error", async () => {
    const url = WEATHER_URL("Vernazza");
    const flaky = () => new FakeHost({ web: { [url]: [new Error("HTTP 503"), WEATHER] } });
    const once = await runGraph(tool("weather"), types, { city: "Vernazza" }, flaky());
    expect(once).toMatchObject({ ok: false });
    expect(once.error).toContain("HTTP 503");
    const host = flaky();
    const retried = await runGraph(withFailure(tool("weather"), { retries: 1 }), types, { city: "Vernazza" }, host);
    expect(retried.ok).toBe(true);
    expect(host.calls).toHaveLength(2);
    const down = new FakeHost({ web: { [url]: [new Error("HTTP 503"), new Error("HTTP 502"), new Error("HTTP 500")] } });
    const exhausted = await runGraph(withFailure(tool("weather"), { retries: 2 }), types, { city: "Vernazza" }, down);
    expect(exhausted.error).toContain("HTTP 500");
    expect(down.calls).toHaveLength(3);
  });

  test("a limit of 0 is derived: connectors × (1 + retries)", async () => {
    const url = WEATHER_URL("Vernazza");
    const down = new FakeHost({ web: { [url]: new Error("HTTP 503") } });
    const g = withLimits(withFailure(tool("weather"), { retries: 3 }), { fetches_per_run: 2 });
    const r = await runGraph(g, types, { city: "Vernazza" }, down);
    expect(r.error).toContain("limit:fetches_per_run");
    expect(down.calls).toHaveLength(2);
    const derived = new FakeHost({ web: { [url]: new Error("HTTP 503") } });
    await runGraph(withFailure(tool("weather"), { retries: 3 }), types, { city: "Vernazza" }, derived);
    expect(derived.calls).toHaveLength(4);
  });

  test("a host without fetch fails the node loudly (rule 11)", async () => {
    const r = await runGraph(tool("weather"), types, { city: "Vernazza" }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no-host:fetch");
  });
});

describe("story-teaser", () => {
  test("a published article goes through the agent, with instruction, input and schema in the prompt", async () => {
    const host = new FakeHost({ llm: [TEASER] });
    const r = await runGraph(tool("story-teaser"), types, { article: ARTICLE }, host);
    expect(r.ok).toBe(true);
    expect(r.outputs).toEqual({ teaser: JSON.parse(TEASER) });
    expect(host.calls).toEqual(["llm low"]);
    const p = host.prompts[0];
    expect(p).toStartWith("Write a one-line teaser for this published article, at most 90 characters.");
    expect(p).toContain(canonicalJson(ARTICLE));
    expect(p).toContain(canonicalJson(reg.jsonSchema("Teaser")));
    expect(r.trace.find((t) => t.node === "long")?.outlet).toBe("yes");
    expect(r.recorded).toEqual({ write: JSON.parse(TEASER) });
  });

  test("an article without published_at takes the no outlet: the agent is not taken, no-output:teaser", async () => {
    const { published_at: _, ...draft } = ARTICLE;
    const host = new FakeHost({ llm: [TEASER] });
    const r = await runGraph(tool("story-teaser"), types, { article: draft }, host);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no-output:teaser");
    expect(r.trace.map((t) => [t.node, t.state])).toEqual([
      ["in", "ok"],
      ["long", "ok"],
      ["write", "not-taken"],
      ["out", "not-taken"],
    ]);
    expect(r.trace[1].outlet).toBe("no");
    expect(r.trace[2]).toMatchObject({ in_sha: null, out_sha: null });
    expect(host.calls).toEqual([]);
  });

  test("an invalid reply gets one repair turn with the validation errors", async () => {
    const g = withLimits(tool("story-teaser"), { llm_calls_per_run: 0 });
    const host = new FakeHost({ llm: [INVALID, TEASER] });
    const r = await runGraph(g, types, { article: ARTICLE }, host);
    expect(r.ok).toBe(true);
    expect(r.outputs.teaser).toEqual(JSON.parse(TEASER));
    expect(host.calls).toEqual(["llm low", "llm low"]);
    expect(host.prompts[1]).toContain(INVALID);
    expect(host.prompts[1]).toContain("not JSON");

    const wrongShape = new FakeHost({ llm: ['{"text": "x"}', TEASER] });
    await runGraph(g, types, { article: ARTICLE }, wrongShape);
    expect(wrongShape.prompts[1]).toContain("- $.line: missing");
    expect(wrongShape.prompts[1]).toContain("- $.text: not a field of this type");
  });

  test("a second invalid reply fails the node with the issues", async () => {
    const g = withLimits(tool("story-teaser"), { llm_calls_per_run: 0 });
    const r = await runGraph(g, types, { article: ARTICLE }, new FakeHost({ llm: ['{"line": 7}', '{"line": 8}'] }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("after a repair turn");
    expect(r.issues).toEqual([{ path: "$.line", message: "expected a string, found an integer" }]);
  });

  test("the fixture's llm_calls_per_run (1) leaves no room for a repair turn", async () => {
    const host = new FakeHost({ llm: [INVALID, TEASER] });
    const r = await runGraph(tool("story-teaser"), types, { article: ARTICLE }, host);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("limit:llm_calls_per_run");
    expect(host.calls).toEqual(["llm low"]);
  });

  test("agent errors are retried as a whole (failure.retries)", async () => {
    const g = withFailure(withLimits(tool("story-teaser"), { llm_calls_per_run: 0 }), { retries: 1 });
    const host = new FakeHost({ llm: [new Error("upstream 529"), TEASER] });
    const r = await runGraph(g, types, { article: ARTICLE }, host);
    expect(r.ok).toBe(true);
    expect(host.calls).toHaveLength(2);
  });
});

describe("replay (the test button, design §7.2)", () => {
  test("ferry-times: zero host calls, identical outputs and trace", async () => {
    const first = await runGraph(tool("ferry-times"), types, { village: VERNAZZA }, new FakeHost({ web: { [FERRY_URL]: TIMETABLE } }));
    const host = new FakeHost();
    const again = await runGraph(tool("ferry-times"), types, { village: VERNAZZA }, host, { replay: first.recorded });
    expect(host.calls).toEqual([]);
    expect(again.outputs).toEqual(first.outputs);
    expect(again.trace).toEqual(first.trace);
    expect(again.recorded).toEqual(first.recorded);
  });

  test("story-teaser: the agent's reply is reused without an LLM call", async () => {
    const first = await runGraph(tool("story-teaser"), types, { article: ARTICLE }, new FakeHost({ llm: [TEASER] }));
    const host = new FakeHost();
    const again = await runGraph(tool("story-teaser"), types, { article: ARTICLE }, host, { replay: first.recorded });
    expect(host.calls).toEqual([]);
    expect(again.outputs).toEqual(first.outputs);
    expect(again.trace.map((t) => [t.in_sha, t.out_sha])).toEqual(first.trace.map((t) => [t.in_sha, t.out_sha]));
  });

  test("a recorded value is still validated", async () => {
    const r = await runGraph(tool("weather"), types, { city: "Vernazza" }, new FakeHost(), { replay: { fetch: { current: { temperature: "warm" } } } });
    expect(r.ok).toBe(false);
    expect(r.issues?.map((i) => i.path)).toEqual(["$.current.condition", "$.current.temperature"]);
  });
});

describe("ops and conditions", () => {
  const ROWS = JSON.parse(TIMETABLE).departures as Array<{ stop: string; dep: string; dest: string }>;

  test("merge, sort (desc, stable), limit, map", async () => {
    const g = graph({
      inputs: { a: "FerryRow[]", b: "FerryRow[]" },
      outputs: { out: "FerryDeparture[]" },
      nodes: [
        { id: "a", kind: "input", port: "a" },
        { id: "b", kind: "input", port: "b" },
        { id: "all", kind: "op", op: "merge" },
        { id: "late", kind: "op", op: "sort", path: "$.dest", desc: true },
        { id: "top", kind: "op", op: "limit", count: 4 },
        { id: "shape", kind: "op", op: "map", fields: { time: "$.dep", to: "$.dest" }, returns: "FerryDeparture[]" },
        { id: "o", kind: "output", port: "out" },
      ] as any,
      edges: [
        ["a.out", "all.in"],
        ["b.out", "all.b"],
        ["all.out", "late.in"],
        ["late.out", "top.in"],
        ["top.out", "shape.in"],
        ["shape.out", "o.in"],
      ],
    });
    const r = await runGraph(g, types, { a: ROWS.slice(0, 6), b: ROWS.slice(6) }, {});
    expect(r.error).toBeUndefined();
    // Portovenere (4 rows) sorts last ascending, so first descending; ties keep their order.
    expect(r.outputs.out).toEqual([
      { time: "08:50", to: "Portovenere" },
      { time: "09:05", to: "Portovenere" },
      { time: "10:25", to: "Portovenere" },
      { time: "14:15", to: "Portovenere" },
    ]);
  });

  test("filter: literal values, gt, contains", async () => {
    const run = async (where: unknown) => {
      const g = graph({
        inputs: { rows: "FerryRow[]" },
        outputs: { out: "FerryRow[]" },
        nodes: [
          { id: "i", kind: "input", port: "rows" },
          { id: "f", kind: "op", op: "filter", where },
          { id: "o", kind: "output", port: "out" },
        ] as any,
        edges: [
          ["i.out", "f.in"],
          ["f.out", "o.in"],
        ],
      });
      const r = await runGraph(g, types, { rows: ROWS }, {});
      return (r.outputs.out as typeof ROWS | undefined)?.map((x) => x.dep);
    };
    expect(await run({ path: "$.dest", cmp: "eq", value: "Lerici" })).toEqual(["11:20"]);
    expect(await run({ path: "$.dep", cmp: "gt", value: "14:00" })).toEqual(["14:15", "16:05", "17:10"]);
    expect(await run({ path: "$.dep", cmp: "lt", value: "09:10" })).toEqual(["08:50", "09:05"]);
    expect(await run({ path: "$.dest", cmp: "contains", value: "Spezia" })).toEqual(["09:55", "11:45", "17:10"]);
    expect(await run({ path: "$.stop", cmp: "ne", value: "vernazza" })).toEqual(["08:50", "09:55", "11:20", "17:10"]);
  });

  test("format, split and a switch whose taken outlet carries the value", async () => {
    const g = graph({
      inputs: { w: "Weather" },
      outputs: { text: "string[]" },
      nodes: [
        { id: "i", kind: "input", port: "w" },
        { id: "sky", kind: "condition", test: "switch", path: "$.condition", cases: ["sunny", "rain"] },
        { id: "say", kind: "op", op: "format", template: "{condition}|{$.temperature} C" },
        { id: "cut", kind: "op", op: "split", separator: "|" },
        { id: "o", kind: "output", port: "text" },
      ] as any,
      edges: [
        ["i.out", "sky.in"],
        ["sky.sunny", "say.in"],
        ["say.out", "cut.in"],
        ["cut.out", "o.in"],
      ],
    });
    const sunny = await runGraph(g, types, { w: { temperature: 21.5, condition: "sunny" } }, {});
    expect(sunny.outputs).toEqual({ text: ["sunny", "21.5 C"] });
    expect(sunny.trace[1].outlet).toBe("sunny");
    const rain = await runGraph(g, types, { w: { temperature: 14, condition: "rain" } }, {});
    expect(rain.error).toBe("no-output:text");
    expect(rain.trace[1].outlet).toBe("rain");
    const fog = await runGraph(g, types, { w: { temperature: 9, condition: "fog" } }, {});
    expect(fog.trace[1].outlet).toBe("else");
  });

  test("compare and validate (closed objects reject extra fields)", async () => {
    const g = graph({
      inputs: { a: "Article" },
      outputs: { page: "Page" },
      nodes: [
        { id: "i", kind: "input", port: "a" },
        { id: "en", kind: "condition", test: "compare", path: "$.page_type", cmp: "eq", value: "blog-article" },
        { id: "v", kind: "op", op: "validate", returns: "Page" },
        { id: "o", kind: "output", port: "page" },
      ] as any,
      edges: [
        ["i.out", "en.in"],
        ["en.yes", "v.in"],
        ["v.out", "o.in"],
      ],
    });
    const { published_at: _, ...page } = ARTICLE;
    expect((await runGraph(g, types, { a: page }, {})).outputs).toEqual({ page });
    const r = await runGraph(g, types, { a: ARTICLE }, {});
    expect(r.issues).toEqual([{ path: "$.published_at", message: "not a field of this type" }]);
    expect((await runGraph(g, types, { a: { ...page, page_type: "home" } }, {})).error).toBe("no-output:page");
  });

  test("pick on a missing path fails; format with a missing field fails", async () => {
    const g = (node: unknown, out = "Weather") =>
      graph({
        inputs: { r: "WeatherReport" },
        outputs: { o: out },
        nodes: [{ id: "i", kind: "input", port: "r" }, node, { id: "o", kind: "output", port: "o" }] as any,
        edges: [
          ["i.out", "x.in"],
          ["x.out", "o.in"],
        ],
      });
    const input = { r: { current: { temperature: 3, condition: "snow" } } };
    expect((await runGraph(g({ id: "x", kind: "op", op: "pick", path: "$.later", returns: "Weather" }), types, input, {})).error).toContain("$.later");
    expect((await runGraph(g({ id: "x", kind: "op", op: "format", template: "{current.wind}" }, "string"), types, input, {})).error).toContain("{current.wind}");
    expect((await runGraph(g({ id: "x", kind: "op", op: "format", template: "{current.temperature}°" }, "string"), types, input, {})).outputs).toEqual({ o: "3°" });
  });

  test("a skill node calls the host's skill and validates what it returns", async () => {
    const g = graph({
      inputs: { city: "string" },
      outputs: { w: "Weather" },
      nodes: [
        { id: "i", kind: "input", port: "city" },
        { id: "s", kind: "skill", extension: "com.example.meteo", tool: "now", returns: "Weather" },
        { id: "o", kind: "output", port: "w" },
      ] as any,
      edges: [
        ["i.out", "s.in"],
        ["s.out", "o.in"],
      ],
    });
    const calls: unknown[] = [];
    const host: ToolHost = {
      skill: async (ext, t, input) => {
        calls.push([ext, t, input]);
        return { temperature: 18, condition: "cloudy" };
      },
    };
    const r = await runGraph(g, types, { city: "Corniglia" }, host);
    expect(r.outputs).toEqual({ w: { temperature: 18, condition: "cloudy" } });
    expect(calls).toEqual([["com.example.meteo", "now", "Corniglia"]]);
    expect(r.recorded).toEqual({ s: { temperature: 18, condition: "cloudy" } });
    const bad = await runGraph(g, types, { city: "Corniglia" }, { skill: async () => ({ temperature: 18 }) });
    expect(bad.issues).toEqual([{ path: "$.condition", message: "missing" }]);
  });

  test("rss reads items from XML without eval", async () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Parco</title>
      <item><title>Sentiero Azzurro &amp; more</title><link>https://www.parconazionale5terre.it/a</link>
        <pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[Open <b>again</b>]]></description></item>
      <item><title>Trail 2</title><link>https://www.parconazionale5terre.it/b</link></item>
    </channel></rss>`;
    expect(parseFeed(xml)).toEqual([
      {
        title: "Sentiero Azzurro & more",
        link: "https://www.parconazionale5terre.it/a",
        published: "Mon, 05 Oct 2026 08:00:00 GMT",
        summary: "Open <b>again</b>",
      },
      { title: "Trail 2", link: "https://www.parconazionale5terre.it/b" },
    ]);
    const atom = `<feed><entry><title>A</title><link rel="alternate" href="https://x.example/a"/><updated>2026-10-05</updated><summary>S &#233;</summary></entry></feed>`;
    expect(parseFeed(atom)).toEqual([{ title: "A", link: "https://x.example/a", published: "2026-10-05", summary: "S é" }]);

    const g = graph({
      outputs: { items: "FeedItem[]" },
      nodes: [
        { id: "feed", kind: "connector", connector: "rss", url: "https://www.parconazionale5terre.it/rss", returns: "FeedItem[]" },
        { id: "o", kind: "output", port: "items" },
      ] as any,
      edges: [["feed.out", "o.in"]],
    });
    const r = await runGraph(g, types, {}, new FakeHost({ web: { "https://www.parconazionale5terre.it/rss": xml } }));
    expect((r.outputs.items as unknown[]).length).toBe(2);
  });

  test("a structural problem or a cycle fails before any host call", async () => {
    const cyc = graph({
      outputs: { o: "string" },
      nodes: [
        { id: "a", kind: "op", op: "format", template: "x" },
        { id: "b", kind: "op", op: "format", template: "y" },
        { id: "o", kind: "output", port: "o" },
      ] as any,
      edges: [
        ["a.out", "b.in"],
        ["b.out", "a.in"],
        ["b.out", "o.in"],
      ],
    });
    expect((await runGraph(cyc, types, {}, {})).error).toContain("cycle");
    const loose = { ...tool("weather"), edges: [["fetch.out", "now.in"], ["now.out", "out.in"]] as [string, string][] };
    const host = new FakeHost();
    const r = await runGraph(loose, types, { city: "x" }, host);
    expect(r.error).toContain("bad-graph");
    expect(host.calls).toEqual([]);
  });
});
