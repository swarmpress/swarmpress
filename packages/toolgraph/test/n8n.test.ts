/**
 * n8n import (FEAT-096): fixed mapping, sealed steps for what has no
 * equivalent, response types inferred from what the workflow reads. The
 * imported graphs are written to crates/blueprint/tests/fixtures/n8n/ (with
 * BLESS=1), where the Rust checker confirms them (crates/blueprint/tests/n8n.rs).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseToolGraph, ToolGraphSchema } from "../src/graph.ts";
import { runGraph } from "../src/interpret.ts";
import { FakeHost } from "./helpers.ts";
import { importN8n, pathOf, SEALED_EXTENSION, urlOf, type N8nWorkflow } from "../src/import/n8n.ts";

const fixture = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dir, `fixtures/n8n/${name}.json`), "utf8")) as N8nWorkflow;
const GOLDEN = resolve(import.meta.dir, "../../../crates/blueprint/tests/fixtures/n8n");

function golden(id: string, value: unknown) {
  const path = `${GOLDEN}/${id}.json`;
  const text = JSON.stringify(value, null, 2) + "\n";
  if (process.env.BLESS) writeFileSync(path, text);
  expect(readFileSync(path, "utf8")).toBe(text);
}

describe("expressions", () => {
  test("plain fields become paths and placeholders", () => {
    expect(pathOf("={{ $json.current.temperature_2m }}")).toBe("$.current.temperature_2m");
    expect(pathOf("={{ $json.items[0] }}")).toBe("$.items[0]");
    expect(pathOf("={{ $json.a + 1 }}")).toBeNull();
    expect(pathOf("literal")).toBeNull();
    expect(urlOf("=https://api.example.com/v1/{{ $json.city }}?x=1")).toBe("https://api.example.com/v1/{city}?x=1");
    expect(urlOf("={{ $json.base }}/x")).toBe("{base}/x");
    expect(urlOf("=https://a.example.com/{{ $now }}")).toBeNull();
  });
});

describe("importN8n", () => {
  test("an RSS digest maps to typed nodes with no sealed step", () => {
    const out = importN8n(fixture("news-digest"), "news-digest");
    const g = ToolGraphSchema.parse(out.graph);
    expect(g.triggers).toEqual([{ kind: "on-demand" }]);
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([
      ["rss-read", "connector"],
      ["limit", "op"],
      ["edit-fields", "op"],
      ["edit-fields-out", "output"],
    ]);
    expect(g.edges).toEqual([
      ["rss-read.out", "limit.in"],
      ["limit.out", "edit-fields.in"],
      ["edit-fields.out", "edit-fields-out.in"],
    ]);
    expect(g.outputs).toEqual({ edit_fields: "NewsDigestEditFields[]" });
    expect(out.issues).toEqual([]);
    golden("news-digest", { graph: out.graph, types: out.types });
  });

  test("code is sealed, the response type is inferred from what is read", () => {
    const out = importN8n(fixture("weather-alert"), "weather-alert");
    const g = ToolGraphSchema.parse(out.graph);
    expect(g.triggers).toEqual([{ kind: "schedule", every_game_days: 1 }]);
    const sealed = g.nodes.find((n) => n.kind === "skill") as { extension: string; tool: string };
    expect(sealed).toMatchObject({ extension: SEALED_EXTENSION, tool: "n8n-nodes-base.code" });
    expect(out.issues.map((i) => i.code)).toEqual(["needs-type", "sealed", "needs-type"]);
    expect(out.issues[0].message).toContain("inferred from what the workflow reads");
    expect(out.types.WeatherAlertForecastResponse).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["current"],
      properties: {
        current: { type: "object", additionalProperties: false, required: ["temperature_2m"], properties: { temperature_2m: { type: "number" } } },
      },
    });
    const cond = g.nodes.find((n) => n.kind === "condition") as { path: string; cmp: string; value: unknown };
    expect(cond).toMatchObject({ path: "$.current.temperature_2m", cmp: "gt", value: 30 });
    golden("weather-alert", { graph: out.graph, types: out.types });
  });

  test("a POST is sealed, not dropped", () => {
    const wf = fixture("weather-alert");
    wf.nodes[1].parameters = { method: "POST", url: "https://api.example.com/x" };
    const out = importN8n(wf, "x");
    expect(out.issues.some((i) => i.code === "sealed" && i.message.includes("POST"))).toBe(true);
  });

  test("the imported digest runs in the interpreter", async () => {
    const out = importN8n(fixture("news-digest"), "news-digest");
    const items = Array.from({ length: 7 }, (_, i) => `<item><title>Story ${i}</title><link>https://www.ansa.it/s/${i}</link></item>`).join("");
    const host = new FakeHost({ web: { "https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml": `<?xml version="1.0"?><rss><channel>${items}</channel></rss>` } });
    const r = await runGraph(parseToolGraph(JSON.stringify(out.graph)), out.types, {}, host);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.outputs.edit_fields).toEqual(Array.from({ length: 5 }, (_, i) => ({ title: `Story ${i}`, link: `https://www.ansa.it/s/${i}` })));
  });
});
