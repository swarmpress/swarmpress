// @vitest-environment jsdom
// The HUD's clock surface (ADR-0060 decision 8, FEAT-080): the status chip,
// pause and speed, the day-done card and loop-error toasts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHIP_LABELS, clockStatus, type ChipState, type ClockStatus, type ModelStatus } from '../session/clock-driver'
import { hudAlert, hudClock, hudNotify, hudToasts, mountHud, StatusChip, TOAST_MS, type HudClock, type HudControls } from './hud'

const flush = () => new Promise((r) => setTimeout(r, 0))
const ready: ModelStatus = { state: 'ready' }
const running: ClockStatus = { state: 'running', label: 'Running', detail: null }

const controls = (): HudControls & Record<keyof HudControls, ReturnType<typeof vi.fn>> => ({
  pause: vi.fn(),
  resume: vi.fn(),
  setSpeed: vi.fn(),
  setUnattendedDays: vi.fn(),
  startNextDay: vi.fn(),
})
const clock = (over: Partial<HudClock> = {}): HudClock => ({ status: running, paused: false, speed: 1, unattendedDays: 0, resting: false, ...over })
const state = { clock: '09:00', day: 0, renderer: 'webgl2', version: '0.2.0', fps: 60 }

let el: HTMLElement | null = null
let hud: ReturnType<typeof mountHud> | null = null
function mount(c: HudControls | null = controls()) {
  el = document.createElement('div')
  document.body.appendChild(el)
  hud = mountHud(el, c)
  hud.set(state)
  return hud
}
afterEach(() => {
  hud?.dispose()
  el?.remove()
  hud = null
  el = null
  hudToasts.value = []
  hudAlert.value = null
  hudClock.value = null
  cleanup()
  vi.useRealTimers()
})

const chip = () => document.querySelector('.hud-chip') as HTMLElement

