/**
 * Builders of synthetic results for the report tests: one value per field
 * that matters, so a test can put a measurement exactly at a threshold.
 */
import type { FixtureId } from './fixtures'
import { FIXTURES } from './fixtures'
import { RESULTS_SCHEMA, type BenchConfig, type BenchResults, type CallRecord, type LoadRecord } from './metrics'
import type { Usage } from '../types'

export function usage(over: Partial<Usage> = {}): Usage {
  return { promptTokens: 1400, completionTokens: 40, durationMs: 1000, tokensPerSec: 25, prefillMs: 350, ttftMs: 400, reasoningTokens: 0, cachedPromptTokens: 0, ...over }
}

export function call(over: Partial<CallRecord> = {}): CallRecord {
  const fixture = over.fixture ?? 'short-action'
  const kind = over.kind ?? (FIXTURES[fixture].kind === 'generate' ? 'generate' : 'structured')
  return {
    key: `${fixture}/${over.index ?? 0}`,
    fixture,
    index: 0,
    pass: 0,
    kind,
    budget: FIXTURES[fixture].budget,
    estimatedPromptTokens: 1400,
    startedMs: 0,
    wallMs: 1000,
    ok: true,
    gens: [{ wallMs: 1000, finishReason: 'stop', usage: usage() }],
    attempts: kind === 'structured' ? [{ attempt: 0, errors: [] }] : [],
    extraTurns: 0,
    truncations: 0,
    firstAttemptValid: kind === 'structured',
    validWithinOneRepair: kind === 'structured',
    ttftMs: 400,
    checkErrors: [],
    answerChars: 80,
    ...over,
  }
}

/** `n` calls of a fixture with distinct keys; `each(i)` overrides per call. */
export function calls(fixture: FixtureId, n: number, each: (i: number) => Partial<CallRecord> = () => ({})): CallRecord[] {
  return Array.from({ length: n }, (_, i) => call({ fixture, index: i, key: `${fixture}/${i}`, ...each(i) }))
}

export function load(kind: LoadRecord['kind'], loadMs: number, warmupMs = 0, index = 0): LoadRecord {
  return {
    kind,
    index,
    ok: true,
    loadMs,
    warmupMs,
    stages: [
      { stage: 'verify', ms: 100, messages: [] },
      { stage: 'weights', ms: loadMs - 200, bytesLoaded: 5_946_648_928, bytesTotal: 5_946_648_928, messages: [] },
      { stage: 'init', ms: 100, messages: [] },
      { stage: 'warm-up', ms: warmupMs, messages: [] },
    ],
  }
}

export function benchConfig(over: Partial<BenchConfig> = {}): BenchConfig {
  return {
    backend: 'bonsai',
    quality: null,
    suite: 'full',
    scale: 1,
    fixtures: [],
    thinking: null,
    context: null,
    pipelineDepth: null,
    repeat: 1,
    reloads: 0,
    start: 'unknown',
    deviceLoss: 'none',
    callTimeoutMs: 900_000,
    idleMs: 0,
    ...over,
  }
}

export function results(over: Partial<BenchResults> = {}, config: Partial<BenchConfig> = {}): BenchResults {
  const c = benchConfig(config)
  const ids = (over.calls ?? []).map((x) => x.fixture).filter((id, i, all) => all.indexOf(id) === i)
  return {
    schema: RESULTS_SCHEMA,
    backend: c.backend,
    backendLabel: c.backend,
    modelId: 'ternary-bonsai-2-27b',
    model: null,
    config: c,
    fixtures: ids.map((id) => ({ id, letter: FIXTURES[id].letter, label: FIXTURES[id].label, kind: FIXTURES[id].kind, count: FIXTURES[id].count, fullCount: FIXTURES[id].count, prompts: FIXTURES[id].kind === 'staged' ? FIXTURES[id].count * 8 : new Set((over.calls ?? []).filter((c) => c.fixture === id).map((c) => c.key)).size, budget: FIXTURES[id].budget, inputTokens: FIXTURES[id].inputTokens })),
    env: { userAgent: 'test', browser: 'Chrome 154.0.8037.95', crossOriginIsolated: true, hardwareConcurrency: 16, deviceMemoryGb: 8, gpu: null },
    capabilities: { probe: null, loaded: null },
    startedAt: '2026-10-02T10:00:00.000Z',
    finishedAt: '2026-10-02T11:00:00.000Z',
    complete: true,
    start: { declared: 'unknown', inferred: 'unknown' },
    loads: [],
    passes: [{ index: 0, startedMs: 0, wallMs: 1, calls: over.calls?.length ?? 0, failures: 0, deviceLost: false }],
    calls: [],
    articles: [],
    memory: [],
    frames: null,
    equivalence: null,
    deviceLoss: null,
    events: [],
    ...over,
  }
}
