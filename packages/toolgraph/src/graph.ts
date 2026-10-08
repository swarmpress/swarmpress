/**
 * The `swarmpress.tool.v1` format (FEAT-091, ADR-0072, design §3.4).
 *
 * The Rust crate `blueprint` (`crates/blueprint/src/tools.rs`) is the source of
 * truth; this Zod schema mirrors its serde shapes exactly: `kind`-tagged
 * nodes, kebab-case enums, edges as `["node.port", "node.port"]`, unknown
 * fields rejected (`deny_unknown_fields` → `.strict()`) and the same defaults.
 *
 * Only tools (editors, the runner, tests) import this module: it uses Zod,
 * which never goes into a sandbox bundle. The interpreter imports the types
 * below with `import type` only.
 */
import { z } from "zod";

export const TOOL_FORMAT = "swarmpress.tool.v1";

const U32 = z.number().int().min(0).max(0xffff_ffff);
/** serde's `Option<T>`: missing or `null` are both `None`. */
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullish().transform((v) => (v === null ? undefined : v));
/** serde's `serde_json::Value`: a missing field deserializes as `null`. */
const anyValue = z.unknown().transform((v) => (v === undefined ? null : v));

export const ConnectorKindSchema = z.enum(["http-get", "rss", "web-search", "knowledge", "store-read", "tool"]);
export const OpKindSchema = z.enum(["pick", "map", "filter", "sort", "limit", "merge", "split", "format", "validate"]);
export const TestSchema = z.enum(["compare", "exists", "switch"]);
export const TierSchema = z.enum(["low", "mid", "high"]);
export const CmpSchema = z.enum(["eq", "ne", "gt", "lt", "contains"]);

export const WhereSchema = z.object({ path: z.string(), cmp: CmpSchema, value: anyValue }).strict();

const id = z.string();

export const NodeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("input"), id, port: z.string() }).strict(),
  z.object({ kind: z.literal("output"), id, port: z.string() }).strict(),
  z
    .object({
      kind: z.literal("connector"),
      id,
      connector: ConnectorKindSchema,
      url: opt(z.string()),
      query: opt(z.string()),
      table: opt(z.string()),
      tool: opt(z.string()),
      credential: opt(z.string()),
      returns: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("op"),
      id,
      op: OpKindSchema,
      path: opt(z.string()),
      fields: z.record(z.string()).default({}),
      where: opt(WhereSchema),
      desc: z.boolean().default(false),
      count: opt(U32),
      separator: opt(z.string()),
      template: opt(z.string()),
      returns: opt(z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("condition"),
      id,
      test: TestSchema,
      path: z.string(),
      cmp: opt(CmpSchema),
      value: opt(z.unknown()),
      cases: z.array(z.string()).default([]),
    })
    .strict(),
  z.object({ kind: z.literal("agent"), id, role: z.string(), tier: TierSchema, instruction: z.string(), output: z.string() }).strict(),
  z.object({ kind: z.literal("skill"), id, extension: z.string(), tool: z.string(), returns: z.string() }).strict(),
  z
    .object({
      kind: z.literal("n8n"),
      id,
      name: z.string(),
      type: z.string(),
      version: opt(z.number()),
      parameters: z.record(z.unknown()).default({}),
      inputs: U32.default(1),
      outputs: U32.default(1),
      credential: opt(z.string()),
      tool: opt(z.string()),
      on_error: opt(z.enum(["stop", "continue"])),
      returns: opt(z.string()),
    })
    .strict(),
]);

export const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("on-demand") }).strict(),
  z.object({ kind: z.literal("build") }).strict(),
  z.object({ kind: z.literal("schedule"), every_game_days: U32 }).strict(),
]);

export const OnErrorSchema = z.enum(["fail", "keep-last"]);

export const FailureSchema = z
  .object({ retries: U32.default(0), on_error: OnErrorSchema.default("fail") })
  .strict();

export const ToolLimitsSchema = z
  .object({ llm_calls_per_run: U32.default(0), fetches_per_run: U32.default(0) })
  .strict();

export const ToolGraphSchema = z
  .object({
    format: z.string(),
    id: z.string(),
    name: z.record(z.string()),
    description: z.string().default(""),
    inputs: z.record(z.string()).default({}),
    outputs: z.record(z.string()),
    nodes: z.array(NodeSchema),
    edges: z.array(z.tuple([z.string(), z.string()])),
    triggers: z.array(TriggerSchema).default([]),
    failure: FailureSchema.default({}),
    limits: ToolLimitsSchema.default({}),
  })
  .strict();

export type ConnectorKind = z.infer<typeof ConnectorKindSchema>;
export type OpKind = z.infer<typeof OpKindSchema>;
export type Test = z.infer<typeof TestSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type Cmp = z.infer<typeof CmpSchema>;
export type Where = z.infer<typeof WhereSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type ToolGraph = z.infer<typeof ToolGraphSchema>;

/** A tool file that does not parse as `swarmpress.tool.v1`. Never replaced by defaults. */
export class ToolGraphParseError extends Error {
  /** One line per issue: `path: message`. */
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`not a ${TOOL_FORMAT} graph:\n${issues.map((i) => `  ${i}`).join("\n")}`);
    this.name = "ToolGraphParseError";
    this.issues = issues;
  }
}

/** Parses a tool graph (a JSON value, or JSON text). Throws {@link ToolGraphParseError}. */
export function parseToolGraph(raw: unknown): ToolGraph {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (e) {
      throw new ToolGraphParseError([`(root): not valid JSON: ${(e as Error).message}`]);
    }
  }
  const r = ToolGraphSchema.safeParse(value);
  if (!r.success) {
    throw new ToolGraphParseError(r.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`));
  }
  if (r.data.format !== TOOL_FORMAT) throw new ToolGraphParseError([`format: must be ${JSON.stringify(TOOL_FORMAT)}`]);
  return r.data;
}
