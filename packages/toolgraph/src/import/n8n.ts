/**
 * n8n workflow import (FEAT-096, ADR-0072, design §8): an n8n workflow JSON
 * becomes a `swarmpress.tool.v1` graph by a fixed mapping, without a model.
 *
 * | n8n node                                  | tool-graph node                      |
 * |-------------------------------------------|--------------------------------------|
 * | Schedule Trigger, Cron                    | a `schedule` trigger (days, at least 1) |
 * | Manual Trigger, Webhook                   | an `on-demand` trigger, and an input |
 * | HTTP Request (GET)                        | `connector http-get`                 |
 * | RSS Read                                  | `connector rss`                      |
 * | IF                                        | `condition compare` (true → yes, false → no) |
 * | Set / Edit Fields                         | `op map`                             |
 * | Merge                                     | `op merge`                           |
 * | Limit                                     | `op limit`                           |
 * | Sort                                      | `op sort`                            |
 * | anything else, Code and Function included | a **sealed** step                   |
 *
 * A sealed step is a `skill` node naming `press.swarm.sealed` and the n8n
 * node type: no such skill is ever installed, so the checker refuses the
 * tool (`unknown-tool`) and it cannot run until someone replaces the step —
 * stubs fail loudly (CLAUDE.md rule 11). The import also lists every sealed
 * step and every type it could only stub (an HTTP response's fields are not
 * in the workflow) as issues, so the Tool Architect knows what is left.
 *
 * Expressions: `={{ $json.a.b }}` becomes the path `$.a.b`; in a URL it
 * becomes a `{a}` placeholder filled from the `params` port (the host must
 * be literal, else the URL is refused as a bad origin by the checker).
 */
import type { Node, ToolGraph } from "../graph.ts";

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  parameters?: Record<string, unknown>;
}

export interface N8nWorkflow {
  name?: string;
  nodes: N8nNode[];
  /** Source node name → `main` outputs → targets. */
  connections: Record<string, { main?: Array<Array<{ node: string; type?: string; index?: number }> | null> }>;
}

export interface ImportIssue {
  code: "sealed" | "needs-type" | "bad-node";
  node: string;
  message: string;
}

export interface N8nImport {
  graph: ToolGraph;
  /** Types the graph names that the workflow does not define (stubs: closed, no fields). */
  types: Record<string, unknown>;
  issues: ImportIssue[];
}

/** The extension a sealed step names; never installed. */
export const SEALED_EXTENSION = "press.swarm.sealed";

const kebab = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "node";

const pascal = (s: string) =>
  kebab(s)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

