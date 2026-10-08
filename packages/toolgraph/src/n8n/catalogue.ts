/**
 * The n8n node types swarm.press runs (ADR-0076, FEAT-096). The Rust checker
 * keeps the same list (`crates/blueprint/src/tools.rs`, `N8N_TYPES`); a test
 * compares them. Every other type imports as a sealed step the checker
 * refuses, so a tool never runs half a workflow (CLAUDE.md rule 11).
 *
 * Sandbox-safe: plain data.
 */

/** What a node type reaches beyond the item data: the manifest derives capabilities from it. */
export interface N8nTypeInfo {
  /** Fetches the URL in `parameters.url` (`web` and the URL's origin). */
  web?: boolean;
  /** Calls a model (`llm:mid`). */
  llm?: boolean;
  /** Calls another tool of the site (`tool` on the node). */
  tool?: boolean;
}

export const N8N_TYPES: Record<string, N8nTypeInfo> = {
  "n8n-nodes-base.httpRequest": { web: true },
  "n8n-nodes-base.rssFeedRead": { web: true },
  "n8n-nodes-base.set": {},
  "n8n-nodes-base.if": {},
  "n8n-nodes-base.filter": {},
  "n8n-nodes-base.switch": {},
  "n8n-nodes-base.merge": {},
  "n8n-nodes-base.limit": {},
  "n8n-nodes-base.sort": {},
  "n8n-nodes-base.removeDuplicates": {},
  "n8n-nodes-base.splitOut": {},
  "n8n-nodes-base.aggregate": {},
  "n8n-nodes-base.summarize": {},
  "n8n-nodes-base.itemLists": {},
  "n8n-nodes-base.renameKeys": {},
  "n8n-nodes-base.dateTime": {},
  "n8n-nodes-base.code": {},
  "n8n-nodes-base.function": {},
  "n8n-nodes-base.functionItem": {},
  "n8n-nodes-base.noOp": {},
  "n8n-nodes-base.wait": {},
  "n8n-nodes-base.stopAndError": {},
  "n8n-nodes-base.respondToWebhook": {},
  "n8n-nodes-base.executeWorkflow": { tool: true },
  "@n8n/n8n-nodes-langchain.chainLlm": { llm: true },
  "@n8n/n8n-nodes-langchain.openAi": { llm: true },
};

/** Trigger types: they become the tool's triggers (and inputs), not nodes. */
export const N8N_TRIGGERS = new Set([
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.cron",
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.executeWorkflowTrigger",
]);

/** Types the import drops without a trace: notes on the canvas. */
export const N8N_IGNORED = new Set(["n8n-nodes-base.stickyNote"]);

/** Model sub-nodes a chain's `ai_languageModel` connection names: the hosted model replaces them. */
export const N8N_MODEL_PREFIX = "@n8n/n8n-nodes-langchain.lmChat";

/** The extension a sealed step names in the checker's message. */
export const SEALED_EXTENSION = "press.swarm.sealed";

export function isSupportedN8n(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(N8N_TYPES, type);
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Why a node of a supported type still cannot run, or `null`. The Rust
 * checker refuses the same shapes (`n8n_unsupported` in tools.rs).
 */
export function unsupportedReason(type: string, version: number | undefined, p: Record<string, unknown>): string | null {
  if (!isSupportedN8n(type)) return "no swarm.press equivalent";
  const v = version ?? 1;
  const opts = isObj(p.options) ? p.options : {};
  switch (type) {
    case "n8n-nodes-base.code":
      return (p.language ?? "javaScript") === "javaScript" ? null : `${String(p.language)} code: swarm.press runs JavaScript only`;
    case "n8n-nodes-base.dateTime":
      return v < 2 ? "Date & Time v1 uses Moment formats: use Date & Time v2" : null;
    case "n8n-nodes-base.httpRequest": {
      if (opts.pagination) return "pagination";
      if (p.contentType === "multipart-form-data" || p.contentType === "binaryData") return "binary request bodies";
      const resp = isObj(opts.response) && isObj(opts.response.response) ? opts.response.response : {};
      if (resp.responseFormat === "file" || (v < 3 && p.responseFormat === "file")) return "file responses";
      return null;
    }
    case "n8n-nodes-base.wait":
      return p.resume === "webhook" || p.resume === "form" ? "a wait for a webhook or form: a tool runs to its end" : null;
    case "n8n-nodes-base.removeDuplicates":
      return p.operation && p.operation !== "removeDuplicateInputItems" ? "remembering items between runs" : null;
    case "n8n-nodes-base.merge":
      return p.mode === "combineBySql" ? "merging by SQL" : null;
    case "@n8n/n8n-nodes-langchain.openAi":
      return (p.resource ?? "text") === "text" && (p.operation ?? "message") === "message" ? null : "only the OpenAI node's \"Message a model\"";
    case "n8n-nodes-base.executeWorkflow":
      return (p.source ?? "database") === "database" ? null : "a sub-workflow given inline or from a file or URL";
  }
  return null;
}

/** Where a URL parameter may go: one literal origin, any origin (a computed host), or nowhere valid. */
export function urlOrigin(raw: unknown): { origin: string } | "any" | null {
  if (typeof raw !== "string") return null;
  const expr = raw.startsWith("=");
  const s = (expr ? raw.slice(1) : raw).trim();
  if (expr && s.startsWith("{{")) return "any";
  const m = /^(https?):\/\/([^/?#]*)/.exec(s);
  if (!m) return null;
  if (m[2].includes("{{")) return expr ? "any" : null;
  return /^[A-Za-z0-9.-]+(:\d+)?$/.test(m[2]) && m[2].includes(".") ? { origin: `${m[1]}://${m[2].toLowerCase()}` } : null;
}
