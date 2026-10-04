import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CommandRecord } from '../store/company-store'
import { commandText } from '../sync/segments'
import { OrchestrationLoop, type LoopSim, type LoopStore } from './loop'
import { utteranceMs } from './speech'

/**
 * Speech bubbles through the loop on the real wasm sim (ADR-0062 decision 8,
 * FEAT-025): the 09:00 standup's turns, reported as `turn` events while its
 * job runs, are applied as `Utterance` commands at step boundaries, in order,
 * one per `utteranceMs`, while the meeting is in session; the
 * `MeetingOutcome` is applied last. Fake timers drive the wall clock. Needs
 * `cargo xtask wasm` (skipped without crates/client-wasm/pkg).
 */
const PKG = resolve(process.cwd(), '../../crates/client-wasm/pkg') + '/'
const built = existsSync(`${PKG}client_wasm.js`)

interface WasmSim extends LoopSim {
  render_state_json(): string
  next_due_step(): bigint | number | null | undefined
  free(): void
}
type WasmModule = { initSync(m: { module: BufferSource }): unknown; Sim: { demo(seed: bigint): WasmSim } }

class MemStore implements LoopStore {
  log: CommandRecord[] = []
  kv = new Map<string, string>()
  async appendCommands(cmds: CommandRecord[]) {
    this.log.push(...cmds)
    return cmds.map((c) => c.seq ?? 0)
  }
  async appendPost() {
    return 'post-1'
  }
  getKv = async (k: string) => this.kv.get(k) ?? null
  async setKv(k: string, v: string) {
    this.kv.set(k, v)
  }
  async deleteKv(k: string) {
    this.kv.delete(k)
  }
}