describe('status chip', () => {
  const base = { hold: null, phase: 'day' as const, halted: null, leaseLost: null, model: ready, heldBy: null }
  const cases: [ChipState, ClockStatus, string][] = [
    ['running', clockStatus(base), 'Running'],
    ['held', clockStatus({ ...base, hold: 'due', heldBy: 'Giulia · draft' }), 'Held·Giulia · draft'],
    ['resting', clockStatus({ ...base, hold: 'resting', phase: 'resting' }), 'Resting·day done'],
    ['model-loading', clockStatus({ ...base, hold: 'model', model: { state: 'loading', detail: 'downloading 41%' } }), 'Model loading·downloading 41%'],
    ['lease-lost', clockStatus({ ...base, hold: 'halted', halted: 'x', leaseLost: 'Another device (dev-1) is running this company.' }), 'Lease lost·Another device (dev-1) is running this company.'],
    ['halted', clockStatus({ ...base, hold: 'halted', halted: 'command #7 (JobCompleted) could not be written to the log: disk full' }), 'Halted·command #7 (JobCompleted) could not be written to the log: disk full'],
    ['paused', clockStatus({ ...base, hold: 'paused' }), 'Paused'],
  ]

  it('covers the seven states of the clock', () => {
    expect(cases.map(([s]) => s).sort()).toEqual(Object.keys(CHIP_LABELS).sort())
  })

  it.each(cases)('shows %s as one chip with its label and the who, what or why', (stateName, status, text) => {
    render(<StatusChip status={status} />)
    const chips = document.querySelectorAll('.hud-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0].getAttribute('data-state')).toBe(stateName)
    expect(chips[0].classList.contains(`is-${stateName}`)).toBe(true)
    expect(chips[0].querySelector('.hud-chip-label')!.textContent).toBe(CHIP_LABELS[stateName])
    const detail = chips[0].querySelector('.hud-chip-detail')?.textContent
    expect([CHIP_LABELS[stateName], detail].filter(Boolean).join('·')).toBe(text)
    // The full text is also the tooltip (the detail is cut off when long).
    expect(chips[0].getAttribute('title')).toBe(detail ? `${CHIP_LABELS[stateName]}: ${detail}` : CHIP_LABELS[stateName])
  })

  it('follows the clock: exactly one chip, updated in place', async () => {
    const h = mount()
    h.setClock(clock())
    await flush()
    expect(chip().dataset.state).toBe('running')
    h.setClock(clock({ status: { state: 'held', label: 'Held', detail: 'Giulia · draft' } }))
    await flush()
    expect(document.querySelectorAll('.hud-chip')).toHaveLength(1)
    expect(chip().dataset.state).toBe('held')
    expect(chip().textContent).toContain('Giulia · draft')
    h.setClock(clock({ status: { state: 'halted', label: 'Halted', detail: 'the log could not be written' }, paused: true }))
    await flush()
    expect(chip().dataset.state).toBe('halted')
    expect(chip().textContent).toContain('the log could not be written')
  })

  it('a frozen screenshot page has no chip and no controls: the HUD is what it was', async () => {
    const h = mount(null)
    h.setClock(null)
    await flush()
    expect(document.querySelector('.hud-clock')!.textContent).toBe('Day 1 · 09:00')
    expect(document.querySelector('.hud')!.className).toBe('hud')
    expect(document.querySelector('.hud-chip')).toBeNull()
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})

describe('pause and speed', () => {
  it('the pause button pauses, and resumes once paused', async () => {
    const c = controls()
    const h = mount(c)
    h.setClock(clock())
    await flush()
    const group = screen.getByRole('group', { name: 'Game clock' })
    fireEvent.click(within(group).getByRole('button', { name: 'Pause the clock' }))
    expect(c.pause).toHaveBeenCalledTimes(1)
    h.setClock(clock({ paused: true, status: { state: 'paused', label: 'Paused', detail: null } }))
    await flush()
    const resume = within(group).getByRole('button', { name: 'Resume the clock' })
    expect(resume.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(resume)
    expect(c.resume).toHaveBeenCalledTimes(1)
    expect(c.pause).toHaveBeenCalledTimes(1)
  })

  it('the speed buttons set the speed and mark the current one', async () => {
    const c = controls()
    const h = mount(c)
    h.setClock(clock({ speed: 5 }))
    await flush()
    const speeds = screen.getAllByRole('button', { name: /^Speed / })
    expect(speeds.map((b) => b.textContent)).toEqual(['1×', '2×', '5×', '10×'])
    expect(speeds.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false'])
    fireEvent.click(screen.getByRole('button', { name: 'Speed 10×' }))
    expect(c.setSpeed).toHaveBeenCalledWith(10)
  })

  it('lists a speed the URL set, when the buttons do not offer it', async () => {
    const h = mount()
    h.setClock(clock({ speed: 600 }))
    await flush()
    expect(screen.getAllByRole('button', { name: /^Speed / }).map((b) => b.textContent)).toEqual(['1×', '2×', '5×', '10×', '600×'])
    expect(screen.getByRole('button', { name: 'Speed 600×' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('the unattended-days setting is a number the player sets (not shown where nothing rests)', async () => {
    const c = controls()
    const h = mount(c)
    h.setClock(clock({ unattendedDays: 2 }))
    await flush()
    const input = screen.getByLabelText('Unattended days') as HTMLInputElement
    expect(input.value).toBe('2')
    fireEvent.change(input, { target: { value: '5' } })
    expect(c.setUnattendedDays).toHaveBeenCalledWith(5)
    h.setClock(clock({ unattendedDays: null }))
    await flush()
    expect(screen.queryByLabelText('Unattended days')).toBeNull()
  })
})

describe('day-done card', () => {
  it('is up while the clock rests, and starts the next day on a click', async () => {
    const c = controls()
    const h = mount(c)
    h.setClock(clock())
    await flush()
    expect(screen.queryByRole('dialog', { name: 'Day done' })).toBeNull()
    h.setClock(clock({ resting: true, status: { state: 'resting', label: 'Resting', detail: 'day done' } }))
    await flush()
    const card = screen.getByRole('dialog', { name: 'Day done' })
    expect(card.textContent).toContain('Day 1')
    expect(chip().dataset.state).toBe('resting')
    fireEvent.click(within(card).getByRole('button', { name: 'Start the next day' }))
    expect(c.startNextDay).toHaveBeenCalledTimes(1)
    fireEvent.change(within(card).getByLabelText('Days to run unattended after it'), { target: { value: '3' } })
    expect(c.setUnattendedDays).toHaveBeenCalledWith(3)
    h.setClock(clock({ status: { state: 'resting', label: 'Resting', detail: 'skipping the night' } }))
    await flush()
    expect(screen.queryByRole('dialog', { name: 'Day done' })).toBeNull()
  })
})

describe('loop errors', () => {
  it('show as a toast and stay on the chip until dismissed', async () => {
    vi.useFakeTimers()
    const h = mount()
    h.setClock(clock())
    hudNotify('draft job 3 failed: timed out after 60 min')
    await vi.advanceTimersByTimeAsync(0)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('draft job 3 failed: timed out after 60 min')
    const mark = screen.getByRole('button', { name: /^Error: draft job 3 failed: timed out after 60 min/ })
    // The chip still shows one state: the clock runs on, the error is a mark next to it.
    expect(document.querySelectorAll('.hud-chip')).toHaveLength(1)
    expect(chip().dataset.state).toBe('running')

    // The toast leaves by itself; the mark stays.
    await vi.advanceTimersByTimeAsync(TOAST_MS + 1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mark.isConnected).toBe(true)
    fireEvent.click(mark)
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.queryByRole('button', { name: /^Error:/ })).toBeNull()
  })

  it('keeps the last three toasts', async () => {
    mount().setClock(clock())
    for (const n of [1, 2, 3, 4]) hudNotify(`error ${n}`)
    await flush()
    expect([...document.querySelectorAll('.hud-toast')].map((t) => t.textContent)).toEqual(['error 2', 'error 3', 'error 4'])
    expect(hudAlert.value).toBe('error 4')
  })
})
