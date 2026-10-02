// The MVP article loop through the JS bridge, under Bun (ADR-0042's runner
// host): crates/orchestrator-wasm/pkg (built by `cargo xtask wasm`) with an
// in-memory JS store, a JS fake gateway and a scripted JS LLM (the port of
// `script()` in crates/orchestrator/tests/loop.rs). Asserts the same plan
// thread as the Rust test.
//
//   cargo xtask wasm && bun test crates/orchestrator-wasm/tests
import { beforeAll, describe, expect, test } from 'bun:test'
import init, { OrchestratorHandle, version } from '../pkg/orchestrator_wasm.js'
import { MVP_POST_TYPES, MVP_REVIEW_NOTE, MVP_TEAM, mvpScript } from '../../../apps/game/src/llm/mvp-script'
import { runMvpLoop, scriptedLlm, type Outcome } from '../../../apps/game/src/orchestrator/bridge'

const COMPANY = 'company-1'
const PATH = 'content/pages/blog/harvest-week-in-manarola.json'
const STYLE_GUIDE = await Bun.file(new URL('../../agents/tests/fixtures/style-guide.json', import.meta.url)).json()

const SITE = JSON.stringify({
  site_id: 'cinqueterre.travel',
  brand_name: 'Cinque Terre Dispatch',
  language: 'en',
  style_guide: STYLE_GUIDE,
  quality_bar: 7,
  simulate_deploy: true,
  standup_max_turns: 4,
})

/** orchestrator::MemStore, in JS (records kept as JSON text). */
class MemJsStore {
  briefs = new Map<string, { record: string; workItem: string | null }>()
  artifacts = new Map<string, string>()
  transcripts = new Map<string, { job: number; seq: number; speaker: string; text: string }>()
  items = new Map<string, { title: string; brief: string }>()
  posts: { id: string; company: string; item: string; post: Record<string, unknown> }[] = []
  calls: string[] = []

  private k(...p: (string | number)[]) {
    return p.join('\u0000')
  }
  async putBrief(c: string, r: string, json: string) {
    this.calls.push('putBrief')
    if (!this.briefs.has(this.k(c, r))) this.briefs.set(this.k(c, r), { record: json, workItem: null })
  }
  async getBrief(c: string, r: string) {
    const b = this.briefs.get(this.k(c, r))
    if (!b) return null
    return JSON.stringify({ ...JSON.parse(b.record), work_item: b.workItem })
  }
  async claimBrief(c: string, r: string, w: string) {
    const b = this.briefs.get(this.k(c, r))
    if (!b) throw new Error(`unknown brief_ref ${r}`)
    if (b.workItem) return false
    b.workItem = w
    return true
  }
  // Sync answers are allowed too.
  putArtifact(c: string, w: string, json: string) {
    this.artifacts.set(this.k(c, w), json)
  }
  getArtifact(c: string, w: string) {
    return this.artifacts.get(this.k(c, w)) ?? null
  }
  async appendTranscript(c: string, job: number, seq: number, speaker: string, text: string) {
    const key = this.k(c, job, seq)
    if (!this.transcripts.has(key)) this.transcripts.set(key, { job, seq, speaker, text })
  }
  async setItemText(c: string, item: string, title: string | null, brief: string | null) {
    const e = this.items.get(this.k(c, item)) ?? { title: '', brief: '' }
    if (title != null) e.title = title
    if (brief != null) e.brief = brief
    this.items.set(this.k(c, item), e)
  }
  async appendPost(c: string, item: string, json: string) {
    const post = JSON.parse(json)
    if (!['minutes', 'artifact', 'handoff', 'review', 'status'].includes(post.type)) throw new Error(`bad type ${post.type}`)
    const id = `post-${this.posts.length + 1}`
    this.posts.push({ id, company: c, item, post: { ...post, id, item } })
    return id
  }
  async planJson(c: string) {
    const items: Record<string, unknown> = {}
    for (const [k, v] of this.items) if (k.startsWith(c + '\u0000')) items[k.split('\u0000')[1]] = v
    const posts: Record<string, unknown[]> = {}
    for (const p of this.posts) if (p.company === c) (posts[p.item] ??= []).push(p.post)
    // An object answer is accepted as well as JSON text.
    return { items, todos: {}, workstreams: {}, goals: {}, posts }
  }
}

/** orchestrator::FakeGateway, in JS. */
class FakeJsGateway {
  files = new Map<string, Map<string, string>>([['main', new Map()]])
  prs = new Map<number, { branch: string; head: string; merged: string | null; workItem: string | null }>()
  merges = 0
  commits = 0

  async openDraft(contentId: string, path: string, pageJson: string, message: string, workItem: string | null) {
    if (!path.startsWith('content/')) throw new Error(`path outside content/: ${path}`)
    expect(message.length).toBeGreaterThan(0)
    const branch = `drafts/content-${contentId}`
    const files = this.files.get(branch) ?? new Map(this.files.get('main'))
    files.set(path, pageJson)
    this.files.set(branch, files)
    const head = `sha-${++this.commits}`
    let number = [...this.prs].find(([, p]) => p.branch === branch && !p.merged)?.[0]
    if (number == null) number = this.prs.size + 1
    this.prs.set(number, { branch, head, merged: null, workItem })
    return { number, branch, head_sha: head }
  }

  async merge(number: number, headSha: string) {
    const pr = this.prs.get(number)
    if (!pr) throw new Error(`no PR #${number}`)
    if (pr.head !== headSha) throw new Error(`PR #${number} head is ${pr.head} not ${headSha}`)
    if (pr.merged) return { merged_sha: pr.merged }
    for (const [p, t] of this.files.get(pr.branch)!) this.files.get('main')!.set(p, t)
    pr.merged = `merge-${number}`
    this.merges++
    return { merged_sha: pr.merged }
  }
}

