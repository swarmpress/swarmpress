import { describe, expect, test } from "bun:test";
import { ToolGraphParseError, parseToolGraph } from "../src/graph.ts";
import { tool } from "./helpers.ts";

describe("swarmpress.tool.v1 parses like the Rust serde shapes", () => {
  test("the three fixture tools parse", () => {
    for (const id of ["ferry-times", "weather", "story-teaser"]) expect(tool(id).id).toBe(id);
  });

  test("defaults are Rust's: triggers [], failure {0, fail}, limits {0, 0}, description ''", () => {
    const weather = tool("weather");
    expect(weather.failure).toEqual({ retries: 0, on_error: "fail" });
    expect(weather.limits).toEqual({ llm_calls_per_run: 0, fetches_per_run: 0 });
    expect(weather.description).toBe("");
    const teaser = tool("story-teaser");
    expect(teaser.limits).toEqual({ llm_calls_per_run: 1, fetches_per_run: 0 });
    const ferry = tool("ferry-times");
    expect(ferry.failure).toEqual({ retries: 1, on_error: "keep-last" });
    expect(ferry.limits).toEqual({ llm_calls_per_run: 0, fetches_per_run: 1 });
    const op = ferry.nodes.find((n) => n.id === "first");
    expect(op).toMatchObject({ kind: "op", op: "limit", count: 6, desc: false, fields: {} });
    const bare = parseToolGraph({ format: "swarmpress.tool.v1", id: "x", name: { en: "X" }, outputs: {}, nodes: [], edges: [] });
    expect(bare.triggers).toEqual([]);
    expect(bare.inputs).toEqual({});
  });

  test("unknown fields are rejected with their path (deny_unknown_fields)", () => {
    const g = JSON.parse(JSON.stringify(tool("weather")));
    g.nodes[1].headers = { a: "b" };
    try {
      parseToolGraph(g);
      throw new Error("parsed");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolGraphParseError);
      expect((e as ToolGraphParseError).issues.join("\n")).toContain("nodes.1");
    }
    expect(() => parseToolGraph({ ...tool("weather"), extra: 1 })).toThrow(ToolGraphParseError);
    expect(() => parseToolGraph({ ...tool("weather"), failure: { retries: 1, on_error: "retry" } })).toThrow(ToolGraphParseError);
    expect(() => parseToolGraph({ ...tool("weather"), limits: { tokens: 3 } })).toThrow(ToolGraphParseError);
  });

  test("an unknown node kind, a bad enum or a malformed edge is a typed error, never a default", () => {
    const g = tool("weather");
    expect(() => parseToolGraph({ ...g, nodes: [{ id: "x", kind: "code", source: "1" }] })).toThrow(ToolGraphParseError);
    expect(() => parseToolGraph({ ...g, nodes: [{ id: "x", kind: "op", op: "eval" }] })).toThrow(ToolGraphParseError);
    expect(() => parseToolGraph({ ...g, edges: [["a.out"]] })).toThrow(ToolGraphParseError);
    expect(() => parseToolGraph({ ...g, triggers: [{ kind: "schedule" }] })).toThrow(ToolGraphParseError);
    expect(() => parseToolGraph({ ...g, format: "swarmpress.tool.v2" })).toThrow(ToolGraphParseError);
    expect(() => parseToolGraph("{not json")).toThrow(ToolGraphParseError);
    expect(() => parseToolGraph({ ...g, nodes: [{ id: "x", kind: "op", op: "limit", count: -1 }] })).toThrow(ToolGraphParseError);
  });

  test("serde's Option: null is the same as missing", () => {
    const g = parseToolGraph({ ...tool("weather"), nodes: [{ id: "x", kind: "connector", connector: "web-search", query: "q", url: null, returns: "SearchResult[]" }] });
    expect(g.nodes[0]).toEqual({ id: "x", kind: "connector", connector: "web-search", query: "q", returns: "SearchResult[]" } as any);
  });
});
