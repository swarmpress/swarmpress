// The week-long soak (docs/mvp.md track W, FEAT-085): the real wasm sim and
// orchestrator, the fake model with realistic latency and failure rates, a
// fake central server, the CEO answering by policy, a model loss, a deploy
// failure and a page reload (src/soak/soak.ts). Fake timers: a game day takes
// seconds.
//
//   short (CI, part of `pnpm test`):  2 game days
//   full (the owner, ~1–2 min):       SOAK_DAYS=7 pnpm --filter @swarm-press/game exec vitest run src/soak
//   with a table per day:             SOAK_REPORT=1 (prints the per-day table)
//
// Needs `cargo xtask wasm` (skipped without the client-wasm and orchestrator-wasm packages).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import miniPack from '../orchestrator/fixtures/cinqueterre-mini.pack.json'
import { CompanyStore } from '../store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import { runSoak, type DayRow, type SoakReport, type SoakWasm } from './soak'

const CLIENT = resolve(process.cwd(), '../../crates/client-wasm/pkg') + '/'
const ORCH = resolve(process.cwd(), '../../crates/orchestrator-wasm/pkg') + '/'
const built = existsSync(`${CLIENT}client_wasm.js`) && existsSync(`${ORCH}orchestrator_wasm_bg.wasm`)

/** A full collection before each heap reading (the flag must be set before `gc` is looked up). */
setFlagsFromString('--expose_gc')
const gc = runInNewContext('gc') as () => void

const DAYS = Number(process.env.SOAK_DAYS ?? 2)
const FULL = DAYS >= 7

/** Tables that are the company's record: they grow with the work done, by design. */
const RECORD_TABLES = ['command_log', 'transcripts', 'plan_items', 'plan_posts', 'post_dedupe', 'activity', 'briefs', 'artifacts']

function table(days: DayRow[]): string {
  const head = 'day | step | items pub/cxl/blk/open | jobs run/failed | model calls | loop jobs/seen/done/open/where/speech/simSeq/spoken/deploys | bridge/fake/gw/events | stages | kv | snaps | log | activity | posts | transcripts | heap MB'
  const rows = days.map((d) => {
    const l = d.loop
    const r = d.rows
    return [
      d.day,
      d.step,
      `${d.items} ${d.published}/${d.cancelled}/${d.blocked}/${d.open}`,
      `${d.jobsRun}/${d.jobsFailed}`,
      d.modelCalls,
      `${l.jobs}/${l.seen}/${l.completed}/${l.open}/${l.where}/${l.speech}/${l.simSeq}/${l.spoken}/${l.deploys}`,
      `${d.bridgeCalls}/${d.fakeCalls}/${d.gatewayCalls}/${d.received}`,
      r.job_stages,
      r.kv,
      r.snapshots,
      r.command_log,
      r.activity,
      r.plan_posts,
      r.transcripts,
      d.heapMb ?? '-',
    ].join(' | ')
  })
  return [head, ...rows].join('\n')
}

