// @vitest-environment jsdom
// The local model's card (ADR-0057, R8): a view of the runtime; the player decides, the card only asks.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STARTUP_STAGES, type StartupStageId } from '../llm/startup'
import type { ModelRuntime, ModelRuntimeInfo, StageView } from '../session/model-runtime'
import { mountModelCard, MODEL_CARD_ID } from './model-card'

afterEach(() => document.body.replaceChildren())

function info(over: Partial<ModelRuntimeInfo> = {}, stages: Partial<Record<StartupStageId, StageView>> = {}): ModelRuntimeInfo {
  return {
    backend: 'bonsai',
    label: 'Ternary Bonsai 2 (in-browser WebGPU)',
    source: 'query',
    phase: 'starting',
    stage: null,
    stages: { ...(Object.fromEntries(STARTUP_STAGES.map((s) => [s.id, { state: 'pending', detail: null }])) as Record<StartupStageId, StageView>), ...stages },
    error: null,
    explain: null,
    canTakeOver: false,
    alternatives: [],
    storage: null,
    fromCache: null,
    loads: 0,
    losses: 0,
    discarded: 0,
    ms: {},
    ...over,
  }
}

function fakeRuntime(first: ModelRuntimeInfo) {
  let current = first
  const listeners = new Set<(i: ModelRuntimeInfo) => void>()
  const rt = {
    info: () => current,
    onChange: (fn: (i: ModelRuntimeInfo) => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    accept: vi.fn(),
    decline: vi.fn(),
    retry: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    takeOver: vi.fn(async () => undefined),
    switchBackend: vi.fn(async () => undefined),
  }
  const set = (i: ModelRuntimeInfo) => {
    current = i
    listeners.forEach((l) => l(i))
  }
  return { rt: rt as unknown as ModelRuntime & typeof rt, set }
}

const card = () => document.getElementById(MODEL_CARD_ID)
const buttons = () => [...(card()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)
const click = (name: string) => [...card()!.querySelectorAll('button')].find((b) => b.textContent === name)!.click()

describe('the model card', () => {
  it('shows the stages with their notes while the model starts, and leaves when it is ready', () => {
    const { rt, set } = fakeRuntime(info({}, { probe: { state: 'done', detail: 'WebGPU ready' }, download: { state: 'active', detail: 'downloading 36% (2.1 GB of 5.9 GB)' } }))
    mountModelCard(rt)
    expect(card()!.dataset.phase).toBe('starting')
    expect(card()!.querySelector('[data-stage="download"]')!.textContent).toBe('Download the weightsdownloading 36% (2.1 GB of 5.9 GB)')
    // The office stays usable: the card can be folded away; the HUD chip keeps saying what happens.
    expect(buttons()).toEqual(['Hide'])
    click('Hide')
    expect(card()!.dataset.collapsed).toBe('true')
    set(info({ phase: 'ready' }))
    expect(card()).toBeNull()
  })

  it('asks before the first download; the player starts it or not', () => {
    const { rt } = fakeRuntime(info({ phase: 'explain', explain: 'Your staff think with a language model that runs here … about 5.9 GB.' }, { explain: { state: 'active', detail: null } }))
    mountModelCard(rt)
    expect(card()!.textContent).toContain('about 5.9 GB')
    expect(buttons()).toEqual(['Start the model', 'Not now'])
    click('Start the model')
    expect(rt.accept).toHaveBeenCalledTimes(1)
    click('Not now')
    expect(rt.decline).toHaveBeenCalledTimes(1)
  })

  it('says the model is in another tab and offers to take it over', () => {
    const { rt } = fakeRuntime(info({ phase: 'elsewhere', canTakeOver: true }))
    mountModelCard(rt)
    expect(card()!.textContent).toContain('The model is running in another tab of swarm.press')
    click('Take over here')
    expect(rt.takeOver).toHaveBeenCalledTimes(1)
  })

  it('a blocked backend is an alert with the reason; switching is offered, never done for the player', () => {
    const reloadPage = vi.fn()
    const error = 'Ternary Bonsai 2 (in-browser WebGPU) cannot be used here: WebGPU is not available in this browser'
    const { rt } = fakeRuntime(info({ phase: 'blocked', stage: 'probe', error, alternatives: ['chrome', 'transformers'] }, { probe: { state: 'failed', detail: error } }))
    mountModelCard(rt, document.body, { reloadPage })
    expect(card()!.getAttribute('role')).toBe('alert')
    expect(card()!.querySelector('.boot-error-text')!.textContent).toBe(error)
    expect(buttons()).toEqual(['Try again', 'Use Chrome built-in AI (browser-managed) for this company', 'Use Transformers.js (ONNX Runtime Web) for this company'])
    expect(rt.switchBackend).not.toHaveBeenCalled()
    click('Use Chrome built-in AI (browser-managed) for this company')
    expect(rt.switchBackend).toHaveBeenCalledWith('chrome')
    return vi.waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  })

  it('a lost device offers to reload the model', () => {
    const { rt, set } = fakeRuntime(info({ phase: 'ready' }))
    mountModelCard(rt)
    expect(card()).toBeNull()
    set(info({ phase: 'lost', error: 'GPU process crashed' }))
    expect(card()!.querySelector('.boot-error-text')!.textContent).toMatch(/^The GPU device was lost \(GPU process crashed\)\. The call in progress was discarded/)
    click('Reload the model')
    expect(rt.reload).toHaveBeenCalledTimes(1)
  })
})
