/**
 * n8n workflow import (FEAT-096, ADR-0076): an n8n workflow's JSON becomes a
 * `swarmpress.tool.v1` graph that runs it with n8n's semantics, without a model.
 *
 * - Every node of a supported type (`../n8n/catalogue.ts`) becomes an `n8n`
 *   node that keeps the node's name, type, version and parameters
 *   unchanged: expressions and Code run as they do in n8n (`../n8n/`).
 * - Triggers become the tool's triggers: Manual → on demand; Schedule and
 *   Cron → a schedule (at most once a game day); Webhook and Execute Workflow
 *   Trigger → on demand with a `request` input (`Json`) the next nodes read
 *   as their items.
 * - Loop Over Items (Split in Batches v3) is flattened: a tool processes all
 *   items at once, so the loop's body runs once and its last node feeds what
 *   followed "done".
 * - Several connections into one input are joined by an Append merge (n8n
 *   runs the node once per connection; the items are the same).
 * - Disabled nodes pass their items through; sticky notes and model
 *   sub-nodes are dropped (the hosted model stands in for any model).
 * - A node of any other type, or a supported type used in a way swarm.press
 *   cannot run (Python, pagination, binary data, waits for a webhook…),
 *   stays in the graph as it is: the checker refuses it, so the tool is not
 *   installed until someone replaces that step (CLAUDE.md rule 11). The
 *   import lists it as `sealed`, with the reason.
 * - Every node nothing reads becomes a tool output (`Json[]`; optional when
 *   there are several, since a branch may not run).
 */
import type { Node, ToolGraph } from "../graph.ts";
import { N8N_IGNORED, N8N_MODEL_PREFIX, N8N_TRIGGERS, N8N_TYPES, unsupportedReason, urlOrigin } from "../n8n/catalogue.ts";

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  parameters?: Record<string, unknown>;
  disabled?: boolean;
  credentials?: Record<string, { id?: string; name?: string }>;
  onError?: string;
  continueOnFail?: boolean;
}

export interface N8nWorkflow {
  name?: string;
  nodes: N8nNode[];
  /** Source node name → connection type (`main`, `ai_languageModel`, …) → outputs → targets. */
  connections: Record<string, Record<string, Array<Array<{ node: string; type?: string; index?: number }> | null> | undefined>>;
}

export interface ImportIssue {
  /**
   * `sealed`: a step the tool cannot run (the checker refuses it);
   * `needs-credential`: a request signs in with a credential the site must hold;
   * `needs-tool`: an Execute Workflow names a workflow no site tool is mapped to;
   * `note`: how the import approximated n8n (it runs);
   * `bad-node`: the workflow cannot become a tool as it is.
   */
  code: "sealed" | "needs-credential" | "needs-tool" | "note" | "bad-node";
  node: string;
  message: string;
}

export interface N8nImport {
  graph: ToolGraph;
  /** Site types the graph needs (none: n8n items are `Json`). */
  types: Record<string, unknown>;
  issues: ImportIssue[];
  /** How each n8n node was taken: `n8n` (runs), `sealed`, `trigger`, `input`, `dropped`, `flattened`. */
  mapping: Array<{ node: string; type: string; as: "n8n" | "sealed" | "trigger" | "input" | "dropped" | "flattened" }>;
}

export interface N8nImportOptions {
  /** n8n workflow id → the site tool an Execute Workflow node calls. */
  tools?: Record<string, string>;
}

/** Most nodes one tool has (`MAX_NODES` in tools.rs). */
export const MAX_IMPORT_NODES = 40;

const kebab = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "node";

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const outPort = (k: number) => (k ? `out${k}` : "out");
const inPort = (k: number) => (k ? `in${k}` : "in");

interface Conn {
  from: string;
  out: number;
  to: string;
  in: number;
}

/** How many outputs an n8n node has, from its parameters (the connections may add more). */
function outputsOf(n: N8nNode): number {
  const p = n.parameters ?? {};
  const v = n.typeVersion ?? 1;
  switch (n.type) {
    case "n8n-nodes-base.if":
      return 2;
    case "n8n-nodes-base.switch": {
      if (p.mode === "expression") return Math.max(1, Number(p.numberOutputs ?? (v >= 3 ? 4 : (p.outputsAmount ?? 4))));
      if (v >= 3) {
        const rules = isObj(p.rules) && Array.isArray(p.rules.values) ? p.rules.values.length : 0;
        const fb = isObj(p.options) ? p.options.fallbackOutput : undefined;
        return Math.max(1, rules + (fb === "extra" ? 1 : 0));
      }
      return Math.max(1, Number(p.outputsAmount ?? 4));
    }
    case "n8n-nodes-base.splitInBatches":
      return v >= 3 ? 2 : 1;
  }
  return 1;
}