describe.skipIf(!built)('meeting turns on the wasm sim', () => {
  let wasm: WasmModule
  beforeAll(async () => {
    wasm = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}client_wasm.js`).href)) as WasmModule
    wasm.initSync({ module: readFileSync(`${PKG}client_wasm_bg.wasm`) })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies utterances in order while the meeting is active, and the outcome last', async () => {
    vi.useFakeTimers({ now: 0 })
    const sim = wasm.Sim.demo(42n)
    const store = new MemStore()
    const active = (meeting: string) =>
      (JSON.parse(sim.render_state_json()) as { meetings: { id: string; active: boolean }[] }).meetings.find((m) => m.id === meeting)?.active ?? false
    // What the sim saw: each command with the wall time, and whether its meeting was in session.
    const seen: { kind: string; at: number; active: boolean; json: string }[] = []
    let meetingId = ''
    const view: LoopSim = {
      step: () => sim.step(),
      hash: () => sim.hash(),
      advance: (n) => sim.advance(n),
      drain_effects_json: () => sim.drain_effects_json(),
      day: () => sim.day(),
      minute_of_day: () => sim.minute_of_day(),
      steps_per_day: () => sim.steps_per_day(),
      validate_command_json: (j) => sim.validate_command_json(j),
      plan_json: (p) => sim.plan_json(p),
      pending_effects: () => sim.pending_effects(),
      next_due_step: () => sim.next_due_step(),
      apply_command_json: (j) => {
        const kind = Object.keys(JSON.parse(j))[0]
        seen.push({ kind, at: Date.now(), active: meetingId ? active(meetingId) : false, json: j })
        sim.apply_command_json(j)
      },
    }
    // The orchestrator: the moderator and two writers speak (the transcript seqs), then the outcome.
    const texts = ['Good morning. One article today.', 'The harvest starts Monday; I want to be on the terraces.', 'Vernazza before eight is another place.']
    let loop: OrchestrationLoop
    let ran: { job_id: number; meeting: string; context: unknown } | null = null
    const orchestrator = {
      run: async (jobJson: string) => {
        const job = JSON.parse(jobJson) as { job_id: number; meeting: string; context: unknown; staff: { id: string; role: string }[] }
        ran = job
        meetingId = job.meeting
        const eic = (job.staff.find((s) => s.role === 'editor-in-chief') ?? job.staff[0]).id
        const writers = job.staff.filter((s) => s.id !== eic).map((s) => s.id)
        ;[eic, writers[0], writers[1] ?? writers[0]].forEach((speaker, seq) =>
          loop.turnFinished({ job_id: job.job_id, stage: 'turn', detail: { seq, speaker, chars: [...texts[seq]].length, meeting: job.meeting } }),
        )
        return JSON.stringify([{ MeetingOutcome: { job_id: job.job_id, briefs: [] } }])
      },
    }
    const codec = {
      jobsFromEffects: (e: string) => (JSON.parse(e) as Record<string, unknown>[]).map((j) => JSON.stringify({ ...j, company_id: 'co' })),
      outcomesForSim: (o: string) => (JSON.parse(o) as unknown[]).map((x) => JSON.stringify(x)),
    }
    loop = new OrchestrationLoop({ sim: view, store, companyId: 'co', orchestrator, codec, jobTimeoutMs: 0 })

    // The clock: a boundary per 100 ms slice, then a step unless the loop holds it.
    let outcomeAt = -1
    for (let slice = 0; slice < 20_000 && outcomeAt < 0; slice++) {
      loop.boundary()
      if (!loop.holdClock) {
        sim.advance(1)
        loop.afterAdvance()
      }
      await vi.advanceTimersByTimeAsync(100)
      outcomeAt = seen.findIndex((s) => s.kind === 'MeetingOutcome')
    }
    expect(ran).not.toBeNull()
    expect(ran!.meeting).toMatch(/^meeting-\d+$/)
    // The default context: the wall-clock date and the sim's work in progress.
    expect(ran!.context).toMatchObject({ today: '1970-01-01', in_flight: [] })
    const said = seen.filter((s) => s.kind === 'Utterance')
    expect(said.map((s) => JSON.parse(s.json).Utterance.seq)).toEqual([0, 1, 2])
    expect(said.every((s) => s.active)).toBe(true)
    expect(seen.slice(outcomeAt).map((s) => s.kind)).toEqual(['MeetingOutcome'])
    // One turn per utteranceMs of wall time; the outcome after the last one's.
    for (let i = 1; i < said.length; i++) {
      expect(said[i].at - said[i - 1].at).toBeGreaterThanOrEqual(utteranceMs([...texts[i - 1]].length))
    }
    expect(seen[outcomeAt].at - said[2].at).toBeGreaterThanOrEqual(utteranceMs([...texts[2]].length))
    // Logged like any outcome, in the same order.
    await loop.flush()
    expect(store.log.map((c) => c.kind)).toEqual(['Utterance', 'Utterance', 'Utterance', 'MeetingOutcome'])
    expect(JSON.parse(commandText(store.log[1].payload)).Utterance.chars).toBe([...texts[1]].length)
    // Each utterance maps back to its transcript row for the bubble's words.
    expect(loop.spokenAt(ran!.meeting, 1)).toEqual({ job: ran!.job_id, seq: 1 })
    sim.free()
  }, 60_000)

  it('skips a turn the sim rejects (a speaker who is not in the meeting) without failing the loop', async () => {
    vi.useFakeTimers({ now: 0 })
    const sim = wasm.Sim.demo(7n)
    const store = new MemStore()
    const errors: string[] = []
    let loop: OrchestrationLoop
    const orchestrator = {
      run: async (jobJson: string) => {
        const job = JSON.parse(jobJson) as { job_id: number; meeting: string; staff: { id: string; role: string }[] }
        const eic = (job.staff.find((s) => s.role === 'editor-in-chief') ?? job.staff[0]).id
        loop.turnFinished({ job_id: job.job_id, stage: 'turn', detail: { seq: 0, speaker: 'staff-999', chars: 40, meeting: job.meeting } })
        loop.turnFinished({ job_id: job.job_id, stage: 'turn', detail: { seq: 1, speaker: eic, chars: 40, meeting: job.meeting } })
        return JSON.stringify([{ MeetingOutcome: { job_id: job.job_id, briefs: [] } }])
      },
    }
    const codec = {
      jobsFromEffects: (e: string) => (JSON.parse(e) as Record<string, unknown>[]).map((j) => JSON.stringify({ ...j, company_id: 'co' })),
      outcomesForSim: (o: string) => (JSON.parse(o) as unknown[]).map((x) => JSON.stringify(x)),
    }
    loop = new OrchestrationLoop({ sim: sim as unknown as LoopSim, store, companyId: 'co', orchestrator, codec, jobTimeoutMs: 0, onError: (m) => errors.push(m) })
    for (let slice = 0; slice < 20_000 && !store.log.some((c) => c.kind === 'MeetingOutcome'); slice++) {
      loop.boundary()
      if (!loop.holdClock) {
        sim.advance(1)
        loop.afterAdvance()
      }
      await vi.advanceTimersByTimeAsync(100)
    }
    await loop.flush()
    expect(store.log.map((c) => c.kind)).toEqual(['Utterance', 'MeetingOutcome'])
    // The sim numbers its own turns: the one it accepted is its seq 0.
    expect(JSON.parse(commandText(store.log[0].payload)).Utterance.seq).toBe(0)
    expect(errors).toEqual([])
    expect(loop.halted).toBeNull()
    sim.free()
  }, 60_000)
})
