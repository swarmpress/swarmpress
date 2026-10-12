// @vitest-environment jsdom
// The design editor as the player uses it (ADR-0087 decision 7), on the real
// kit (crates/kit-wasm/pkg; skipped without it): start empty, place bricks
// with the keyboard, see the kit's verdict and part count, undo and redo,
// a floating brick refused, save to the library, open a shipped design, and
// no axe violations.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import axe from 'axe-core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { flush } from '../testing'
import { compileDesign, compileShipped, setDesignKit, type EditorKit } from './design-kit'
import { mountFact, workstationFacts } from './provides'
import { LIBRARY_KEY } from './design-library'
import { DesignEditor } from './DesignEditor'

const PKG = resolve(process.cwd(), '../../crates/kit-wasm/pkg') + '/'
const built = existsSync(`${PKG}kit_wasm.js`)
let kit: EditorKit
beforeAll(async () => {
  if (!built) return
  const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}kit_wasm.js`).href)) as EditorKit & { initSync(m: { module: BufferSource }): unknown }
  mod.initSync({ module: readFileSync(`${PKG}kit_wasm_bg.wasm`) })
  setDesignKit(mod)
  kit = mod
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const audit = async () =>
  (await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'], iframes: false })).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  )

const parts = () => screen.getByTestId('de-parts').textContent
const grid = () => screen.getByRole('application')
const key = (k: string, opts: Record<string, unknown> = {}) => fireEvent.keyDown(grid(), { key: k, ...opts })

async function startEmpty() {
  render(<DesignEditor />)
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Start empty' }))
  await flush()
}

describe.skipIf(!built)('the design editor', () => {
  it('places bricks with the keyboard, compiles them live, undoes and redoes', async () => {
    await startEmpty()
    expect(parts()).toBe('0')
    expect(screen.getByRole('button', { name: 'Save to library' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'brick 2 by 4' }))
    key('Enter')
    await flush()
    expect(screen.getByText('The kit builds it')).toBeTruthy()
    expect(parts()).toBe('1')
    key('ArrowRight')
    key('ArrowRight')
    key('Enter')
    await flush()
    // Two 2 × 4 bricks side by side: the kit's splitter decides the bricks.
    expect(Number(parts())).toBeGreaterThanOrEqual(1)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await flush()
    expect(parts()).toBe('1')
    fireEvent.keyDown(screen.getByRole('region', { name: 'Design editor' }), { key: 'z', ctrlKey: true, shiftKey: true })
    await flush()
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Redo' }).hasAttribute('disabled')).toBe(true)
  })

  it('refuses a floating brick and will not save it; saves a valid design to the library', async () => {
    await startEmpty()
    key('Enter')
    await flush()
    // Up 6 plates, away from the first brick: it floats.
    for (let i = 0; i < 6; i++) key('PageUp')
    for (let i = 0; i < 5; i++) key('ArrowDown')
    key('Enter')
    await flush()
    expect(screen.getByText(/The kit refuses it/)).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Issues' })).getByText('floating')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save to library' })
    expect(save.hasAttribute('disabled')).toBe(true)
    key('e') // remove: the floating brick as drawn
    key('Enter')
    await flush()
    expect(screen.getByText('The kit builds it')).toBeTruthy()
    fireEvent.click(save)
    await flush()
    const stored = JSON.parse(localStorage.getItem(LIBRARY_KEY)!) as Array<{ design: { provenance: unknown; ops: unknown[] } }>
    expect(stored).toHaveLength(1)
    expect(stored[0].design.provenance).toEqual({ kind: 'player', player: 'local' })
    const lib = screen.getByRole('region', { name: 'Your designs' })
    expect(within(lib).getByText('My design')).toBeTruthy()
    fireEvent.click(within(lib).getByRole('button', { name: 'Delete My design' }))
    fireEvent.click(within(lib).getByRole('button', { name: 'Delete My design' }))
    await flush()
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)!)).toEqual([])
  })

  it('opens a copy of a shipped design with what it provides', async () => {
    render(<DesignEditor />)
    await flush()
    fireEvent.change(screen.getByRole('combobox', { name: 'Start from a kit design' }), { target: { value: 'stool' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open a copy' }))
    await flush()
    expect(screen.getByText('The kit builds it')).toBeTruthy()
    expect(parts()).toBe('9')
    expect(screen.getByText(/Provides: seat/)).toBeTruthy()
  })

  it('has no axe violations, idle and while editing', async () => {
    render(<DesignEditor />)
    await flush()
    expect(await audit(), 'idle').toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Start empty' }))
    await flush()
    key('Enter')
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }))
    await flush()
    expect(await audit(), 'editing').toEqual([])
  })
})

/** A workstation of the player's (ADR-0088): a desk-high top, a screen, a seat port 0.75 m south of its centre. */
const MY_DESK = {
  format: 'swarmpress.design.v1',
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
  provenance: { kind: 'player', player: 'local' },
}

describe.skipIf(!built)('what a design provides in the office (ADR-0088)', () => {
  const facts = (r: ReturnType<typeof compileDesign>) => workstationFacts({ summary: r.summary!, ports: r.ports, bounds: r.bounds })

  it('says a workstation is one and where its seat is, or which rule it misses', () => {
    const mine = facts(compileDesign(kit, MY_DESK))
    expect(mine).toMatchObject({ workstation: true, seat: [0, 750] })
    expect(mine.text).toBe('A workstation: staff can work here (seat at x 0.00 m, z 0.75 m from its centre).')
    // The shipped desk is one too, its chair 0.75 m in front of its centre.
    expect(facts(compileShipped(kit, 'desk'))).toMatchObject({ workstation: true, seat: [0, 750] })
    // Without its screen, my desk has the top and the seat port, but no screen or paper.
    expect(facts(compileDesign(kit, { ...MY_DESK, ops: MY_DESK.ops.slice(0, 2) }))).toMatchObject({ workstation: false, why: ['no screen or paper part'] })
    // A stool: no seat port, no desk-high top.
    expect(facts(compileShipped(kit, 'stool')).text).toBe('Not a workstation: no port that accepts a seat; no flat top at desk height (70–80 cm).')
    // Too small a top.
    const small = { ...MY_DESK, footprint: [6, 6], ops: [{ op: 'box', at: [0, 0, 0], size: [6, 6, 30], part: 'brick', colour: 'sand' }], ports: [{ id: 'seat', at: [3, 10, 0], accepts: ['seat'] }] }
    expect(facts(compileDesign(kit, small)).text).toMatch(/too small \(36 of 64 stud²/)
    // The summary's own seat position wins when the kit gives one.
    const r = compileDesign(kit, MY_DESK)
    expect(workstationFacts({ summary: { ...r.summary!, seat_at: [10, 760] }, ports: r.ports, bounds: r.bounds })).toMatchObject({ seat: [10, 760] })
    expect(mountFact(compileShipped(kit, 'monitor').summary!)).toBe('Goes on a desk: its screen slot.')
    expect(mountFact(compileShipped(kit, 'desk-lamp').summary!)).toBe('Goes on a desk: its lamp slot.')
    expect(mountFact(compileShipped(kit, 'ceiling-light').summary!)).toBe('Hangs from the ceiling: not placeable yet.')
  })

  it('shows workstation yes or no, the seats and the reason beside the compiled facts', async () => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify([{ id: 'my-desk', name: 'My desk', hash: 'h', parts: 1, colour: 'sand', design: MY_DESK }]))
    render(<DesignEditor />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Open My desk' }))
    await flush()
    expect(screen.getByTestId('de-workstation').textContent).toBe('Yes')
    expect(screen.getByTestId('de-workstation-why').textContent).toMatch(/^A workstation: staff can work here \(seat at x 0\.00 m, z 0\.75 m/)
    expect(within(screen.getByTestId('de-office')).getByText('Stands on the floor.')).toBeTruthy()
    expect(await audit()).toEqual([])
    cleanup()
    render(<DesignEditor />)
    await flush()
    fireEvent.change(screen.getByRole('combobox', { name: 'Start from a kit design' }), { target: { value: 'stool' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open a copy' }))
    await flush()
    expect(screen.getByTestId('de-workstation').textContent).toBe('No')
    expect(screen.getByTestId('de-workstation-why').textContent).toBe('Not a workstation: no port that accepts a seat; no flat top at desk height (70–80 cm).')
    fireEvent.change(screen.getByRole('combobox', { name: 'Start from a kit design' }), { target: { value: 'monitor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open a copy' }))
    await flush()
    expect(screen.getByTestId('de-workstation').textContent).toBe('No (not on the floor)')
    expect(within(screen.getByTestId('de-office')).getByText('Goes on a desk: its screen slot.')).toBeTruthy()
  })
})
