// @vitest-environment jsdom
// Build mode (FEAT-026, ADR-0087): the Build section opens its inspector; the catalogue shows the
// kit's equipment with the sim's prices; placing, moving, turning and removing send the sim's
// commands with the shapes of crates/sim-core/src/commands.rs; a refusal shows the sim's reason
// and disables the action; the town tab moves houses and places, moves and removes pieces.
import { fireEvent, screen, within } from '@testing-library/preact'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBridge, type BuildBridge } from '../../build-bridge'
import { ALL_COMMANDS, type CommandResult } from '../commands'
import { flush, setup } from '../testing'
import { rectOf } from './Rooms'
import { EQUIPMENT, type BuildLayout } from './types'

const BUILD_COMMANDS = ['PlaceRoom', 'Demolish', 'PlaceEquipment', 'MoveEquipment', 'PlaceTownItem', 'MoveTownItem', 'RemoveTownItem']

const LAYOUT: BuildLayout = {
  originX: 0,
  originZ: 0,
  width: 16,
  depth: 10,
  wallHeight: 3,
  floors: 1,
  entrance: { side: 'south', x: 4.5, z: 10, spawn: [4.5, 12.5] },
  buildMode: 'sandbox',
  rooms: [
    {
      id: 'room-1',
      kind: 'newsroom',
      label: 'Newsroom',
      x: 0,
      z: 0,
      w: 10,
      d: 10,
      floor: 0,
      level: 1,
      capacity: 16,
      windows: [],
      doors: [{ side: 'east', at: 2, width: 1 }],
      desks: [
        { id: 'equip-1', x: 2.5, z: 3, rot: 0, seat: [2.5, 3.75] },
        { id: 'equip-2', x: 5, z: 3, rot: 0, seat: [5, 3.75] },
      ],
      ceilingLights: [{ id: 'equip-3', x: 4, z: 3 }],
      props: [
        { id: 'equip-4', kind: 'monitor', x: 2.5, z: 3, rot: 0, attachedTo: 'equip-1' },
        { id: 'equip-5', kind: 'plant', x: 9.4, z: 0.6, rot: 0, attachedTo: null },
      ],
    },
    {
      id: 'room-2',
      kind: 'meeting-room',
      label: 'Meeting room',
      x: 10,
      z: 5,
      w: 6,
      d: 5,
      floor: 0,
      level: 1,
      capacity: 10,
      windows: [],
      doors: [],
      desks: [],
      ceilingLights: [],
      props: [],
    },
  ],
  town: [
    { id: 'town-1', kind: 'PlanHouse', x: -8, z: 4, rot: 0 },
    { id: 'town-2', kind: 'Tree', x: 20, z: 14, rot: Math.PI / 2 },
  ],
}

/** The sim's prices in cents (`EquipmentKind::cost`), as the mocked source reports them. */
const PRICES: Record<string, number> = { Desk: 40_000, Monitor: 30_000, Plant: 5_000 }

type Verdicts = (cmd: Record<string, unknown>) => CommandResult

function mockBridge() {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  let at: ReturnType<BuildBridge['pick']> = null
  const bridge = {
    pick: vi.fn(() => at),
    ghost: vi.fn(),
    ghostRect: vi.fn(),
    ghostPlan: vi.fn(),
    highlight: vi.fn(),
    setCapture: vi.fn(),
    focus: vi.fn(),
    canvas: () => canvas,
  }
  return {
    bridge,
    canvas,
    aim(p: ReturnType<BuildBridge['pick']>) {
      at = p
    },
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

/** Let the store's checks answer and Preact re-render (a few rounds). */
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush()
}

let ctx: ReturnType<typeof setup> | null = null
let canvas: HTMLCanvasElement | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
  canvas?.remove()
  canvas = null
  buildBridge.value = null
})

