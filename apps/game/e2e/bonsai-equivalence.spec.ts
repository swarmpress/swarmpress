/**
 * Upstream equivalence (ADR-0057): on five fixed prompts, with greedy
 * decoding, the worker adapter must produce exactly the token ids the
 * unmodified upstream engine produces on the main thread. Zero mismatches is
 * the gate for every bump of the pinned engine or model (runtime.lock.json).
 *
 * The ids of a run are also compared with the golden recorded for this GPU
 * and feature set (e2e/bonsai-equivalence.goldens.json), when one exists for
 * the same engine build and model revision: the same pin on the same device
 * must reproduce. BONSAI_UPDATE_GOLDEN=1 records the current run.
 *
 * Gated by BONSAI_E2E=1 (see playwright.bonsai.config.ts); never part of CI.
 *
 *   BONSAI_E2E=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.bonsai.config.ts e2e/bonsai-equivalence.spec.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import type { EquivalenceReport } from '../src/harness/bonsai-harness'
import { checkGolden, EQUIVALENCE_PROMPTS, EQUIVALENCE_TOKENS, type Goldens } from '../src/llm/runtime/bonsai/equivalence'
import { openHarness, requireBonsai, test } from './bonsai-fixture'

const GOLDENS = fileURLToPath(new URL('./bonsai-equivalence.goldens.json', import.meta.url))

requireBonsai()

test('the worker adapter generates the same token ids as upstream on the main thread', async ({ page }) => {
  const errors = await openHarness(page)
  const r = (await page.evaluate((n) => window.__bonsai!.equivalence(n), EQUIVALENCE_TOKENS)) as EquivalenceReport
  console.log(`device ${r.key}`)
  for (const [i, a] of r.adapter.entries()) {
    console.log(`prompt ${i + 1}: ${a.promptTokens} prompt tok, ttft ${a.ttftMs.toFixed(0)} ms, ${a.decodeTps.toFixed(1)} tok/s (upstream ${r.reference[i].decodeTps.toFixed(1)})`)
  }
  expect(r.current.ids).toHaveLength(EQUIVALENCE_PROMPTS.length)
  expect(r.current.ids.every((ids) => ids.length === EQUIVALENCE_TOKENS)).toBe(true)
  // The gate: the Worker, the shims and the adapter's own prefill path change nothing.
  expect(r.workerMismatches).toEqual([])
  expect(r.adapterMismatches).toEqual([])

  const goldens = JSON.parse(readFileSync(GOLDENS, 'utf8')) as Goldens
  const check = checkGolden(goldens, r.key, r.current)
  console.log(`golden for this device: ${check.status}`)
  if (process.env.BONSAI_UPDATE_GOLDEN) {
    goldens[r.key] = r.current
    writeFileSync(GOLDENS, `${JSON.stringify(goldens, null, 2)}\n`)
  } else if (check.status === 'mismatch') {
    // Same engine, same model, same device, different tokens: the runtime is not reproducible.
    expect(check.mismatches).toEqual([])
  }
  expect(errors).toEqual([])
})
