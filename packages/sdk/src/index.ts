/**
 * `@simpress/sdk`: types, schemas and helpers for SimPress extensions (ADR-0042, ADR-0043).
 *
 * Extension bundles should import `@simpress/sdk/runtime` (no zod, safe inside
 * the sandbox). Tools (the runner, editors, CI) import this entry point.
 */
import { parse as parseToml } from "smol-toml";
import type { ZodError, ZodTypeAny } from "zod";
import { HappeningSchema, PersonaSchema, PromptLayerSchema, PropSchema } from "./schemas.ts";

export * from "./runtime.ts";
export * from "./schemas.ts";
export * from "./semver.ts";
export * from "./version.ts";

/** Content document kinds, keyed as in `entry.content`. */
export const CONTENT_SCHEMAS = {
  personas: PersonaSchema,
  happenings: HappeningSchema,
  prompt_layers: PromptLayerSchema,
  props: PropSchema,
} as const satisfies Record<string, ZodTypeAny>;
export type ContentSection = keyof typeof CONTENT_SCHEMAS;

/** One line per issue: `path: message`. */
export function formatIssues(err: ZodError): string[] {
  return err.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Parses JSON or TOML text (by file extension) and validates it against `schema`. */
export function parseDocument<T>(schema: ZodTypeAny, text: string, fileName: string): ParseResult<T> {
  let raw: unknown;
  try {
    raw = fileName.endsWith(".toml") ? parseToml(text) : JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid ${fileName.endsWith(".toml") ? "TOML" : "JSON"}: ${(e as Error).message}`] };
  }
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, value: r.data as T } : { ok: false, errors: formatIssues(r.error) };
}