function inputsOf(n: N8nNode): number {
  if (n.type !== "n8n-nodes-base.merge") return 1;
  const v = n.typeVersion ?? 1;
  return v >= 3 ? Math.max(2, Number(n.parameters?.numberInputs ?? 2)) : 2;
}

/** Game days between runs for a Schedule Trigger's first rule. */
function scheduleDays(n: N8nNode): { days: number; note?: string } {
  if (n.type === "n8n-nodes-base.cron") return { days: 1, note: "a Cron trigger runs once a game day" };
  const rule = isObj(n.parameters?.rule) && Array.isArray(n.parameters!.rule.interval) ? (n.parameters!.rule.interval[0] as Record<string, unknown> | undefined) : undefined;
  const field = String(rule?.field ?? "days");
  const clamp = (d: number) => Math.min(28, Math.max(1, Math.round(d)));
  switch (field) {
    case "days":
      return { days: clamp(Number(rule?.daysInterval ?? 1)) };
    case "weeks":
      return { days: clamp(7 * Number(rule?.weeksInterval ?? 1)) };
    case "months":
      return { days: 28, note: "a monthly schedule runs every 28 game days" };
    default:
      return { days: 1, note: `a schedule every few ${field} runs once a game day (the shortest a tool's schedule is)` };
  }
}

