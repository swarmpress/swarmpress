import type { PhaseKind } from './plan-types'
import type { FinanceJson, OrgJson, StaffJson } from './types'

/**
 * Game rules the overlay needs before asking the sim (e.g. a slider's max).
 * The sim stays authoritative: every action is still checked with
 * `validate()`; these only shape the controls.
 */

export const MAX_ALLOCATION = 100

/** Books are kept when there is a CFO and the sim does not flag them unkept (§6). */
export const booksKept = (f: FinanceJson, org: OrgJson) => !!org.executive.cfo && f.booksKept !== false && f.booksUnkept !== true

/** Projects a company may run at once by level (organization.md §4). */
export function projectCapForLevel(level: number): number {
  if (level >= 5) return 5
  if (level >= 4) return 3
  if (level >= 3) return 2
  return 1
}

export function nextUnlock(level: number): { level: number; projects: number } | null {
  for (const l of [3, 4, 5]) if (l > level) return { level: l, projects: projectCapForLevel(l) }
  return null
}

/** Projects that count against the cap: active and paused. */
export const runningProjects = (org: OrgJson) => org.projects.filter((p) => p.status === 'active' || p.status === 'paused')

/** Why the company can't start another project, or null. Null too when the level is unknown (the sim decides). */
export function projectLockReason(org: OrgJson): string | null {
  if (!org.company) return null
  const { level, maxProjects } = org.company
  const used = runningProjects(org).length
  if (used < maxProjects) return null
  const next = nextUnlock(level)
  return next
    ? `Company level ${level} allows ${maxProjects} running project${maxProjects === 1 ? '' : 's'}. Level ${next.level} unlocks ${next.projects}.`
    : `All ${maxProjects} project slots are in use.`
}

export const allocationTotal = (s: StaffJson, exceptProject?: string) =>
  s.projects.filter((a) => a.project !== exceptProject).reduce((sum, a) => sum + a.allocation, 0)

/** Highest allocation this person can take on `project` without exceeding 100%. */
export const maxAllocationFor = (s: StaffJson, project: string) => Math.max(0, MAX_ALLOCATION - allocationTotal(s, project))

/** Which roles may take which phase (publishing-plan.md §3: role-checked). */
export const PHASE_ROLES: Record<string, string[]> = {
  research: ['writer', 'editor', 'editor-in-chief', 'analyst', 'strategist', 'data-scientist', 'fact-checker'],
  outline: ['writer', 'editor', 'editor-in-chief'],
  draft: ['writer', 'editor', 'editor-in-chief'],
  media: ['photographer', 'photo-editor', 'video-producer'],
  'links-seo': ['seo-specialist', 'marketing-manager', 'social-media-manager'],
  review: ['editor', 'editor-in-chief', 'art-director'],
  publish: ['it-engineer', 'dev-ops', 'web-developer', 'editor', 'editor-in-chief'],
  translate: ['translator'],
  design: ['art-director', 'ux-designer', 'web-developer'],
  build: ['web-developer', 'it-engineer', 'dev-ops'],
  ops: ['it-engineer', 'dev-ops'],
  analysis: ['data-scientist', 'analyst', 'strategist', 'it-engineer'],
}

export const rolesForPhase = (kind: PhaseKind) => PHASE_ROLES[kind] ?? []

/** Roles a publication team needs (missing ones block work, §4). */
export const REQUIRED_ROLES: Array<{ role: string; satisfiedBy: string[] }> = [
  { role: 'editor', satisfiedBy: ['editor', 'editor-in-chief'] },
  { role: 'writer', satisfiedBy: ['writer'] },
  { role: 'photographer', satisfiedBy: ['photographer', 'photo-editor'] },
  { role: 'web-developer', satisfiedBy: ['web-developer'] },
  { role: 'seo-specialist', satisfiedBy: ['seo-specialist', 'marketing-manager'] },
  { role: 'it-engineer', satisfiedBy: ['it-engineer', 'dev-ops'] },
  { role: 'translator', satisfiedBy: ['translator'] },
]

export const humanRole = (role: string) => role.replace(/[_-]+/g, ' ')

export const noSecretaryReason = 'No executive secretary. Hire one to delegate and to get tickets triaged.'
export const noCfoReason = 'No CFO. Books not reviewed: no alerts, no reports.'
