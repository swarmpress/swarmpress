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

const COMMANDS = [...ALL_COMMANDS, 'PlaceRoom', 'Demolish', 'PlaceEquipment', 'MoveEquipment', 'PlaceObject', 'MoveObject', 'RemoveObject'] as CommandName[]

const cube: DesignJson = {
  format: 'swarmpress.design.v1',
  id: 'cube-1',
  name: 'Red cube',
  footprint: [8, 8],
  height: 6,
  ops: [{ op: 'box', at: [0, 0, 0], size: [8, 8, 6], part: 'brick', colour: 'red' }],
  provenance: { kind: 'player', player: 'local' },
}
/** A design that hangs on a wall: kept, but not placeable on the floor. */
const shelf: DesignJson = { ...cube, id: 'shelf-1', name: 'Wall shelf', mount: 'surface', ops: [{ op: 'box', at: [0, 0, 0], size: [8, 2, 3], part: 'brick', colour: 'blue' }], footprint: [8, 2], height: 3 }

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

async function open(layout: (hash: string) => BuildLayout, opts: { designs?: boolean } = {}) {
  const designs = opts.designs === false ? null : memoryDesignStore(async (j) => acceptedHash(kit, j), null)
  const { hash } = designs ? await designs.save(cube) : { hash: '' }
  if (designs) await designs.save(shelf)
  const source = sourceWithDesigns(designs)
  const s = source as unknown as Record<string, unknown>
  s.getLayout = async () => structuredClone(layout(hash))
  s.price = async (json: string) => {
    const c = JSON.parse(json) as { PlaceObject?: { summary: { cost: number } } }
    return c.PlaceObject ? c.PlaceObject.summary.cost : null
  }
  s.validate = async () => ({ ok: true })
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
  return { panel, run, mb, hash, store: handle.store }
}

const sent = (run: { mock: { calls: unknown[][] } }) => run.mock.calls.map((c) => c[0])

describe.skipIf(!built)('my designs in the Furniture tab', () => {
  it('shows the company’s placeable designs as brick tiles with parts and the sim price', async () => {
    const { panel } = await open(() => layoutWith([]))
    const mine = within(panel).getByRole('region', { name: 'My designs' })
    const tiles = within(mine).getAllByRole('button')
    expect(tiles).toHaveLength(1)
    const facts = compileDesign(kit, cube)
    expect(tiles[0].textContent).toContain('Red cube')
    expect(tiles[0].textContent).toContain(`${facts.summary!.parts} parts`)
    expect(tiles[0].textContent).toContain(`€${(facts.summary!.cost / 100).toLocaleString('en', { maximumFractionDigits: facts.summary!.cost % 100 ? 2 : 0 })}`)
    expect(tiles[0].querySelector('svg.st-brick-icon')).toBeTruthy()
    // The wall shelf is kept but not placeable on the floor.
    expect(within(mine).getByText(/not placeable/)).toBeTruthy()
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
      `{"PlaceObject":{"design":"${hash}","pos":{"x":4000,"z":3000},"rot":1,"summary":{"footprint":[8,8],"height":6,"mount":"Floor","seats":${summary.seats},"workstation":${summary.workstation},"lights":${summary.lights},"storage":${summary.storage},"screens":${summary.screens},"parts":${summary.parts},"cost":${summary.cost}}}}`,
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