describe.skipIf(!built)(`a ${DAYS}-day soak on the fake model (W)`, () => {
  let report: SoakReport
  const lines: string[] = []
  let errors = 0

  beforeAll(async () => {
    const client = (await import(/* @vite-ignore */ pathToFileURL(`${CLIENT}client_wasm.js`).href)) as SoakWasm & { initSync(m: { module: BufferSource }): unknown }
    client.initSync({ module: readFileSync(`${CLIENT}client_wasm_bg.wasm`) })
    const orch = (await import('orchestrator-wasm')) as { default(o: { module_or_path: BufferSource }): Promise<unknown> }
    await orch.default({ module_or_path: readFileSync(`${ORCH}orchestrator_wasm_bg.wasm`) })
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: new Date('2026-10-05T07:00:00Z') })
    // The loop reports every job failure on console.error; a spy would record each call (and grow the heap).
    const error = console.error
    console.error = (...args: unknown[]) => void (errors += args.length ? 1 : 0)
    try {
      report = await runSoak({
        wasm: client,
        store,
        advance: async (ms) => {
          await vi.advanceTimersByTimeAsync(ms)
        },
        knowledgePack: JSON.stringify(miniPack),
        days: DAYS,
        lossDay: 0,
        reloadDay: 1,
        deployFailDay: 0,
        absentDay: FULL ? 3 : null,
        jobFailDay: FULL ? 5 : 1,
        gc,
        // Only the newest lines are kept (a full log would grow the heap the test measures).
        log: (l) => {
          lines.push(l)
          if (lines.length > 200) lines.shift()
          if (process.env.SOAK_LOG) console.info(l)
        },
      })
    } finally {
      console.error = error
      vi.useRealTimers()
    }
    if (process.env.SOAK_REPORT) {
      console.info(`${errors} lines on console.error`)
      console.info(table(report.days))
      console.info(JSON.stringify({ ...report, days: undefined }, null, 1))
    }
  }, 600_000)

  afterAll(() => {
    vi.useRealTimers()
  })

  it('ran every game day, with each fault injected', () => {
    expect(report.halted).toBeNull()
    expect(report.days.length).toBeGreaterThanOrEqual(DAYS)
    expect(report.events.reloads).toBe(1)
    expect(report.events.modelLosses).toBe(1)
    expect(report.events.deployFailures).toBeGreaterThanOrEqual(1)
    expect(report.faults.invalid).toBeGreaterThan(0)
    expect(report.faults.hang).toBeGreaterThan(0)
    expect(report.faults.unavailable).toBeGreaterThan(0)
    expect(report.faults.gateway).toBeGreaterThanOrEqual(2)
    // The forced timeout failed one draft; the CEO's Retry adopted its completed stages.
    expect(report.events.jobTimeouts).toBeGreaterThanOrEqual(1)
    expect(report.answers['escalation:retry']).toBeGreaterThanOrEqual(1)
    expect(report.adoptedStages).toBeGreaterThan(0)
    // The reloaded page reused the stages the draft had finished.
    expect(report.reusedStages).toBeGreaterThan(report.adoptedStages)
    // Articles were commissioned and published.
    expect(report.items.length).toBeGreaterThan(0)
    expect(report.items.some((i) => i.status === 'published')).toBe(true)
  })

  it('leaves no item stuck: each one is closed, has a pending job, a ticket or a deploy in flight', () => {
    expect(report.stuck).toEqual([])
  })

  it('makes no duplicate PR, merge, post, utterance or outcome', () => {
    expect(report.duplicates).toEqual([])
  })

  it('replays the command log to the live world', () => {
    expect(report.replayHash).toBe(report.hash)
  })

  it('never ran the clock past a pending job’s due step (ADR-0060)', () => {
    expect(report.clockViolations).toEqual([])
  })

  it('has no unhandled promise rejection', () => {
    expect(report.rejections).toEqual([])
  })

  it('raises no finance ticket without revenue', () => {
    expect(report.financeTickets).toEqual([])
  })

  it('does not parse the plan per step', () => {
    expect(report.planJsonPerStep).toBeLessThan(0.05)
  })

  it('keeps memory and the store flat: bounded collections, stage rows swept', () => {
    const last = report.days[report.days.length - 1]
    // In-memory collections are capped, whatever the length of the run.
    expect(last.loop.jobs).toBeLessThanOrEqual(60)
    expect(last.loop.where + last.loop.speech + last.loop.simSeq).toBeLessThanOrEqual(10)
    expect(last.loop.deploys).toBeLessThanOrEqual(5)
    expect(last.activity.jobs + last.activity.latest).toBeLessThanOrEqual(4)
    expect(last.bridgeCalls).toBeLessThanOrEqual(20)
    expect(last.fakeCalls).toBeLessThanOrEqual(20)
    expect(last.gatewayCalls).toBeLessThanOrEqual(200)
    expect(last.received).toBeLessThanOrEqual(200)
    // Store: work tables stay flat (snapshots keep three, outcomes leave the kv, stages are swept);
    // the record tables grow with the work done, never faster than it.
    for (const d of report.days) {
      expect(d.rows.snapshots).toBeLessThanOrEqual(3)
      expect(d.rows.kv).toBeLessThanOrEqual(10)
      expect(d.rows.site_knowledge).toBeLessThanOrEqual(2)
    }
    // Stage rows belong to items still in flight: the sweeper removes those of closed items each morning.
    for (const d of report.days) expect(d.rows.job_stages, `day ${d.day}`).toBeLessThanOrEqual(Math.max(d.open + d.blocked, 1) * 25)
    if (FULL) {
      // The record grows roughly linearly: rows per published item do not climb.
      for (const t of RECORD_TABLES) {
        const perDay = report.days.slice(1).map((d, i) => d.rows[t] - report.days[i].rows[t])
        expect(Math.max(...perDay.slice(2)), t).toBeLessThanOrEqual(Math.max(...perDay.slice(0, 3)) * 2 + 50)
      }
      // The heap after day 2 (after a full collection) stays within a bound.
      const heaps = report.days.slice(2).map((d) => d.heapMb).filter((h): h is number => h != null)
      expect(Math.max(...heaps) - heaps[0]).toBeLessThan(20)
    }
    void lines
  })
})
