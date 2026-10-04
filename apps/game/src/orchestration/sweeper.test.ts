// The stage sweeper (W, FEAT-085): stage rows go once no job can re-run or
// adopt them; a blocked item's stages stay for its Retry.
import { describe, expect, it } from 'vitest'
import { CompanyStore, type ActivityRow } from '../store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import { prunableStageJobs, sweepStages } from './sweeper'

const row = (job_id: number, work_item: string | null, stage = 'outline'): ActivityRow => ({
  job_id,
  stage,
  idx: 0,
  attempt: 1,
  kind: work_item ? 'draft' : 'standup',
  revision: 0,
  work_item,
  staff: null,
  role: null,
  persona: null,
  model: null,
  tokens_in: 0,
  tokens_out: 0,
  wall_ms: 0,
  game_step: 0,
  day: 0,
  minute: 0,
  result: 'done',
  detail: {},
})

describe('prunableStageJobs', () => {
  const plan = {
    items: [
      { id: 'work-item-1', status: 'published' },
      { id: 'work-item-2', status: 'blocked' },
      { id: 'work-item-3', status: 'cancelled' },
      { id: 'work-item-4', status: 'in-progress' },
    ],
    jobs: [{ id: 9 }],
  }

  it('prunes the jobs of closed items and finished standups, nothing a Retry or a re-run needs', () => {
    const jobs = [
      { jobId: 1, workItem: 'work-item-1' }, // published
      { jobId: 2, workItem: 'work-item-2' }, // blocked: Retry adopts these
      { jobId: 3, workItem: 'work-item-3' }, // killed
      { jobId: 4, workItem: 'work-item-4' }, // in flight
      { jobId: 5, workItem: null }, // a standup that is over
      { jobId: 6, workItem: undefined }, // no activity row: unknown item
      { jobId: 9, workItem: null }, // a standup still pending
    ]
    expect(prunableStageJobs(jobs, plan)).toEqual([1, 3, 5])
  })
})

describe('sweepStages on the company store', () => {
  it('deletes the stage rows of prunable jobs only, and is idempotent', async () => {
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    const stage = (job: number, stage: string) => store.putStage('c1', job, stage, 0, JSON.stringify({ input_hash: 'h', value: { ok: true } }))
    for (const j of [1, 2, 3]) {
      await stage(j, 'outline')
      await stage(j, 'section')
    }
    await store.putActivity('c1', row(1, 'work-item-1'))
    await store.putActivity('c1', row(2, 'work-item-2'))
    // Job 3 has stage rows but no activity row: kept.
    const plan = JSON.stringify({ items: [{ id: 'work-item-1', status: 'published' }, { id: 'work-item-2', status: 'blocked' }], jobs: [] })
    expect(await store.stageJobs('c1')).toEqual([
      { jobId: 1, workItem: 'work-item-1' },
      { jobId: 2, workItem: 'work-item-2' },
      { jobId: 3, workItem: undefined },
    ])
    expect(await sweepStages(store, 'c1', plan)).toEqual([1])
    expect(await store.stages('c1', 1)).toEqual([])
    expect((await store.stages('c1', 2)).length).toBe(2)
    expect((await store.stages('c1', 3)).length).toBe(2)
    expect(await sweepStages(store, 'c1', plan)).toEqual([])
    expect((await store.rowCounts()).job_stages).toBe(4)
  })
})
