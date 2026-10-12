// @vitest-environment jsdom
// Placing the player's own designs (K-4, ADR-0065 §4; ADR-0087 decision 7) on the real kit
// (crates/kit-wasm/pkg; skipped without it): the Furniture tab's "My designs" tiles come from the
// company's designs (brick icon, name, parts, the sim's price); placing one shows its own ghost and
// sends `PlaceObject` with the design's hash and the kit's compiled summary; placed objects are
// listed, picked in the scene, turned, moved and removed by `MoveObject` / `RemoveObject`. The
// design editor's library saves with the company when the source keeps designs. No axe violations.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fireEvent, render, screen, within } from '@testing-library/preact'
import axe from 'axe-core'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildBridge, type BuildBridge } from '../../build-bridge'
import { ALL_COMMANDS, type CommandName } from '../commands'
import type { DataTopic } from '../data-source'
import { MockDataSource } from '../mock-source'
import { mountOverlay } from '../mount'
import { StoreContext, type OverlayStore } from '../store'
import { flush } from '../testing'
import { acceptedHash, memoryDesignStore, type DesignStore } from './company-designs'
import { compileDesign, setDesignKit, type EditorKit } from './design-kit'
import type { DesignJson } from './design-model'
import { DesignEditor } from './DesignEditor'
import { objectSummary, type BuildLayout } from './types'
import { hangY } from '../../render/bricks/objects'
import type { ObjectSummary } from '../../state/render-state'
/** A floor design's summary for a footprint in metres (16 studs a metre). */
const summaryOf = (w: number, d: number): ObjectSummary => ({ footprint: [w * 16, d * 16], height: 3, mount: 'Floor', seats: 0, workstation: false, lights: 0, storage: 0, screens: 0, parts: 1, cost: 100 })

