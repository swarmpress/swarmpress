// The MVP loop in Node through orchestrator-wasm with the browser's pieces:
// CompanyStore (memory engine, the same SQL as turso/sqlite), the `?llm=fake`
// LocalLlm (FakeLlm + the LocalLlm structured-output path) through
// localLlmBridge, and a fake JS gateway. Needs `cargo xtask wasm`.
import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { OrchestratorHandle, validateJson } from 'orchestrator-wasm'
import { FakeLlm } from '../llm/fake-llm'
import type { ChatMessage, GenerateOptions, GenerateResult, LocalLlm } from '../llm/types'
import { LlmUnavailableError } from '../llm/types'
import { MVP_POST_TYPES, MVP_REVIEW_NOTE, MVP_REVISION_LINE } from '../llm/mvp-script'
import { CompanyStore } from '../store/company-store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import miniPack from './fixtures/cinqueterre-mini.pack.json'
import { fakeMvpLlm, llmModeFromQuery } from './index'
import { activeTimer, defaultCallPolicy, localLlmBridge, runMvpLoop, rustValidator, toChatMessages, type LlmCallRecord, type Outcome, type ProgressEvent, type SiteBindingJson } from './bridge'
import { MVP_TEAM } from '../llm/mvp-script'

/** The binding over the knowledge crate's cinqueterre-mini pack (the staged draft needs the site's closed world). */
const SITE: SiteBindingJson = {
  site_id: 'cinqueterre.travel',
  brand_name: 'Cinque Terre Dispatch',
  language: 'en',
  quality_bar: 7,
  simulate_deploy: true,
  standup_max_turns: 4,
  seo_suffix: 'The Dispatch',
  knowledge_pack: JSON.stringify(miniPack),
}

/** The `## Task:` line of a bridged call. */
const task = (c: { request: { messages: { text: string }[] } }) => /^## Task: (.*)/.exec(c.request.messages[0]?.text ?? '')?.[1] ?? ''

