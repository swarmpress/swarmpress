/**
 * The tool-graph interpreter (FEAT-091, ADR-0072, design §7): one shared,
 * reviewed piece of code that runs any `swarmpress.tool.v1` graph. Graphs are
 * data; code lives only here and in reviewed skills.
 *
 * - Deterministic: nodes run in the same topological order as Rust's `topo()`
 *   (a FIFO ready queue seeded in node declaration order).
 * - Only the taken outlet of a condition carries a value; a node with a
 *   connected inlet that received nothing is skipped (`not-taken`). A declared
 *   output nobody wrote fails the run (`no-output:<port>`, rule 11).
 * - Connector, agent and skill results are validated against their declared
 *   types, recorded by node id, and reused on replay without a host call.
 * - Every node leaves a trace entry with input and output hashes.
 *
 * Sandbox-safe: no Zod, no `crypto`, no Node or Bun modules; it is bundled
 * into every tool's skill (`skill.ts`) and runs inside QuickJS.
 */
import { canonicalJson, sha256Hex } from "@swarm-press/sdk/runtime";
import type { Cmp, Node, Tier, ToolGraph } from "./graph.ts";
import { TypeRegistry, TypeSchemaError, readPath, type TypeIssue } from "./types.ts";
import { N8N_TYPES } from "./n8n/catalogue.ts";
import type { Item } from "./n8n/expr.ts";
import { type HttpRequest, type HttpResponse, type N8nNode, runN8n, toItems } from "./n8n/nodes.ts";
import { N8N_PRELUDE } from "./n8n/prelude.ts";

/** Requests (or model calls) one n8n node makes per run at most, per item list: the default run limit (ADR-0076). */
export const N8N_CALLS_PER_NODE = 50;

// ---------------------------------------------------------------- host and result

/** What the graph may reach outside itself. A missing facility fails its node loudly. */
export interface ToolHost {
  /** `http-get`, `rss`: GET `url`, resolve with the body text; throw on a failed request. */
  fetch?(url: string, init: { credential?: string }): Promise<string>;
  /** `web-search` (server-side, ADR-0068): results for the query. */
  search?(query: string): Promise<unknown>;
  /** `knowledge`: the pack's `pages`, `media` or `entities`. */
  knowledge?(query: string): Promise<unknown>;
  /** `store-read`: a table's value (`key` from the `params` port when it is a string). */
  store?(table: string, key?: string): Promise<unknown>;
  /** `tool`: another tool of the site. */
  tool?(id: string, input: unknown): Promise<unknown>;
  /** `agent`: one completion. */
  llm?(tier: Tier, prompt: string, meta: { role: string; node: string }): Promise<string>;
  /** `skill`: a tool of an installed SDK skill. */
  skill?(extension: string, tool: string, input: unknown): Promise<unknown>;
  /** n8n HTTP Request and RSS: any method; resolves with the response (any status); throws when no response came. */
  request?(req: HttpRequest): Promise<HttpResponse>;
  /** n8n JavaScript: runs `program` in a fresh sandbox without capabilities and calls its `run(task)` (ADR-0076). */
  code?(program: string, task: unknown): Promise<unknown>;
}

export type NodeState = "ok" | "not-taken" | "failed";

export interface TraceEntry {
  node: string;
  state: NodeState;
  /** sha256 hex of the canonical JSON of the node's inlets (`{port: value}`); null when not taken. */
  in_sha: string | null;
  /** sha256 hex of the canonical JSON of what the node wrote; null when not taken or failed. */
  out_sha: string | null;
  /** A condition's taken outlet. */
  outlet?: string;
  /** Elapsed time from the injected clock. */
  ms: number;
  error?: string;
  /** Type issues behind the error, by field path. */
  issues?: TypeIssue[];
}

/** Connector, agent and skill outputs by node id (what a replay reuses). */
export type Recorded = Record<string, unknown>;

export interface RunResult {
  ok: boolean;
  /** The tool's outputs by port; empty when the run failed (nothing is written). */
  outputs: Record<string, unknown>;
  trace: TraceEntry[];
  recorded: Recorded;
  error?: string;
  issues?: TypeIssue[];
  /** The run failed and the graph says bound blocks keep their last good output (the caller writes). */
  keepLast?: boolean;
}

