// @vitest-environment jsdom
// The office designer, the player's side (FEAT-084, ADR-0087 decision 6): the Rooms tab asks the
// office designer for a room (the words and the brief go to the source's `commissionInterior`
// exactly; the form says why it cannot ask: no such source method, no designer on the staff, no
// room, nothing asked); the Inbox shows a `build-approval` ticket with the plan from the store
// (room, summary, cost, the items by name and count, the warnings), previews it as ghosts in the
// room through the bridge, and answers with the ticket's own options.
import { fireEvent, screen, within } from '@testing-library/preact'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBridge, type BuildBridge } from '../../build-bridge'
import { ALL_COMMANDS, type CommandResult } from '../commands'
import { fixtureState, MockDataSource } from '../mock-source'
import { mountOverlay } from '../mount'
import type { OverlayStore } from '../store'
import { flush } from '../testing'
import type { OrgJson, StaffJson, TicketJson } from '../types'
import { designName, itemCounts, planGhosts, type InteriorBrief, type RoomPlan } from './interior'
import type { BuildLayout } from './types'

const room = (id: string, kind: string, label: string, x: number, w: number, d: number) => ({
  id,
  kind,
  label,
  x,
  z: 0,
  w,
  d,
  floor: 0,
  level: 1,
  capacity: 8,
  windows: [],
  doors: [],
  desks: id === 'room-1' ? [{ id: 'equip-1', x: 2.5, z: 3, rot: 0, seat: [2.5, 3.75] as [number, number] }] : [],
  ceilingLights: [],
  props: [],
})

const LAYOUT = (mode: 'sandbox' | 'economic' = 'economic'): BuildLayout =>
  ({
    originX: 0,
    originZ: 0,
    width: 16,
    depth: 10,
    wallHeight: 3,
    floors: 1,
    entrance: { side: 'south', x: 4.5, z: 10, spawn: [4.5, 12.5] },
    buildMode: mode,
    rooms: [room('room-1', 'newsroom', 'Newsroom', 0, 10, 10), room('room-6', 'meeting-room', 'Meeting room', 10, 6, 5)],
    town: [],
  }) as unknown as BuildLayout

const PLAN: RoomPlan = {
  kind: 'room-plan',
  room: 'room-6',
  items: [
    { design: 'desk', x_mm: 11500, z_mm: 2000, rot: 1, on_desk: null },
    { design: 'desk', x_mm: 13000, z_mm: 2000, rot: 1, on_desk: null },
    { design: 'monitor', x_mm: 0, z_mm: 0, rot: 0, on_desk: { planned: 0 } },
    { design: 'desk-lamp', x_mm: 0, z_mm: 0, rot: 0, on_desk: { existing: 'equip-1' } },
    { design: 'plant', x_mm: 15500, z_mm: 500, rot: 0, on_desk: null },
  ],
  cost_cents: 123_450,
  parts: 412,
  summary: 'Two facing desks by the window, a plant in the corner.',
  issues: [
    { id: 'i1', code: 'tight-aisle', severity: 'warning', message: 'The aisle behind the desks is 70 cm wide.' },
    { id: 'i2', code: 'over-budget', severity: 'error', message: 'The plan costs more than the budget.' },
  ],
}

const DESIGNER: StaffJson = {
  id: 'staff-90',
  persona: 'chiara',
  role: 'office-designer',
  department: 'operations',
  seniority: 'mid',
  salaryEurMonth: 3800,
  morale: 0.8,
  fatigue: 0.1,
  activity: 'idle',
  projects: [],
}

const TICKET: TicketJson = {
  id: 'ticket-90',
  kind: 'build-approval',
  priority: 'medium',
  project: null,
  from: 'staff-90',
  status: 'open',
  routedViaSecretary: false,
  options: ['build', 'defer', 'decline'],
  defaultOption: 'defer',
  workItem: 'item-90',
  amountEur: 1234.5,
  deadlineMinute: 99_999,
}

let ctx: { store: OverlayStore; el: HTMLElement; cleanup: () => void } | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
  buildBridge.value = null
})

