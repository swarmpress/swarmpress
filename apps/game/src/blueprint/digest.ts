/**
 * The site's models as the sim holds them (ADR-0072, FEAT-095): digests only,
 * never text (CLAUDE.md rule 2). After the session reads the models from the
 * central server it logs `ServerCommand::BlueprintChanged` and
 * `ServerCommand::ToolsChanged` when they differ from what the sim holds
 * (`plan_json().structure`), the way the site audit logs `SiteSignals`: every
 * device that restores the log then holds the same facts.
 *
 * - `BlueprintChanged{hash, page_types, slots, issues}`: the first 16 bytes
 *   of the blueprint's semantic hash, the page types, their slots and the
 *   checker's issues.
 * - `ToolsChanged{tools}`: each installed tool's first 6 bytes of its hash
 *   (big-endian, below 2^48 so a JS number holds it exactly), its schedule
 *   (the first `schedule` trigger's `every_game_days`, at most 28; 0 without
 *   one) and the role of its first agent step (none: no staff time). A tool
 *   with checker issues cannot be installed, so it is left out.
 */
import type { SiteModels, ToolGraph } from './types'

/** `crates/sim-core/src/structure.rs` `MAX_SCHEDULE_DAYS`. */
export const MAX_SCHEDULE_DAYS = 28
/** `MAX_TOOLS`. */
export const MAX_TOOLS = 64

/** What `plan_json().structure` holds. */
export interface HeldStructure {
  model?: { hash: string; pageTypes: number; slots: number; issues: number } | null
  tools?: { toolRef: number; scheduleDays: number; role: string | null }[]
}

export interface ToolStubJson {
  tool_ref: number
  schedule_days: number
  role: string | null
}

const u16 = (n: number) => Math.max(0, Math.min(65535, Math.floor(n)))

/** The blueprint's digest: the hash's first 16 bytes and the counts. */
export function blueprintDigest(m: SiteModels): { hash: number[]; page_types: number; slots: number; issues: number } {
  const hex = m.hash.slice(0, 32).padEnd(32, '0')
  const hash = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0)
  const slots = m.blueprint.page_types.reduce((n, t) => n + (t.slots?.length ?? 0), 0)
  return { hash, page_types: u16(m.blueprint.page_types.length), slots: u16(slots), issues: u16(m.issues.length) }
}

/** One installed tool as the sim takes it. */
export function toolStub(t: { hash: string; graph: ToolGraph }): ToolStubJson {
  const schedule = t.graph.triggers?.find((x) => x.kind === 'schedule') as { every_game_days?: number } | undefined
  const days = schedule?.every_game_days ? Math.max(1, Math.min(MAX_SCHEDULE_DAYS, Math.floor(schedule.every_game_days))) : 0
  const agent = t.graph.nodes.find((n) => n.kind === 'agent')
  return {
    tool_ref: parseInt(t.hash.slice(0, 12), 16),
    schedule_days: days,
    role: typeof agent?.role === 'string' ? agent.role : null,
  }
}

/** The tools the sim should hold: those that check, by tool ref, at most `MAX_TOOLS`. */
export function toolStubs(m: SiteModels): ToolStubJson[] {
  const byRef = new Map<number, ToolStubJson>()
  for (const t of m.tools) {
    if (t.issues.length > 0 || !/^[0-9a-f]{12}/.test(t.hash)) continue
    const s = toolStub(t)
    if (!byRef.has(s.tool_ref)) byRef.set(s.tool_ref, s)
  }
  return [...byRef.values()].sort((a, b) => a.tool_ref - b.tool_ref).slice(0, MAX_TOOLS)
}

/** `{"BlueprintChanged": …}` when the sim holds another digest; null when it holds this one. */
export function blueprintCommand(m: SiteModels, held: HeldStructure | null | undefined): string | null {
  const d = blueprintDigest(m)
  const hex = d.hash.map((b) => b.toString(16).padStart(2, '0')).join('')
  const h = held?.model
  if (h && h.hash === hex && h.pageTypes === d.page_types && h.slots === d.slots && h.issues === d.issues) return null
  return JSON.stringify({ BlueprintChanged: d })
}

/** `{"ToolsChanged": …}` when the sim holds other tools; null when it holds these. */
export function toolsCommand(m: SiteModels, held: HeldStructure | null | undefined): string | null {
  const want = toolStubs(m)
  const have = [...(held?.tools ?? [])].sort((a, b) => a.toolRef - b.toolRef)
  const same =
    want.length === have.length &&
    want.every((w, i) => w.tool_ref === have[i].toolRef && w.schedule_days === have[i].scheduleDays && (w.role ?? null) === (have[i].role ?? null))
  return same ? null : JSON.stringify({ ToolsChanged: { tools: want } })
}