export interface RunOptions {
  /** A previous run's `recorded`: those nodes reuse the record and make no host call (design §7.2). */
  replay?: Recorded;
  /** Milliseconds for trace timings. Default: always 0 (deterministic traces). */
  clock?: () => number;
}

// ---------------------------------------------------------------- errors

class NodeError extends Error {
  readonly issues?: TypeIssue[];
  /** Not retried (limits, capabilities, missing host facilities). */
  readonly fatal: boolean;
  constructor(message: string, opts: { issues?: TypeIssue[]; fatal?: boolean } = {}) {
    super(message);
    this.name = "NodeError";
    this.issues = opts.issues;
    this.fatal = opts.fatal ?? false;
  }
}

/** The sandbox's capability errors are never swallowed or retried: they reach the host as they are. */
function isCapabilityError(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: unknown }).name === "CapabilityError";
}

const sha = (v: unknown) => sha256Hex(canonicalJson(v));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function typeError(what: string, issues: TypeIssue[]): NodeError {
  const head = issues
    .slice(0, 5)
    .map((i) => `${i.path}: ${i.message}`)
    .join("; ");
  return new NodeError(`${what}: ${head}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ""}`, { issues });
}

// ---------------------------------------------------------------- graph structure

/** The ports a node reads, and whether each must be connected (`Node::in_ports`). */
export function inPorts(n: Node): Array<[string, boolean]> {
  switch (n.kind) {
    case "input":
      return [];
    case "n8n":
      return Array.from({ length: Math.max(1, n.inputs) }, (_, i): [string, boolean] => [i ? `in${i}` : "in", false]);
    case "connector":
      return [["params", false]];
    case "op":
      if (n.op === "filter")
        return [
          ["in", true],
          ["param", false],
        ];
      if (n.op === "merge")
        return [
          ["in", true],
          ["b", true],
        ];
      return [["in", true]];
    default:
      return [["in", true]];
  }
}

/** The ports a node writes (`Node::out_ports`). */
export function outPorts(n: Node): string[] {
  if (n.kind === "output") return [];
  if (n.kind === "condition") return n.test === "switch" ? [...n.cases, "else"] : ["yes", "no"];
  if (n.kind === "n8n") return Array.from({ length: Math.max(1, n.outputs) }, (_, i) => (i ? `out${i}` : "out"));
  return ["out"];
}

interface Edge {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

function parseEdges(g: ToolGraph): Edge[] {
  const ids = new Map(g.nodes.map((n) => [n.id, n]));
  if (ids.size !== g.nodes.length) throw new NodeError("bad-graph: a node id is used twice");
  const edges: Edge[] = [];
  const fed = new Set<string>();
  g.edges.forEach(([a, b], i) => {
    const da = a.indexOf(".");
    const db = b.indexOf(".");
    if (da < 0 || db < 0) throw new NodeError(`bad-graph: edge ${i} joins node.port to node.port`);
    const e = { from: a.slice(0, da), fromPort: a.slice(da + 1), to: b.slice(0, db), toPort: b.slice(db + 1) };
    const f = ids.get(e.from);
    const t = ids.get(e.to);
    if (!f || !outPorts(f).includes(e.fromPort)) throw new NodeError(`bad-graph: edge ${i}: ${a} is not an outlet`);
    if (!t || !inPorts(t).some(([p]) => p === e.toPort)) throw new NodeError(`bad-graph: edge ${i}: ${b} is not an inlet`);
    const key = `${e.to}.${e.toPort}`;
    if (fed.has(key)) throw new NodeError(`bad-graph: ${key} is fed twice`);
    fed.add(key);
    edges.push(e);
  });
  for (const n of g.nodes) {
    if (n.kind === "input" && !Object.prototype.hasOwnProperty.call(g.inputs, n.port))
      throw new NodeError(`bad-graph: ${n.id} reads ${n.port}, which is not an input of the tool`);
    if (n.kind === "output" && !Object.prototype.hasOwnProperty.call(g.outputs, n.port))
      throw new NodeError(`bad-graph: ${n.id} writes ${n.port}, which is not an output of the tool`);
  }
  for (const n of g.nodes)
    for (const [p, required] of inPorts(n))
      if (required && !fed.has(`${n.id}.${p}`)) throw new NodeError(`bad-graph: ${n.id}.${p} is not connected`);
  for (const n of g.nodes)
    if (n.kind === "connector" && placeholders(n.url ?? n.query ?? "").length && !fed.has(`${n.id}.params`))
      throw new NodeError(`bad-graph: ${n.id} fills {${placeholders(n.url ?? n.query ?? "").join("}, {")}} from params, which is not connected`);
  return edges;
}

/** Node ids in Rust `topo()` order; throws on a cycle. */
export function topoOrder(g: ToolGraph, edges: Edge[] = parseEdges(g)): string[] {
  const indeg = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  for (const e of edges) if (indeg.has(e.from) && indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to)! + 1);
  const ready = g.nodes.map((n) => n.id).filter((id) => indeg.get(id) === 0);
  const out: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    out.push(id);
    for (const e of edges) {
      if (e.from !== id || !indeg.has(e.to)) continue;
      const d = indeg.get(e.to)! - 1;
      indeg.set(e.to, d);
      if (d === 0) ready.push(e.to);
    }
  }
  if (out.length !== indeg.size) throw new NodeError("bad-graph: the graph has a cycle");
  return out;
}