function mockBridge() {
  const canvas = document.createElement('canvas')
  const bridge = {
    pick: vi.fn(() => null),
    ghost: vi.fn(),
    ghostPlan: vi.fn(),
    ghostRect: vi.fn(),
    highlight: vi.fn(),
    setCapture: vi.fn(),
    focus: vi.fn(),
    canvas: () => canvas,
  } satisfies BuildBridge
  return bridge
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await flush()
}

interface Opts {
  designer?: boolean
  commission?: ((input: { room: string; words: string; brief: InteriorBrief }) => Promise<CommandResult>) | null
  plan?: RoomPlan | null | undefined | 'absent'
  mode?: 'sandbox' | 'economic'
  bridge?: boolean
  ticket?: TicketJson
}

async function start(opts: Opts = {}) {
  const state = fixtureState()
  const org = state.org as OrgJson
  if (opts.designer !== false) org.staff.push(DESIGNER)
  state.inbox.tickets = [opts.ticket ?? TICKET, ...state.inbox.tickets]
  const mock = new MockDataSource({ commands: [...ALL_COMMANDS, 'PlaceRoom', 'Demolish', 'PlaceEquipment', 'MoveEquipment'], state })
  const source = mock as unknown as Record<string, unknown>
  source.getLayout = async () => structuredClone(LAYOUT(opts.mode))
  source.validate = async () => ({ ok: true })
  if (opts.commission !== null) source.commissionInterior = opts.commission ?? vi.fn(async () => ({ ok: true }))
  if (opts.plan !== 'absent') source.roomPlanOf = vi.fn(() => ('plan' in opts ? opts.plan : PLAN))
  const bridge = opts.bridge === false ? null : mockBridge()
  if (bridge) buildBridge.value = bridge
  const el = document.createElement('div')
  document.body.appendChild(el)
  const handle = mountOverlay(el, mock)
  ctx = { store: handle.store, el, cleanup: () => (handle.dispose(), el.remove()) }
  await handle.store.refresh()
  await settle()
  return { store: handle.store, source, bridge, el }
}

async function openRooms() {
  const top = screen.getByRole('navigation', { name: 'Sections' })
  fireEvent.click(within(top).getByRole('button', { name: /^Build/ }))
  await flush()
  const panel = screen.getByRole('region', { name: 'Build' })
  fireEvent.click(within(panel).getByRole('tab', { name: 'Rooms' }))
  await settle()
  return within(panel).getByRole('form', { name: 'Ask the office designer' })
}

async function audit(root: Element) {
  const res = await axe.run(root, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] })
  return res.violations.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
}

describe('the plan helpers', () => {
  it('names designs from the kit and counts them in order', () => {
    expect(designName('desk-lamp')).toBe('Desk lamp')
    expect(itemCounts(PLAN).map((c) => [c.name, c.count])).toEqual([
      ['Desk', 2],
      [designName('monitor'), 1],
      ['Desk lamp', 1],
      [designName('plant'), 1],
    ])
  })

  it('converts the plan to the bridge ghosts: metres, kinds, the desk each item stands on', () => {
    expect(planGhosts(PLAN)).toEqual([
      { kind: 'Desk', x: 11.5, z: 2, rot: 1 },
      { kind: 'Desk', x: 13, z: 2, rot: 1 },
      { kind: 'Monitor', x: 0, z: 0, rot: 0, onDesk: 0 },
      { kind: 'DeskLamp', x: 0, z: 0, rot: 0, onDesk: 'equip-1' },
      { kind: 'Plant', x: 15.5, z: 0.5, rot: 0 },
    ])
  })
})

