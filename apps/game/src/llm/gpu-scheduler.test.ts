import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GpuScheduler, type RendererHooks } from './gpu-scheduler'

function hooks() {
  const calls: string[] = []
  const h: RendererHooks = {
    setQualityDrop: (n) => calls.push(`drop:${n}`),
    setFpsCap: (f) => calls.push(`fps:${f}`),
  }
  return { h, calls }
}

describe('GpuScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('drops one tier + caps FPS on start, restores after the cooldown', () => {
    const { h, calls } = hooks()
    const s = new GpuScheduler(h, { fpsCap: 30, restoreDelayMs: 1000 })
    s.begin('j1')
    expect(s.state).toBe('generating')
    expect(calls).toEqual(['drop:1', 'fps:30'])
    s.end('j1')
    expect(s.state).toBe('cooldown')
    vi.advanceTimersByTime(999)
    expect(calls).toEqual(['drop:1', 'fps:30'])
    vi.advanceTimersByTime(1)
    expect(s.state).toBe('idle')
    expect(calls).toEqual(['drop:1', 'fps:30', 'drop:0', 'fps:null'])
  })

  it('back-to-back jobs during the cooldown do not flicker quality', () => {
    const { h, calls } = hooks()
    const s = new GpuScheduler(h, { restoreDelayMs: 1000 })
    s.begin('a')
    s.end('a')
    vi.advanceTimersByTime(500)
    s.begin('b')
    vi.advanceTimersByTime(5000) // cancelled timer must not fire
    expect(s.state).toBe('generating')
    s.end('b')
    vi.advanceTimersByTime(1000)
    expect(calls).toEqual(['drop:1', 'fps:30', 'drop:0', 'fps:null'])
  })

  it('stays generating until every concurrent generation ended; begin/end are idempotent', () => {
    const { h } = hooks()
    const s = new GpuScheduler(h)
    s.begin('a')
    s.begin('a')
    s.begin('b')
    s.end('a')
    s.end('a')
    expect(s.state).toBe('generating')
    s.end('b')
    expect(s.state).toBe('cooldown')
    s.end('zzz') // unknown id is a no-op
    expect(s.snapshot().active).toBe(0)
  })

  it('sustained slow frames while generating drop one more tier (bounded by maxDrop)', () => {
    const { h, calls } = hooks()
    const s = new GpuScheduler(h, { fpsCap: 30, slowFramesBeforeExtraDrop: 3, maxDrop: 2 })
    for (let i = 0; i < 10; i++) s.reportFrameTime(80) // idle: ignored
    expect(calls).toEqual([])
    s.begin('a')
    for (let i = 0; i < 20; i++) s.reportFrameTime(80)
    expect(calls).toEqual(['drop:1', 'fps:30', 'drop:2'])
    expect(s.snapshot().qualityDrop).toBe(2)
    s.end('a')
    vi.runAllTimers()
    expect(calls.at(-2)).toBe('drop:0')
  })

  it('pauses new generations while hidden when the setting is on', async () => {
    const { h } = hooks()
    const s = new GpuScheduler(h, { pauseWhenHidden: true })
    await expect(s.waitUntilRunnable()).resolves.toBeUndefined()
    s.setHidden(true)
    expect(s.paused).toBe(true)
    let ran = false
    const p = s.waitUntilRunnable().then(() => (ran = true))
    await Promise.resolve()
    expect(ran).toBe(false)
    s.setHidden(false)
    await p
    expect(ran).toBe(true)
  })

  it('does not pause when the setting is off, and turning it off releases waiters', async () => {
    const { h } = hooks()
    const s = new GpuScheduler(h, { pauseWhenHidden: false })
    s.setHidden(true)
    expect(s.paused).toBe(false)
    s.updateSettings({ pauseWhenHidden: true })
    expect(s.paused).toBe(true)
    const p = s.waitUntilRunnable()
    s.updateSettings({ pauseWhenHidden: false })
    await expect(p).resolves.toBeUndefined()
  })

  it('wires document visibility and notifies listeners', () => {
    const { h } = hooks()
    const s = new GpuScheduler(h)
    const doc = Object.assign(new EventTarget(), { hidden: false })
    const states: boolean[] = []
    s.onChange((snap) => states.push(snap.paused))
    const off = s.attachVisibility(doc as unknown as Document)
    doc.hidden = true
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(s.paused).toBe(true)
    off()
    doc.hidden = false
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(s.paused).toBe(true) // detached
    expect(states).toContain(true)
  })

  it('dispose restores the renderer', () => {
    const { h, calls } = hooks()
    const s = new GpuScheduler(h)
    s.begin('a')
    s.dispose()
    expect(calls).toEqual(['drop:1', 'fps:30', 'drop:0', 'fps:null'])
  })
})