// ---------------------------------------------------------------- pure helpers

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function compare(a: unknown, cmp: Cmp, b: unknown): boolean {
  const eq = (x: unknown, y: unknown) => x !== undefined && canonicalJson(x) === canonicalJson(y);
  switch (cmp) {
    case "eq":
      return eq(a, b);
    case "ne":
      return !eq(a, b);
    case "gt":
    case "lt": {
      const same = (typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string");
      if (!same) return false;
      return cmp === "gt" ? (a as number | string) > (b as number | string) : (a as number | string) < (b as number | string);
    }
    case "contains":
      if (typeof a === "string" && typeof b === "string") return a.includes(b);
      if (Array.isArray(a)) return a.some((x) => eq(x, b));
      return false;
  }
}

/** Sort key order: numbers, then strings, then anything else, then missing. */
function sortRank(v: unknown): number {
  if (typeof v === "number") return 0;
  if (typeof v === "string") return 1;
  return v === undefined || v === null ? 3 : 2;
}
function sortCompare(a: unknown, b: unknown): number {
  const ra = sortRank(a);
  const rb = sortRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return (a as number) - (b as number);
  if (ra === 1) return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  if (ra === 2) {
    const ca = canonicalJson(a);
    const cb = canonicalJson(b);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  }
  return 0;
}

/** `{name}` placeholders in a template (`placeholders()` in tools.rs). */
export function placeholders(t: string): string[] {
  return t
    .split("{")
    .slice(1)
    .flatMap((p) => {
      const end = p.indexOf("}");
      return end < 0 ? [] : [p.slice(0, end)];
    });
}

/** `https://host[:port]` of an `https://` URL with a literal host (`origin_of`). */
export function originOf(url: string): string | null {
  if (!url.startsWith("https://")) return null;
  const rest = url.slice(8);
  const m = /[/?#]/.exec(rest);
  const host = rest.slice(0, m ? m.index : rest.length);
  return host && /^[A-Za-z0-9.:-]+$/.test(host) && host.includes(".") ? `https://${host}` : null;
}

function scalarText(v: unknown, what: string): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new NodeError(`${what} is ${v === undefined ? "missing" : "not a string, number or boolean"}`);
}

/** Fills `{name}` from `params`: an object's field, or the scalar itself when there is one placeholder. */
export function fillTemplate(template: string, params: unknown, encode: boolean): string {
  const names = [...new Set(placeholders(template))];
  if (!names.length) return template;
  const scalar = !isObj(params) && names.length === 1;
  return template.replace(/\{([^{}]*)\}/g, (_, name: string) => {
    const v = scalar ? params : isObj(params) ? readPath(params, `$.${name}`) : undefined;
    const s = scalarText(v, `placeholder {${name}}`);
    return encode ? encodeURIComponent(s) : s;
  });
}

/** `format`: `{path}` placeholders against the value; `{a.b}` is relative to the root, `{$}` is the value. */
export function formatTemplate(template: string, value: unknown): string {
  return template.replace(/\{([^{}]*)\}/g, (_, raw: string) => {
    const p = raw.trim();
    const path = p === "" || p === "$" ? "$" : p.startsWith("$") ? p : `$.${p}`;
    const v = readPath(value, path);
    if (v === undefined) throw new NodeError(`format: {${raw}} is not in the value`);
    return typeof v === "string" ? v : canonicalJson(v);
  });
}

// ---------------------------------------------------------------- rss

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeXmlText(raw: string): string {
  let out = "";
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const decode = (s: string) =>
    s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[e] ?? whole;
    });
  while ((m = re.exec(raw))) {
    out += decode(raw.slice(last, m.index)) + m[1];
    last = m.index + m[0].length;
  }
  out += decode(raw.slice(last));
  return out.trim();
}

