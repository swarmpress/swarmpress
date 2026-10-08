/**
 * `@swarm-press/toolgraph`: the `swarmpress.tool.v1` interpreter (FEAT-091, ADR-0072).
 *
 * Bundles import `@swarm-press/toolgraph/skill` (no Zod). Tools (editors, the
 * runner, tests) import this entry point, which also parses graphs with Zod.
 */
export * from "./graph.ts";
export * from "./types.ts";
export * from "./interpret.ts";
export * from "./skill.ts";
export * from "./compile.ts";
export * from "./import/n8n.ts";
export * from "./n8n/catalogue.ts";
export { parseTemplate, referencedNodes, type Item } from "./n8n/expr.ts";
export { runN8n, toItems, conditionV2, compareV1, type N8nNode as N8nGraphNode } from "./n8n/nodes.ts";
export { N8N_PRELUDE } from "./n8n/prelude.ts";
