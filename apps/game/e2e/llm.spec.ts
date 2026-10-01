/**
 * Local LLM runtime end to end in headless Chromium:
 *   llm.html → LlmClient → module Worker → Transformers.js v4 →
 *   onnxruntime-web (self-hosted wasm, WebGPU or wasm EP) → TextStreamer →
 *   RPC deltas back on the main thread.
 *
 * Gated: runs only with LLM_E2E=1 (model download / heavy wasm).
 *
 * Model: by default the offline fixture `tiny-random-llama` (random
 * weights, generated in-worker by src/llm/testing/tiny-model.ts) so the
 * test needs no network. Set LLM_E2E_MODEL=<registry id> to run a real Hub
 * model instead (e.g. qwen3-0.6b-q4f16; needs huggingface.co access).
 *
 *   LLM_E2E=1 pnpm --filter @swarm-press/game exec playwright test e2e/llm.spec.ts
 */
import { expect, test } from '@playwright/test'

type Report = {
  modelId: string
  device: 'webgpu' | 'wasm'
  loadMs: number
  progressEvents: number
  lastProgress: { phase: string; fraction: number } | null
  deltas: string[]
  result: { text: string; finishReason: string; usage: { promptTokens: number; completionTokens: number; durationMs: number; tokensPerSec: number } }
  webgpuAdapter: boolean
}

const MODEL = process.env.LLM_E2E_MODEL || 'tiny-random-llama'

test.skip(!process.env.LLM_E2E, 'set LLM_E2E=1 to run the local LLM end-to-end test')

async function smoke(page: import('@playwright/test').Page, device: 'webgpu' | 'wasm'): Promise<Report> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto('/llm.html')
  await page.waitForFunction(() => !!(window as unknown as { __llmHarness?: unknown }).__llmHarness)
  const report = await page.evaluate(
    async ({ device, modelId }) => {
      const h = (window as unknown as { __llmHarness: { ready: Promise<void>; runSmoke(o: object): Promise<unknown> } }).__llmHarness
      await h.ready
      return h.runSmoke({ modelId, device, maxTokens: 24, temperature: 0 })
    },
    { device, modelId: MODEL },
  )
  const r = report as Report
  console.log(
    `[llm e2e] ${r.modelId} on ${r.device}: load ${r.loadMs.toFixed(0)} ms, ` +
      `${r.result.usage.promptTokens} prompt + ${r.result.usage.completionTokens} completion tokens, ` +
      `${r.result.usage.tokensPerSec.toFixed(1)} tok/s, ${r.deltas.length} deltas, finish=${r.result.finishReason}\n` +
      `[llm e2e] text: ${JSON.stringify(r.result.text)}`,
  )
  expect(errors.filter((e) => !/powerPreference/i.test(e))).toEqual([])
  return r
}

function assertStreamed(r: Report) {
  expect(r.lastProgress).toMatchObject({ phase: 'ready', fraction: 1 })
  expect(r.progressEvents).toBeGreaterThan(1)
  expect(r.result.usage.completionTokens).toBeGreaterThan(0)
  expect(r.deltas.length).toBeGreaterThan(1) // streamed in pieces, not one blob
  expect(r.deltas.join('')).toBe(r.result.text)
  expect(r.result.text.trim().length).toBeGreaterThan(0)
  expect(['stop', 'length']).toContain(r.result.finishReason)
}

test('worker generates and streams tokens on the wasm device', async ({ page }) => {
  const r = await smoke(page, 'wasm')
  assertStreamed(r)
})

test('worker generates and streams tokens on WebGPU', async ({ page }, info) => {
  test.skip(info.project.name !== 'webgpu', 'WebGPU needs the webgpu project (SwiftShader flags)')
  const hasAdapter = await page.goto('/llm.html').then(() =>
    page.evaluate(async () => !!(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter())),
  )
  test.skip(!hasAdapter, 'no WebGPU adapter in this Chromium')
  const r = await smoke(page, 'webgpu')
  assertStreamed(r)
})
