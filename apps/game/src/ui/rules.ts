import type { PhaseKind } from './plan-types'
import type { OrgJson, StaffJson } from './types'

/**
 * Game rules the overlay needs before asking the sim (e.g. a slider's max).
 * The sim stays authoritative: every action is still checked with
 * `validate()`; these only shape the controls.
 */

export const MAX_ALLOCATION = 100

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
  research: ['writer', 'editor', 'editor_in_chief', 'analyst', 'strategist', 'data_scientist', 'fact_checker'],
  outline: ['writer', 'editor', 'editor_in_chief'],
  draft: ['writer', 'editor', 'editor_in_chief'],
  media: ['photographer', 'photo_editor', 'video_producer'],
  'links-seo': ['seo_specialist', 'marketing_manager', 'social_media_manager'],
  review: ['editor', 'editor_in_chief', 'art_director'],
  publish: ['it_engineer', 'devops', 'web_developer', 'editor', 'editor_in_chief'],
  translate: ['translator'],
  design: ['art_director', 'ux_designer', 'web_developer'],
  build: ['web_developer', 'it_engineer', 'devops'],
  ops: ['it_engineer', 'devops'],
  analysis: ['data_scientist', 'analyst', 'strategist', 'it_engineer'],
}

export const rolesForPhase = (kind: PhaseKind) => PHASE_ROLES[kind] ?? []

/** Roles a publication team needs (missing ones block work, §4). */
export const REQUIRED_ROLES: Array<{ role: string; satisfiedBy: string[] }> = [
  { role: 'editor', satisfiedBy: ['editor', 'editor_in_chief'] },
  { role: 'writer', satisfiedBy: ['writer'] },
  { role: 'photographer', satisfiedBy: ['photographer', 'photo_editor'] },
  { role: 'web_developer', satisfiedBy: ['web_developer'] },
  { role: 'seo_specialist', satisfiedBy: ['seo_specialist', 'marketing_manager'] },
  { role: 'it_engineer', satisfiedBy: ['it_engineer', 'devops'] },
  { role: 'translator', satisfiedBy: ['translator'] },
]

export const humanRole = (role: string) => role.replace(/[_-]+/g, ' ')

export const noSecretaryReason = 'No executive secretary. Hire one to delegate and to get tickets triaged.'
export const noCfoReason = 'No CFO. Books not reviewed: no alerts, no reports.'