/** The n8n workflow as a tool graph with id `id` (kebab-case). */
export function importN8n(wf: N8nWorkflow, id: string, opts: N8nImportOptions = {}): N8nImport {
  const issues: ImportIssue[] = [];
  const mapping: N8nImport["mapping"] = [];
  const all = (wf.nodes ?? []).filter((n) => !N8N_IGNORED.has(n.type));
  const byName = new Map(all.map((n) => [n.name, n]));

  // Main connections only; sub-nodes (models, memory, parsers) connect by other types.
  const conns: Conn[] = [];
  const subNodes = new Set<string>();
  for (const [from, types] of Object.entries(wf.connections ?? {})) {
    for (const [ctype, outs] of Object.entries(types ?? {})) {
      if (ctype !== "main") {
        subNodes.add(from);
        continue;
      }
      (outs ?? []).forEach((targets, out) => {
        for (const t of targets ?? []) if (byName.has(from) && byName.has(t.node)) conns.push({ from, out, to: t.node, in: t.index ?? 0 });
      });
    }
  }
  for (const n of all) if (n.type.startsWith(N8N_MODEL_PREFIX)) subNodes.add(n.name);

  // Ids.
  const used = new Set<string>();
  const nodeId = new Map<string, string>();
  const fresh = (base: string) => {
    let k = kebab(base);
    while (used.has(k)) k = `${k}-x`;
    used.add(k);
    return k;
  };
  for (const n of all) nodeId.set(n.name, fresh(n.name));

  const nodes: Node[] = [];
  const triggers: ToolGraph["triggers"] = [];
  const inputs: Record<string, string> = {};
  /** n8n names that produce nothing in the graph (triggers without data, dropped nodes). */
  const silent = new Set<string>();

  for (const n of all) {
    const k = nodeId.get(n.name)!;
    const p = (n.parameters ?? {}) as Record<string, unknown>;
    if (subNodes.has(n.name)) {
      silent.add(n.name);
      mapping.push({ node: n.name, type: n.type, as: "dropped" });
      if (!n.type.startsWith(N8N_MODEL_PREFIX)) issues.push({ code: "note", node: n.name, message: `${n.type}: a sub-node of a chain; the tool ignores it` });
      continue;
    }
    if (N8N_TRIGGERS.has(n.type)) {
      if (n.type === "n8n-nodes-base.webhook" || n.type === "n8n-nodes-base.executeWorkflowTrigger") {
        const port = Object.keys(inputs).length ? `request_${Object.keys(inputs).length + 1}` : "request";
        inputs[port] = "Json";
        nodes.push({ kind: "input", id: k, port } as Node);
        if (!triggers.some((t) => t.kind === "on-demand")) triggers.push({ kind: "on-demand" });
        mapping.push({ node: n.name, type: n.type, as: "input" });
      } else {
        if (n.type === "n8n-nodes-base.manualTrigger") {
          if (!triggers.some((t) => t.kind === "on-demand")) triggers.push({ kind: "on-demand" });
        } else {
          const s = scheduleDays(n);
          if (!triggers.some((t) => t.kind === "schedule")) triggers.push({ kind: "schedule", every_game_days: s.days });
          if (s.note) issues.push({ code: "note", node: n.name, message: s.note });
        }
        silent.add(n.name);
        mapping.push({ node: n.name, type: n.type, as: "trigger" });
      }
      continue;
    }
    const disabled = n.disabled === true;
    const loop = n.type === "n8n-nodes-base.splitInBatches";
    const type = disabled || loop ? "n8n-nodes-base.noOp" : n.type;
    const why = disabled || loop ? null : unsupportedReason(n.type, n.typeVersion, p);
    const node: Record<string, unknown> = {
      kind: "n8n",
      id: k,
      name: n.name,
      type,
      ...(disabled || loop ? {} : n.typeVersion !== undefined ? { version: n.typeVersion } : {}),
      parameters: disabled || loop ? {} : p,
      inputs: inputsOf({ ...n, type }),
      outputs: loop ? 1 : outputsOf({ ...n, type }),
    };
    const cred = Object.values(n.credentials ?? {})[0];
    if (cred && !disabled) {
      node.credential = kebab(cred.name ?? cred.id ?? "credential");
      issues.push({ code: "needs-credential", node: n.name, message: `signs in with the credential "${cred.name ?? cred.id}": add it to the site's credentials as ${node.credential}` });
    }
    if (n.onError === "continueRegularOutput" || n.onError === "continueErrorOutput" || n.continueOnFail === true) node.on_error = "continue";
    if (n.onError === "continueErrorOutput") issues.push({ code: "note", node: n.name, message: "failed items go to the main output as { error } (no separate error output)" });
    if (type === "n8n-nodes-base.executeWorkflow" && !disabled) {
      const wid = isObj(p.workflowId) ? String(p.workflowId.value ?? "") : String(p.workflowId ?? "");
      const tool = opts.tools?.[wid];
      if (tool) node.tool = tool;
      else issues.push({ code: "needs-tool", node: n.name, message: `runs the n8n workflow ${wid || "(none)"}: import that workflow as a tool and choose it here` });
    }
    if (N8N_TYPES[type]?.web) {
      const o = urlOrigin(p.url);
      if (o === "any") issues.push({ code: "note", node: n.name, message: "the URL's host is computed: the tool may reach any public website (the CEO sees this before installing)" });
      else if (!o) issues.push({ code: "sealed", node: n.name, message: `the URL ${JSON.stringify(p.url)} is not an http(s) URL` });
    }
    if (disabled) issues.push({ code: "note", node: n.name, message: "disabled in n8n: passes its items through" });
    if (loop) {
      if ((n.typeVersion ?? 1) < 3) issues.push({ code: "sealed", node: n.name, message: "Split in Batches v1/v2 loops by checking noItemsLeft: use Loop Over Items (v3)" });
      else issues.push({ code: "note", node: n.name, message: "Loop Over Items: the tool processes all items at once, so the loop body runs once" });
    }
    if (why) issues.push({ code: "sealed", node: n.name, message: `${n.type}: ${why}` });
    nodes.push(node as unknown as Node);
    mapping.push({ node: n.name, type: n.type, as: loop ? "flattened" : why ? "sealed" : "n8n" });
  }

  // Loop Over Items (v3): output 0 is "done", output 1 the loop body.
  let edges: Conn[] = conns.filter((c) => !silent.has(c.from) && !silent.has(c.to));
  for (const n of all) {
    if (n.type !== "n8n-nodes-base.splitInBatches" || (n.typeVersion ?? 1) < 3 || n.disabled) continue;
    const body = new Set<string>();
    const stack = edges.filter((c) => c.from === n.name && c.out === 1).map((c) => c.to);
    while (stack.length) {
      const x = stack.pop()!;
      if (x === n.name || body.has(x)) continue;
      body.add(x);
      for (const c of edges) if (c.from === x) stack.push(c.to);
    }
    const back = edges.filter((c) => c.to === n.name && body.has(c.from));
    const done = edges.filter((c) => c.from === n.name && c.out === 0);
    edges = edges.filter((c) => !back.includes(c) && !done.includes(c)).map((c) => (c.from === n.name && c.out === 1 ? { ...c, out: 0 } : c));
    const tails = back.map((c) => ({ from: c.from, out: c.out }));
    for (const d of done) {
      if (!tails.length) edges.push({ from: n.name, out: 0, to: d.to, in: d.in });
      for (const t of tails) edges.push({ from: t.from, out: t.out, to: d.to, in: d.in });
    }
  }

  // Edges into the graph; an input fed by several connections gets an Append merge.
  const graphEdges: [string, string][] = [];
  const inletOf = new Map<string, Conn[]>();
  for (const c of edges) {
    const key = `${c.to}\u0000${c.in}`;
    inletOf.set(key, [...(inletOf.get(key) ?? []), c]);
  }
  const node = (name: string) => nodes.find((x) => x.id === nodeId.get(name)) as (Node & { outputs?: number; inputs?: number }) | undefined;
  for (const [, group] of inletOf) {
    const to = node(group[0].to);
    if (!to || to.kind === "input") continue;
    const portOk = (c: Conn) => {
      const from = node(c.from);
      if (!from) return false;
      if (from.kind === "n8n" && c.out >= (from.outputs ?? 1)) (from as { outputs: number }).outputs = c.out + 1;
      return true;
    };
    if ((to as { inputs?: number }).inputs !== undefined && group[0].in >= (to as { inputs: number }).inputs) (to as { inputs: number }).inputs = group[0].in + 1;
    const live = group.filter(portOk);
    if (!live.length) continue;
    const target = `${to.id}.${inPort(group[0].in)}`;
    if (live.length === 1) {
      graphEdges.push([`${nodeId.get(live[0].from)}.${outPort(live[0].out)}`, target]);
      continue;
    }
    const mid = fresh(`${group[0].to} inputs`);
    nodes.push({ kind: "n8n", id: mid, name: `${group[0].to} (inputs)`, type: "n8n-nodes-base.merge", version: 3, parameters: { mode: "append", numberInputs: live.length }, inputs: live.length, outputs: 1 } as unknown as Node);
    live.forEach((c, k) => graphEdges.push([`${nodeId.get(c.from)}.${outPort(c.out)}`, `${mid}.${inPort(k)}`]));
    graphEdges.push([`${mid}.out`, target]);
    issues.push({ code: "note", node: group[0].to, message: `${live.length} connections into one input: their items are appended and the node runs once` });
  }

  // Outputs: what nothing reads (the main outlet of each leaf), and every Respond to Webhook.
  const read = new Set(graphEdges.map(([f]) => f.split(".")[0]));
  const leaves = nodes.filter((n) => n.kind === "n8n" && (!read.has(n.id) || (n as { type?: string }).type === "n8n-nodes-base.respondToWebhook"));
  const outputs: Record<string, string> = {};
  for (const n of leaves) {
    const port = (n as { type?: string }).type === "n8n-nodes-base.respondToWebhook" && !("response" in outputs) ? "response" : n.id.replace(/-/g, "_");
    outputs[port] = leaves.length > 1 ? "Json[]?" : "Json[]";
    const out = fresh(`${n.id}-out`);
    nodes.push({ kind: "output", id: out, port } as Node);
    graphEdges.push([`${n.id}.out`, `${out}.in`]);
  }
  if (!leaves.length) issues.push({ code: "bad-node", node: "*", message: "the workflow has no node that produces items" });

  if (!triggers.length) triggers.push({ kind: "on-demand" });
  const graph = {
    format: "swarmpress.tool.v1",
    id,
    name: { en: wf.name || id },
    description: `Imported from n8n${wf.name ? `: ${wf.name}` : ""}.`,
    inputs,
    outputs,
    nodes,
    edges: graphEdges,
    triggers,
    failure: { retries: 0, on_error: "fail" },
    limits: { llm_calls_per_run: 0, fetches_per_run: 0 },
  } as ToolGraph;
  if (nodes.length > MAX_IMPORT_NODES) issues.push({ code: "bad-node", node: "*", message: `${nodes.length} nodes: a tool has at most ${MAX_IMPORT_NODES}; split the workflow with Execute Workflow` });
  return { graph, types: {}, issues, mapping };
}
