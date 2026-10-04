/**
 * The host sweeper (docs/design/mvp-pipeline.md §7, docs/mvp.md W, FEAT-085):
 * keeps the company store from growing with every job.
 *
 * Stage rows (`job_stages`, ADR-0058 decision 7) exist so that a re-run job,
 * or a retried phase (a new job that adopts its predecessor's rows), never
 * repeats a completed model call. Once a job can no longer be re-run or
 * adopted from they are dead weight: a staged draft leaves a few dozen rows of
 * model output each. They are kept while
 *
 *   - the sim still waits for the job (it may run again after a reload), or
 *   - the job's work item is not closed (a `Retry` of a blocked item adopts
 *     the stages of the item's latest job of that kind, and a revision may
 *     adopt the sections that did not change), or
 *   - the activity record does not say which item the job was for;
 *
 * and deleted otherwise: the stages of a published or cancelled item's jobs,
 * and of a standup that is no longer pending. Transcripts, posts and the
 * activity record are the company's record and are kept (the panels read
 * them a window at a time).
 *
 * Runs at the start of each game day (session.ts) and is idempotent. Closing
 * the pull requests of cancelled items (G7) is a server endpoint that does
 * not exist yet.
 */

export interface StageSweepStore {
  stageJobs(company: string): Promise<{ jobId: number; workItem: string | null | undefined }[]>
  deleteStages(company: string, jobIds: number[]): Promise<void>
}

/** The part of `Sim.plan_json()` the sweeper reads. */
export interface SweepPlan {
  items: { id: string; status: string }[]
  jobs?: { id: number }[]
}

const CLOSED = new Set(['published', 'cancelled'])

/** The jobs whose stage rows may go (pure: the policy above). */
export function prunableStageJobs(jobs: { jobId: number; workItem: string | null | undefined }[], plan: SweepPlan): number[] {
  const pending = new Set((plan.jobs ?? []).map((j) => j.id))
  const status = new Map(plan.items.map((i) => [i.id, i.status]))
  return jobs
    .filter((j) => {
      if (pending.has(j.jobId) || j.workItem === undefined) return false
      if (j.workItem === null) return true
      return CLOSED.has(status.get(j.workItem) ?? '')
    })
    .map((j) => j.jobId)
}

/** Deletes the stage rows no job can use any more; returns the jobs swept. */
export async function sweepStages(store: StageSweepStore, company: string, planJson: string): Promise<number[]> {
  const plan = JSON.parse(planJson) as SweepPlan
  const prune = prunableStageJobs(await store.stageJobs(company), plan)
  if (prune.length) await store.deleteStages(company, prune)
  return prune
}