describe('asking the office designer (the Rooms tab)', () => {
  it('sends the words and the brief exactly, for the chosen room, and says where the plan goes', async () => {
    const commission = vi.fn(async () => ({ ok: true }))
    const { bridge } = await start({ commission })
    const form = within(await openRooms())
    const ask = form.getByRole('button', { name: 'Ask for a plan' }) as HTMLButtonElement
    expect(ask.disabled).toBe(true)
    expect(form.getByText('Choose a room first.')).toBeTruthy()
    fireEvent.change(form.getByLabelText('The room'), { target: { value: 'room-6' } })
    await settle()
    // Choosing the room selects it in the scene too.
    expect(bridge!.focus).toHaveBeenLastCalledWith({ room: 'room-6' })
    expect(form.getByText('Describe the room, or ask for at least one thing.')).toBeTruthy()
    fireEvent.input(form.getByLabelText('What should the room be?'), { target: { value: '  A meeting room for eight with a whiteboard ' } })
    fireEvent.input(form.getByLabelText('Meeting seats'), { target: { value: '8' } })
    fireEvent.input(form.getByLabelText('Writing surfaces'), { target: { value: '1' } })
    fireEvent.input(form.getByLabelText('Plants'), { target: { value: '40' } })
    fireEvent.input(form.getByLabelText('Budget, € (optional)'), { target: { value: '2500.5' } })
    await settle()
    expect(ask.disabled).toBe(false)
    fireEvent.click(ask)
    await settle()
    expect(commission).toHaveBeenCalledTimes(1)
    expect(commission).toHaveBeenCalledWith({
      room: 'room-6',
      words: 'A meeting room for eight with a whiteboard',
      brief: { workstations: 0, meeting_seats: 8, storage: 0, writing_surfaces: 1, coffee: 0, plants: 12, max_cost_cents: 250_050 },
    })
    expect(form.getByRole('status').textContent).toMatch(/the plan comes to your Inbox for approval/)
  })

  it('in Sandbox, says the builders start once the plan is ready; without a budget, max_cost_cents is null', async () => {
    const commission = vi.fn(async () => ({ ok: true }))
    await start({ commission, mode: 'sandbox' })
    const form = within(await openRooms())
    fireEvent.change(form.getByLabelText('The room'), { target: { value: 'room-1' } })
    fireEvent.input(form.getByLabelText('Workstations'), { target: { value: '4' } })
    await settle()
    fireEvent.click(form.getByRole('button', { name: 'Ask for a plan' }))
    await settle()
    expect(commission).toHaveBeenCalledWith({ room: 'room-1', words: '', brief: expect.objectContaining({ workstations: 4, max_cost_cents: null }) })
    expect(form.getByRole('status').textContent).toMatch(/builders start/)
  })

  it('shows the sim reason when the request is refused', async () => {
    await start({ commission: async () => ({ ok: false, reason: 'room-6 is under construction' }) })
    const form = within(await openRooms())
    fireEvent.change(form.getByLabelText('The room'), { target: { value: 'room-6' } })
    fireEvent.input(form.getByLabelText('Coffee'), { target: { value: '1' } })
    await settle()
    fireEvent.click(form.getByRole('button', { name: 'Ask for a plan' }))
    await settle()
    expect(form.getByRole('alert').textContent).toContain('room-6 is under construction')
  })

  it('refuses a budget that is not a positive amount', async () => {
    await start()
    const form = within(await openRooms())
    fireEvent.change(form.getByLabelText('The room'), { target: { value: 'room-6' } })
    fireEvent.input(form.getByLabelText('Plants'), { target: { value: '2' } })
    fireEvent.input(form.getByLabelText('Budget, € (optional)'), { target: { value: '-3' } })
    await settle()
    expect((form.getByRole('button', { name: 'Ask for a plan' }) as HTMLButtonElement).disabled).toBe(true)
    expect(form.getByText(/The budget is a positive amount/)).toBeTruthy()
  })

  it('without an office designer on the staff: disabled, and points to Hiring', async () => {
    const { store } = await start({ designer: false })
    const form = await openRooms()
    const section = within(form.parentElement!)
    expect(section.getByRole('note').textContent).toMatch(/No office designer on the staff/)
    expect(within(form).getByText('Needs an office designer.')).toBeTruthy()
    expect((within(form).getByRole('button', { name: 'Ask for a plan' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(form).getByLabelText('What should the room be?').matches(':disabled')).toBe(true)
    fireEvent.click(section.getByRole('button', { name: 'Open Hiring' }))
    await flush()
    expect(store.panel.value).toBe('hiring')
  })

  it('without the source method: disabled with an honest note', async () => {
    await start({ commission: null })
    const form = await openRooms()
    expect(within(form.parentElement!).getByRole('note').textContent).toMatch(/cannot ask the office designer yet/)
    expect(within(form).getByText('Not available in this game.')).toBeTruthy()
    expect((within(form).getByRole('button', { name: 'Ask for a plan' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('is axe clean', async () => {
    await start({ designer: false })
    await openRooms()
    expect(await audit(ctx!.el)).toEqual([])
  })
})

async function openInbox() {
  ctx!.store.panel.value = 'inbox'
  await settle()
  const ticket = screen.getByRole('article', { name: 'Build approval' })
  return ticket
}

describe('the Build Approval ticket', () => {
  it('shows the room, summary, cost, items by name and count, and the check findings', async () => {
    const { source } = await start()
    const t = within(await openInbox())
    expect(source.roomPlanOf).toHaveBeenCalledWith('item-90')
    expect(t.getByText('Meeting room (6 × 5 m)')).toBeTruthy()
    expect(t.getByText(PLAN.summary)).toBeTruthy()
    expect(t.getByText('€1,235 to build')).toBeTruthy()
    const items = within(t.getByRole('list', { name: 'Items in the plan' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/\s+/g, ' ').trim())
    expect(items).toEqual(['2 × Desk', `1 × ${designName('monitor')}`, '1 × Desk lamp', `1 × ${designName('plant')}`])
    expect(t.getByText(/5 items · 412 parts/)).toBeTruthy()
    expect(t.getByText('The aisle behind the desks is 70 cm wide.')).toBeTruthy()
    expect(t.getByText('The plan costs more than the budget.')).toBeTruthy()
    // The work item's link, the preview, then the ticket's own options.
    expect(t.getAllByRole('button').map((b) => b.textContent)).toEqual(['item-90', 'Preview in the room', 'Build', 'Defer (default at deadline)', 'Decline'])
  })

  it('previews the whole plan as ghosts in the framed room, and hides them again', async () => {
    const { bridge } = await start()
    const t = within(await openInbox())
    fireEvent.click(t.getByRole('button', { name: 'Preview in the room' }))
    await flush()
    expect(bridge!.focus).toHaveBeenLastCalledWith({ room: 'room-6' })
    expect(bridge!.ghostPlan).toHaveBeenLastCalledWith(planGhosts(PLAN))
    const hide = t.getByRole('button', { name: 'Hide the preview' })
    expect(hide.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(hide)
    await flush()
    expect(bridge!.ghostPlan).toHaveBeenLastCalledWith(null)
  })

  it.each([
    ['Build', 'build'],
    ['Defer', 'defer'],
    ['Decline', 'decline'],
  ])('%s answers the ticket with its own option, and the preview goes', async (label, option) => {
    const { bridge, store } = await start()
    const run = vi.spyOn(store, 'run')
    const t = within(await openInbox())
    fireEvent.click(t.getByRole('button', { name: 'Preview in the room' }))
    await flush()
    fireEvent.click(t.getByRole('button', { name: new RegExp(`^${label}`) }))
    await settle()
    expect(run.mock.calls[0][0]).toEqual({ AnswerTicket: { ticket: 'ticket-90', option } })
    expect(bridge!.ghostPlan).toHaveBeenLastCalledWith(null)
  })

  it('while the plan loads, without one, and without a source for plans', async () => {
    await start({ plan: undefined })
    expect(within(await openInbox()).getByText(/Reading the office designer’s plan/)).toBeTruthy()
    ctx!.cleanup()
    ctx = null
    await start({ plan: null })
    expect(within(await openInbox()).getByText(/not in this device’s store/)).toBeTruthy()
    ctx!.cleanup()
    ctx = null
    await start({ plan: 'absent' })
    expect(within(await openInbox()).getByText(/cannot show the office designer’s plan yet/)).toBeTruthy()
  })

  it('without a scene, the preview is disabled with the reason', async () => {
    await start({ bridge: false })
    const t = within(await openInbox())
    expect((t.getByRole('button', { name: 'Preview in the room' }) as HTMLButtonElement).disabled).toBe(true)
    expect(t.getByText(/The scene is not up/)).toBeTruthy()
  })

  it('is axe clean', async () => {
    await start()
    await openInbox()
    expect(await audit(ctx!.el)).toEqual([])
  })
})
