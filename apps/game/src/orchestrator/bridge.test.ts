// The MVP loop in Node through orchestrator-wasm with the browser's pieces:
// CompanyStore (memory engine, the same SQL as turso/sqlite), the `?llm=fake`
// LocalLlm (FakeLlm + the LocalLlm structured-output path) through
// localLlmBridge, and a fake JS gateway. Needs `cargo xtask wasm`.
import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { OrchestratorHandle } from 'orchestrator-wasm'
import styleGuide from '../../../../crates/agents/tests/fixtures/style-guide.json'
import { MVP_POST_TYPES, MVP_REVIEW_NOTE } from '../llm/mvp-script'
import { CompanyStore } from '../store/company-store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import { fakeMvpLlm, llmModeFromQuery } from './index'
import { localLlmBridge, runMvpLoop, toChatMessages, type SiteBindingJson } from './bridge'

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