async function open(opts: { verdicts?: Verdicts; layout?: BuildLayout; bridge?: boolean; tab?: string } = {}) {
  ctx = setup({ commands: [...ALL_COMMANDS, ...BUILD_COMMANDS] })
  const source = ctx.source as unknown as Record<string, unknown>
  source.getLayout = async () => structuredClone(opts.layout ?? LAYOUT)
  source.price = async (json: string) => {
    const c = JSON.parse(json) as { PlaceEquipment?: { kind: string } }
    return c.PlaceEquipment ? (PRICES[c.PlaceEquipment.kind] ?? null) : null
  }
  source.validate = async (json: string) => (opts.verdicts ? opts.verdicts(JSON.parse(json)) : { ok: true })
  source.apply = async () => ({ ok: true })
  const mb = opts.bridge === false ? null : mockBridge()
  if (mb) {
    canvas = mb.canvas
    buildBridge.value = mb.bridge
  }
  await ctx.store.refresh()
  await flush()
  const top = screen.getByRole('navigation', { name: 'Sections' })
  fireEvent.click(within(top).getByRole('button', { name: /^Build/ }))
  await flush()
  const panel = screen.getByRole('region', { name: 'Build' })
  if (opts.tab) {
    fireEvent.click(within(panel).getByRole('tab', { name: opts.tab }))
    await flush()
  }
  await flush()
  const run = vi.spyOn(ctx.store, 'run')
  return { panel, run, mb: mb!, store: ctx.store }
}

const sent = (run: { mock: { calls: unknown[][] } }) => run.mock.calls.map((c) => c[0])

async function audit(root: Element) {
  const res = await axe.run(root, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] })
  return res.violations.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
}

