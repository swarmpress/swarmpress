// Aggregation of qualification calls: percentiles, rates and failure
// accounting (a failed call is counted, never dropped).
import { describe, expect, it } from 'vitest'
import type { Usage } from '../types'
import { FrameRecorder } from './frames'
import {
  MIN_DECODE_TOKENS,
  MIN_PREFILL_TOKENS,
  decodeRate,
  downsample,
  failureKind,
  firstAttemptPct,
  oneRepairPct,
  prefillRate,
  quantile,
  stats,
  summarize,
  summarizeArticles,
  type CallRecord,
} from './metrics'

export function call(over: Partial<CallRecord> = {}): CallRecord {
  return {
    key: 'short-action/0',
    fixture: 'short-action',
    index: 0,
    pass: 0,
    kind: 'structured',
    budget: { thinking: 'off', maxTokens: 128 },
    estimatedPromptTokens: 1400,
    startedMs: 0,
    wallMs: 1000,
    ok: true,
    gens: [{ wallMs: 1000, finishReason: 'stop', usage: usage() }],
    attempts: [{ attempt: 0, errors: [] }],
    extraTurns: 0,
    truncations: 0,
    firstAttemptValid: true,
    validWithinOneRepair: true,
    ttftMs: 400,
    checkErrors: [],
    answerChars: 80,
    ...over,
  }
}

function usage(over: Partial<Usage> = {}): Usage {
  return { promptTokens: 1400, completionTokens: 40, durationMs: 1000, tokensPerSec: 25, prefillMs: 350, ttftMs: 400, reasoningTokens: 0, cachedPromptTokens: 700, ...over }
}

describe('quantile and stats', () => {
  it('interpolates linearly between ranks (R-7)', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(quantile(v, 0.5)).toBe(5.5)
    expect(quantile(v, 0.95)).toBeCloseTo(9.55, 10)
    expect(quantile([7], 0.95)).toBe(7)
    expect(quantile([3, 1, 2], 0.5)).toBe(2)
    expect(quantile([], 0.5)).toBeNaN()
    expect(quantile([1, NaN, 3], 0.5)).toBe(2)
  })

  it('summarises finite values only, and nothing when there are none', () => {
    expect(stats([4, 2, NaN, 6, Infinity])).toEqual({ n: 3, p50: 4, p95: 5.8, min: 2, max: 6, mean: 4 })
    expect(stats([])).toBeNull()
    expect(stats([NaN])).toBeNull()
  })

  it('downsamples evenly and keeps short lists whole', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3])
    expect(downsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8])
  })
})

describe('rates', () => {
  it('prefill counts only the tokens that were not cached, and needs enough of them', () => {
    expect(prefillRate(usage({ promptTokens: 1400, cachedPromptTokens: 700, prefillMs: 350 }))).toBe(2000)
    expect(prefillRate(usage({ promptTokens: 700 + MIN_PREFILL_TOKENS - 1, cachedPromptTokens: 700 }))).toBeNull()
    expect(prefillRate(usage({ prefillMs: undefined }))).toBeNull()
    expect(prefillRate(usage({ prefillMs: 0 }))).toBeNull()
    expect(prefillRate(null)).toBeNull()
  })

  it('a call that primed the system prefix counts that prefill too (reported apart by the adapter)', () => {
    // 700 primed in 700 ms, then 700 more in 350 ms: 1400 tokens in 1050 ms.
    const primed = usage({ promptTokens: 1400, cachedPromptTokens: 700, prefillMs: 350, primeMs: 700, primedTokens: 700 })
    expect(prefillRate(primed)).toBeCloseTo((1400 * 1000) / 1050, 6)
    // Nothing primed: the prime time is not added, whatever it says.
    expect(prefillRate(usage({ promptTokens: 1400, cachedPromptTokens: 700, prefillMs: 350, primeMs: 0, primedTokens: 0 }))).toBe(2000)
  })

  it('decode counts reasoning and answer tokens, and needs enough of them', () => {
    expect(decodeRate(usage({ completionTokens: 10, reasoningTokens: MIN_DECODE_TOKENS - 10, tokensPerSec: 21 }))).toBe(21)
    expect(decodeRate(usage({ completionTokens: MIN_DECODE_TOKENS - 1, reasoningTokens: 0 }))).toBeNull()
    expect(decodeRate(usage({ tokensPerSec: 0 }))).toBeNull()
  })
})

