/**
 * The CEO commissions structural work (ADR-0072, FEAT-095): the request is
 * text, so it goes to the company store as the item's brief (the
 * `BriefRecord` shape of `orchestrator::structure_brief`, its request in
 * `brief.angle`), and only its ref enters the sim, in
 * `Command::Commission{project, kind, brief_ref}` (CLAUDE.md rule 2). The
 * sim then staffs the Draft with the kind's architect.
 */
import type { CommandResult } from '../ui/commands'

/** What can be asked for here: a blueprint change or a tool (a theme lands with FEAT-094). */
export type CommissionKind = 'structure' | 'tool'

/** `sim_core::WorkItemKind` variant names. */
const VARIANT: Record<CommissionKind, string> = { structure: 'Structure', tool: 'Tool' }

/** The longest request kept (the job cuts what it shows the model further). */
export const REQUEST_MAX = 1200

/** The brief record of a structural item: `orchestrator::structure_brief(kind, request)`. */
export function structureBrief(kind: CommissionKind, request: string): Record<string, unknown> {
  const text = request.trim()
  const title = [...(text.split('\n')[0] ?? '')].slice(0, 80).join('')
  return {
    job_id: 0,
    brief: { content_id: `${kind}-request`, title, slug: '', angle: text, keywords: [], target_words: 0, language: 'en', notes: '' },
    writer: '',
    editor: '',
    kind,
  }
}

/**
 * A fresh brief ref: random, positive and below 2^53, so the command's JSON
 * number is exact in JavaScript (standup briefs are 63-bit hashes; a clash
 * is as unlikely as theirs).
 */
export function newBriefRef(random: (n: Uint32Array) => Uint32Array = (n) => crypto.getRandomValues(n)): number {
  const [hi, lo] = random(new Uint32Array(2))
  return ((hi & 0x1fffff) * 0x100000000 + lo) || 1
}

/** `{"Commission": {project, kind, brief_ref}}`. */
export function commissionCommand(project: string, kind: CommissionKind, briefRef: number): string {
  return JSON.stringify({ Commission: { project, kind: VARIANT[kind], brief_ref: briefRef } })
}

export interface CommissionDeps {
  /** `sim.validate_command_json`: undefined when the command would apply, else why not. */
  validate(json: string): string | undefined | null
  /** Logs and applies a command (the loop's `apply`). */
  apply(json: string): CommandResult
  putBrief(briefRef: string, recordJson: string): Promise<void>
}

/**
 * Stores the request as a brief, then logs the command. A command the sim
 * would refuse (no architect on the staff, three structural items open) is
 * refused before anything is stored.
 */
export async function commission(deps: CommissionDeps, project: string, kind: CommissionKind, request: string, ref = newBriefRef()): Promise<CommandResult> {
  const text = request.trim().slice(0, REQUEST_MAX)
  if (!text) return { ok: false, reason: 'Say what you want first.' }
  const cmd = commissionCommand(project, kind, ref)
  const why = deps.validate(cmd)
  if (why) return { ok: false, reason: why }
  await deps.putBrief(String(ref), JSON.stringify(structureBrief(kind, text)))
  return deps.apply(cmd)
}
