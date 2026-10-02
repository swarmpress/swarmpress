/**
 * The Bonsai WebGPU runtime end to end on the real engine and model
 * (ADR-0057, FEAT-037): bonsai.html → LlmClient → module Worker → the pinned
 * upstream engine → WebGPU.
 *
 * Gated: runs only with BONSAI_E2E=1 (see playwright.bonsai.config.ts). It is
 * not part of CI: it needs a GPU and downloads about 6 GB on first run.
 *
 *   BONSAI_E2E=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.bonsai.config.ts e2e/bonsai.spec.ts
 */
import { expect } from '@playwright/test'
import type { SmokeReport } from '../src/harness/bonsai-harness'
import type { RuntimeCapabilities } from '../src/llm/types'
import { openHarness, requireBonsai, test } from './bonsai-fixture'

requireBonsai()

test('the device offers WebGPU and the page is cross-origin isolated', async ({ page }) => {
  const errors = await openHarness(page)
  const isolated = await page.evaluate(() => window.__bonsai!.crossOriginIsolated)
  expect(isolated).toBe(true)
  const caps = (await page.evaluate(() => window.__bonsai!.probe())) as RuntimeCapabilities
  console.log(`probe: ${JSON.stringify(caps)}`)
  expect(caps.backend).toBe('bonsai-kernels')
  expect(caps.unavailable).toBeUndefined()
  expect(caps.webgpu).toBe(true)
  expect(caps.supportsConstrainedOutput).toBe(false)
  expect(errors).toEqual([])
})

test('loads in the worker, streams a turn with a system message, reuses the prefix, cancels, reasons', async ({ page }) => {
  const errors = await openHarness(page)
  const r = (await page.evaluate(() => window.__bonsai!.smoke())) as SmokeReport
  console.log(
    `load ${(r.loadMs / 1000).toFixed(1)} s · turn ${r.turn.usage.completionTokens} tok, ttft ${r.turn.usage.ttftMs?.toFixed(0)} ms, ` +
      `${r.turn.usage.tokensPerSec.toFixed(1)} tok/s · second turn cached ${r.second.usage.cachedPromptTokens}/${r.second.usage.promptTokens}`,
  )
  expect(r.capabilities).toMatchObject({ backend: 'bonsai-kernels', webgpu: true, contextTokens: 16384 })
  // The high-level upstream call would have thrown on the system message; the adapter answers.
  expect(r.turn.text.trim().length).toBeGreaterThan(0)
  expect(r.turn.usage.completionTokens).toBeGreaterThan(0)
  expect(r.deltas).toBeGreaterThan(0)
  expect(['stop', 'length']).toContain(r.turn.finishReason)
  // The second turn shares the system prompt: its prefix comes from the rewind point.
  expect(r.second.usage.cachedPromptTokens).toBeGreaterThan(0)
  expect(r.second.usage.cachedPromptTokens).toBe(r.turn.usage.cachedPromptTokens)
  // Cancelled mid-stream, and the model is still usable afterwards.
  expect(r.cancelled.finishReason).toBe('cancelled')
  expect(r.cancelled.usage.completionTokens).toBeLessThan(512)
  // Reasoning stays out of the answer and inside its budget.
  expect(r.reasoned.text).not.toMatch(/<\/?think>/)
  expect(r.reasoned.usage.reasoningTokens).toBeGreaterThan(0)
  expect(r.reasoned.usage.reasoningTokens).toBeLessThanOrEqual(256)
  expect(r.events).toEqual([])
  expect(errors).toEqual([])
})
