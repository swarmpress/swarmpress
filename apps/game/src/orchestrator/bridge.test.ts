// The MVP loop in Node through orchestrator-wasm with the browser's pieces:
// CompanyStore (memory engine, the same SQL as turso/sqlite), the `?llm=fake`
// LocalLlm (FakeLlm + the LocalLlm structured-output path) through
// localLlmBridge, and a fake JS gateway. Needs `cargo xtask wasm`.
import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { OrchestratorHandle, validateJson } from 'orchestrator-wasm'
import styleGuide from '../../../../crates/agents/tests/fixtures/style-guide.json'
import { FakeLlm } from '../llm/fake-llm'
import { MVP_POST_TYPES, MVP_REVIEW_NOTE } from '../llm/mvp-script'
import { CompanyStore } from '../store/company-store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import { fakeMvpLlm, llmModeFromQuery } from './index'
import { defaultCallPolicy, localLlmBridge, runMvpLoop, rustValidator, toChatMessages, type SiteBindingJson } from './bridge'

const SITE: SiteBindingJson = {
  site_id: 'cinqueterre.travel',
  brand_name: 'Cinque Terre Dispatch',
  language: 'en',
  style_guide: styleGuide,
  quality_bar: 7,
  simulate_deploy: true,
  standup_max_turns: 4,
}

function fakeGateway() {
  const prs: { branch: string; head: string; merged: string | null; workItem: string | null; page: string }[] = []
  return {
    prs,
    async openDraft(contentId: string, path: string, pageJson: string, _message: string, workItem: string | null) {
      expect(path.startsWith('content/')).toBe(true)
      const branch = `drafts/content-${contentId}`
      let n = prs.findIndex((p) => p.branch === branch && !p.merged)
      if (n < 0) n = prs.push({ branch, head: '', merged: null, workItem, page: '' }) - 1
      prs[n].head = `head-${n + 1}-${pageJson.length}`
      prs[n].page = pageJson
      return { number: n + 1, branch, head_sha: prs[n].head }
    },
    async merge(number: number, headSha: string) {
      const pr = prs[number - 1]
      if (pr.head !== headSha) throw new Error('head moved')
      pr.merged ??= `merged-${number}`
      return pr.merged
    },
  }
}

beforeAll(async () => {
  const url = new URL('../../../../crates/orchestrator-wasm/pkg/orchestrator_wasm_bg.wasm', import.meta.url)
  await init({ module_or_path: await readFile(url) })
})

