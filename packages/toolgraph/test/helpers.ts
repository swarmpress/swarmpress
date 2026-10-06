import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseToolGraph, type ToolGraph } from "../src/graph.ts";
import type { ToolHost } from "../src/interpret.ts";

export const ROOT = join(import.meta.dir, "..", "..", "..");
/** The fixture site shared with `crates/blueprint` (the Rust checker's goldens). */
export const SITE = join(ROOT, "crates", "blueprint", "tests", "fixtures", "site");
export const FIXTURES = join(import.meta.dir, "fixtures");

export const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

export function tool(id: string): ToolGraph {
  return parseToolGraph(readFileSync(join(SITE, "blueprint", "tools", `${id}.tool.json`), "utf8"));
}

/** The site's types (`blueprint/types/<Name>.json`), name → schema. */
export function siteTypes(): Record<string, unknown> {
  const dir = join(SITE, "blueprint", "types");
  const out: Record<string, unknown> = {};
  for (const f of readdirSync(dir).sort()) if (f.endsWith(".json")) out[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  return out;
}

export function goldenManifests(): Record<string, any> {
  return JSON.parse(readFileSync(join(SITE, "manifests.golden.json"), "utf8"));
}

export const FERRY_URL = "https://www.navigazionegolfodeipoeti.it/orari.json";
export const WEATHER_URL = (city: string) => `https://api.open-meteo.com/v1/current?city=${encodeURIComponent(city)}`;
export const VERNAZZA = { slug: "vernazza", name: "Vernazza" };
export const ARTICLE = {
  id: "page-vernazza-dawn",
  path: "content/pages/en/vernazza-dawn.json",
  page_type: "blog-article",
  route: "/en/blog/vernazza-dawn",
  title: { en: "Vernazza at dawn" },
  published_at: "2026-09-30",
};

type Answer = string | Error;

/** A recorded host: answers from fixtures (by exact URL, in order), logs every call, and fails loudly. */
export class FakeHost implements ToolHost {
  readonly calls: string[] = [];
  readonly prompts: string[] = [];
  private readonly web: Map<string, Answer[]>;
  private readonly script: Answer[];

  constructor(opts: { web?: Record<string, Answer | Answer[]>; llm?: Answer[] } = {}) {
    this.web = new Map(Object.entries(opts.web ?? {}).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
    this.script = [...(opts.llm ?? [])];
  }

  async fetch(url: string): Promise<string> {
    this.calls.push(`fetch ${url}`);
    const q = this.web.get(url);
    if (!q || q.length === 0) throw new Error(`fake web: no fixture for ${url}`);
    const a = q.length > 1 ? q.shift()! : q[0];
    if (a instanceof Error) throw a;
    return a;
  }

  async llm(tier: string, prompt: string): Promise<string> {
    this.calls.push(`llm ${tier}`);
    this.prompts.push(prompt);
    const a = this.script.shift();
    if (a === undefined) throw new Error("fake llm: no scripted reply left");
    if (a instanceof Error) throw a;
    return a;
  }
}
