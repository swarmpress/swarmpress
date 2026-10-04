/**
 * The mock company's activity record (FEAT-078, increment U4) in the shape the
 * CompanyStore keeps it (`activity` rows, store migration 3): one row per
 * stage attempt and one per job, as `ActivityRecorder` writes them from the
 * orchestrator's progress events.
 *
 * Jobs 3 to 9 are done (a standup; Giulia's draft with a repaired section,
 * its review at 6, the revision and the review at 8; a draft that failed for
 * want of a hero image; the publish job without a model). Job 10 is in flight:
 * Lorenzo writes section 3 of 5, which `FIXTURE_LIVE_JOB` reports.
 */
import type { ActivityRowJson, LiveJob } from '../data-source'

export const FIXTURE_MODEL = 'ternary-bonsai-2-27b'
export const FIXTURE_LIVE_JOB_ID = 10

/** Unix ms of the fixture's morning; rows are written after it. */
const T0 = Date.UTC(2026, 9, 1, 7, 0, 0)

type Job = Pick<ActivityRowJson, 'job_id' | 'kind' | 'revision' | 'work_item' | 'staff' | 'role' | 'persona'>

function rows(job: Job, day: number, minute: number, stages: Array<[string, number, number, string, number, number, number, Record<string, unknown>?, string?]>, end?: { result: string; wallMs: number; detail: Record<string, unknown>; model?: string | null }): ActivityRowJson[] {
  let at = T0 + job.job_id * 3_600_000
  const out: ActivityRowJson[] = stages.map(([stage, idx, attempt, result, tokensIn, tokensOut, wallMs, detail, model]) => {
    at += wallMs
    return {
      ...job,
      stage,
      idx,
      attempt,
      model: model === undefined ? (tokensIn > 0 ? FIXTURE_MODEL : null) : model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      wall_ms: wallMs,
      game_step: day * 12_000 + minute * 8,
      day,
      minute,
      result,
      detail: detail ?? {},
      created_at: at,
    }
  })
  if (end) {
    const sum = (k: 'tokens_in' | 'tokens_out') => out.reduce((a, r) => a + r[k], 0)
    out.push({
      ...job,
      stage: 'job',
      idx: 0,
      attempt: 1,
      model: end.model === undefined ? FIXTURE_MODEL : end.model,
      tokens_in: sum('tokens_in'),
      tokens_out: sum('tokens_out'),
      wall_ms: end.wallMs,
      game_step: day * 12_000 + minute * 8,
      day,
      minute,
      result: end.result,
      detail: end.detail,
      created_at: at + 50,
    })
  }
  return out
}

const giulia = { staff: 'staff-1', role: 'writer', persona: 'giulia' }
const marco = { staff: 'staff-5', role: 'editor', persona: 'marco' }