function fakeGateway() {
  const prs: { branch: string; head: string; merged: string | null; workItem: string | null; page: string }[] = []
  /** The attribution of every call (G6), parsed. */
  const who: { op: string; attribution: Record<string, unknown> | null }[] = []
  return {
    prs,
    who,
    async openDraft(contentId: string, path: string, pageJson: string, _message: string, workItem: string | null, attribution?: string | null) {
      who.push({ op: 'draft', attribution: attribution ? JSON.parse(attribution) : null })
      expect(path.startsWith('content/')).toBe(true)
      const branch = `drafts/content-${contentId}`
      let n = prs.findIndex((p) => p.branch === branch && !p.merged)
      if (n < 0) n = prs.push({ branch, head: '', merged: null, workItem, page: '' }) - 1
      prs[n].head = `head-${n + 1}-${pageJson.length}`
      prs[n].page = pageJson
      return { number: n + 1, branch, head_sha: prs[n].head }
    },
    async merge(number: number, headSha: string, attribution?: string | null) {
      who.push({ op: 'merge', attribution: attribution ? JSON.parse(attribution) : null })
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
  it('runs standup → publish in stages and leaves the plan thread, stage rows and progress in the store', async () => {
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    const local = fakeMvpLlm()
    const usage: LlmCallRecord[] = []
    const llm = localLlmBridge(local, { onCall: (c) => usage.push(c) })
    const gateway = fakeGateway()
    const orch = new OrchestratorHandle(store, gateway, llm, JSON.stringify(SITE))
    const events: ProgressEvent[] = []
    orch.setProgress((json: string) => events.push(JSON.parse(json) as ProgressEvent))

    const res = await runMvpLoop(orch, { company: 'c1' })
    expect(res.steps.map((s) => s.job.kind)).toEqual(['standup', 'draft', 'review', 'draft', 'review', 'publish'])
    expect(res.steps[5].outcomes[1]).toEqual({ DeployLanded: { work_item: 'work-item-1' } })
    // The standup's pitch round (opening, two pitches, commission; ADR-0062), then the staged jobs (ADR-0058).
    // Each pitch checked on the web, research before the draft and before the revision (ADR-0068).
    expect(llm.calls.map((c) => c.kind)).toEqual([
      'generate',
      ...Array(2).fill('structured'),
      ...Array(2).fill('research'),
      'structured',
      'research',
      ...Array(7).fill('structured'),
      'research',
      ...Array(2).fill('structured'),
    ])
    expect(llm.calls.slice(0, 6).map(task)).toEqual(['standup opening', 'pitch', 'pitch', 'pitch check', 'pitch check', 'commission'])
    expect(llm.calls.slice(6).map(task)).toEqual([
      'research',
      'outline',
      'intro',
      'section s1 of 3',
      'section s2 of 3',
      'section s3 of 3',
      'closing',
      'review',
      'research',
      'revise s2',
      'review',
    ])
    // The revision rewrites the part the review names, with its note.
    expect(llm.calls[15].request.messages[0].text).toContain(MVP_REVIEW_NOTE)
    expect(llm.calls[7].request.reasoning_tokens).toBe(2048)
    // FakeLlm saw the system layers as a system message.
    expect(local.calls[0].messages[0].role).toBe('system')
    // Every call was metered (the activity record's tokens and model).
    expect(usage).toHaveLength(llm.calls.length)
    expect(usage.every((u) => u.model === 'fake-mvp' && u.turns === 1 && u.ok && u.promptTokens > 0)).toBe(true)

    const plan = await store.plan('c1')
    expect(plan.items['work-item-1'].title).toBe('Harvest week in Manarola')
    expect(plan.posts['work-item-1'].map((p) => p.type)).toEqual([...MVP_POST_TYPES])
    // The opening, Giulia's and Isabella's pitches and the closing, each reported as a turn (the bubbles).
    expect((await store.transcripts('c1')).map((l) => `${l.seq}:${l.speaker}`)).toEqual(['0:staff-4', '1:staff-1', '2:staff-2', '3:staff-4'])
    expect(events.filter((e) => e.stage === 'turn').map((e) => [e.index, e.staff, e.detail?.chars])).toEqual(
      (await store.transcripts('c1')).map((l) => [l.seq, l.speaker, [...l.text].length]),
    )
    expect(await store.getArtifact('c1', 'work-item-1')).toContain(`"brief_ref":${res.briefRef}`)
    expect(gateway.prs[0].workItem).toBe('work-item-1')
    const page = JSON.parse(gateway.prs[0].page)
    expect(JSON.stringify(page)).toContain(MVP_REVISION_LINE)
    expect(page.body[0].type).toBe('editorial-hero')
    expect(page.body.at(-1).type).toBe('closing-note')
    expect(Object.keys(page.slug).sort()).toEqual(['de', 'en', 'fr', 'it'])
    // The draft's stages are in the store, keyed by job.
    const draftJob = res.steps[1].job.job_id
    expect((await store.stages('c1', draftJob)).map((r) => `${r.stage}#${r.index}`)).toEqual([
      'closing#0',
      'context#0',
      'outline#0',
      'research#0',
      'section#0',
      'section#1',
      'section#2',
      'section#3',
    ])
    // Progress as counts: "section 2 of 3".
    expect(events.find((e) => e.stage === 'section' && e.index === 2 && e.state === 'started')).toMatchObject({
      job_id: draftJob,
      kind: 'draft',
      total: 3,
      staff: 'staff-1',
      persona: 'giulia',
    })
    expect(events.filter((e) => e.stage === 'job').map((e) => `${e.kind}:${e.state}`)).toEqual([
      'standup:started',
      'standup:done',
      'draft:started',
      'draft:done',
      'review:started',
      'review:done',
      'draft:started',
      'draft:done',
      'review:started',
      'review:done',
      'publish:started',
      'publish:done',
    ])

    // A re-run of the draft job calls no model and posts nothing.
    const n = llm.calls.length
    const posts = plan.posts['work-item-1'].length
    await orch.run(JSON.stringify(res.steps[1].job))
    expect(llm.calls.length).toBe(n)
    expect((await store.plan('c1')).posts['work-item-1']).toHaveLength(posts)
  })

  it('maps LocalLlm failures onto agents::LlmError, with the answer stripped of its reasoning', async () => {
    const llm = localLlmBridge(fakeMvpLlm())
    const req = { profile: {}, system: ['s'], messages: [{ role: 'user' as const, text: 'hi' }], max_tokens: 50 }
    // Not a call the fake knows: it answers free text, which is no JSON value at all.
    const bad = JSON.parse(
      await llm.complete(JSON.stringify({ kind: 'structured', request: req, schema: { type: 'object', required: ['nope'] } })),
    )
    expect(bad.error.InvalidOutput.errors.length).toBeGreaterThan(0)
    expect(typeof bad.error.InvalidOutput.answer).toBe('string')
    const thinking = new FakeLlm({ responder: () => '<think>a long thought about the terraces</think>{"wrong": 1}' })
    const out = JSON.parse(
      await localLlmBridge(thinking).complete(JSON.stringify({ kind: 'structured', request: req, schema: { type: 'object', required: ['nope'] } })),
    )
    expect(out.error.InvalidOutput.answer).toBe('{"wrong": 1}')
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

  it('a staged call brings its own reasoning allowance; a repair turn answers directly', () => {
    const staged = (reasoning_tokens: number, assistant = false) => ({
      kind: 'structured' as const,
      request: { ...request(900), reasoning_tokens, messages: [{ role: 'user' as const, text: '## Task: section s1 of 3' }, ...(assistant ? [{ role: 'assistant' as const, text: '{}' }, { role: 'user' as const, text: 'fix' }] : [])] },
      schema: { type: 'object' },
    })
    expect(defaultCallPolicy(staged(2048))).toEqual({ thinking: 'medium', reasoningBudget: 2048, stopOnJsonEnd: true })
    expect(defaultCallPolicy(staged(0))).toEqual({ thinking: 'off', stopOnJsonEnd: true, answerPrefix: '{' })
    expect(defaultCallPolicy(staged(2048, true))).toEqual({ thinking: 'off', stopOnJsonEnd: true, answerPrefix: '{' })
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

  it('marks a call interactive while the player waits for it (Standard tier, ADR-0067)', async () => {
    const local = new FakeLlm({ responder: () => 'A sentence.' })
    let waits = false
    const llm = localLlmBridge(local, { interactive: () => waits })
    await llm.complete(JSON.stringify({ kind: 'generate', request: request(50) }))
    waits = true
    await llm.complete(JSON.stringify({ kind: 'generate', request: request(50) }))
    await llm.complete(structured({ type: 'object' }, 512))
    const marks = local.calls.map((c) => c.opts.interactive)
    expect(marks[0]).toBe(false)
    expect(marks.slice(1).length).toBeGreaterThan(1)
    expect(marks.slice(1).every(Boolean)).toBe(true)
  })

  it('keeps a bounded record of calls', async () => {
    const local = new FakeLlm({ responder: () => 'A sentence.' })
    const llm = localLlmBridge(local, { maxCalls: 3 })
    for (let i = 0; i < 5; i++) await llm.complete(JSON.stringify({ kind: 'generate', request: { ...request(50), messages: [{ role: 'user', text: `q${i}` }] } }))
    expect(llm.calls.map((c) => c.request.messages[0].text)).toEqual(['q2', 'q3', 'q4'])
  })
})

/**
 * A LocalLlm that hangs on one task while `hang.on`: the call never answers
 * unless it is aborted (then it ends `cancelled`, as the worker does).
 */
function hangingOn(task: string, hang: { on: boolean; calls: number }): LocalLlm {
  const inner = fakeMvpLlm()
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'generate') {
        return (messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> => {
          const prompt = messages.find((m) => m.role === 'user')?.content ?? ''
          if (hang.on && prompt.startsWith(`## Task: ${task}`)) {
            hang.calls++
            return new Promise((resolve) => {
              const zero = { promptTokens: 1, completionTokens: 0, durationMs: 0, tokensPerSec: 0 }
              opts.signal?.addEventListener('abort', () => resolve({ text: '', finishReason: 'cancelled', usage: zero }), { once: true })
            })
          }
          return target.generate.call(receiver, messages, opts)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

const STAGE_SITE = { ...SITE, executor: 'browser dev-1 epoch 2' }
const run = async (orch: OrchestratorHandle, job: object) => JSON.parse(await orch.run(JSON.stringify(job))) as Outcome[]
const jobOf = (job_id: number, kind: string, brief_ref: string | null, work_item: string | null = 'work-item-1') => ({
  company_id: 'c1',
  job_id,
  kind,
  project: 'project-1',
  work_item: kind === 'standup' ? null : work_item,
  brief_ref,
  revision: 0,
  staff: MVP_TEAM,
})

describe('P6 and G6 through the bridge (ADR-0058)', () => {
  it('the draft commit and the merge carry the attribution, with the model the bridge reports', async () => {
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    const gateway = fakeGateway()
    const orch = new OrchestratorHandle(store, gateway, localLlmBridge(fakeMvpLlm()), JSON.stringify(STAGE_SITE))
    const res = await runMvpLoop(orch, { company: 'c1' })
    expect(res.mergedSha).toBe('merged-1')
    expect(gateway.who.map((w) => w.op)).toEqual(['draft', 'draft', 'merge'])
    expect(gateway.who[0].attribution).toEqual({
      staff_id: 'staff-1',
      name: 'Giulia Rossi',
      persona: 'giulia',
      role: 'writer',
      job_id: res.steps[1].job.job_id,
      job_kind: 'draft',
      revision: 0,
      work_item: 'work-item-1',
      model: 'fake-mvp',
      executor: 'browser dev-1 epoch 2',
    })
    // runMvpLoop's publish job has no approver (no CEO answered a ticket there).
    expect(gateway.who[2].attribution).toMatchObject({ staff_id: 'staff-1', job_kind: 'publish', revision: 1, model: 'fake-mvp', reviewed_by: 'Marco Vitali' })
    expect(gateway.who[2].attribution).not.toHaveProperty('approved_by')
  })

  it('a hung model times out per stage, is tried once more, then the job fails with Timeout; a retried job adopts the finished stages', async () => {
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    const gateway = fakeGateway()
    const hang = { on: true, calls: 0 }
    const llm = localLlmBridge(hangingOn('section s2 of 3', hang), { stageTimeoutMs: 40 })
    const orch = new OrchestratorHandle(store, gateway, llm, JSON.stringify(STAGE_SITE))
    const standup = await run(orch, jobOf(1, 'standup', null))
    const briefRef = (standup[0] as { MeetingOutcome: { briefs: { brief_ref: string }[] } }).MeetingOutcome.briefs[0].brief_ref
    expect(await run(orch, jobOf(2, 'draft', briefRef))).toEqual([{ JobFailed: { job_id: 2, reason: 'Timeout' } }])
    expect(hang.calls).toBe(2)
    expect(gateway.prs).toHaveLength(0)
    expect((await store.plan('c1')).posts['work-item-1'].map((p) => p.type)).toEqual(['minutes', 'status'])
    // The sim's Retry: a new job id. The model answers again; only the rest is written.
    hang.on = false
    const before = llm.calls.length
    const out = await run(orch, jobOf(3, 'draft', briefRef))
    expect((out[0] as { JobCompleted: { digest: { ok: boolean } } }).JobCompleted.digest.ok).toBe(true)
    expect(llm.calls.slice(before).map(task)).toEqual(['section s2 of 3', 'section s3 of 3', 'closing'])
    expect((await store.plan('c1')).posts['work-item-1'].map((p) => p.type)).toEqual(['minutes', 'status', 'artifact', 'handoff'])
    expect(gateway.prs).toHaveLength(1)
  })

  it('cancel() stops the running job between stages and aborts the call in flight', async () => {
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    const hang = { on: true, calls: 0 }
    const llm = localLlmBridge(hangingOn('section s1 of 3', hang))
    const orch = new OrchestratorHandle(store, fakeGateway(), llm, JSON.stringify(STAGE_SITE))
    expect(orch.cancel('timeout')).toBeUndefined() // nothing runs
    const standup = await run(orch, jobOf(1, 'standup', null))
    const briefRef = (standup[0] as { MeetingOutcome: { briefs: { brief_ref: string }[] } }).MeetingOutcome.briefs[0].brief_ref
    const draft = run(orch, jobOf(2, 'draft', briefRef))
    while (hang.calls === 0) await new Promise((r) => setTimeout(r, 5))
    expect(orch.cancel('timeout')).toBe(2)
    expect(await draft).toEqual([{ JobFailed: { job_id: 2, reason: 'Timeout' } }])
    expect(hang.calls).toBe(1) // not tried again: the job was cancelled
    expect(llm.calls.map(task).slice(6)).toEqual(['research', 'outline', 'intro', 'section s1 of 3'])
  })

  it('a lost model answers Unavailable, so the run rejects instead of failing the job', async () => {
    const lost = new FakeLlm({ script: [new LlmUnavailableError('the model was lost 3 times during one call')] })
    const out = JSON.parse(await localLlmBridge(lost).complete(JSON.stringify({ kind: 'generate', request: request(50) })))
    expect(out).toEqual({ error: { Unavailable: 'the model was lost 3 times during one call' } })
    expect(localLlmBridge(lost).modelId).toBeNull()
  })

  it('the stage clock stands still while the model is not ready', async () => {
    let paused = true
    let fired = 0
    const stop = activeTimer(30, () => fired++, () => paused)
    await new Promise((r) => setTimeout(r, 90))
    expect(fired).toBe(0)
    paused = false
    await new Promise((r) => setTimeout(r, 90))
    expect(fired).toBe(1)
    stop()
  })
})