function tagText(xml: string, names: string[]): string | undefined {
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc}\\s*>`).exec(xml);
    if (m) {
      const t = decodeXmlText(m[1]);
      if (t) return t;
    }
  }
  return undefined;
}

/**
 * Items of an RSS 2.0 (`<item>`) or Atom (`<entry>`) document as FeedItems
 * (`title`, `link`, `published?`, `summary?`). A small regex reader, no eval,
 * no entity expansion beyond the predefined and numeric ones.
 */
export function parseFeed(xml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const body = m[2];
    const item: Record<string, string> = {};
    const title = tagText(body, ["title"]);
    let link = tagText(body, ["link"]);
    if (!link) {
      const links = [...body.matchAll(/<link\b([^>]*?)\/?>/g)].map((l) => l[1]);
      const pick = links.find((a) => !/\brel\s*=/.test(a) || /\brel\s*=\s*["']alternate["']/.test(a)) ?? links[0];
      const href = pick && /\bhref\s*=\s*["']([^"']*)["']/.exec(pick);
      if (href) link = decodeXmlText(href[1]);
    }
    const published = tagText(body, ["pubDate", "published", "updated", "dc:date"]);
    const summary = tagText(body, ["description", "summary"]);
    if (title !== undefined) item.title = title;
    if (link !== undefined) item.link = link;
    if (published !== undefined) item.published = published;
    if (summary !== undefined) item.summary = summary;
    items.push(item);
  }
  return items;
}

/** The JSON value in an LLM reply (bare, or in a ```json fence). */
export function parseJsonReply(text: string): unknown {
  let t = text.trim();
  const fence = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1].trim();
  return JSON.parse(t);
}

// ---------------------------------------------------------------- the run