describe('the Build section', () => {
  it('is offered with a layout, opens the Build panel with the mode badge, and is lit', async () => {
    const { panel } = await open()
    expect(within(panel).getByText('Sandbox')).toBeTruthy()
    const top = screen.getByRole('navigation', { name: 'Sections' })
    expect(within(top).getByRole('button', { name: /^Build/ }).getAttribute('aria-current')).toBe('page')
    expect(within(panel).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Rooms', 'Furniture', 'Town', 'Designs'])
  })

  it('is not offered without a layout', async () => {
    ctx = setup()
    await flush()
    const top = screen.getByRole('navigation', { name: 'Sections' })
    expect(within(top).queryByRole('button', { name: /^Build/ })).toBeNull()
  })
})

describe('furniture', () => {
  it('shows the catalogue as brick tiles with the sim prices', async () => {
    const { panel } = await open({ tab: 'Furniture' })
    const cat = within(panel).getByRole('region', { name: 'Furniture catalogue' })
    const tiles = within(cat).getAllByRole('button')
    expect(tiles).toHaveLength(EQUIPMENT.length)
    expect(tiles[0].textContent).toContain('Desk')
    expect(tiles[0].textContent).toContain('€400')
    expect(tiles[0].querySelector('svg.st-brick-icon')).toBeTruthy()
    // No price from the sim for this kind: no number is shown.
    const lamp = tiles.find((t) => t.textContent?.startsWith('Desk lamp'))!
    expect(lamp.textContent).not.toMatch(/€/)
    expect(lamp.textContent).toContain('On a desk')
  })

  it('places a desk: the ghost follows the pointer with the sim verdict, R turns, a click sends PlaceEquipment', async () => {
    const { panel, run, mb } = await open({ tab: 'Furniture' })
    fireEvent.click(within(panel).getByRole('button', { name: /^Desk €400/ }))
    await flush()
    expect(mb.bridge.setCapture).toHaveBeenLastCalledWith(true)
    await mb.hover({ x: 4.03, z: 3.01, room: 'room-1', target: null })
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith({ kind: 'Desk', family: 'equipment', x: 4.03, z: 3.01, rot: 0, ok: true })
    expect(within(panel).getByText(/the sim accepts · €400/)).toBeTruthy()
    fireEvent.keyDown(mb.canvas, { key: 'r' })
    await settle()
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.objectContaining({ rot: 1 }))
    await mb.click({ x: 4.03, z: 3.01, room: 'room-1', target: null })
    expect(sent(run)).toEqual([{ PlaceEquipment: { kind: 'Desk', placement: { Floor: { pos: { x: 4000, z: 3000 }, rot: 1 } } } }])
    // Escape ends the gesture: no ghost, the camera pans again.
    fireEvent.keyDown(mb.canvas, { key: 'Escape' })
    await flush()
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(null)
    expect(mb.bridge.setCapture).toHaveBeenLastCalledWith(false)
  })

  it('a red ghost and the sim reason when refused; a click then sends nothing', async () => {
    const { panel, run, mb } = await open({ tab: 'Furniture', verdicts: (c) => ('PlaceEquipment' in c ? { ok: false, reason: 'too close to a wall' } : { ok: true }) })
    fireEvent.click(within(within(panel).getByRole('region', { name: 'Furniture catalogue' })).getByRole('button', { name: /^Potted plant/ }))
    await mb.hover({ x: 0.1, z: 0.1, room: 'room-1', target: null })
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'Plant', ok: false }))
    expect(within(panel).getByText(/refused, too close to a wall/)).toBeTruthy()
    expect((within(panel).getByRole('button', { name: 'Place here' }) as HTMLButtonElement).disabled).toBe(true)
    await mb.click({ x: 0.1, z: 0.1, room: 'room-1', target: null })
    expect(run).not.toHaveBeenCalled()
  })

  it('puts a monitor on the desk under the pointer', async () => {
    const { panel, run, mb } = await open({ tab: 'Furniture' })
    fireEvent.click(within(within(panel).getByRole('region', { name: 'Furniture catalogue' })).getByRole('button', { name: /^Monitor/ }))
    await mb.hover({ x: 5.1, z: 3.2, room: 'room-1', target: { kind: 'equipment', id: 'equip-2' } })
    expect(mb.bridge.ghost).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'Monitor', x: 5, z: 3 }))
    await mb.click({ x: 5.1, z: 3.2, room: 'room-1', target: { kind: 'equipment', id: 'equip-2' } })
    expect(sent(run)).toEqual([{ PlaceEquipment: { kind: 'Monitor', placement: { OnDesk: 'equip-2' } } }])
  })

  it('selects a placed item, then moves, turns and removes it', async () => {
    const { panel, run, mb } = await open({ tab: 'Furniture' })
    // Select by clicking it in the scene.
    await mb.click({ x: 9.4, z: 0.6, room: 'room-1', target: { kind: 'equipment', id: 'equip-5' } })
    expect(mb.bridge.highlight).toHaveBeenLastCalledWith({ kind: 'equipment', id: 'equip-5' })
    const sel = within(panel).getByRole('region', { name: /Selected: Potted plant/ })
    fireEvent.click(within(sel).getByRole('button', { name: 'Turn' }))
    await flush()
    fireEvent.click(within(sel).getByRole('button', { name: 'Remove' }))
    await flush()
    // Move: pick it up, click where it goes.
    fireEvent.click(within(panel).getByRole('button', { name: /^Potted plant equip-5/ }))
    await flush()
    fireEvent.click(within(panel).getByRole('button', { name: 'Move' }))
    await flush()
    await mb.click({ x: 7.24, z: 8.06, room: 'room-1', target: null })
    expect(sent(run)).toEqual([
      { MoveEquipment: { equipment: 'equip-5', placement: { Floor: { pos: { x: 9400, z: 600 }, rot: 1 } } } },
      { Demolish: { Equipment: 'equip-5' } },
      { MoveEquipment: { equipment: 'equip-5', placement: { Floor: { pos: { x: 7250, z: 8000 }, rot: 0 } } } },
    ])
  })

  it('drags the selected item to move it', async () => {
    const { run, mb } = await open({ tab: 'Furniture' })
    await mb.click({ x: 9.4, z: 0.6, room: 'room-1', target: { kind: 'equipment', id: 'equip-5' } })
    mb.aim({ x: 9.4, z: 0.6, room: 'room-1', target: { kind: 'equipment', id: 'equip-5' } })
    mb.canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
    await flush()
    expect(mb.bridge.setCapture).toHaveBeenLastCalledWith(true)
    await mb.hover({ x: 6, z: 6, room: 'room-1', target: null })
    mb.canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 80, clientY: 60 }))
    await flush()
    expect(sent(run)).toEqual([{ MoveEquipment: { equipment: 'equip-5', placement: { Floor: { pos: { x: 6000, z: 6000 }, rot: 0 } } } }])
  })

  it('Delete removes the selected item when the sim accepts; the sim reason disables Remove otherwise', async () => {
    const { panel, run, mb } = await open({ tab: 'Furniture', verdicts: (c) => ('Demolish' in c ? { ok: false, reason: 'this desk is assigned' } : { ok: true }) })
    fireEvent.click(within(panel).getByRole('button', { name: /^Desk equip-1/ }))
    await flush()
    await flush()
    const remove = within(panel).getByRole('button', { name: 'Remove' }) as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    expect(within(panel).getByText('this desk is assigned')).toBeTruthy()
    fireEvent.keyDown(mb.canvas, { key: 'Delete' })
    await flush()
    expect(run).not.toHaveBeenCalled()
  })
})