beforeAll(async () => {
  const wasm = await Bun.file(new URL('../pkg/orchestrator_wasm_bg.wasm', import.meta.url)).arrayBuffer()
  await init({ module_or_path: wasm })
})

describe('orchestrator-wasm under Bun', () => {
  test('exports its version', () => {
    expect(version()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('rejects a bad site binding', () => {
    expect(() => new OrchestratorHandle({}, {}, {}, '{"site_id":"x"}')).toThrow(/brand_name|style_guide/)
  })

  test('standup → draft → review 6 → revision → review 8 → publish', async () => {
    const store = new MemJsStore()
    const gateway = new FakeJsGateway()
    const llm = scriptedLlm(mvpScript())
    const orch = new OrchestratorHandle(store, gateway, llm, SITE)

    const res = await runMvpLoop(orch, { company: COMPANY })
    // brief_ref crosses as a decimal string (it is a u64).
    expect(res.briefRef).toMatch(/^\d+$/)
    const [standup] = res.steps
    expect(standup.outcomes).toEqual([
      { MeetingOutcome: { job_id: 1, briefs: [{ brief_ref: res.briefRef, writer: 'staff-1', editor: 'staff-5' }] } },
    ])
    expect(store.transcripts.size).toBe(1)

    const kinds = res.steps.map((s) => `${s.job.kind}:${s.job.revision}`)
    expect(kinds).toEqual(['standup:0', 'draft:0', 'review:0', 'draft:1', 'review:1', 'publish:1'])
    const scores = res.steps
      .filter((s) => s.job.kind === 'review')
      .map((s) => (s.outcomes[0] as Extract<Outcome, { JobCompleted: unknown }>).JobCompleted.digest.score)
    expect(scores).toEqual([6, 8])
    const publish = res.steps[5].outcomes
    expect(publish[1]).toEqual({ DeployLanded: { work_item: 'work-item-1' } })

    // The revision prompt carries the review; every scripted reply was used.
    expect(llm.calls[6].request.messages[0].text).toContain(MVP_REVIEW_NOTE)
    expect(llm.remaining()).toBe(0)

    // The gateway saw the work item; the revised page is what shipped.
    expect(gateway.merges).toBe(1)
    expect([...gateway.prs.values()][0].workItem).toBe('work-item-1')
    const live = JSON.parse(gateway.files.get('main')!.get(PATH)!)
    expect(live.slug.en).toBe('/en/blog/harvest-week-in-manarola')
    expect(JSON.stringify(live)).toContain('Maria and her sons')

    // The artifact record keeps the exact u64 brief_ref.
    const art = store.artifacts.get(`${COMPANY}\u0000work-item-1`)!
    expect(art).toContain(`"brief_ref":${res.briefRef}`)

    // Same plan thread as crates/orchestrator/tests/loop.rs.
    const posts = store.posts.filter((p) => p.item === 'work-item-1').map((p) => p.post)
    expect(posts.map((p) => p.type)).toEqual([...MVP_POST_TYPES])
    expect(posts[2]).toMatchObject({ author: 'staff-1', to: 'staff-5' })
    expect(posts[3]).toMatchObject({ author: 'staff-5', payload: { verdict: 'changes', score: 6 } })
    expect(posts[6]).toMatchObject({ payload: { verdict: 'approve', score: 8 } })
    expect(store.items.get(`${COMPANY}\u0000work-item-1`)?.title).toBe('Harvest week in Manarola')

    // Publishing again is idempotent: same sha, no second merge, no new posts.
    const again = JSON.parse(await orch.run(JSON.stringify({ ...res.steps[5].job })))
    expect(again[0].JobCompleted.digest.artifact_sha).toBe(res.mergedSha)
    expect(gateway.merges).toBe(1)
    expect(store.posts.length).toBe(posts.length)
  })

  test('infrastructure failures reject; agent failures resolve not-ok', async () => {
    const store = new MemJsStore()
    const llm = scriptedLlm(mvpScript().slice(0, 4))
    const gateway = new FakeJsGateway()
    const orch = new OrchestratorHandle(store, gateway, llm, SITE)
    const out = JSON.parse(
      await orch.run(JSON.stringify({ company_id: COMPANY, job_id: 1, kind: 'standup', project: 'p', work_item: null, brief_ref: null, revision: 0, staff: MVP_TEAM })),
    )
    const briefRef: string = out[0].MeetingOutcome.briefs[0].brief_ref
    // The script is exhausted: the draft's LLM call fails → ok:false + a status post.
    const job = { company_id: COMPANY, job_id: 2, kind: 'draft', project: 'p', work_item: 'w1', brief_ref: briefRef, revision: 0, staff: MVP_TEAM }
    const draft = JSON.parse(await orch.run(JSON.stringify(job)))
    expect(draft[0].JobCompleted.digest.ok).toBe(false)
    expect(store.posts.at(-1)?.post.type).toBe('status')
    expect(gateway.prs.size).toBe(0)
    // A review before any draft is an invalid job: the promise rejects.
    await expect(orch.run(JSON.stringify({ ...job, job_id: 3, kind: 'review', work_item: 'w2' }))).rejects.toThrow(/invalid job/)
    // A store that throws rejects the job too.
    const failing = Object.assign(new MemJsStore(), { putBrief: () => Promise.reject(new Error('disk full')) })
    const broken = new OrchestratorHandle(failing, gateway, scriptedLlm(mvpScript()), SITE)
    await expect(
      broken.run(JSON.stringify({ company_id: COMPANY, job_id: 9, kind: 'standup', project: 'p', work_item: null, brief_ref: null, revision: 0, staff: MVP_TEAM })),
    ).rejects.toThrow(/disk full/)
  })
})