/** `={{ $json.a.b }}` → `$.a.b`; a literal stays a literal (`null` when it is not an expression). */
export function pathOf(expr: unknown): string | null {
  if (typeof expr !== "string") return null;
  const m = /^=\{\{\s*\$json((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)\s*\}\}$/.exec(expr.trim());
  return m ? `$${m[1]}` : null;
}

/** A URL with `{{ $json.x }}` expressions as `{x}` placeholders; `null` when an expression is not a plain field. */
export function urlOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.startsWith("=") ? raw.slice(1) : raw;
  let ok = true;
  s = s.replace(/\{\{\s*([^}]*)\s*\}\}/g, (_m, inner: string) => {
    const f = /^\$json\.([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(inner.trim());
    if (!f) {
      ok = false;
      return "";
    }
    return `{${f[1]}}`;
  });
  return ok ? s : null;
}

const CMP: Record<string, "eq" | "ne" | "gt" | "lt" | "contains"> = {
  equal: "eq",
  equals: "eq",
  notEqual: "ne",
  notEquals: "ne",
  larger: "gt",
  gt: "gt",
  smaller: "lt",
  lt: "lt",
  contains: "contains",
};

/** The first condition of an IF node (v1 `conditions.{number,string,boolean}[]` or v2 `conditions.conditions[]`). */
function ifCondition(p: Record<string, unknown>): { path: string; cmp: string; value: unknown } | null {
  const c = p.conditions as Record<string, unknown> | undefined;
  if (!c) return null;
  const v2 = Array.isArray(c.conditions) ? (c.conditions as Array<Record<string, unknown>>)[0] : null;
  if (v2) {
    const path = pathOf(v2.leftValue);
    const op = (v2.operator as { operation?: string } | undefined)?.operation ?? "";
    const cmp = CMP[op];
    return path && cmp ? { path, cmp, value: v2.rightValue ?? null } : null;
  }
  for (const k of ["number", "string", "boolean"]) {
    const list = c[k];
    if (Array.isArray(list) && list[0]) {
      const r = list[0] as Record<string, unknown>;
      const path = pathOf(r.value1);
      const cmp = CMP[String(r.operation ?? "equal")];
      return path && cmp ? { path, cmp, value: r.value2 ?? null } : null;
    }
  }
  return null;
}

/** Field assignments of a Set node (v1 `values.{string,number,boolean}[]`, v3 `assignments.assignments[]`). */
function setFields(p: Record<string, unknown>): Record<string, string> | null {
  const out: Record<string, string> = {};
  const v3 = (p.assignments as { assignments?: Array<{ name: string; value: unknown }> } | undefined)?.assignments;
  const v1 = p.values as Record<string, Array<{ name: string; value: unknown }>> | undefined;
  const list = v3 ?? Object.values(v1 ?? {}).flat();
  for (const a of list) {
    const path = pathOf(a.value);
    if (!path) return null;
    out[kebab(a.name).replace(/-/g, "_")] = path;
  }
  return Object.keys(out).length ? out : null;
}

const TRIGGERS = new Set([
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.cron",
]);

/** The n8n workflow as a tool graph with id `id` (kebab-case). */
export function importN8n(wf: N8nWorkflow, id: string): N8nImport {
  const issues: ImportIssue[] = [];
  const types: Record<string, unknown> = {};
  const T = pascal(id);
  const stub = (name: string, node: string, why: string) => {
    if (!(name in types)) {
      types[name] = { type: "object", additionalProperties: false, properties: {} };
      issues.push({ code: "needs-type", node, message: `declare the fields of ${name}: ${why}` });
    }
    return name;
  };

  const byName = new Map(wf.nodes.map((n) => [n.name, n]));
  const nodeId = new Map<string, string>();
  const used = new Set<string>();
  for (const n of wf.nodes) {
    let k = kebab(n.name);
    while (used.has(k)) k = `${k}-x`;
    used.add(k);
    nodeId.set(n.name, k);
  }

  const nodes: Node[] = [];
  const triggers: ToolGraph["triggers"] = [];
  const outlets = new Map<string, string[]>(); // n8n name → our out ports by output index
  let hasInput = false;

  for (const n of wf.nodes) {
    const k = nodeId.get(n.name)!;
    const p = (n.parameters ?? {}) as Record<string, unknown>;
    const sealed = (why: string) => {
      issues.push({ code: "sealed", node: n.name, message: `${n.type}: ${why}` });
      nodes.push({ kind: "skill", id: k, extension: SEALED_EXTENSION, tool: n.type, returns: stub(`${T}${pascal(n.name)}Out`, n.name, "a sealed step's output") } as Node);
      outlets.set(n.name, ["out"]);
    };
    switch (n.type) {
      case "n8n-nodes-base.scheduleTrigger":
      case "n8n-nodes-base.cron": {
        const rule = (p.rule as { interval?: Array<{ field?: string; daysInterval?: number }> } | undefined)?.interval?.[0];
        const days = rule?.field === "days" && rule.daysInterval ? Math.min(28, Math.max(1, rule.daysInterval)) : 1;
        triggers.push({ kind: "schedule", every_game_days: days });
        outlets.set(n.name, []);
        break;
      }
      case "n8n-nodes-base.manualTrigger":
        triggers.push({ kind: "on-demand" });
        outlets.set(n.name, []);
        break;
      case "n8n-nodes-base.webhook": {
        triggers.push({ kind: "on-demand" });
        nodes.push({ kind: "input", id: k, port: "request" } as Node);
        hasInput = true;
        outlets.set(n.name, ["out"]);
        break;
      }
      case "n8n-nodes-base.httpRequest": {
        const method = String(p.method ?? p.requestMethod ?? "GET").toUpperCase();
        const url = urlOf(p.url);
        if (method !== "GET") sealed(`${method} requests are not a connector (only GET)`);
        else if (!url) sealed("the URL is computed by an expression that is not a plain field");
        else {
          nodes.push({ kind: "connector", id: k, connector: "http-get", url, returns: stub(`${T}${pascal(n.name)}Response`, n.name, "the HTTP response's fields are not in the workflow") } as Node);
          outlets.set(n.name, ["out"]);
        }
        break;
      }
      case "n8n-nodes-base.rssFeedRead": {
        const url = urlOf(p.url);
        if (!url) sealed("the feed URL is computed");
        else {
          nodes.push({ kind: "connector", id: k, connector: "rss", url, returns: "FeedItem[]" } as Node);
          outlets.set(n.name, ["out"]);
        }
        break;
      }
      case "n8n-nodes-base.if": {
        const c = ifCondition(p);
        if (!c) sealed("the condition is not one field compared with a value");
        else {
          nodes.push({ kind: "condition", id: k, test: "compare", path: c.path, cmp: c.cmp, value: c.value, cases: [] } as unknown as Node);
          outlets.set(n.name, ["yes", "no"]);
        }
        break;
      }
      case "n8n-nodes-base.set": {
        const fields = setFields(p);
        if (!fields) sealed("a field is computed by an expression that is not a plain field");
        else {
          const item = `${T}${pascal(n.name)}`;
          types[item] = {
            type: "object",
            additionalProperties: false,
            required: Object.keys(fields),
            properties: Object.fromEntries(Object.keys(fields).map((f) => [f, { type: "string" }])),
          };
          nodes.push({ kind: "op", id: k, op: "map", fields, returns: `${item}[]`, desc: false } as unknown as Node);
          outlets.set(n.name, ["out"]);
        }
        break;
      }
      case "n8n-nodes-base.merge":
        nodes.push({ kind: "op", id: k, op: "merge", fields: {}, desc: false } as unknown as Node);
        outlets.set(n.name, ["out"]);
        break;
      case "n8n-nodes-base.limit":
        nodes.push({ kind: "op", id: k, op: "limit", count: Math.max(1, Number(p.maxItems ?? 1)), fields: {}, desc: false } as unknown as Node);
        outlets.set(n.name, ["out"]);
        break;
      case "n8n-nodes-base.sort": {
        const f = (p.sortFieldsUi as { sortField?: Array<{ fieldName?: string; order?: string }> } | undefined)?.sortField?.[0];
        if (!f?.fieldName) sealed("the sort has no field");
        else {
          nodes.push({ kind: "op", id: k, op: "sort", path: `$.${f.fieldName}`, desc: f.order === "descending", fields: {} } as unknown as Node);
          outlets.set(n.name, ["out"]);
        }
        break;
      }
      default:
        sealed(n.type.endsWith(".code") || n.type.endsWith(".function") || n.type.endsWith(".functionItem") ? "code runs only in a reviewed skill" : "no swarm.press equivalent");
    }
  }

  // Edges, from n8n's `main` connections (triggers without nodes drop out).
  const edges: [string, string][] = [];
  const fed = new Map<string, number>();
  for (const [from, conn] of Object.entries(wf.connections ?? {})) {
    const src = byName.get(from);
    if (!src) continue;
    const ports = outlets.get(from) ?? [];
    (conn.main ?? []).forEach((targets, i) => {
      const port = ports[i];
      for (const t of targets ?? []) {
        const dst = nodeId.get(t.node);
        if (!port || !dst || !byName.has(t.node) || TRIGGERS.has(byName.get(t.node)!.type)) continue;
        const n = fed.get(dst) ?? 0;
        fed.set(dst, n + 1);
        const target = nodes.find((x) => x.id === dst);
        // A merge's second input is `b`; a connector reads `params`.
        const inlet = target?.kind === "connector" ? "params" : target?.kind === "op" && (target as { op?: string }).op === "merge" && n >= 1 ? "b" : "in";
        edges.push([`${nodeId.get(from)}.${port}`, `${dst}.${inlet}`]);
      }
    });
  }

  // A stub type downstream nodes read fields of: declare those fields (they
  // are the workflow's own evidence of the response's shape). A leaf compared
  // with a number is a number, any other leaf a string; all are required.
  for (const n of nodes) {
    const ret = (n as { returns?: string }).returns;
    if (!ret || !(ret in types) || Object.keys((types[ret] as { properties: object }).properties).length) continue;
    const readers = edges.filter(([f]) => f.split(".")[0] === n.id).map(([, t]) => nodes.find((x) => x.id === t.split(".")[0])!);
    const reads: Array<{ path: string; numeric: boolean }> = [];
    for (const r of readers) {
      const x = r as unknown as { kind: string; path?: string; cmp?: string; value?: unknown; fields?: Record<string, string>; where?: { path: string } };
      if (x.kind === "condition" && x.path) reads.push({ path: x.path, numeric: (x.cmp === "gt" || x.cmp === "lt") && typeof Number(x.value) === "number" && !Number.isNaN(Number(x.value)) });
      if (x.kind === "op") {
        if (x.path) reads.push({ path: x.path, numeric: false });
        for (const v of Object.values(x.fields ?? {})) reads.push({ path: v, numeric: false });
        if (x.where) reads.push({ path: x.where.path, numeric: false });
      }
    }
    if (!reads.length) continue;
    type Schema = { type: string; additionalProperties?: boolean; required?: string[]; properties?: Record<string, Schema> };
    const root: Schema = { type: "object", additionalProperties: false, required: [], properties: {} };
    for (const { path, numeric } of reads) {
      const segs = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
      let cur = root;
      segs.forEach((seg, i) => {
        const last = i === segs.length - 1;
        cur.properties![seg] ??= last ? { type: numeric ? "number" : "string" } : { type: "object", additionalProperties: false, required: [], properties: {} };
        if (!cur.required!.includes(seg)) cur.required!.push(seg);
        if (!last) cur = cur.properties![seg];
      });
    }
    types[ret] = root;
    const at = issues.findIndex((i) => i.code === "needs-type" && i.message.startsWith(`declare the fields of ${ret}:`));
    if (at >= 0) issues[at] = { ...issues[at], message: `check the fields of ${ret}: inferred from what the workflow reads` };
  }

  // Outputs: every node nothing reads becomes an output port.
  const read = new Set(edges.map(([f]) => f.split(".")[0]));
  const outputs: Record<string, string> = {};
  for (const n of [...nodes]) {
    if (n.kind === "input" || read.has(n.id)) continue;
    const port = n.id.replace(/-/g, "_");
    const out = `${n.id}-out`;
    const ty = outputType(n, types);
    outputs[port] = ty ?? stub(`${T}Result`, n.id, "what the workflow ends with");
    nodes.push({ kind: "output", id: out, port } as Node);
    for (const p of n.kind === "condition" ? ["yes"] : ["out"]) edges.push([`${n.id}.${p}`, `${out}.in`]);
  }

  if (!triggers.length) triggers.push({ kind: "on-demand" });
  const graph: ToolGraph = {
    format: "swarmpress.tool.v1",
    id,
    name: { en: wf.name || id },
    description: `Imported from n8n${wf.name ? `: ${wf.name}` : ""}.`,
    inputs: hasInput ? { request: stub(`${T}Request`, "trigger", "the request the workflow receives") } : {},
    outputs,
    nodes,
    edges,
    triggers,
    failure: { retries: 0, on_error: "fail" },
    limits: { llm_calls_per_run: 0, fetches_per_run: 0 },
  } as ToolGraph;
  if (nodes.length > 12) issues.push({ code: "bad-node", node: "*", message: `${nodes.length} nodes: a tool has at most 12` });
  return { graph, types, issues };
}

function outputType(n: Node, _types: Record<string, unknown>): string | null {
  const r = n as unknown as { kind: string; returns?: string; output?: string };
  if (n.kind === "op" && (n as { op?: string }).op === "map") return r.returns ?? null;
  if (n.kind === "connector" || n.kind === "skill") return r.returns ?? null;
  if (n.kind === "agent") return r.output ?? null;
  return null;
}
