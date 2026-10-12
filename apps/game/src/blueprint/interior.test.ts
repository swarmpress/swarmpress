import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { officeFix, officeLayout, standupAnswer } from '../llm/mvp-script'
import { briefProblem, commissionInterior, commissionInteriorCommand, interiorBrief, roomPlanOfArtifact, type InteriorBrief } from './interior'

/**
 * The office designer's host side (FEAT-084, ADR-0087 decision 6): the CEO's
 * words and brief as a store record and its ref in `CommissionInterior`; the
 * room plan read back from the artifact record; the fake designer, the twin
 * of `agents::build::fake`. With `crates/client-wasm/pkg` the command and the
 * job's context come from the real sim.
 */
const BRIEF: InteriorBrief = { workstations: 0, meeting_seats: 8, storage: 0, writing_surfaces: 1, coffee: 0, plants: 1, max_cost_cents: 500_000 }

describe('commissioning a room', () => {
  it('stores the words and the brief, then logs the command with the ref', async () => {
    const putBrief = vi.fn(async () => undefined)
    const apply = vi.fn(() => ({ ok: true }))
    const r = await commissionInterior({ validate: () => undefined, apply, putBrief }, { room: 'room-6', words: '  A plant, please. ', brief: BRIEF }, 12)
    expect(r).toEqual({ ok: true })
    expect(putBrief).toHaveBeenCalledWith('12', JSON.stringify({ words: 'A plant, please.', brief: BRIEF }))
    expect(apply).toHaveBeenCalledWith('{"CommissionInterior":{"room":"room-6","brief_ref":12}}')
    expect(commissionInteriorCommand('room-6', 12)).toBe('{"CommissionInterior":{"room":"room-6","brief_ref":12}}')
    expect(interiorBrief('x', BRIEF)).toEqual({ words: 'x', brief: BRIEF })
  })

  it('refuses before storing anything: a bad brief, or a command the sim refuses', async () => {
    const putBrief = vi.fn(async () => undefined)
    const apply = vi.fn(() => ({ ok: true }))
    expect(briefProblem({ ...BRIEF, plants: -1 })).toMatch(/plants/)
    expect(briefProblem({ ...BRIEF, max_cost_cents: 0 })).toMatch(/budget/)
    expect(await commissionInterior({ validate: () => undefined, apply, putBrief }, { room: 'room-6', words: '', brief: { ...BRIEF, plants: 1.5 } })).toMatchObject({ ok: false })
    expect(await commissionInterior({ validate: () => 'unknown room-99', apply, putBrief }, { room: 'room-99', words: '', brief: BRIEF })).toEqual({ ok: false, reason: 'unknown room-99' })
    expect(putBrief).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    // No budget: the field is left out (the designer's brief has no null).
    const { max_cost_cents: _, ...free } = BRIEF
    await commissionInterior({ validate: () => undefined, apply, putBrief }, { room: 'room-6', words: 'x', brief: free }, 3)
    expect(JSON.parse((putBrief.mock.calls as unknown as string[][])[0][1]).brief).toEqual(free)
    // A null budget is no budget either.
    await commissionInterior({ validate: () => undefined, apply, putBrief }, { room: 'room-6', words: 'x', brief: { ...BRIEF, max_cost_cents: null } }, 4)
    expect(JSON.parse((putBrief.mock.calls as unknown as string[][])[1][1]).brief).toEqual(free)
  })
})

describe('the room plan of an artifact record', () => {
  it('reads RoomPlan, and nothing else', () => {
    const plan = roomPlanOfArtifact({
      brief_ref: 12,
      room_plan: {
        kind: 'room-plan',
        room: 'room-6',
        items: [
          { design: 'desk', x_mm: 31500, z_mm: 9250, rot: 1, on_desk: null },
          { design: 'monitor', x_mm: 0, z_mm: 0, rot: 0, on_desk: { planned: 0 } },
          { design: 'desk-lamp', x_mm: 0, z_mm: 0, rot: 0, on_desk: { existing: 'equip-3' } },
        ],
        cost_cents: 76000,
        parts: 456,
        summary: 'Newsroom (room-6): 1 desk, 1 monitor, 1 desk-lamp; €760.00, 456 parts.',
        issues: [{ id: 'I1', code: 'unreachable', severity: 'warning', message: 'seat 1 of the table already cannot be reached' }, 'not an issue'],
        repairs: 1,
      },
    })
    expect(plan?.items.map((i) => i.on_desk)).toEqual([null, { planned: 0 }, { existing: 'equip-3' }])
    expect(plan).toMatchObject({ room: 'room-6', cost_cents: 76000, parts: 456, repairs: 1 })
    expect(plan?.issues).toEqual([{ id: 'I1', code: 'unreachable', severity: 'warning', message: 'seat 1 of the table already cannot be reached' }])
    expect(roomPlanOfArtifact({ page: {} })).toBeNull()
    expect(roomPlanOfArtifact(null)).toBeNull()
    expect(roomPlanOfArtifact({ room_plan: { kind: 'other', room: 'room-1', items: [] } })).toBeNull()
  })
})