describe('summarize', () => {
  const repaired = call({ key: 'short-action/1', extraTurns: 1, firstAttemptValid: false, attempts: [{ attempt: 0, errors: ['x'] }, { attempt: 1, errors: [] }], gens: [{ wallMs: 500, finishReason: 'stop', usage: usage() }, { wallMs: 500, finishReason: 'stop', usage: usage({ cachedPromptTokens: 0 }) }] })
  const twice = call({ key: 'short-action/2', extraTurns: 2, firstAttemptValid: false, validWithinOneRepair: false, wallMs: 3000 })
  const failed = call({ key: 'short-action/3', ok: false, extraTurns: 2, firstAttemptValid: false, validWithinOneRepair: false, error: { name: 'StructuredOutputError', message: 'failed after 3 attempts: $.x is 42 long' }, wallMs: 9000, ttftMs: null, gens: [] })
  const failed2 = call({ key: 'short-action/4', ok: false, extraTurns: 2, firstAttemptValid: false, validWithinOneRepair: false, error: { name: 'StructuredOutputError', message: 'failed after 3 attempts: $.x is 57 long' }, wallMs: 8000, ttftMs: null, gens: [] })
  const cut = call({ key: 'short-action/5', truncations: 1, extraTurns: 1, firstAttemptValid: false })
  const wrong = call({ key: 'short-action/6', checkErrors: ['target is not an item'] })
  const text = call({ key: 'meeting-turn/0', fixture: 'meeting-turn', kind: 'generate', finishReason: 'length', truncations: 1, firstAttemptValid: false, validWithinOneRepair: false })
  const calls = [call(), repaired, twice, failed, failed2, cut, wrong, text]
  const s = summarize(calls)

  it('counts every call, failed ones included', () => {
    expect(s).toMatchObject({ calls: 8, ok: 6, failed: 2, structured: 7, firstAttemptValid: 2, validWithinOneRepair: 4, validEventually: 5, extraTurns: 8, truncations: 2, checkFailed: 1 })
    expect(s.repairsPerCall).toBe(1)
    expect(firstAttemptPct(s)).toBeCloseTo((2 * 100) / 7, 10)
    expect(oneRepairPct(s)).toBeCloseTo((4 * 100) / 7, 10)
  })

  it('takes wall time over all calls and the other figures over the calls that have them', () => {
    expect(s.wallMs).toMatchObject({ n: 8, max: 9000 })
    expect(s.ttftMs).toMatchObject({ n: 6 })
    // Generations: 1 + 2 + 1 + 0 + 0 + 1 + 1 + 1.
    expect(s.gens).toBe(7)
    expect(s.cachedPrefixGens).toBe(6)
    expect(s.prefillTps).toMatchObject({ n: 7, p50: 2000 })
    expect(s.decodeTps).toMatchObject({ n: 7, p50: 25 })
    expect(s.promptTokens!.n).toBe(6)
    expect(s.estimatedPromptTokens!.n).toBe(8)
  })

  it('groups failures by message, folding numbers, with the keys of the first few', () => {
    expect(s.failures).toEqual([{ message: 'StructuredOutputError: failed after N attempts: $.x is N long', count: 2, keys: ['short-action/3', 'short-action/4'] }])
    expect(failureKind(call({ ok: false, finishReason: 'cancelled' }))).toBe('cancelled')
    expect(failureKind(call({ ok: false }))).toBe('no answer')
  })

  it('reports an empty list as zero calls with no percentiles', () => {
    const e = summarize([])
    expect(e).toMatchObject({ calls: 0, failed: 0, repairsPerCall: 0, wallMs: null, ttftMs: null })
    expect(oneRepairPct(e)).toBeNaN()
  })
})

describe('summarizeArticles', () => {
  it('takes time over the completed articles and names where the others stopped', () => {
    const base = { pass: 0, calls: 8, words: 1000, checkFailures: 0 }
    const a = summarizeArticles([
      { ...base, index: 0, ok: true, wallMs: 60_000 },
      { ...base, index: 1, ok: true, wallMs: 120_000 },
      { ...base, index: 2, ok: false, failedStage: 'outline', wallMs: 5000, calls: 1, words: 0 },
      { ...base, index: 3, ok: false, failedStage: 'section-3', wallMs: 50_000, calls: 4, words: 0 },
    ])
    expect(a).toMatchObject({ articles: 4, completed: 2, failed: 2, failedStages: { outline: 1, 'section-3': 1 } })
    expect(a.wallMs).toMatchObject({ n: 2, p50: 90_000 })
  })
})

describe('FrameRecorder', () => {
  it('files each frame interval under what the model was doing', () => {
    const f = new FrameRecorder()
    f.frame(0)
    f.frame(16) // idle-unloaded: 16
    f.setBase('loading')
    f.frame(50) // loading: 34
    f.setBase('idle')
    f.frame(66) // idle: 16
    f.generation(1)
    f.generation(1)
    f.frame(100) // generating: 34
    f.generation(-1)
    f.frame(120) // still generating (one left): 20
    f.generation(-1)
    f.frame(136) // idle: 16
    expect(f.count('idle-unloaded')).toBe(1)
    expect(f.count('loading')).toBe(1)
    expect(f.count('idle')).toBe(2)
    expect(f.count('generating')).toBe(2)
    const s = f.summary('webgpu', 'medium')
    expect(s.phases.generating).toMatchObject({ n: 2, min: 20, max: 34 })
    expect(s).toMatchObject({ renderer: 'webgpu', quality: 'medium', hiddenMs: 0 })
  })

  it('does not count the gap while the tab is hidden', () => {
    const f = new FrameRecorder()
    f.setBase('idle')
    f.frame(0)
    f.frame(16)
    f.visibility(true, 20)
    f.frame(5000) // ignored: hidden
    f.visibility(false, 9000)
    f.frame(9016) // first frame after showing: no interval
    f.frame(9032)
    expect(f.summary('webgl2', 'low')).toMatchObject({ hiddenMs: 8980, phases: { idle: { n: 2, max: 16 } } })
    f.generation(-1) // never below zero
    expect(f.phase).toBe('idle')
  })
})