describe('rooms', () => {
  it('selects a room (framed and lit) and shows the sim reason on a refused demolish', async () => {
    const { panel, run, mb } = await open({ tab: 'Rooms', verdicts: (c) => ('Demolish' in c ? { ok: false, reason: 'room-1 would be unreachable from the entrance' } : { ok: true }) })
    fireEvent.click(within(within(panel).getByRole('region', { name: /^Rooms/ })).getByRole('button', { name: /^Newsroom/ }))
    await flush()
    await flush()
    expect(mb.bridge.focus).toHaveBeenLastCalledWith({ room: 'room-1' })
    expect(mb.bridge.highlight).toHaveBeenLastCalledWith({ kind: 'room', id: 'room-1' })
    const demolish = within(panel).getByRole('button', { name: 'Demolish' }) as HTMLButtonElement
    expect(demolish.disabled).toBe(true)
    expect(within(panel).getByText('room-1 would be unreachable from the entrance')).toBeTruthy()
    fireEvent.click(demolish)
    expect(run).not.toHaveBeenCalled()
  })

  it('demolishes a room the sim lets go', async () => {
    const { panel, run } = await open({ tab: 'Rooms' })
    fireEvent.click(within(panel).getByRole('button', { name: /^Meeting room 6/ }))
    await flush()
    await flush()
    fireEvent.click(within(panel).getByRole('button', { name: 'Demolish' }))
    await flush()
    expect(sent(run)).toEqual([{ Demolish: { Room: 'room-2' } }])
  })

  it('builds a room from a template by picking two corners, with the door on the chosen side', async () => {
    const { panel, run, mb } = await open({ tab: 'Rooms' })
    const fresh = within(panel).getByRole('region', { name: 'New room' })
    fireEvent.click(within(fresh).getByRole('button', { name: /^Kitchen/ }))
    await flush()
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick corners on the floor' }))
    await flush()
    expect(mb.bridge.setCapture).toHaveBeenLastCalledWith(true)
    await mb.click({ x: 2.5, z: 11.5, room: null, target: null })
    await mb.hover({ x: 4.2, z: 13.9, room: null, target: null })
    await mb.click({ x: 5.2, z: 14.9, room: null, target: null })
    expect(mb.bridge.setCapture).toHaveBeenLastCalledWith(false)
    fireEvent.change(within(panel).getByLabelText('Door side'), { target: { value: 'West' } })
    await flush()
    await flush()
    fireEvent.click(within(panel).getByRole('button', { name: 'Build room' }))
    await flush()
    expect(sent(run)).toEqual([{ PlaceRoom: { kind: 'Kitchen', rect: { x: 2, z: 11, w: 4, d: 4 }, floor: 0, doors: [{ side: 'West', at: 2 }], windows: [] } }])
  })

  it('shows the new room as a slab from the first corner, red or green by the sim verdict, and clears it', async () => {
    const { panel, mb } = await open({ tab: 'Rooms', verdicts: (c) => {
      const rect = (c as { PlaceRoom?: { rect: { w: number } } }).PlaceRoom?.rect
      return rect && rect.w < 3 ? { ok: false, reason: 'invalid: room too small' } : { ok: true }
    } })
    const fresh = within(panel).getByRole('region', { name: 'New room' })
    fireEvent.click(within(fresh).getByRole('button', { name: /^Archive/ }))
    await settle()
    fireEvent.click(within(panel).getByRole('button', { name: 'Pick corners on the floor' }))
    await settle()
    // Waiting for the first corner: no slab.
    expect(mb.bridge.ghostRect).toHaveBeenLastCalledWith(null)
    await mb.click({ x: 2.5, z: 11.5, room: null, target: null })
    await mb.hover({ x: 3.4, z: 13.2, room: null, target: null })
    expect(mb.bridge.ghostRect).toHaveBeenLastCalledWith({ x: 2, z: 11, w: 2, d: 3, ok: false })
    await mb.hover({ x: 5.4, z: 13.2, room: null, target: null })
    expect(mb.bridge.ghostRect).toHaveBeenLastCalledWith({ x: 2, z: 11, w: 4, d: 3, ok: true })
    await mb.click({ x: 5.4, z: 13.2, room: null, target: null })
    expect(mb.bridge.ghostRect).toHaveBeenLastCalledWith({ x: 2, z: 11, w: 4, d: 3, ok: true })
    // Built: the form closes and the slab goes.
    fireEvent.click(within(panel).getByRole('button', { name: 'Build room' }))
    await settle()
    expect(mb.bridge.ghostRect).toHaveBeenLastCalledWith(null)
    // Cancel and a tab change clear it too.
    fireEvent.click(within(fresh).getByRole('button', { name: /^Archive/ }))
    await settle()
    expect(mb.bridge.ghostRect).toHaveBeenLastCalledWith(expect.objectContaining({ ok: expect.any(Boolean) }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    await settle()
    expect(mb.bridge.ghostRect).toHaveBeenLastCalledWith(null)
    fireEvent.click(within(fresh).getByRole('button', { name: /^Archive/ }))
    await settle()
    fireEvent.click(within(panel).getByRole('tab', { name: 'Town' }))
    await settle()
    expect(mb.bridge.ghostRect).toHaveBeenLastCalledWith(null)
  })

  it('spans a rectangle from two corners in any order', () => {
    expect(rectOf({ x: 5, z: 2 }, { x: 2, z: 4 })).toEqual({ x: 2, z: 2, w: 4, d: 3 })
  })
})

describe('the town', () => {
  it('frames the town, places a tree with the keyboard, keeps the houses, removes a tree', async () => {
    const { panel, run, mb } = await open({ tab: 'Town' })
    expect(mb.bridge.focus).toHaveBeenLastCalledWith({ town: true })
    fireEvent.click(within(within(panel).getByRole('region', { name: 'Town pieces' })).getByRole('button', { name: /^Town tree/ }))
    await flush()
    const gesture = within(panel).getByRole('region', { name: 'Pending action' })
    fireEvent.keyDown(gesture, { key: 'ArrowRight' })
    await flush()
    fireEvent.keyDown(gesture, { key: 'Enter' })
    await flush()
    expect(sent(run)).toEqual([{ PlaceTownItem: { kind: 'Tree', pos: { x: -3875, z: 3750 }, rot: 0 } }])
    fireEvent.keyDown(gesture, { key: 'Escape' })
    await flush()
    // The Plan house moves and turns, but has no Remove.
    fireEvent.click(within(panel).getByRole('button', { name: /^Plan house/ }))
    await flush()
    await flush()
    const house = within(panel).getByRole('region', { name: /Selected: Plan house/ })
    expect(within(house).queryByRole('button', { name: 'Remove' })).toBeNull()
    fireEvent.click(within(house).getByRole('button', { name: 'Turn' }))
    await flush()
    fireEvent.click(within(panel).getByRole('button', { name: /^Town tree town-2/ }))
    await flush()
    await flush()
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove' }))
    await flush()
    expect(sent(run).slice(1)).toEqual([{ MoveTownItem: { item: 'town-1', pos: { x: -8000, z: 4000 }, rot: 1 } }, { RemoveTownItem: { item: 'town-2' } }])
  })

  it('moves a house by picking it in the scene', async () => {
    const { panel, run, mb } = await open({ tab: 'Town' })
    await mb.click({ x: -8, z: 4, room: null, target: { kind: 'town', id: 'town-1' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Move' }))
    await flush()
    await mb.click({ x: -12.3, z: 6, room: null, target: null })
    expect(sent(run)).toEqual([{ MoveTownItem: { item: 'town-1', pos: { x: -12250, z: 6000 }, rot: 0 } }])
  })
})

describe('axe: the Build panel', () => {
  it.each(['Rooms', 'Furniture', 'Town', 'Designs'])('%s tab', async (tab) => {
    const { panel } = await open({ tab })
    if (tab === 'Furniture') {
      fireEvent.click(within(panel).getByRole('button', { name: /^Desk €400/ }))
      await flush()
      fireEvent.click(within(panel).getByRole('button', { name: /^Desk equip-1/ }))
      await flush()
    }
    if (tab === 'Rooms') {
      fireEvent.click(within(panel).getByRole('button', { name: /^Archive/ }))
      await flush()
    }
    await flush()
    expect(await audit(ctx!.el)).toEqual([])
  })

  it('without a scene, the panel still lists and checks everything', async () => {
    const { panel } = await open({ bridge: false, tab: 'Furniture' })
    fireEvent.click(within(panel).getByRole('button', { name: /^Desk €400/ }))
    await flush()
    expect(within(panel).getByText(/The scene is not up/)).toBeTruthy()
    expect(await audit(ctx!.el)).toEqual([])
  })
})