const PKG = resolve(process.cwd(), '../../crates/kit-wasm/pkg') + '/'
const built = existsSync(`${PKG}kit_wasm.js`)
let kit: EditorKit
beforeAll(async () => {
  if (!built) return
  const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}kit_wasm.js`).href)) as EditorKit & { initSync(m: { module: BufferSource }): unknown }
  mod.initSync({ module: readFileSync(`${PKG}kit_wasm_bg.wasm`) })
  kit = mod
  setDesignKit(mod)
})
afterAll(() => setDesignKit(null))

const COMMANDS = [...ALL_COMMANDS, 'PlaceRoom', 'Demolish', 'PlaceEquipment', 'MoveEquipment', 'PlaceObject', 'PlaceObjectOnDesk', 'MoveObject', 'RemoveObject'] as CommandName[]

const cube: DesignJson = {
  format: 'swarmpress.design.v1',
  id: 'cube-1',
  name: 'Red cube',
  footprint: [8, 8],
  height: 6,
  ops: [{ op: 'box', at: [0, 0, 0], size: [8, 8, 6], part: 'brick', colour: 'red' }],
  provenance: { kind: 'player', player: 'local' },
}
/** A design that stands on a desk (ADR-0088): a tile too, placed on a desk's lamp slot (it has no screen). */
const shelf: DesignJson = { ...cube, id: 'shelf-1', name: 'Desk shelf', mount: 'surface', ops: [{ op: 'box', at: [0, 0, 0], size: [8, 2, 3], part: 'brick', colour: 'blue' }], footprint: [8, 2], height: 3 }
/** A design that hangs from the ceiling (ADR-0090): a tile too, placed over the floor with its top at the ceiling. */
const pendant: DesignJson = { ...cube, id: 'pendant-1', name: 'Pendant', mount: 'ceiling', ops: [{ op: 'box', at: [0, 0, 0], size: [2, 2, 3], part: 'brick', colour: 'yellow' }], footprint: [2, 2], height: 3 }

function layoutWith(objects: BuildLayout['objects']): BuildLayout {
  return {
    originX: 0,
    originZ: 0,
    width: 16,
    depth: 10,
    wallHeight: 3,
    floors: 1,
    entrance: { side: 'south', x: 4.5, z: 10, spawn: [4.5, 12.5] },
    buildMode: 'economic',
    rooms: [
      { id: 'room-1', kind: 'newsroom', label: 'Newsroom', x: 0, z: 0, w: 10, d: 10, floor: 0, level: 1, capacity: 16, windows: [], doors: [], desks: [], ceilingLights: [], props: [] },
    ],
    objects,
  } as BuildLayout
}

function mockBridge() {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  let at: ReturnType<BuildBridge['pick']> = null
  const bridge = { pick: vi.fn(() => at), ghost: vi.fn(), ghostRect: vi.fn(), ghostPlan: vi.fn(), highlight: vi.fn(), setCapture: vi.fn(), focus: vi.fn(), canvas: () => canvas }
  return {
    bridge,
    canvas,
    async hover(p: ReturnType<BuildBridge['pick']>) {
      at = p
      canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }))
      await settle()
    },
    async click(p: ReturnType<BuildBridge['pick']>) {
      at = p
      canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
      canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 11, clientY: 10 }))
      await settle()
    },
  }
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await flush()
}

/** A mock source that keeps designs like a company (the memory store on the real kit's hash). */
function sourceWithDesigns(designs: DesignStore | null) {
  const source = new MockDataSource({ commands: COMMANDS })
  if (designs) {
    const s = source as unknown as Record<string, unknown>
    s.saveDesign = (d: object) => designs.save(d)
    s.designOf = (h: string) => designs.get(h)
    s.listDesigns = () => designs.list()
    s.retireDesign = (h: string) => designs.retire(h)
    s.designsWhere = () => 'company'
    const subscribe = source.subscribe.bind(source)
    source.subscribe = (fn: (t?: DataTopic[]) => void) => {
      const a = subscribe(fn)
      const b = designs.subscribe(() => fn(['designs']))
      return () => {
        a()
        b()
        return undefined
      }
    }
  }
  return source
}

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
  buildBridge.value = null
  localStorage.clear()
})

async function open(layout: (hash: string) => BuildLayout, opts: { designs?: boolean; extra?: DesignJson[]; validate?: (json: string) => { ok: boolean; reason?: string } } = {}) {
  const designs = opts.designs === false ? null : memoryDesignStore(async (j) => acceptedHash(kit, j), null)
  const { hash } = designs ? await designs.save(cube) : { hash: '' }
  if (designs) await designs.save(shelf)
  if (designs) await designs.save(pendant)
  const extra: string[] = []
  for (const d of opts.extra ?? []) if (designs) extra.push((await designs.save(d)).hash)
  const source = sourceWithDesigns(designs)
  const s = source as unknown as Record<string, unknown>
  s.getLayout = async () => structuredClone(layout(hash))
  s.price = async (json: string) => {
    const c = JSON.parse(json) as { PlaceObject?: { summary: { cost: number } } }
    return c.PlaceObject ? c.PlaceObject.summary.cost : null
  }
  s.validate = async (json: string) => opts.validate?.(json) ?? { ok: true }
  s.apply = async () => ({ ok: true })
  const mb = mockBridge()
  buildBridge.value = mb.bridge
  const el = document.createElement('div')
  document.body.appendChild(el)
  const handle = mountOverlay(el, source)
  cleanup = () => {
    handle.dispose()
    el.remove()
    mb.canvas.remove()
  }
  await handle.store.refresh()
  await flush()
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: /^Build/ }))
  await flush()
  const panel = screen.getByRole('region', { name: 'Build' })
  fireEvent.click(within(panel).getByRole('tab', { name: 'Furniture' }))
  await settle()
  const run = vi.spyOn(handle.store, 'run')
  return { panel, run, mb, hash, extra, store: handle.store }
}

const sent = (run: { mock: { calls: unknown[][] } }) => run.mock.calls.map((c) => c[0])

describe.skipIf(!built)('my designs in the Furniture tab', () => {
  it('shows the company’s placeable designs as brick tiles with parts and the sim price', async () => {
    const { panel } = await open(() => layoutWith([]))
    const mine = within(panel).getByRole('region', { name: 'My designs' })
    const all = within(mine).getAllByRole('button')
    // The cube on the floor, the shelf on a desk, the pendant on the ceiling (ADR-0090).
    expect(all).toHaveLength(3)
    const shelfTile = all.find((t) => t.textContent!.includes('Desk shelf'))!
    expect(shelfTile.textContent).toContain('On a desk')
    const pendantTile = all.find((t) => t.textContent!.includes('Pendant'))!
    expect(pendantTile.textContent).toContain('On the ceiling')
    expect(pendantTile.textContent).toContain('Hangs from the ceiling')
    const tiles = all.filter((t) => t !== shelfTile && t !== pendantTile)
    const facts = compileDesign(kit, cube)
    expect(tiles[0].textContent).toContain('Red cube')
    expect(tiles[0].textContent).toContain(`${facts.summary!.parts} parts`)
    expect(tiles[0].textContent).toContain(`€${(facts.summary!.cost / 100).toLocaleString('en', { maximumFractionDigits: facts.summary!.cost % 100 ? 2 : 0 })}`)
    expect(tiles[0].querySelector('svg.st-brick-icon')).toBeTruthy()
    expect(await audit(panel)).toEqual([])
  })

  it('places a design: its own ghost follows the pointer, a click sends PlaceObject with the hash and the compiled summary', async () => {
    const { panel, run, mb, hash } = await open(() => layoutWith([]))
    fireEvent.click(within(within(panel).getByRole('region', { name: 'My designs' })).getByRole('button', { name: /^Red cube/ }))
    await settle()
    await mb.hover({ x: 4.03, z: 3.01, room: 'room-1', target: null })
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith({ kind: `design:${hash}`, family: 'equipment', x: 4.03, z: 3.01, rot: 0, ok: true, design: JSON.stringify(cube) })
    fireEvent.keyDown(mb.canvas, { key: 'r' })
    await settle()
    await mb.click({ x: 4.03, z: 3.01, room: 'room-1', target: null })
    const summary = compileDesign(kit, cube).summary!
    expect(sent(run)).toEqual([
      {
        PlaceObject: {
          design: hash,
          pos: { x: 4000, z: 3000 },
          rot: 1,
          summary: {
            footprint: summary.footprint,
            height: summary.height,
            mount: 'Floor',
            seats: summary.seats,
            workstation: summary.workstation,
            seat_at: null,
            lights: summary.lights,
            storage: summary.storage,
            screens: summary.screens,
            parts: summary.parts,
            cost: summary.cost,
          },
        },
      },
    ])
    expect(objectSummary(summary).mount).toBe('Floor')
    // The command's JSON as the sim reads it.
    expect(JSON.stringify(sent(run)[0])).toBe(
      `{"PlaceObject":{"design":"${hash}","pos":{"x":4000,"z":3000},"rot":1,"summary":{"footprint":[8,8],"height":6,"mount":"Floor","seats":${summary.seats},"workstation":${summary.workstation},"seat_at":null,"lights":${summary.lights},"storage":${summary.storage},"screens":${summary.screens},"parts":${summary.parts},"cost":${summary.cost}}}}`,
    )
  })

  it('lists placed objects by their design; selects one in the scene, turns, removes and moves it', async () => {
    const { panel, run, mb, hash } = await open((h) =>
      layoutWith([{ id: 'object-1', design: h, room: 'room-1', x: 3, z: 4, rot: 0, footprint: [0.5, 0.5], summary: objectSummary(compileDesign(kit, cube).summary!) }]),
    )
    expect(within(panel).getByRole('button', { name: /^Red cube object-1/ })).toBeTruthy()
    await mb.click({ x: 3, z: 4, room: 'room-1', target: { kind: 'object', id: 'object-1' } })
    expect(mb.bridge.highlight).toHaveBeenLastCalledWith({ kind: 'object', id: 'object-1' })
    const sel = within(panel).getByRole('region', { name: /Selected: Red cube/ })
    fireEvent.click(within(sel).getByRole('button', { name: 'Turn' }))
    await settle()
    fireEvent.click(within(sel).getByRole('button', { name: 'Remove' }))
    await settle()
    fireEvent.click(within(panel).getByRole('button', { name: /^Red cube object-1/ }))
    await flush()
    fireEvent.click(within(panel).getByRole('button', { name: 'Move' }))
    await settle()
    // Its own design is the ghost while it moves.
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.objectContaining({ kind: `design:${hash}`, design: JSON.stringify(cube) }))
    await mb.click({ x: 6.24, z: 7.06, room: 'room-1', target: null })
    expect(sent(run)).toEqual([
      { MoveObject: { object: 'object-1', pos: { x: 3000, z: 4000 }, rot: 1 } },
      { RemoveObject: { object: 'object-1' } },
      { MoveObject: { object: 'object-1', pos: { x: 6250, z: 7000 }, rot: 0 } },
    ])
    expect(await audit(panel)).toEqual([])
  })

  it('names an object whose design the company does not have, and still moves and removes it', async () => {
    const { panel, run } = await open(() => layoutWith([{ id: 'object-2', design: 'e'.repeat(64), room: 'room-1', x: 2, z: 2, rot: 0, footprint: [0.5, 0.5], summary: summaryOf(0.5, 0.5) }]))
    fireEvent.click(within(panel).getByRole('button', { name: /^A design the company does not have object-2/ }))
    await settle()
    fireEvent.click(within(within(panel).getByRole('region', { name: /^Selected/ })).getByRole('button', { name: 'Remove' }))
    await settle()
    expect(sent(run)).toEqual([{ RemoveObject: { object: 'object-2' } }])
  })

  it('offers no designs of its own when the source keeps none', async () => {
    const { panel } = await open(() => layoutWith([]), { designs: false })
    expect(within(panel).queryByRole('region', { name: 'My designs' })).toBeNull()
  })
})

/** A tablet: a surface design with a screen, so it takes a desk's screen slot. */
const tablet: DesignJson = {
  ...cube,
  id: 'tablet-1',
  name: 'Tablet',
  mount: 'surface',
  footprint: [4, 2],
  height: 6,
  ops: [
    { op: 'box', at: [0, 0, 0], size: [4, 2, 1], part: 'plate', colour: 'grey-dark' },
    { op: 'part', part: 'screen-2x2', at: [1, 0, 1], colour: 'screen-blue' },
  ],
}
/** A workstation of the player's (ADR-0088): a desk-high top, a screen, a seat port 0.75 m south of its centre. */
const myDesk: DesignJson = {
  ...cube,
  id: 'my-desk',
  name: 'My desk',
  footprint: [16, 12],
  height: 40,
  ops: [
    { op: 'box', at: [0, 0, 0], size: [16, 12, 29], part: 'brick', colour: 'sand' },
    { op: 'box', at: [0, 0, 29], size: [16, 12, 1], part: 'plate', colour: 'sand' },
    { op: 'part', part: 'screen-2x2', at: [7, 2, 30], colour: 'screen-blue', surface: 'monitor' },
  ],
  ports: [{ id: 'seat', at: [8, 18, 0], accepts: ['seat'] }],
} as DesignJson

/** The newsroom with two desks (and, for the totals, what its objects provide). */
function deskLayout(objects: BuildLayout['objects'], caps?: { seats: number; workstations: number; lights: number; storage: number; screens: number }): BuildLayout {
  const l = layoutWith(objects)
  l.rooms[0].desks = [
    { id: 'equip-3', x: 3, z: 3, rot: 0, seat: [3, 3.6] },
    { id: 'equip-4', x: 6, z: 3, rot: 0, seat: [6, 3.6] },
  ]
  if (caps) l.rooms[0].objectCapabilities = caps
  return l
}

describe.skipIf(!built)('desk-top designs and workstations (ADR-0088)', () => {
  it('places a surface design on a desk: the ghost at the desk’s lamp slot, PlaceObjectOnDesk with the compiled summary', async () => {
    const { panel, run, mb, store } = await open(() => deskLayout([]))
    const shelfHash = store.designs()!.find((d) => d.design.id === 'shelf-1')!.hash
    fireEvent.click(within(within(panel).getByRole('region', { name: 'My designs' })).getByRole('button', { name: /^Desk shelf/ }))
    await settle()
    // It starts on the room's first desk; no Turn on a desk.
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.objectContaining({ kind: `design:${shelfHash}`, design: JSON.stringify(shelf), onDesk: { desk: 'equip-3', slot: 'lamp' } }))
    const gesture = within(panel).getByRole('region', { name: 'Pending action' })
    expect(within(gesture).queryByRole('button', { name: /Turn/ })).toBeNull()
    // Pointing at the floor is no place for it; pointing at a desk is.
    await mb.hover({ x: 8, z: 8, room: 'room-1', target: { kind: 'room', id: 'room-1' } })
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.not.objectContaining({ onDesk: expect.anything() }))
    expect(within(gesture).getByRole('button', { name: 'Place here' }).hasAttribute('disabled')).toBe(true)
    await mb.click({ x: 6, z: 3, room: 'room-1', target: { kind: 'equipment', id: 'equip-4' } })
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.objectContaining({ onDesk: { desk: 'equip-4', slot: 'lamp' }, ok: true }))
    // Or chosen from the room's desks.
    fireEvent.change(within(gesture).getByRole('combobox', { name: 'On the desk' }), { target: { value: 'equip-3' } })
    await settle()
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.objectContaining({ onDesk: { desk: 'equip-3', slot: 'lamp' } }))
    fireEvent.click(within(gesture).getByRole('button', { name: 'Place here' }))
    await settle()
    const summary = compileDesign(kit, shelf).summary!
    expect(sent(run)).toHaveLength(2)
    expect(JSON.stringify(sent(run)[0])).toBe(
      `{"PlaceObjectOnDesk":{"design":"${shelfHash}","desk":"equip-4","summary":{"footprint":[8,2],"height":${summary.height},"mount":"Surface","seats":0,"workstation":false,"seat_at":null,"lights":0,"storage":0,"screens":0,"parts":${summary.parts},"cost":${summary.cost}}}}`,
    )
    expect(sent(run)[1]).toEqual({ PlaceObjectOnDesk: expect.objectContaining({ design: shelfHash, desk: 'equip-3' }) })
    expect(await audit(panel)).toEqual([])
  })

  it('stands a design with a screen at the desk’s screen slot, and shows the sim’s refusal when it is taken', async () => {
    const { panel, mb, extra } = await open(() => deskLayout([]), {
      extra: [tablet],
      validate: (json) => (json.includes('"desk":"equip-3"') ? { ok: false, reason: 'equip-3 has a screen already' } : { ok: true }),
    })
    expect(compileDesign(kit, tablet).ok).toBe(true)
    fireEvent.click(within(within(panel).getByRole('region', { name: 'My designs' })).getByRole('button', { name: /^Tablet/ }))
    await settle()
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.objectContaining({ kind: `design:${extra[0]}`, onDesk: { desk: 'equip-3', slot: 'screen' }, ok: false }))
    expect(within(panel).getByText(/refused, equip-3 has a screen already/)).toBeTruthy()
  })

  it('lists a desk-top object on its desk: no Move or Turn (it moves with its desk), Remove sends RemoveObject', async () => {
    const { panel, run } = await open((h) =>
      deskLayout([{ id: 'object-5', design: h, room: 'room-1', x: 3, z: 3, rot: 0, footprint: [0.5, 0.5], summary: { ...summaryOf(0.5, 0.5), mount: 'Surface' }, onDesk: { desk: 'equip-3', slot: 'lamp' } }]),
    )
    fireEvent.click(within(panel).getByRole('button', { name: /^Red cube object-5 · on equip-3/ }))
    await settle()
    const sel = within(panel).getByRole('region', { name: /Selected: Red cube/ })
    const move = within(sel).getByRole('button', { name: 'Move' })
    expect(move.hasAttribute('disabled')).toBe(true)
    expect(document.getElementById(move.getAttribute('aria-describedby')!)!.textContent).toBe('It moves with its desk: move the desk instead.')
    expect(within(sel).queryByRole('button', { name: 'Turn' })).toBeNull()
    fireEvent.click(within(sel).getByRole('button', { name: 'Remove' }))
    await settle()
    expect(sent(run)).toEqual([{ RemoveObject: { object: 'object-5' } }])
    expect(await audit(panel)).toEqual([])
  })

  it('says who calls a workstation object home, disables its Move and Remove with the sim’s reason, and totals the room', async () => {
    const reason = 'Ada works at object-6'
    const { panel, run } = await open(
      (h) => {
        const ws = { ...summaryOf(1, 0.75), workstation: true, screens: 1 }
        return deskLayout(
          [
            { id: 'object-6', design: h, room: 'room-1', x: 3, z: 6, rot: 0, footprint: [1, 0.75], summary: ws, seatAt: [0, 0.75], assignedTo: 'staff-1' },
            { id: 'object-7', design: h, room: 'room-1', x: 6, z: 6, rot: 0, footprint: [1, 0.75], summary: ws, seatAt: [0, 0.75], assignedTo: null },
          ],
          { seats: 0, workstations: 2, lights: 0, storage: 0, screens: 2 },
        )
      },
      { validate: (json) => (json.includes('object-6') ? { ok: false, reason } : { ok: true }) },
    )
    expect(within(panel).getByTestId('room-provides').textContent).toBe('Your designs here provide: 2 workstations (1 free) · 2 screens')
    expect(within(panel).getByRole('button', { name: /^Red cube object-7 · a free workstation/ })).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: /^Red cube object-6 · Giulia Rossi works here/ }))
    await settle()
    const sel = within(panel).getByRole('region', { name: /Selected: Red cube/ })
    expect(within(sel).getByText('A workstation: Giulia Rossi calls it home.')).toBeTruthy()
    const move = within(sel).getByRole('button', { name: 'Move' })
    expect(move.hasAttribute('disabled')).toBe(true)
    expect(document.getElementById(move.getAttribute('aria-describedby')!)!.textContent).toBe(reason)
    const remove = within(sel).getByRole('button', { name: 'Remove' })
    expect(remove.hasAttribute('disabled')).toBe(true)
    expect(document.getElementById(remove.getAttribute('aria-describedby')!)!.textContent).toBe(reason)
    fireEvent.click(remove)
    await settle()
    expect(sent(run)).toEqual([])
    expect(await audit(panel)).toEqual([])
  })
})

describe.skipIf(!built)('seats and ceiling designs of your own (ADR-0089, ADR-0090)', () => {
  it('hangs a ceiling design: its ghost’s top at the ceiling, PlaceObject with the Ceiling mount', async () => {
    const { panel, run, mb, store } = await open(() => layoutWith([]))
    const pendantHash = store.designs()!.find((d) => d.design.id === 'pendant-1')!.hash
    fireEvent.click(within(within(panel).getByRole('region', { name: 'My designs' })).getByRole('button', { name: /^Pendant/ }))
    await settle()
    await mb.hover({ x: 4.03, z: 3.01, room: 'room-1', target: null })
    const summary = compileDesign(kit, pendant).summary!
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.objectContaining({ kind: `design:${pendantHash}`, x: 4.03, z: 3.01, y: hangY(summary.height), ok: true }))
    await mb.click({ x: 4.03, z: 3.01, room: 'room-1', target: null })
    expect(sent(run)).toEqual([{ PlaceObject: expect.objectContaining({ design: pendantHash, pos: { x: 4000, z: 3000 }, summary: expect.objectContaining({ mount: 'Ceiling' }) }) }])
    expect(await audit(panel)).toEqual([])
  })

  it('says what a seat object and a ceiling design provide, in the list, the selection and the room’s totals', async () => {
    const { panel } = await open((h) => {
      const l = layoutWith([
        { id: 'object-8', design: h, room: 'room-1', x: 3, z: 6, rot: 0, footprint: [1.5, 0.5], summary: { ...summaryOf(1.5, 0.5), seats: 3 }, places: [[-0.5, 0], [0, 0], [0.5, 0]] },
        { id: 'object-9', design: h, room: 'room-1', x: 3, z: 6, rot: 0, footprint: [0.25, 0.25], summary: { ...summaryOf(0.25, 0.25), mount: 'Ceiling', lights: 1 } },
      ])
      l.rooms[0].objectCapabilities = { seats: 3, places: 3, workstations: 0, lights: 1, storage: 0, screens: 0 }
      return l
    })
    expect(within(panel).getByTestId('room-provides').textContent).toBe('Your designs here provide: seats 3 at meetings and breaks · 1 light')
    fireEvent.click(within(panel).getByRole('button', { name: /^Red cube object-8/ }))
    await settle()
    expect(within(panel).getByTestId('selected-provides').textContent).toBe('Seats 3 at meetings and breaks, in a meeting room or the kitchen.')
    fireEvent.click(within(panel).getByRole('button', { name: /^Red cube object-9 · on the ceiling/ }))
    await settle()
    expect(within(panel).getByTestId('selected-provides').textContent).toBe('Hangs from the ceiling · 1 light for the room.')
    expect(await audit(panel)).toEqual([])
  })
})

describe.skipIf(!built)('the design editor with the company’s designs', () => {
  it('says where designs live, saves with the company and lists them from it', async () => {
    const designs = memoryDesignStore(async (j) => acceptedHash(kit, j), null)
    const source = sourceWithDesigns(designs)
    const el = document.createElement('div')
    document.body.appendChild(el)
    const handle = mountOverlay(el, source)
    const store: OverlayStore = handle.store
    const view = render(
      <StoreContext.Provider value={store}>
        <DesignEditor />
      </StoreContext.Provider>,
    )
    cleanup = () => {
      view.unmount()
      handle.dispose()
      el.remove()
    }
    await settle()
    expect(screen.getByTestId('de-library-note').textContent).toMatch(/Kept with the company/)
    fireEvent.click(screen.getByRole('button', { name: 'Start empty' }))
    await settle()
    fireEvent.keyDown(screen.getByRole('application'), { key: 'Enter' })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }))
    await settle()
    const kept = designs.list()!
    expect(kept).toHaveLength(1)
    expect(kept[0].design.name).toBe('My design')
    expect(screen.getByText(/Saved My design with the company/)).toBeTruthy()
    const lib = screen.getByRole('region', { name: 'Your designs' })
    expect(within(lib).getByText('My design')).toBeTruthy()
    // Delete retires it from the company's library.
    fireEvent.click(within(lib).getByRole('button', { name: 'Delete My design' }))
    await settle()
    fireEvent.click(within(lib).getByRole('button', { name: /^Delete My design$/ }))
    await settle()
    expect(designs.list()).toEqual([])
    expect(designs.get(kept[0].hash)?.name).toBe('My design')
  })

  it('falls back to this browser when the source keeps no designs, and says so', async () => {
    const source = sourceWithDesigns(null)
    const el = document.createElement('div')
    document.body.appendChild(el)
    const handle = mountOverlay(el, source)
    const view = render(
      <StoreContext.Provider value={handle.store}>
        <DesignEditor />
      </StoreContext.Provider>,
    )
    cleanup = () => {
      view.unmount()
      handle.dispose()
      el.remove()
    }
    await settle()
    expect(screen.getByTestId('de-library-note').textContent).toMatch(/Kept in this browser only/)
  })
})

async function audit(root: Element) {
  const res = await axe.run(root, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] })
  return res.violations.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
}
