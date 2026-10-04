// @vitest-environment jsdom
// WebGPU only (ADR-0064, FEAT-017): no WebGPU means a NoWebGpuError and the
// no-WebGPU screen, never another renderer. The engine itself is covered by the
// Playwright smoke test on SwiftShader WebGPU (e2e/smoke.spec.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEngine, NoWebGpuError, watchDeviceLoss } from './engine'
import { mountNoWebGpu, noWebGpuMessage, REQUIREMENTS_URL, SUPPORTED_BROWSERS } from './no-webgpu'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('createEngine', () => {
  it('rejects with no-api when navigator.gpu is missing', async () => {
    expect('gpu' in navigator).toBe(false)
    const err = await createEngine(document.createElement('canvas')).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoWebGpuError)
    expect((err as NoWebGpuError).reason).toBe('no-api')
  })

  it('names an insecure context as the reason navigator.gpu is hidden', async () => {
    vi.stubGlobal('isSecureContext', false)
    const err = (await createEngine(document.createElement('canvas')).catch((e: unknown) => e)) as NoWebGpuError
    expect(err.reason).toBe('no-api')
    expect(err.detail).toMatch(/secure context/)
  })
})

describe('watchDeviceLoss', () => {
  const fakeEngine = () => {
    let lose: (info: { reason: string; message: string }) => void = () => {}
    const device = { lost: new Promise<{ reason: string; message: string }>((r) => (lose = r)), destroy: vi.fn() }
    const engine = { _device: device, dispose: vi.fn() }
    return { engine, device, lose: (reason: string) => lose({ reason, message: 'gone' }) }
  }

  it('reports a loss once', async () => {
    const f = fakeEngine()
    const onLost = vi.fn()
    watchDeviceLoss(f.engine as never, onLost)
    f.lose('unknown')
    await Promise.resolve()
    expect(onLost).toHaveBeenCalledWith({ reason: 'unknown', message: 'gone' })
  })

  it('ignores the loss its own dispose causes, and destroys the device on request', async () => {
    const f = fakeEngine()
    const onLost = vi.fn()
    const handle = watchDeviceLoss(f.engine as never, onLost)
    handle.destroyDevice()
    expect(f.device.destroy).toHaveBeenCalled()
    handle.dispose()
    expect(f.engine.dispose).toHaveBeenCalled()
    f.lose('destroyed')
    await Promise.resolve()
    expect(onLost).not.toHaveBeenCalled()
  })
})

describe('the no-WebGPU screen', () => {
  it('says what is missing, names the browsers that work and links to the requirements', () => {
    const el = mountNoWebGpu(document.body, 'no-adapter', 'Could not retrieve a WebGPU adapter')
    expect(el.getAttribute('role')).toBe('alert')
    expect(el.dataset.reason).toBe('no-adapter')
    expect(el.querySelector('h1')?.textContent).toBe('swarm.press needs WebGPU')
    expect(el.textContent).toContain(noWebGpuMessage('no-adapter'))
    expect(Array.from(el.querySelectorAll('li'), (li) => li.textContent)).toEqual(SUPPORTED_BROWSERS)
    expect(el.querySelector('a')?.getAttribute('href')).toBe(REQUIREMENTS_URL)
    expect(el.textContent).toContain('Could not retrieve a WebGPU adapter')
  })

  it('has a message for every reason', () => {
    for (const r of ['no-api', 'no-adapter', 'device-failed', 'device-lost'] as const) expect(noWebGpuMessage(r).length).toBeGreaterThan(20)
  })
})
