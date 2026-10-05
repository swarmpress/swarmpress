import { describe, expect, it } from 'vitest'
import { HostedLlm, HOSTED_MODEL_ID } from './hosted-llm'
import { isUnavailableError } from './types'
import type { LlmGenerateReply, LlmGenerateRequest } from '../net/central'

function reply(text: string, over: Partial<LlmGenerateReply> = {}): LlmGenerateReply {
  return {
    job_id: 'job-1',
    text,
    finish: 'stop',
    model: HOSTED_MODEL_ID,
    service_tier: 'flex',
    usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 50, reasoning_tokens: 30 },
    cost_micros: 40,
    duration_ms: 1000,
    ...over,
  }
}

function adapter(answer: (b: LlmGenerateRequest) => Promise<LlmGenerateReply> | LlmGenerateReply) {
  const sent: LlmGenerateRequest[] = []
  const llm = new HostedLlm({
    send: async (b) => {
      sent.push(b)
      return answer(b)
    },
  })
  return { llm, sent }
}

/** What CentralClient throws for a non-2xx answer. */
const httpError = (status: number, message: string) => Object.assign(new Error(message), { name: 'CentralError', status })

describe('HostedLlm', () => {
  it('loads without downloading and sends the conversation with effort, budget and tier', async () => {
    const { llm, sent } = adapter(() => reply('Ciao'))
    const phases: string[] = []
    await llm.load(HOSTED_MODEL_ID, (p) => phases.push(p.phase))
    expect(phases).toEqual(['ready'])
    const deltas: string[] = []
    const r = await llm.generate(
      [
        { role: 'system', content: 'brief' },
        { role: 'user', content: 'hi' },
      ],
      { maxTokens: 200, thinking: 'medium', reasoningBudget: 300, onDelta: (d) => deltas.push(d) },
    )
    expect(sent[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'brief' },
        { role: 'user', content: 'hi' },
      ],
      max_output_tokens: 500,
      reasoning_effort: 'medium',
      service_tier: 'flex',
    })
    expect(sent[0].json_schema).toBeUndefined()
    expect(r.text).toBe('Ciao')
    expect(deltas).toEqual(['Ciao'])
    expect(r.finishReason).toBe('stop')
    expect(r.usage).toMatchObject({ promptTokens: 120, completionTokens: 20, reasoningTokens: 30, cachedPromptTokens: 20, tokensPerSec: 50 })
  })

  it('thinking off is effort none with the answer budget only; an interactive turn uses Standard', async () => {
    const { llm, sent } = adapter(() => reply('ok'))
    await llm.load(HOSTED_MODEL_ID)
    await llm.generate([{ role: 'user', content: 'x' }], { maxTokens: 64, interactive: true })
    expect(sent[0]).toMatchObject({ max_output_tokens: 64, reasoning_effort: 'none', service_tier: 'default' })
  })

  it('structured calls send the schema and parse the JSON answer', async () => {
    const { llm, sent } = adapter(() => reply('{"title":"Vernazza"}'))
    await llm.load(HOSTED_MODEL_ID)
    const schema = { type: 'object', required: ['title'], properties: { title: { type: 'string' } } }
    const v = await llm.structured<{ title: string }>([{ role: 'user', content: 'title' }], schema, { answerPrefix: '{' })
    expect(v).toEqual({ title: 'Vernazza' })
    expect(sent[0].json_schema).toEqual(schema)
  })

  it('applies stop sequences and reports an answer cut by the output limit as length', async () => {
    const { llm } = adapter((b) => (b.max_output_tokens === 10 ? reply('half an ans', { finish: 'length' }) : reply('one END two')))
    await llm.load(HOSTED_MODEL_ID)
    expect((await llm.generate([{ role: 'user', content: 'x' }], { stop: [' END'] })).text).toBe('one')
    expect((await llm.generate([{ role: 'user', content: 'x' }], { maxTokens: 10 })).finishReason).toBe('length')
  })

  it('a 503 (no key, no credits, busy provider) is the model being unavailable; other errors stay errors', async () => {
    const down = adapter(() => {
      throw httpError(503, 'the model provider account has no credits')
    })
    await down.llm.load(HOSTED_MODEL_ID)
    const e = await down.llm.generate([{ role: 'user', content: 'x' }]).catch((x: unknown) => x)
    expect(isUnavailableError(e)).toBe(true)
    const budget = adapter(() => {
      throw httpError(429, 'the daily model budget is used up')
    })
    await budget.llm.load(HOSTED_MODEL_ID)
    const b = await budget.llm.generate([{ role: 'user', content: 'x' }]).catch((x: unknown) => x)
    expect(isUnavailableError(b)).toBe(false)
    expect((b as Error).message).toMatch(/budget/)
  })

  it('an aborted turn is cancelled and sends nothing', async () => {
    const { llm, sent } = adapter(() => reply('never'))
    await llm.load(HOSTED_MODEL_ID)
    const ac = new AbortController()
    ac.abort()
    const r = await llm.generate([{ role: 'user', content: 'x' }], { signal: ac.signal })
    expect(r.finishReason).toBe('cancelled')
    expect(sent).toHaveLength(0)
  })

  it('says it runs on the server, without WebGPU', async () => {
    const { llm } = adapter(() => reply('x'))
    const c = await llm.capabilities()
    expect(c).toMatchObject({ backend: 'openai-responses', webgpu: false, contextTokens: 1_050_000 })
    expect(c.unavailable).toBeUndefined()
  })
})
