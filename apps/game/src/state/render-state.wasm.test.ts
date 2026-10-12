import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkLayout, checkRenderState, POSES } from './render-state-shape'
import type { BuildingLayout, RenderState } from './render-state'
import layoutFixture from './fixtures/demo-layout.json'
import standupFixture from './fixtures/demo-standup.json'
import workingFixture from './fixtures/demo-working.json'
import lunchFixture from './fixtures/demo-lunch.json'

/**
 * Drift test of the render-state contract (FEAT-023, FEAT-024): the JSON the
 * real wasm sim writes (`Sim.layout_json()`, `Sim.render_state_json()`) must
 * have exactly the fields `render-state.ts` declares, with known enum values.
 * Needs `cargo xtask wasm`; the live part is skipped without
 * crates/client-wasm/pkg. The committed fixtures (written from the same sim,
 * used by the renderer's NullEngine tests) are checked either way.
 */
const PKG = resolve(process.cwd(), '../../crates/client-wasm/pkg') + '/'
const built = existsSync(`${PKG}client_wasm.js`)

interface DriftSim {
  layout_json(): string
  render_state_json(): string
  advance(n: number): void
  steps_per_day(): bigint
  apply_command_json(json: string): void
  free(): void
}
type WasmModule = { initSync(m: { module: BufferSource }): unknown; Sim: { demo(seed: bigint): DriftSim } }

describe('committed sim fixtures', () => {
  it('match the contract', () => {
    expect(checkLayout(layoutFixture).problems).toEqual([])
    for (const s of [standupFixture, workingFixture, lunchFixture]) expect(checkRenderState(s).problems).toEqual([])
  })

  it('cover what the renderer draws: walks, a speaker, listeners, typing with a work item, kitchen seats', () => {
    const all = [standupFixture, workingFixture, lunchFixture] as unknown as RenderState[]
    const staff = all.flatMap((s) => s.staff)
    expect(new Set(staff.map((s) => s.pose))).toEqual(new Set(['walk', 'sit', 'type', 'talk', 'listen']))
    expect(staff.some((s) => s.pose === 'type' && s.workItem)).toBe(true)
    expect((standupFixture as unknown as RenderState).bubbles).toHaveLength(1)
    const layout = layoutFixture as unknown as BuildingLayout
    expect(layout.rooms.map((r) => r.kind)).toContain('finance-office')
    expect(layout.rooms.map((r) => r.kind)).toContain('strategy-room')
  })
})

describe.skipIf(!built)('render state from the wasm sim (drift)', () => {
  let wasm: WasmModule
  beforeAll(async () => {
    wasm = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}client_wasm.js`).href)) as WasmModule
    wasm.initSync({ module: readFileSync(`${PKG}client_wasm_bg.wasm`) })
  })

  it('layout_json has exactly the declared fields', () => {
    const sim = wasm.Sim.demo(42n)
    const layout = JSON.parse(sim.layout_json())
    expect(checkLayout(layout).problems).toEqual([])
    // the committed fixture has the same shape (regenerate it when the sim's layout changes)
    expect(Object.keys(layout).sort()).toEqual(Object.keys(layoutFixture).sort())
    sim.free()
  })

  it('layout_json lists placed objects and their rooms\' capabilities (ADR-0065 §4)', () => {
    const sim = wasm.Sim.demo(42n)
    const summary = { footprint: [24, 12], height: 34, mount: 'Floor', seats: 1, workstation: true, seat_at: [0, 750], lights: 1, storage: 0, screens: 1, parts: 204, cost: 3199 }
    sim.apply_command_json(JSON.stringify({ PlaceObject: { design: 'ab'.repeat(32), pos: { x: 1500, z: 13500 }, rot: 1, summary } }))
    // a desk-top design on Giulia's desk once its lamp is gone (ADR-0088)
    const mug = { footprint: [4, 4], height: 12, mount: 'Surface', seats: 0, workstation: false, seat_at: null, lights: 0, storage: 0, screens: 0, parts: 9, cost: 120 }
    sim.apply_command_json(JSON.stringify({ Demolish: { Equipment: 'equip-19' } }))
    sim.apply_command_json(JSON.stringify({ PlaceObjectOnDesk: { design: 'cd'.repeat(32), desk: 'equip-17', summary: mug } }))
    const layout = JSON.parse(sim.layout_json()) as BuildingLayout
    expect(checkLayout(layout).problems).toEqual([])
    expect(layout.objects).toEqual([
      { id: 'object-1', design: 'ab'.repeat(32), room: 'room-6', x: 1.5, z: 13.5, rot: Math.PI / 2, footprint: [1.5, 0.75], summary, seatAt: [0, 0.75], onDesk: null, assignedTo: null },
      { id: 'object-2', design: 'cd'.repeat(32), room: 'room-1', x: 1.5, z: 1.5, rot: 0, footprint: [0.25, 0.25], summary: mug, seatAt: null, onDesk: { desk: 'equip-17', slot: 'lamp' }, assignedTo: null },
    ])
    expect(layout.rooms.find((r) => r.id === 'room-6')?.objectCapabilities).toEqual({ seats: 1, workstations: 1, lights: 1, storage: 0, screens: 1 })
    sim.free()
  })

  it('render_state_json has exactly the declared fields through a whole day, a meeting turn and a job', () => {
    const sim = wasm.Sim.demo(42n)
    const seen = new Set<string>()
    const check = () => {
      const state = JSON.parse(sim.render_state_json()) as RenderState
      const problems = checkRenderState(state).problems
      if (problems.length) throw new Error(`step ${state.step}:\n${problems.slice(0, 20).join('\n')}`)
      for (const s of state.staff) seen.add(s.pose)
      return state
    }
    // 07:00 → 09:10: arrivals, then the standup sits.
    for (let i = 0; i < 1090; i += 10) {
      sim.advance(10)
      check()
    }
    let state = check()
    const meeting = state.meetings.find((m) => m.active)!
    const listener = state.staff.find((s) => s.pose === 'listen')!
    sim.apply_command_json(JSON.stringify({ Utterance: { meeting: meeting.id, seq: 0, speaker: listener.id, chars: 90 } }))
    state = check()
    expect(state.bubbles.map((b) => b.speaker)).toEqual([listener.id])
    expect(state.meetings.find((m) => m.id === meeting.id)!.speaker).toBe(listener.id)
    sim.apply_command_json(JSON.stringify({ MeetingOutcome: { job_id: meeting.job, briefs: [{ brief_ref: 7, writer: 'staff-1', editor: 'staff-5' }] } }))
    for (let i = 0; i < Number(sim.steps_per_day()) - 1200; i += 25) {
      sim.advance(25)
      state = check()
    }
    expect([...seen].every((p) => POSES.includes(p))).toBe(true)
    expect(seen).toEqual(new Set(['walk', 'sit', 'type', 'talk', 'listen', 'idle']))
    sim.free()
  })
})