export async function runGraph(
  graph: ToolGraph,
  types: TypeRegistry | Record<string, unknown>,
  input: unknown,
  host: ToolHost,
  opts: RunOptions = {},
): Promise<RunResult> {
  const clock = opts.clock ?? (() => 0);
  const trace: TraceEntry[] = [];
  const recorded: Recorded = {};
  const keepLast = graph.failure.on_error === "keep-last";
  const fail = (error: string, issues?: TypeIssue[]): RunResult => ({
    ok: false,
    outputs: {},
    trace,
    recorded,
    error,
    ...(issues ? { issues } : {}),
    ...(keepLast ? { keepLast: true } : {}),
  });

  let reg: TypeRegistry;
  let edges: Edge[];
  let order: string[];
  try {
    reg = types instanceof TypeRegistry ? types : TypeRegistry.withSite(types);
    edges = parseEdges(graph);
    order = topoOrder(graph, edges);
  } catch (e) {
    if (e instanceof TypeSchemaError) return fail(`bad-types: ${e.message}`, e.issues);
    return fail(errMsg(e));
  }

  // The tool's inputs: exactly the declared ports, each fitting its type.
  if (!isObj(input)) return fail("bad-input: the input is an object of the tool's inputs");
  for (const k of Object.keys(input).sort()) if (!(k in graph.inputs)) return fail(`bad-input:${k}: not an input of ${graph.id}`);
  for (const port of Object.keys(graph.inputs).sort()) {
    const issues = reg.validate(input[port], graph.inputs[port]).map((i) => ({ path: `${port}${i.path.slice(1)}`, message: i.message }));
    if (issues.length) return fail(`bad-input:${port}: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, issues);
  }

  const retries = graph.failure.retries;
  const count = (k: Node["kind"]) => graph.nodes.filter((n) => n.kind === k).length;
  const n8nCount = (what: "web" | "llm" | "tool") => graph.nodes.filter((n) => n.kind === "n8n" && N8N_TYPES[n.type]?.[what]).length;
  const fetchLimit = graph.limits.fetches_per_run || (count("connector") + (n8nCount("web") + n8nCount("tool")) * N8N_CALLS_PER_NODE) * (1 + retries);
  const llmLimit = graph.limits.llm_calls_per_run || (count("agent") * 2 + n8nCount("llm") * N8N_CALLS_PER_NODE) * (1 + retries);
  let fetches = 0;
  let llmCalls = 0;
  const spendFetch = () => {
    if (fetches >= fetchLimit) throw new NodeError(`limit:fetches_per_run: more than ${fetchLimit} calls`, { fatal: true });
    fetches++;
  };
  const spendLlm = () => {
    if (llmCalls >= llmLimit) throw new NodeError(`limit:llm_calls_per_run: more than ${llmLimit} calls`, { fatal: true });
    llmCalls++;
  };
  const need = <K extends keyof ToolHost>(k: K): NonNullable<ToolHost[K]> => {
    const f = host[k];
    if (typeof f !== "function") throw new NodeError(`no-host:${k}: this host does not provide ${k}`, { fatal: true });
    return (f as Function).bind(host) as NonNullable<ToolHost[K]>;
  };
  const checked = (value: unknown, typeExpr: string, what: string): unknown => {
    const issues = reg.validate(value, typeExpr);
    if (issues.length) throw typeError(`${what} does not fit ${typeExpr}`, issues);
    return value;
  };
  const withRetries = async <T>(fn: () => Promise<T>): Promise<T> => {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (isCapabilityError(e) || (e instanceof NodeError && e.fatal)) throw e;
        last = e;
      }
    }
    throw last;
  };
  const replayed = (id: string) => opts.replay !== undefined && Object.prototype.hasOwnProperty.call(opts.replay, id);

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const values = new Map<string, unknown>();
  const outputs: Record<string, unknown> = {};
  /** What each n8n node wrote, by its n8n name (`$('Name')`). */
  const n8nItems: Record<string, Item[]> = {};

  for (const id of order) {
    const n = nodes.get(id)!;
    if (n.kind === "n8n") {
      const r = await n8nStep(n);
      if (r) return r;
      continue;
    }
    // Inlets: every connected inlet must have received a value, or the node is not taken.
    const inlets: Record<string, unknown> = {};
    let taken = true;
    for (const [port] of inPorts(n)) {
      const e = edges.find((x) => x.to === id && x.toPort === port);
      if (!e) continue;
      const key = `${e.from}.${e.fromPort}`;
      if (!values.has(key)) taken = false;
      else inlets[port] = values.get(key);
    }
    if (!taken) {
      trace.push({ node: id, state: "not-taken", in_sha: null, out_sha: null, ms: 0 });
      continue;
    }
    if (n.kind === "input") inlets[n.port] = input[n.port];
    const inSha = sha(inlets);
    const t0 = clock();
    try {
      const { value, outlet } = await step(n, inlets);
      const entry: TraceEntry = { node: id, state: "ok", in_sha: inSha, out_sha: sha(value), ms: clock() - t0 };
      if (n.kind === "condition") entry.outlet = outlet;
      trace.push(entry);
      if (n.kind === "output") outputs[n.port] = value;
      else values.set(`${id}.${outlet}`, value);
    } catch (e) {
      if (isCapabilityError(e)) throw e;
      const issues = e instanceof NodeError ? e.issues : undefined;
      trace.push({ node: id, state: "failed", in_sha: inSha, out_sha: null, ms: clock() - t0, error: errMsg(e), ...(issues ? { issues } : {}) });
      return fail(`${id}: ${errMsg(e)}`, issues);
    }
  }
  // A declared output nobody wrote fails the run, unless its type is optional (`T?`: a branch that did not run).
  for (const port of Object.keys(graph.outputs).sort()) if (!(port in outputs) && !graph.outputs[port].endsWith("?")) return fail(`no-output:${port}`);
  return { ok: true, outputs, trace, recorded };

  // ------------------------------------------------------------ an n8n node (ADR-0076)

  /** Runs an n8n node; a failed run's result, or nothing when the run goes on. */
  async function n8nStep(n: Extract<Node, { kind: "n8n" }>): Promise<RunResult | undefined> {
    const id = n.id;
    // Inputs: an unconnected node starts from one empty item (as after a trigger);
    // a connected one runs when at least one of its inputs received items.
    const ports = inPorts(n).map(([p]) => p);
    const fedBy = ports.map((p) => edges.find((x) => x.to === id && x.toPort === p));
    const connected = fedBy.some(Boolean);
    const ins: Item[][] = fedBy.map((e) => (e && values.has(`${e.from}.${e.fromPort}`) ? toItems(values.get(`${e.from}.${e.fromPort}`)) : []));
    if (connected && !fedBy.some((e) => e && values.has(`${e.from}.${e.fromPort}`))) {
      trace.push({ node: id, state: "not-taken", in_sha: null, out_sha: null, ms: 0 });
      return undefined;
    }
    if (!connected) ins[0] = [{}];
    const inlets: Record<string, unknown> = {};
    ports.forEach((p, i) => (inlets[p] = ins[i]));
    const inSha = sha(inlets);
    const t0 = clock();
    let touched = false;
    const node = n as unknown as N8nNode;
    try {
      let outlets: Item[][];
      if (replayed(id)) {
        const rec = clone(opts.replay![id]) as { outlets?: Item[][] };
        if (!rec || !Array.isArray(rec.outlets)) throw new NodeError("the recorded output is not an n8n node's outlets");
        outlets = rec.outlets;
        recorded[id] = clone(rec);
      } else {
        outlets = await withRetries(() =>
          runN8n({
            node,
            inputs: ins,
            nodes: n8nItems,
            workflow: { id: graph.id, name: graph.name.en ?? graph.id },
            js: async (task) => {
              touched = true;
              return await need("code")(N8N_PRELUDE, task);
            },
            request: async (req) => {
              touched = true;
              spendFetch();
              return await need("request")(req);
            },
            llm: async (prompt) => {
              touched = true;
              spendLlm();
              const text = await need("llm")("mid", prompt, { role: "n8n", node: id });
              if (typeof text !== "string") throw new NodeError(`${id}: the model returned no text`);
              return text;
            },
            tool: async (tool, input) => {
              touched = true;
              spendFetch();
              return await need("tool")(tool, input);
            },
          }),
        );
        if (touched) recorded[id] = { outlets: clone(outlets) };
      }
      if (n.returns) {
        const want = n.returns;
        const issues = reg.validate(outlets[0] ?? [], want);
        if (issues.length) throw typeError(`${id}: the items do not fit ${want}`, issues);
      }
      const taken: string[] = [];
      outPorts(n).forEach((p, k) => {
        const its = outlets[k] ?? [];
        if (its.length) {
          values.set(`${id}.${p}`, its);
          taken.push(p);
        }
      });
      n8nItems[n.name] = outlets.flat();
      trace.push({ node: id, state: "ok", in_sha: inSha, out_sha: sha(outlets), outlet: taken.join(","), ms: clock() - t0 });
      return undefined;
    } catch (e) {
      if (isCapabilityError(e)) throw e;
      const issues = e instanceof NodeError ? e.issues : undefined;
      trace.push({ node: id, state: "failed", in_sha: inSha, out_sha: null, ms: clock() - t0, error: errMsg(e), ...(issues ? { issues } : {}) });
      return fail(`${id}: ${errMsg(e)}`, issues);
    }
  }

  // ------------------------------------------------------------ one node

  async function step(n: Node, inlets: Record<string, unknown>): Promise<{ value: unknown; outlet: string }> {
    const out = (value: unknown) => ({ value, outlet: "out" });
    switch (n.kind) {
      case "input":
        return out(clone(inlets[n.port]));
      case "output":
        return { value: checked(clone(inlets.in), graph.outputs[n.port], `output ${n.port}`), outlet: "" };
      case "condition": {
        const v = readPath(inlets.in, n.path);
        let outlet: string;
        if (n.test === "exists") outlet = v !== undefined && v !== null ? "yes" : "no";
        else if (n.test === "compare") outlet = compare(v, n.cmp!, n.value) ? "yes" : "no";
        else outlet = typeof v === "string" && n.cases.includes(v) ? v : "else";
        return { value: clone(inlets.in), outlet };
      }
      case "op":
        return out(op(n, inlets));
      case "connector":
        return out(await recordedCall(n.id, n.returns, () => connector(n, inlets.params)));
      case "skill":
        return out(
          await recordedCall(n.id, n.returns, async () => checked(await need("skill")(n.extension, n.tool, clone(inlets.in)), n.returns, `skill ${n.extension}/${n.tool}`)),
        );
      case "agent":
        return out(await recordedCall(n.id, n.output, () => agent(n, inlets.in)));
      case "n8n":
        throw new NodeError(`${n.id}: an n8n node runs in n8nStep`);
    }
  }

  async function recordedCall(id: string, returns: string, call: () => Promise<unknown>): Promise<unknown> {
    if (replayed(id)) {
      const v = checked(clone(opts.replay![id]), returns, "the recorded output");
      recorded[id] = v;
      return clone(v);
    }
    const v = await call();
    recorded[id] = clone(v);
    return v;
  }

  async function connector(n: Extract<Node, { kind: "connector" }>, params: unknown): Promise<unknown> {
    const what = `${n.connector} ${n.id}`;
    switch (n.connector) {
      case "http-get":
      case "rss": {
        const fetch = need("fetch");
        const template = n.url ?? "";
        const origin = originOf(template);
        if (!origin) throw new NodeError(`${what}: ${JSON.stringify(template)} is not an https URL with a literal host`, { fatal: true });
        const url = fillTemplate(template, params, true);
        const rest = url.slice(origin.length);
        if (!url.startsWith(origin) || !(rest === "" || "/?#".includes(rest[0])))
          throw new NodeError(`${what}: the filled URL left ${origin}`, { fatal: true });
        return withRetries(async () => {
          spendFetch();
          const body = await fetch(url, n.credential ? { credential: n.credential } : {});
          if (typeof body !== "string") throw new NodeError(`${what}: the host returned no text`);
          let v: unknown;
          if (n.connector === "rss") v = parseFeed(body);
          else {
            try {
              v = JSON.parse(body);
            } catch (e) {
              throw new NodeError(`${what}: the response is not JSON (${errMsg(e)})`);
            }
          }
          return checked(v, n.returns, what);
        });
      }
      case "web-search": {
        const search = need("search");
        const query = fillTemplate(n.query ?? "", params, false);
        return withRetries(async () => {
          spendFetch();
          return checked(await search(query), n.returns, what);
        });
      }
      case "knowledge": {
        const knowledge = need("knowledge");
        return withRetries(async () => {
          spendFetch();
          return checked(await knowledge(n.query ?? ""), n.returns, what);
        });
      }
      case "store-read": {
        const store = need("store");
        return withRetries(async () => {
          spendFetch();
          return checked(await store(n.table ?? "", typeof params === "string" ? params : undefined), n.returns, what);
        });
      }
      case "tool": {
        const tool = need("tool");
        return withRetries(async () => {
          spendFetch();
          return checked(await tool(n.tool ?? "", clone(params ?? {})), n.returns, what);
        });
      }
    }
  }

  async function agent(n: Extract<Node, { kind: "agent" }>, value: unknown): Promise<unknown> {
    const llm = need("llm");
    const prompt = agentPrompt(n.instruction, value, n.output, reg);
    return withRetries(async () => {
      spendLlm();
      const first = await llm(n.tier, prompt, { role: n.role, node: n.id });
      const a = judge(first, n.output);
      if (a.ok) return a.value;
      spendLlm();
      const second = await llm(n.tier, repairPrompt(prompt, first, a.problems), { role: n.role, node: n.id });
      const b = judge(second, n.output);
      if (b.ok) return b.value;
      throw new NodeError(`agent ${n.id}: the reply does not fit ${n.output} after a repair turn: ${b.problems.join("; ")}`, {
        issues: b.issues,
      });
    });
  }

  function judge(text: unknown, output: string): { ok: true; value: unknown } | { ok: false; problems: string[]; issues?: TypeIssue[] } {
    let v: unknown;
    try {
      if (typeof text !== "string") throw new Error("the reply is not text");
      v = parseJsonReply(text);
    } catch (e) {
      return { ok: false, problems: [`not JSON: ${errMsg(e)}`] };
    }
    const issues = reg.validate(v, output);
    return issues.length ? { ok: false, problems: issues.map((i) => `${i.path}: ${i.message}`), issues } : { ok: true, value: v };
  }

  function op(n: Extract<Node, { kind: "op" }>, inlets: Record<string, unknown>): unknown {
    const v = clone(inlets.in);
    const list = (what: string): unknown[] => {
      if (!Array.isArray(v)) throw new NodeError(`${n.op} ${n.id}: ${what} reads a list`);
      return v;
    };
    switch (n.op) {
      case "pick": {
        const got = readPath(v, n.path ?? "$");
        if (got === undefined) throw new NodeError(`pick ${n.id}: ${n.path} is not in the value`);
        return n.returns ? checked(got, n.returns, `pick ${n.id}`) : got;
      }
      case "map": {
        const items = list("map").map((item) => {
          const o: Record<string, unknown> = {};
          for (const field of Object.keys(n.fields).sort()) {
            const fv = readPath(item, n.fields[field]);
            if (fv !== undefined) o[field] = fv;
          }
          return o;
        });
        return n.returns ? checked(items, n.returns, `map ${n.id}`) : items;
      }
      case "filter": {
        const w = n.where!;
        let rhs: unknown = w.value;
        if (typeof rhs === "string" && (rhs === "$param" || rhs.startsWith("$param."))) {
          if (!("param" in inlets)) throw new NodeError(`filter ${n.id}: ${rhs} reads the param port, which is not connected`);
          rhs = readPath(inlets.param, `$${rhs.slice(6)}`);
          if (rhs === undefined) throw new NodeError(`filter ${n.id}: ${w.value} is not in the param value`);
        }
        return list("filter").filter((item) => compare(readPath(item, w.path), w.cmp, rhs));
      }
      case "sort": {
        const path = n.path ?? "$";
        const keyed = list("sort").map((item, i) => ({ item, key: readPath(item, path), i }));
        keyed.sort((a, b) => {
          const c = sortCompare(a.key, b.key);
          return (n.desc ? -c : c) || a.i - b.i;
        });
        return keyed.map((k) => k.item);
      }
      case "limit":
        return list("limit").slice(0, n.count ?? 0);
      case "merge": {
        const b = clone(inlets.b);
        if (!Array.isArray(b)) throw new NodeError(`merge ${n.id}: b reads a list`);
        return [...list("merge"), ...b];
      }
      case "split": {
        const s = n.path ? readPath(v, n.path) : v;
        if (typeof s !== "string") throw new NodeError(`split ${n.id}: splits a string`);
        return s.split(n.separator ?? "");
      }
      case "format":
        return formatTemplate(n.template ?? "", v);
      case "validate":
        return checked(v, n.returns ?? "", `validate ${n.id}`);
    }
  }
}

/** The agent step's prompt: the instruction, the input as JSON, and the output type's schema. */
export function agentPrompt(instruction: string, input: unknown, output: string, reg: TypeRegistry): string {
  return [
    instruction.trim(),
    "",
    "Input (JSON):",
    canonicalJson(input),
    "",
    `Reply with exactly one JSON value of type ${output} and nothing else. Its JSON Schema:`,
    canonicalJson(reg.jsonSchema(output)),
  ].join("\n");
}

function repairPrompt(prompt: string, reply: string, problems: string[]): string {
  return [
    prompt,
    "",
    "Your previous reply was:",
    reply,
    "",
    "It does not fit the type:",
    ...problems.map((p) => `- ${p}`),
    "",
    "Reply again with only the corrected JSON value.",
  ].join("\n");
}
