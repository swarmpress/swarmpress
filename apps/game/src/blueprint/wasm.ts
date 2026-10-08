/**
 * The blueprint facade (`crates/blueprint-wasm`, ADR-0072) as the brick
 * canvas uses it: the browser checks and diffs the CEO's edits with the very
 * code the server runs. Loaded lazily (`loadBlueprintWasm`), only when the
 * Blueprint panel opens, so the default bundle never fetches its wasm. Tests
 * hand in the real module (`initSync` under Node) or a fake with
 * `setBlueprintWasm`.
 */
import type { Blueprint, BlueprintChange, ModelIssue, SiteModels, ToolGraph } from './types'

/** The subset of `blueprint-wasm` the canvas calls; JSON in and out as strings. */
export interface BlueprintApi {
  checkBlueprint(bp: string, ctx: string): string
  diffBlueprints(old: string, next: string): string
  hashBlueprint(bp: string): string
  checkTool(graph: string, ctx: string): string
  toolManifest(graph: string): string
  /** `apply_changes`: `base` with the chosen `changes` of `proposal` (the booklet's steps); absent in older fakes. */
  applyChanges?(base: string, proposal: string, changes: string): string
}

let loading: Promise<BlueprintApi> | null = null

/** The module for the page, loaded once. */
export function loadBlueprintWasm(): Promise<BlueprintApi> {
  loading ??= import('./wasm-load').then((m) => m.importBlueprintWasm())
  return loading
}

/** Tests: use this module instead of loading the pkg (null: load it again). */
export function setBlueprintWasm(api: BlueprintApi | null) {
  loading = api ? Promise.resolve(api) : null
}

/** The checker's context for this site (`{types, custom_blocks, sections, collections, tools}`). */
export function contextOf(models: SiteModels): string {
  return JSON.stringify({
    types: models.types,
    custom_blocks: models.context.custom_blocks,
    sections: models.context.sections,
    collections: models.context.collections,
    tools: models.tools.map((t) => t.graph),
  })
}

/** A refusal of the facade is a JSON array of issues; anything else becomes one issue. */
function refused(e: unknown, path: string): ModelIssue[] {
  const text = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)
  try {
    const v = JSON.parse(text) as unknown
    if (Array.isArray(v)) return v as ModelIssue[]
  } catch {
    // not JSON: fall through
  }
  return [{ code: 'bad-format', path, message: text }]
}

export function checkBlueprint(api: BlueprintApi, bp: Blueprint, ctx: string): ModelIssue[] {
  try {
    return JSON.parse(api.checkBlueprint(JSON.stringify(bp), ctx)) as ModelIssue[]
  } catch (e) {
    return refused(e, '/')
  }
}

export function diffBlueprints(api: BlueprintApi, old: Blueprint, next: Blueprint): BlueprintChange[] {
  try {
    return JSON.parse(api.diffBlueprints(JSON.stringify(old), JSON.stringify(next))) as BlueprintChange[]
  } catch {
    return []
  }
}

export function checkTool(api: BlueprintApi, graph: ToolGraph, ctx: string): ModelIssue[] {
  try {
    return JSON.parse(api.checkTool(JSON.stringify(graph), ctx)) as ModelIssue[]
  } catch (e) {
    return refused(e, '/')
  }
}

export function toolManifest(api: BlueprintApi, graph: ToolGraph): Record<string, unknown> | null {
  try {
    return JSON.parse(api.toolManifest(JSON.stringify(graph))) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * `base` with the chosen changes of `proposal` applied (the instruction
 * booklet's step states, FEAT-101); null when the checker cannot do it.
 */
export function applyChanges(api: BlueprintApi, base: Blueprint, proposal: Blueprint, changes: BlueprintChange[]): Blueprint | null {
  if (!api.applyChanges) return null
  try {
    return JSON.parse(api.applyChanges(JSON.stringify(base), JSON.stringify(proposal), JSON.stringify(changes))) as Blueprint
  } catch {
    return null
  }
}