/** The prompt of `agents::build::fake`'s unit test: the twins answer it alike. */
const ROOM =
  '## Task: office layout\n\nThe brief (counts include what the room already has):\n- workstations: 3\n- meeting seats: 0\n- storage: 0\n- writing surfaces: 0\n- coffee: 0\n- plants: 1\n- budget: none given\n\nThe room:\nNewsroom, 6 m × 6 m.\n- wall:north is 6 m long: door:0 from 1 m to 2 m from the west end (keep 1 m in front clear).\n- wall:east is 6 m long: window:0 from 1 m to 5 m from the north end.\n- wall:south is 6 m long.\n- wall:west is 6 m long.\n- equipment:equip-74: ceiling-light at 3 m from the west wall, 3 m from the north wall, facing south.'

describe('the fake office designer (the twin of agents::build::fake)', () => {
  it('plans from the brief and the room, and fixes by moving to the next wall', () => {
    expect(officeLayout(ROOM)).toEqual({
      placements: [
        { design: 'desk', anchor: 'window:0', count: 3, spacing: 4 },
        { design: 'monitor', anchor: 'placement:0' },
        { design: 'plant', anchor: 'wall:south', from: 'wall:west' },
      ],
    })
    expect(officeFix('x\nPlacements to fix (change only these):\n2: {"design":"plant","anchor":"wall:south","from":"wall:west"}\n\nAnswer')).toEqual({
      replace: [{ index: 2, placement: { design: 'plant', anchor: 'wall:west' } }],
    })
    expect(standupAnswer(ROOM)).toEqual({ json: officeLayout(ROOM) })
    // the CEO's own workstation counts: two desks for three (as the Rust twin)
    const own = `${ROOM}\n- equipment:object-1: the CEO's own design, 1.5 m (west to east) × 0.75 m (north to south), at 1 m from the west wall, 1.5 m from the north wall; a workstation, its seat at 1 m from the west wall, 2.25 m from the north wall (keep 0.5 m around the seat free). Keep off it.`
    expect(officeLayout(own).placements[0]).toEqual({ design: 'desk', anchor: 'window:0', count: 2, spacing: 4 })
    expect(standupAnswer('## Task: office layout fix\nPlacements to fix (change only these):\n0: {"design":"monitor","anchor":"placement:1"}')).toEqual({
      json: { replace: [{ index: 0, placement: { design: 'monitor', anchor: 'placement:1' } }] },
    })
  })
})

const PKG = resolve(__dirname, '../../../../crates/client-wasm/pkg/')
const built = existsSync(`${PKG}/client_wasm_bg.wasm`)

interface WasmSim {
  validate_command_json(json: string): string | undefined
  apply_command_json(json: string): void
  plan_json(project?: string | null): string
  inbox_json(): string
  interior_context_json(item: string): string | undefined
  drain_effects_json(): string
}
let wasm: { initSync(o: { module: Buffer }): void; Sim: { scenario(name: string, seed: bigint): WasmSim } }

describe.skipIf(!built)('with the real sim', () => {
  beforeAll(async () => {
    wasm = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}/client_wasm.js`).href)) as typeof wasm
    wasm.initSync({ module: readFileSync(`${PKG}/client_wasm_bg.wasm`) })
  })

  it('commissions a room: the item, the designer job and its context', async () => {
    const sim = wasm.Sim.scenario('designer', 42n)
    sim.drain_effects_json()
    const stored: string[] = []
    const r = await commissionInterior(
      {
        validate: (json) => sim.validate_command_json(json),
        apply: (json) => {
          sim.apply_command_json(json)
          return { ok: true }
        },
        putBrief: async (_, record) => void stored.push(record),
      },
      { room: 'room-6', words: 'A plant for the meeting room.', brief: BRIEF },
      12,
    )
    expect(r).toEqual({ ok: true })
    expect(stored).toHaveLength(1)
    const effects = JSON.parse(sim.drain_effects_json()) as { kind: string; work_item: string; staff: { persona: string; role: string }[] }[]
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({ kind: 'interior-design', staff: [{ persona: 'ottavia', role: 'office-designer' }] })
    const item = (JSON.parse(sim.plan_json()) as { items: { id: string; kind: string; interior: unknown }[] }).items.find((i) => i.kind === 'interior')!
    expect(item.id).toBe(effects[0].work_item)
    expect(item.interior).toMatchObject({ room: 'room-6', items: 0, placed: 0, costCents: 0, refused: null })
    const ctx = JSON.parse(sim.interior_context_json(item.id)!) as { room_id: string; room: { kind: string; doors: unknown[]; equipment: { design: string }[]; objects: unknown[] } }
    expect(ctx.room_id).toBe('room-6')
    expect(ctx.room.kind).toBe('meeting-room')
    expect(ctx.room.equipment.some((e) => e.design === 'whiteboard')).toBe(true)
    // the players' own designs in the room (ADR-0088): none here
    expect(ctx.room.objects).toEqual([])
    expect(sim.interior_context_json('work-item-999')).toBeUndefined()
    // The room is being designed: a second request is refused.
    expect(sim.validate_command_json(commissionInteriorCommand('room-6', 13))).toMatch(/design in progress/)
  })
})
