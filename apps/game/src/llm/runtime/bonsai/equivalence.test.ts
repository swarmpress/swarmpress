import { describe, expect, it } from 'vitest'
import { checkGolden, compareIds, EQUIVALENCE_PROMPTS, EQUIVALENCE_TOKENS, goldenKey, type EquivalenceGolden } from './equivalence'
import { BonsaiLlm } from './bonsai-llm'
import { fakeEngine, FakeSession } from './testing/fake-session'
import { mergeSystem, templateArgs } from './think'

const device = (over: Partial<{ shaderF16: boolean; subgroups: boolean; subgroupMatrix: boolean }> = {}) => ({
  vendor: 'apple',
  architecture: 'metal-3',
  device: '',
  description: 'Apple M3 Max',
  isFallbackAdapter: false,
  features: { shaderF16: true, subgroups: true, subgroupMatrix: false, timestampQuery: true, ...over },
})

const golden = (ids: number[][]): EquivalenceGolden => ({ engineSha256: 'e1', modelRevision: 'r1', maxNewTokens: 4, ids })

describe('compareIds', () => {
  it('is empty for identical runs', () => {
    expect(compareIds([[1, 2], [3]], [[1, 2], [3]])).toEqual([])
  })

  it('reports the first differing position per prompt, including length differences', () => {
    expect(compareIds([[1, 2, 3], [4, 5], [6]], [[1, 9, 3], [4, 5, 7], [6]])).toEqual([
      { prompt: 0, index: 1, expected: 2, actual: 9 },
      { prompt: 1, index: 2, expected: null, actual: 7 },
    ])
    expect(compareIds([[1]], [])).toEqual([{ prompt: 0, index: 0, expected: 1, actual: null }])
  })
})

describe('goldens', () => {
  it('are keyed by adapter and feature set', () => {
    expect(goldenKey(device())).toBe('apple|metal-3|Apple M3 Max|f16|sg|no-sgmat')
    expect(goldenKey(device({ shaderF16: false }))).not.toBe(goldenKey(device()))
    expect(goldenKey(device({ subgroupMatrix: true }))).toBe('apple|metal-3|Apple M3 Max|f16|sg|sgmat')
  })

  it('compare only against the same engine build and model revision', () => {
    const key = goldenKey(device())
    const store = { [key]: golden([[1, 2]]) }
    expect(checkGolden({}, key, golden([[1, 2]]))).toEqual({ status: 'missing' })
    expect(checkGolden(store, key, golden([[1, 2]]))).toEqual({ status: 'match' })
    expect(checkGolden(store, key, golden([[1, 3]]))).toEqual({ status: 'mismatch', mismatches: [{ prompt: 0, index: 1, expected: 2, actual: 3 }] })
    expect(checkGolden(store, key, { ...golden([[9, 9]]), engineSha256: 'e2' }).status).toBe('stale')
    expect(checkGolden(store, key, { ...golden([[9, 9]]), modelRevision: 'r2' }).status).toBe('stale')
  })
})

describe('the fixed prompts', () => {
  it('are five conversations the chat template accepts (system first, a user turn last)', () => {
    expect(EQUIVALENCE_PROMPTS).toHaveLength(5)
    expect(EQUIVALENCE_TOKENS).toBe(64)
    for (const p of EQUIVALENCE_PROMPTS) {
      expect(p.at(-1)!.role).toBe('user')
      expect(mergeSystem(p)).toEqual(p)
    }
    expect(EQUIVALENCE_PROMPTS.filter((p) => p[0].role === 'system')).toHaveLength(2)
  })

  it("give identical ids through the adapter and through the engine's own benchmark (fake session)", async () => {
    // The same check the gated e2e runs on the real engine, here on the fake:
    // the adapter's prefill and stream path against benchmarkFixedTokenIds.
    const script = EQUIVALENCE_PROMPTS.flatMap(() => [{ answer: 'una risposta di prova, abbastanza lunga per sessantaquattro token' }])
    const reference = new FakeSession({ script })
    reference.chatTemplateArgs = templateArgs('off')
    const expected: number[][] = []
    for (const p of EQUIVALENCE_PROMPTS) expected.push((await reference.benchmarkFixedTokenIds(reference.encodePrompt(mergeSystem(p)), 8, {})).ids)

    const session = new FakeSession({ script })
    const llm = new BonsaiLlm({ resolve: () => ({ hfRepo: 'r', file: 'f', revision: 'v', sha256: 's', sizeBytes: 1, context: 4096, runtime: { url: 'u', sha256: 'h' } }), importEngine: async () => fakeEngine(session), skipRemoteCheck: true })
    await llm.load('m')
    const actual: number[][] = []
    for (const p of EQUIVALENCE_PROMPTS) actual.push((await llm.bench({ messages: p, maxNewTokens: 8, mode: 'adapter' })).ids)
    expect(compareIds(expected, actual)).toEqual([])
    expect(actual.every((ids) => ids.length === 8)).toBe(true)
  })
})
