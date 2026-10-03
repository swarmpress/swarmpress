// @vitest-environment jsdom
// The boot screen (FEAT-080): stages while the page starts, a visible error when it cannot.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_STAGES, mountBootScreen, SESSION_STAGES } from './boot-screen'

afterEach(() => {
  document.body.replaceChildren()
})

const states = () => Object.fromEntries([...document.querySelectorAll<HTMLElement>('.boot-stages li')].map((li) => [li.dataset.stage, li.dataset.state]))

describe('boot screen', () => {
  it('lists the stages of a session: wasm, renderer, login, store, lease, restore, orchestrator, scene', () => {
    expect(SESSION_STAGES.map((s) => s.id)).toEqual(['wasm', 'renderer', 'login', 'store', 'lease', 'restore', 'orchestrator', 'scene'])
    expect(DEMO_STAGES.map((s) => s.id)).toEqual(['wasm', 'renderer', 'scene'])
    const boot = mountBootScreen(document.body, SESSION_STAGES)
    expect(boot.el.id).toBe('boot-screen')
    expect(boot.el.getAttribute('role')).toBe('status')
    expect(boot.el.dataset.state).toBe('loading')
    expect([...document.querySelectorAll('.boot-stages li')].map((li) => li.textContent)).toEqual(SESSION_STAGES.map((s) => s.label))
    expect(new Set(Object.values(states()))).toEqual(new Set(['pending']))
  })

  it('marks the running stage, the ones before it done, and moves the progress bar', () => {
    const boot = mountBootScreen(document.body, SESSION_STAGES)
    const progress = document.querySelector('progress') as HTMLProgressElement
    expect([progress.max, progress.value]).toEqual([8, 0])
    boot.stage('wasm')
    expect(states()).toMatchObject({ wasm: 'active', renderer: 'pending' })
    boot.stage('lease')
    expect(states()).toEqual({ wasm: 'done', renderer: 'done', login: 'done', store: 'done', lease: 'active', restore: 'pending', orchestrator: 'pending', scene: 'pending' })
    expect(progress.value).toBe(4)
    expect(boot.el.dataset.stage).toBe('lease')
    // A stage this screen does not list changes nothing.
    boot.stage('nonsense')
    expect(states().lease).toBe('active')
  })

  it('leaves when boot is done', () => {
    const boot = mountBootScreen(document.body, DEMO_STAGES)
    boot.stage('scene')
    boot.done()
    expect(document.getElementById('boot-screen')).toBeNull()
  })

  it('a failed boot is a visible error: the stage, the reason and a reload button', () => {
    const reload = vi.fn()
    const boot = mountBootScreen(document.body, SESSION_STAGES, { reload })
    boot.stage('restore')
    boot.fail(new Error('restore from opfs: replay desync at the checkpoint'))
    expect(boot.el.dataset.state).toBe('error')
    expect(boot.el.getAttribute('role')).toBe('alert')
    expect(states()).toMatchObject({ lease: 'done', restore: 'failed', orchestrator: 'pending' })
    const error = document.querySelector('.boot-error') as HTMLElement
    expect(error.hidden).toBe(false)
    expect(error.querySelector('.boot-error-text')!.textContent).toBe(
      'swarm.press could not start (restore the company): restore from opfs: replay desync at the checkpoint',
    )
    ;(error.querySelector('button') as HTMLButtonElement).click()
    expect(reload).toHaveBeenCalledTimes(1)
    // Later stage reports do not paint over the error.
    boot.stage('scene')
    expect(states().restore).toBe('failed')
  })

  it('as a card: notes per stage, a message with buttons, and an error with actions of its own', () => {
    const stages = [
      { id: 'probe', label: 'Check WebGPU' },
      { id: 'download', label: 'Download the weights' },
      { id: 'load', label: 'Load onto the GPU' },
    ]
    const card = mountBootScreen(document.body, stages, { id: 'model-startup', title: 'Ternary Bonsai 2', label: 'Local model', variant: 'card', failPrefix: '' })
    expect(card.el.id).toBe('model-startup')
    expect(card.el.classList.contains('is-card')).toBe(true)
    expect(card.el.querySelector('h2')!.textContent).toBe('Ternary Bonsai 2')
    card.mark('probe', 'done', 'WebGPU ready')
    card.mark('download', 'active', 'downloading 36% (2.1 GB of 5.9 GB)')
    expect(states()).toEqual({ probe: 'done', download: 'active', load: 'pending' })
    expect(document.querySelector('li[data-stage="download"] .boot-stage-note')!.textContent).toBe('downloading 36% (2.1 GB of 5.9 GB)')
    expect((document.querySelector('progress') as HTMLProgressElement).value).toBe(1)
    const start = vi.fn()
    card.prompt('The model runs in this browser.', [{ label: 'Start the model', primary: true, run: start }, { label: 'Not now', run: () => undefined }])
    const message = document.querySelector('.boot-message') as HTMLElement
    expect(message.hidden).toBe(false)
    expect([...message.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Start the model', 'Not now'])
    ;(message.querySelector('button') as HTMLButtonElement).click()
    expect(start).toHaveBeenCalledTimes(1)
    card.prompt(null)
    expect(message.hidden).toBe(true)
    const reload = vi.fn()
    card.fail('The GPU device was lost.', { actions: [{ label: 'Reload the model', primary: true, run: reload }] })
    expect(document.querySelector('.boot-error-text')!.textContent).toBe('The GPU device was lost.')
    expect(states().download).toBe('failed')
    ;(document.querySelector('.boot-error button') as HTMLButtonElement).click()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('shows an error that is not an Error, and one before any stage', () => {
    const boot = mountBootScreen(document.body, DEMO_STAGES)
    boot.fail('unknown scenario "x"')
    expect(document.querySelector('.boot-error-text')!.textContent).toBe('swarm.press could not start: unknown scenario "x"')
  })
})