describe('orchestrator-wasm with the browser store and the fake LocalLlm', () => {
  it('runs standup → publish and leaves the plan thread in the store', async () => {
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    const local = fakeMvpLlm()
    const llm = localLlmBridge(local)
    const gateway = fakeGateway()
    const orch = new OrchestratorHandle(store, gateway, llm, JSON.stringify(SITE))

    const res = await runMvpLoop(orch, { company: 'c1' })
    expect(res.steps.map((s) => s.job.kind)).toEqual(['standup', 'draft', 'review', 'draft', 'review', 'publish'])
    expect(res.steps[5].outcomes[1]).toEqual({ DeployLanded: { work_item: 'work-item-1' } })
    expect(llm.calls.map((c) => c.kind)).toEqual([
      'structured',
      'generate',
      'structured',
      'structured',
      'structured',
      'structured',
      'structured',
      'structured',
    ])
    expect(llm.calls[6].request.messages[0].text).toContain(MVP_REVIEW_NOTE)
    // FakeLlm saw the system layers as a system message.
    expect(local.calls[0].messages[0].role).toBe('system')

    const plan = await store.plan('c1')
    expect(plan.items['work-item-1'].title).toBe('Harvest week in Manarola')
    expect(plan.posts['work-item-1'].map((p) => p.type)).toEqual([...MVP_POST_TYPES])
    expect(await store.transcripts('c1')).toHaveLength(1)
    expect(await store.getArtifact('c1', 'work-item-1')).toContain(`"brief_ref":${res.briefRef}`)
    expect(gateway.prs[0].workItem).toBe('work-item-1')
    expect(gateway.prs[0].page).toContain('Maria and her sons')
  })

  it('maps LocalLlm failures onto agents::LlmError', async () => {
    const llm = localLlmBridge(fakeMvpLlm())
    const req = { profile: {}, system: ['s'], messages: [{ role: 'user' as const, text: 'hi' }], max_tokens: 50 }
    // The first scripted reply is JSON; as a structured answer with an incompatible schema it fails validation.
    const bad = JSON.parse(
      await llm.complete(JSON.stringify({ kind: 'structured', request: req, schema: { type: 'object', required: ['nope'] } })),
    )
    expect(bad.error.InvalidOutput.errors.length).toBeGreaterThan(0)
    expect(toChatMessages(req)).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('reads ?llm=', () => {
    expect(llmModeFromQuery('?llm=fake')).toBe('fake')
    expect(llmModeFromQuery('?llm=qwen')).toBe('local')
    expect(llmModeFromQuery('')).toBe('local')
  })
})

// A page body whose blocks are an `anyOf`, like `article_schema()` in crates/orchestrator.
const BODY_SCHEMA = {
  type: 'object',
  required: ['body'],
  additionalProperties: false,
  properties: {
    body: {
      type: 'array',
      minItems: 1,
      items: {
        anyOf: [
          {
            type: 'object',
            required: ['type', 'markdown'],
            additionalProperties: false,
            properties: { type: { const: 'paragraph' }, markdown: { type: 'string', minLength: 1 } },
          },
          {
            type: 'object',
            required: ['type', 'level', 'text'],
            additionalProperties: false,
            properties: { type: { const: 'heading' }, level: { type: 'integer', minimum: 2, maximum: 4 }, text: { type: 'string', minLength: 1 } },
          },
        ],
      },
    },
  },
}
const BAD_BODY = '{"body": [{"type": "paragraph", "markdown": "ok"}, {"type": "heading", "level": 2}]}'
const GOOD_BODY = '{"body": [{"type": "paragraph", "markdown": "ok"}, {"type": "heading", "level": 2, "text": "Harvest"}]}'
const request = (max_tokens = 4096) => ({ profile: {}, system: ['s'], messages: [{ role: 'user' as const, text: 'write' }], max_tokens })
const structured = (schema: object, max_tokens?: number) => JSON.stringify({ kind: 'structured', request: request(max_tokens), schema })

describe('the Rust validator in the browser repair loop (validateJson)', () => {
  it('reports an anyOf violation with its path, and nothing for a valid value', () => {
    const errors = validateJson(JSON.stringify(BODY_SCHEMA), BAD_BODY)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^\/body\/1: /)
    expect(validateJson(JSON.stringify(BODY_SCHEMA), GOOD_BODY)).toEqual([])
    expect(() => validateJson('{"type": "no-such-type"}', '{}')).toThrow(/bad schema/)
    expect(() => validateJson('{}', '{not json')).toThrow(/value JSON/)
  })

  it('a body block that matches no anyOf branch now gets a repair turn', async () => {
    const local = new FakeLlm({ script: [BAD_BODY, GOOD_BODY] })
    const llm = localLlmBridge(local, { validate: rustValidator(validateJson) })
    const out = JSON.parse(await llm.complete(structured(BODY_SCHEMA)))
    expect(out.value.body[1]).toEqual({ type: 'heading', level: 2, text: 'Harvest' })
    expect(local.calls).toHaveLength(2)
    // The repair turn carries the Rust validator's message for the offending block.
    expect(local.calls[1].messages.at(-1)!.content).toMatch(/\/body\/1: /)
  })

  it('the built-in subset validator alone lets that block through (the gap this closes)', async () => {
    const local = new FakeLlm({ script: [BAD_BODY, GOOD_BODY] })
    const out = JSON.parse(await localLlmBridge(local).complete(structured(BODY_SCHEMA)))
    expect(out.value.body[1]).toEqual({ type: 'heading', level: 2 })
    expect(local.calls).toHaveLength(1)
  })

  it('useValidator swaps the validator in after construction (what createOrchestrator does)', async () => {
    const local = new FakeLlm({ script: [BAD_BODY, GOOD_BODY] })
    const llm = localLlmBridge(local)
    llm.useValidator!(rustValidator(validateJson))
    const out = JSON.parse(await llm.complete(structured(BODY_SCHEMA)))
    expect(out.value.body[1].text).toBe('Harvest')
  })
})

describe('localLlmBridge policy and truncation', () => {
  it('keeps a free-text turn that hit the token limit, cut at its last sentence', async () => {
    const local = new FakeLlm({ script: [{ text: 'We should cover the harvest. It starts next week. And then the', finishReason: 'length' }] })
    const out = JSON.parse(await localLlmBridge(local).complete(JSON.stringify({ kind: 'generate', request: request(600) })))
    expect(out).toEqual({ text: 'We should cover the harvest. It starts next week.', truncated: true })
  })

  it('a cut-off turn without one complete sentence is Truncated', async () => {
    const local = new FakeLlm({ script: [{ text: 'We should cover the', finishReason: 'length' }] })
    const out = JSON.parse(await localLlmBridge(local).complete(JSON.stringify({ kind: 'generate', request: request(600) })))
    expect(out).toEqual({ error: { Truncated: { partial: 'We should cover the' } } })
  })

  it('a structured answer cut off twice is Truncated, never a partial value', async () => {
    const cut = { text: '{"body": [{"type": "paragraph", "markdown": "The terraces', finishReason: 'length' as const }
    const local = new FakeLlm({ script: [cut, cut] })
    const out = JSON.parse(await localLlmBridge(local).complete(structured(BODY_SCHEMA)))
    expect(out.error.Truncated.partial).toContain('The terraces')
    expect(local.calls).toHaveLength(2)
    expect(local.calls[1].opts.thinking).toBe('off')
  })

  it('short structured picks answer directly from "{"; larger calls may reason within a cap', async () => {
    const generate = { kind: 'generate' as const, request: request(600) }
    expect(defaultCallPolicy(generate)).toEqual({ thinking: 'off' })
    expect(defaultCallPolicy({ kind: 'structured', request: request(512), schema: { type: 'object' } })).toEqual({
      thinking: 'off',
      stopOnJsonEnd: true,
      answerPrefix: '{',
    })
    expect(defaultCallPolicy({ kind: 'structured', request: request(512), schema: { type: 'array' } })).toEqual({ thinking: 'off', stopOnJsonEnd: true })
    expect(defaultCallPolicy({ kind: 'structured', request: request(2000), schema: {} })).toEqual({ thinking: 'medium', reasoningBudget: 1000, stopOnJsonEnd: true })
    expect(defaultCallPolicy({ kind: 'structured', request: request(4096), schema: {} }).reasoningBudget).toBe(2048)
    expect(defaultCallPolicy({ kind: 'structured', request: request(16000), schema: {} }).reasoningBudget).toBe(2048)

    const local = new FakeLlm({ script: ['{"next": "staff-2"}', GOOD_BODY] })
    const llm = localLlmBridge(local)
    await llm.complete(structured({ type: 'object' }, 512))
    await llm.complete(structured(BODY_SCHEMA, 4096))
    expect(local.calls[0].opts).toMatchObject({ maxTokens: 512, thinking: 'off', answerPrefix: '{', stopOnJsonEnd: true })
    expect(local.calls[1].opts).toMatchObject({ maxTokens: 4096, thinking: 'medium', reasoningBudget: 2048, stopOnJsonEnd: true })
  })

  it('keeps a bounded record of calls', async () => {
    const local = new FakeLlm({ responder: () => 'A sentence.' })
    const llm = localLlmBridge(local, { maxCalls: 3 })
    for (let i = 0; i < 5; i++) await llm.complete(JSON.stringify({ kind: 'generate', request: { ...request(50), messages: [{ role: 'user', text: `q${i}` }] } }))
    expect(llm.calls.map((c) => c.request.messages[0].text)).toEqual(['q2', 'q3', 'q4'])
  })
})