/** The record, oldest job first (the store's write order). */
export function fixtureActivityRows(): ActivityRowJson[] {
  const pr = { pr: 31, branch: 'drafts/harvest-week-in-manarola', sha: '9f2c1aa7b3e4', path: 'content/pages/blog/harvest-week-in-manarola.json' }
  return [
    ...rows({ job_id: 3, kind: 'standup', revision: 0, work_item: null, staff: 'staff-4', role: 'editor-in-chief', persona: 'sophia' }, 10, 540, [], {
      result: 'done',
      wallMs: 48_200,
      detail: { briefs: 2 },
      model: FIXTURE_MODEL,
    }).map((r) => ({ ...r, tokens_in: 4_210, tokens_out: 880 })),
    ...rows({ job_id: 4, kind: 'draft', revision: 0, work_item: 'work-item-1', ...giulia }, 10, 552, [
      ['context', 0, 1, 'done', 0, 0, 120, { heroes: 6 }],
      ['outline', 0, 1, 'done', 1_480, 310, 31_000],
      ['section', 0, 1, 'done', 1_820, 260, 44_000, { words: 140 }],
      ['section', 1, 1, 'done', 1_910, 270, 46_500, { words: 150 }],
      ['section', 2, 1, 'repaired', 1_890, 255, 45_100, { ok: false, turns: 1 }],
      ['section', 2, 2, 'done', 2_140, 262, 47_900, { words: 152, turns: 1 }],
      ['section', 3, 1, 'done', 2_010, 268, 46_000, { words: 148 }],
      ['closing', 0, 1, 'done', 1_600, 90, 18_000],
      ['commit', 0, 1, 'done', 0, 0, 900, pr],
    ], { result: 'done', wallMs: 281_000, detail: { ...pr, words: 842 } }),
    ...rows({ job_id: 5, kind: 'review', revision: 0, work_item: 'work-item-1', ...marco }, 10, 600, [['review', 0, 1, 'done', 3_900, 420, 52_000, { score: 6 }]], {
      result: 'done',
      wallMs: 52_400,
      detail: { score: 6, verdict: 'needs_changes', issues: 1 },
    }),
    ...rows({ job_id: 6, kind: 'draft', revision: 1, work_item: 'work-item-1', ...giulia }, 10, 660, [
      ['revise', 2, 1, 'done', 2_300, 280, 49_000, { words: 156 }],
      ['commit', 0, 1, 'done', 0, 0, 700, { ...pr, sha: '1d0e6b2c4a71' }],
    ], { result: 'done', wallMs: 50_100, detail: { ...pr, sha: '1d0e6b2c4a71', revision: 1, words: 846 } }),
    ...rows({ job_id: 7, kind: 'review', revision: 1, work_item: 'work-item-1', ...marco }, 10, 720, [['review', 0, 1, 'done', 3_950, 380, 50_500, { score: 8 }]], {
      result: 'done',
      wallMs: 50_900,
      detail: { score: 8, verdict: 'approve', issues: 0 },
    }),
    ...rows({ job_id: 8, kind: 'draft', revision: 0, work_item: 'work-item-10', staff: 'staff-2', role: 'writer', persona: 'isabella' }, 10, 780, [
      ['context', 0, 1, 'failed', 0, 0, 90, { error: 'no hero image' }],
    ], { result: 'failed', wallMs: 140, detail: { halt: 'NeedsMedia' }, model: null }),
    ...rows({ job_id: 9, kind: 'publish', revision: 1, work_item: 'work-item-1', staff: 'staff-4', role: 'editor-in-chief', persona: 'sophia' }, 11, 545, [], {
      result: 'done',
      wallMs: 2_300,
      detail: { ok: true, merged_sha: '4be81c2d9a01' },
      model: null,
    }),
    // In flight: the rows of the stages done so far, no job row yet.
    ...rows({ job_id: FIXTURE_LIVE_JOB_ID, kind: 'draft', revision: 0, work_item: 'work-item-2', staff: 'staff-3', role: 'writer', persona: 'lorenzo' }, 11, 555, [
      ['context', 0, 1, 'done', 0, 0, 110, { heroes: 4 }],
      ['outline', 0, 1, 'done', 1_420, 300, 19_000],
      ['section', 0, 1, 'done', 1_760, 250, 24_000, { words: 138 }],
      ['section', 1, 1, 'done', 1_880, 265, 26_000, { words: 151 }],
      ['section', 2, 1, 'done', 1_900, 270, 25_500, { words: 149 }],
    ]),
  ]
}

/** Job 10's progress: section 3 of 5, 1:42 in. */
export function fixtureLiveJobs(): LiveJob[] {
  return [
    {
      jobId: FIXTURE_LIVE_JOB_ID,
      kind: 'draft',
      revision: 0,
      workItem: 'work-item-2',
      staff: 'staff-3',
      persona: 'lorenzo',
      role: 'writer',
      stage: 'section',
      index: 3,
      total: 5,
      label: 'section 3 of 5',
      model: FIXTURE_MODEL,
      elapsedMs: 102_000,
    },
  ]
}
