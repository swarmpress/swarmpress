/**
 * A tool graph as an SDK `skill` (design §7.1): one tool, named after the
 * graph id, whose `run` interprets the graph with the sandbox's facilities.
 *
 * This is what a tool's bundle exports (`compile.ts`). Sandbox-safe: it
 * imports only `@swarm-press/sdk/runtime`, the interpreter and the types.
 */
import { CREDENTIAL_HEADER, defineSkill, type HostContext, type SkillExport } from "@swarm-press/sdk/runtime";
import type { ToolGraph } from "./graph.ts";
import { runGraph, type RunOptions, type RunResult, type ToolHost } from "./interpret.ts";
import { TypeRegistry, parseTypeExpr } from "./types.ts";

/** The JSON Schema of the tool's input object, from the graph's input types. */
export function inputSchema(graph: ToolGraph, reg: TypeRegistry): Record<string, unknown> {
  const ports = Object.keys(graph.inputs).sort();
  const properties: Record<string, unknown> = {};
  for (const p of ports) {
    const e = parseTypeExpr(graph.inputs[p]);
    properties[p] = reg.jsonSchema({ ...e, optional: false });
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ports.filter((p) => !parseTypeExpr(graph.inputs[p]).optional),
    properties,
  };
}

/**
 * The interpreter host over an SDK {@link HostContext}: `fetch` and n8n
 * requests via `ctx.web.fetch` (a credential goes by name in the credential
 * header, and the host's proxy swaps it), agents via `ctx.llm.complete`,
 * `store-read` via `ctx.store`, n8n JavaScript via `ctx.code`. Facilities the context lacks come from `extra`, or fail their
 * node loudly.
 */
export function contextHost(ctx: HostContext, extra: Partial<ToolHost> = {}): ToolHost {
  return {
    async fetch(url, init) {
      const headers: Record<string, string> = {};
      if (init.credential) headers[CREDENTIAL_HEADER] = init.credential;
      const res = await ctx.web.fetch(url, { method: "GET", headers });
      if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
      return await res.text();
    },
    async llm(tier, prompt) {
      return (await ctx.llm.complete({ tier, prompt })).text;
    },
    async store(table, key) {
      return await ctx.store.table(table).get(key ?? "latest");
    },
    async request(req) {
      const headers: Record<string, string> = { ...req.headers };
      if (req.credential) headers[CREDENTIAL_HEADER] = req.credential;
      const res = await ctx.web.fetch(req.url, { method: req.method, headers, ...(req.body !== null ? { body: req.body } : {}) });
      const out: Record<string, string> = {};
      const each = (res.headers as { forEach?: (cb: (v: string, k: string) => void) => void }).forEach;
      if (typeof each === "function") each.call(res.headers, (v, k) => (out[k] = v));
      return { status: res.status, headers: out, body: await res.text() };
    },
    async code(program, task) {
      return await ctx.code.run(program, task);
    },
    ...extra,
  };
}

export interface ToolSkillOptions extends Omit<RunOptions, "replay"> {
  /** Host facilities beyond the SDK context (web search, knowledge, other tools, skills). */
  host?: Partial<ToolHost>;
}

/**
 * The SDK skill for a graph. `run(input)` returns the whole {@link RunResult}
 * (outputs, trace, recorded outputs), so the caller stores the trace and
 * writes the outputs; a failed run returns `ok: false`, never placeholders.
 */
export function toolSkill(graph: ToolGraph, types: Record<string, unknown>, opts: ToolSkillOptions = {}): SkillExport {
  const reg = TypeRegistry.withSite(types);
  return defineSkill({
    tools: {
      [graph.id]: {
        description: graph.description || graph.name.en || graph.id,
        input: inputSchema(graph, reg),
        async run(input: unknown, ctx: HostContext): Promise<RunResult> {
          return await runGraph(graph, reg, input, contextHost(ctx, opts.host), { clock: opts.clock ?? (() => Date.now()) });
        },
      },
    },
  });
}
