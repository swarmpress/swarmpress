// The MVP article loop through the JS bridge, under Bun (ADR-0042's runner
// host): crates/orchestrator-wasm/pkg (built by `cargo xtask wasm`) with an
// in-memory JS store (stage rows and post dedupe included), a JS fake gateway
// and the brief-driven fake model (`apps/game/src/llm/mvp-script.ts`, the twin
// of `agents::fake_writer`). The binding carries the cinqueterre-mini
// knowledge pack: the staged draft (ADR-0058) needs the site's closed world.
// Asserts the same plan thread and staged calls as the Rust test.
//
//   cargo xtask wasm && bun test crates/orchestrator-wasm/tests
import { beforeAll, describe, expect, test } from 'bun:test'
import init, { OrchestratorHandle, outcomesForSim, version } from '../pkg/orchestrator_wasm.js'
import { createMvpModel, MVP_POST_TYPES, MVP_REVIEW_NOTE, MVP_REVISION_LINE, MVP_TEAM } from '../../../apps/game/src/llm/mvp-script'
import { runMvpLoop, scriptedLlm, type Outcome, type ProgressEvent } from '../../../apps/game/src/orchestrator/bridge'
import miniPack from '../../../apps/game/src/orchestrator/fixtures/cinqueterre-mini.pack.json'

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
  knowledge_pack: JSON.stringify(miniPack),
})

/** The fake model: a standup, then every stage of the staged jobs. */
const fakeModel = () => scriptedLlm([], createMvpModel())
const task = (c: { request: { messages: { text: string }[] } }) => /^## Task: (.*)/.exec(c.request.messages[0]?.text ?? '')?.[1] ?? ''

/** orchestrator::MemStore, in JS (records kept as JSON text). */
class MemJsStore {
  briefs = new Map<string, { record: string; workItem: string | null }>()
  artifacts = new Map<string, string>()
  transcripts = new Map<string, { job: number; seq: number; speaker: string; text: string }>()
  items = new Map<string, { title: string; brief: string }>()
  posts: { id: string; company: string; item: string; post: Record<string, unknown> }[] = []
  dedupe = new Map<string, string>()
  stages = new Map<string, string>()
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
  // As JSON text (an array is accepted too).
  listArtifacts(c: string) {
    const rows = [...this.artifacts].filter(([k]) => k.startsWith(c + '\u0000')).map(([k, record]) => ({ work_item: k.split('\u0000')[1], record }))
    return JSON.stringify(rows)
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
    const key = typeof post.dedupe === 'string' ? this.k(c, post.dedupe) : null
    if (key && this.dedupe.has(key)) return this.dedupe.get(key)!
    const id = `post-${this.posts.length + 1}`
    this.posts.push({ id, company: c, item, post: { ...post, id, item } })
    if (key) this.dedupe.set(key, id)
    return id
  }
  // Stage rows stay JSON text; an object answer is accepted too.
  getStage(c: string, job: number, stage: string, index: number) {
    return this.stages.get(this.k(c, job, stage, index)) ?? null
  }
  async putStage(c: string, job: number, stage: string, index: number, rowJson: string) {
    const key = this.k(c, job, stage, index)
    if (!this.stages.has(key)) this.stages.set(key, rowJson)
    return JSON.parse(this.stages.get(key)!)
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
  /** The attribution of every call (G6), as the bridge passes it: JSON text. */
  who: { op: string; attribution: Record<string, unknown> | null }[] = []

  async openDraft(contentId: string, path: string, pageJson: string, message: string, workItem: string | null, attribution?: string) {
    this.who.push({ op: 'draft', attribution: attribution ? JSON.parse(attribution) : null })
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

  async merge(number: number, headSha: string, attribution?: string) {
    this.who.push({ op: 'merge', attribution: attribution ? JSON.parse(attribution) : null })
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

  // ADR-0061 (K2): the binding takes the knowledge pack; its style guide wins over the binding's.
  const PACK_COMMIT = '3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b'
  const packOf = (styleGuide: unknown, category = 'sights') =>
    JSON.stringify({
      commit: PACK_COMMIT,
      files: {
        'content/config/media-index.json': JSON.stringify({
          images: [{ id: 'manarola-hero-001', url: 'https://images.unsplash.com/photo-1', tags: { village: 'manarola', category } }],
        }),
        'content/config/style-guide.json': JSON.stringify(styleGuide, null, 2),
      },
      manifest: { name: 'Mini', default_language: 'en', languages: ['en'] },
      pages: [{ id: 'manarola', path: 'content/pages/manarola.json', page_type: 'village', routes: { en: '/en/manarola' }, titles: { en: 'Manarola' }, status: null }],
    })
  const bound = (extra: Record<string, unknown>) => {
    const { style_guide: _drop, ...site } = JSON.parse(SITE) as Record<string, unknown>
    return JSON.stringify({ ...site, ...extra })
  }

  test('a binding from a knowledge pack carries its closed world and runs the loop', async () => {
    const orch = new OrchestratorHandle(new MemJsStore(), new FakeJsGateway(), fakeModel(), bound({ knowledge_pack: packOf(STYLE_GUIDE) }))
    expect(JSON.parse(orch.siteSummary())).toEqual({
      site_id: 'cinqueterre.travel',
      commit: PACK_COMMIT,
      pages: 1,
      media: 1,
      entities: 0,
      blog_index: false,
      style_guide: 'pack',
      writer_prompt: 'absent',
      // No article title with a suffix and no blog index in this pack: the brand.
      seo_suffix: 'Cinque Terre Dispatch',
      seo_suffix_source: 'brand',
    })
    const res = await runMvpLoop(orch, { company: COMPANY })
    expect(res.mergedSha).toBe('merge-1')

    // A site without an image an article hero may use: the draft fails with
    // NeedsMedia (rule 5), before any model call of the draft; the sim gets JobFailed.
    const store = new MemJsStore()
    const llm = fakeModel()
    const bare = new OrchestratorHandle(store, new FakeJsGateway(), llm, bound({ knowledge_pack: packOf(STYLE_GUIDE, 'accommodations') }))
    const standup = JSON.parse(await bare.run(JSON.stringify({ company_id: COMPANY, job_id: 1, kind: 'standup', project: 'p', work_item: null, brief_ref: null, revision: 0, staff: MVP_TEAM })))
    const briefRef: string = standup[0].MeetingOutcome.briefs[0].brief_ref
    const calls = llm.calls.length
    const out = JSON.parse(await bare.run(JSON.stringify({ company_id: COMPANY, job_id: 2, kind: 'draft', project: 'p', work_item: 'w1', brief_ref: briefRef, revision: 0, staff: MVP_TEAM })))
    expect(out).toEqual([{ JobFailed: { job_id: 2, reason: 'NeedsMedia' } }])
    expect(llm.calls.length).toBe(calls)
    expect(outcomesForSim(JSON.stringify(out))).toEqual(['{"JobFailed":{"job_id":2,"reason":"NeedsMedia"}}'])
    expect(store.posts.map((p) => p.post.type)).toEqual(['minutes', 'status'])

    // Without a pack: the binding's own style guide, else none at all.
    const fallback = new OrchestratorHandle({}, {}, {}, JSON.stringify({ ...JSON.parse(SITE), knowledge_pack: null }))
    expect(JSON.parse(fallback.siteSummary())).toMatchObject({ commit: null, media: null, style_guide: 'binding' })
    expect(JSON.parse(new OrchestratorHandle({}, {}, {}, bound({ knowledge_pack: null })).siteSummary())).toMatchObject({ style_guide: 'absent' })
    // A broken pack is an error that names it.
    expect(() => new OrchestratorHandle({}, {}, {}, bound({ knowledge_pack: '{"commit": 1}' }))).toThrow(/knowledge pack/)
  })

  test('the weekly editorial board: the twin fake plans what the Rust fake plans, refs cross as text (ADR-0069)', async () => {
    const store = new MemJsStore()
    const llm = fakeModel()
    const orch = new OrchestratorHandle(store, new FakeJsGateway(), llm, SITE)
    const team = [...MVP_TEAM.filter((s) => s.role !== 'writer'), { id: 'staff-9', persona: 'chiara', role: 'strategist' }]
    const req = { company_id: COMPANY, job_id: 19, kind: 'board', project: 'project-1', work_item: null, brief_ref: null, revision: 0, staff: team, meeting: 'meeting-7', context: { today: '2026-10-05', in_flight: [], planned_room: 10 } }
    const out = JSON.parse(await orch.run(JSON.stringify(req)))
    const board = out[0].BoardOutcome
    // the same plan as crates/orchestrator/tests/board.rs: the autumn topic, the evergreen one, then three guides
    expect(llm.calls.map(task)).toEqual(['weekly board', ...Array(5).fill('pitch check'), 'board schedule'])
    expect(board.items.map((i: { start_offset: number; publish_offset: number }) => [i.start_offset, i.publish_offset])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 8],
      [8, 10],
    ])
    expect(board.items[1].depends_on).toEqual([0])
    expect(board.workstreams).toHaveLength(3)
    for (const r of [...board.workstreams, ...board.items.map((i: { brief_ref: string }) => i.brief_ref)]) expect(r).toMatch(/^\d+$/)
    const titles = board.items.map((i: { brief_ref: string }) => JSON.parse(store.briefs.get(`${COMPANY}\u0000${i.brief_ref}`)!.record).brief.title)
    expect(titles.slice(0, 3)).toEqual(['The Grape Harvest in Manarola', 'Complete Train Schedule Guide', 'Vernazza harbour at first light'])
    expect(store.items.get(`${COMPANY}\u0000brief:${board.items[0].brief_ref}`)?.title).toBe('The Grape Harvest in Manarola')
    expect(store.items.get(`${COMPANY}\u0000workstream:${board.workstreams[0]}`)?.title).toBe('Fall')
    // for the sim: the refs as numbers again, the u64s exact
    const [cmd] = outcomesForSim(JSON.stringify(out))
    expect(cmd).toContain(`"workstreams":[${board.workstreams.join(',')}]`)
    expect(cmd).toContain(`"brief_ref":${board.items[0].brief_ref}`)
  })

  test('standup → draft → review 6 → revision → review 8 → publish', async () => {
    const store = new MemJsStore()
    const gateway = new FakeJsGateway()
    const llm = fakeModel()
    const orch = new OrchestratorHandle(store, gateway, llm, SITE)
    const progress: ProgressEvent[] = []
    orch.setProgress((json: string) => progress.push(JSON.parse(json)))

    const res = await runMvpLoop(orch, { company: COMPANY })
    // brief_ref crosses as a decimal string (it is a u64).
    expect(res.briefRef).toMatch(/^\d+$/)
    const [standup] = res.steps
    expect(standup.outcomes).toEqual([
      { MeetingOutcome: { job_id: 1, briefs: [{ brief_ref: res.briefRef, writer: 'staff-1', editor: 'staff-5' }] } },
    ])
    // The pitch round (ADR-0062): the opening, two pitches, the closing; each a `turn` event.
    expect(store.transcripts.size).toBe(4)
    expect(progress.filter((e) => e.stage === 'turn').map((e) => e.staff)).toEqual(['staff-4', 'staff-1', 'staff-2', 'staff-4'])

    const kinds = res.steps.map((s) => `${s.job.kind}:${s.job.revision}`)
    expect(kinds).toEqual(['standup:0', 'draft:0', 'review:0', 'draft:1', 'review:1', 'publish:1'])
    const scores = res.steps
      .filter((s) => s.job.kind === 'review')
      .map((s) => (s.outcomes[0] as Extract<Outcome, { JobCompleted: unknown }>).JobCompleted.digest.score)
    expect(scores).toEqual([6, 8])
    const publish = res.steps[5].outcomes
    expect(publish[1]).toEqual({ DeployLanded: { work_item: 'work-item-1' } })

    // The staged calls (ADR-0058): after the standup's six (opening, two pitches,
    // two pitch checks, the commission), research (ADR-0068), the draft in stages,
    // a review, research on the review's notes and a revision of the part the
    // review names (its prompt carries the note), a review.
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
    expect(llm.calls[15].request.messages[0].text).toContain(MVP_REVIEW_NOTE)
    expect(progress.filter((e) => e.stage === 'section' && e.state === 'done').map((e) => `${e.index}/${e.total}`)).toEqual(['0/3', '1/3', '2/3', '3/3'])
    // The bridge stores the stage rows as JSON text.
    expect([...store.stages.keys()].filter((k) => k.includes('\u0000section\u0000'))).toHaveLength(4)

    // G6: the attribution reached the gateway (the scripted model has no id: no Model).
    expect(gateway.who.map((w) => w.op)).toEqual(['draft', 'draft', 'merge'])
    expect(gateway.who[0].attribution).toEqual({
      staff_id: 'staff-1', name: 'Giulia Rossi', persona: 'giulia', role: 'writer', job_id: 2, job_kind: 'draft', revision: 0, work_item: 'work-item-1',
    })
    expect(gateway.who[2].attribution).toMatchObject({ staff_id: 'staff-1', job_id: 6, job_kind: 'publish', revision: 1, reviewed_by: 'Marco Vitali' })

    // The gateway saw the work item; the revised page is what shipped.
    expect(gateway.merges).toBe(1)
    expect([...gateway.prs.values()][0].workItem).toBe('work-item-1')
    const live = JSON.parse(gateway.files.get('main')!.get(PATH)!)
    expect(live.slug.en).toBe('/en/blog/harvest-week-in-manarola')
    expect(JSON.stringify(live)).toContain(MVP_REVISION_LINE)
    expect(live.body[0].type).toBe('editorial-hero')

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

  // FEAT-085: the CEO's Retry on a DeployFailed ticket runs the publish job again; the merge is
  // done, so the job asks the gateway to deploy again (deployState, then redeploy) and completes.
  test('a publish job for a merged item whose deploy failed redeploys through the JS gateway', async () => {
    const store = new MemJsStore()
    store.putArtifact(COMPANY, 'work-item-1', JSON.stringify({ brief_ref: 1, path: PATH, branch: 'drafts/content-1', pr_number: 4, head_sha: 'h1', merged_sha: 'm1' }))
    const calls: string[] = []
    let state = 'failed'
    let refuse: string | null = null
    const gateway = {
      openDraft: () => Promise.reject(new Error('no draft in this test')),
      merge: () => Promise.reject(new Error('no second merge')),
      // A state name or {state}: both are accepted.
      deployState: (n: number) => (calls.push(`state #${n}`), n % 2 ? state : { state }),
      async redeploy(n: number) {
        calls.push(`redeploy #${n}`)
        if (refuse) throw new Error(refuse)
        const requested = state === 'failed'
        state = 'pending'
        return { number: n, work_item: 'work-item-1', state, requested, run_id: 77, run_attempt: 1, attempt: 1, detail: 're-run requested' }
      },
    }
    const site = JSON.stringify({ ...JSON.parse(SITE), simulate_deploy: false })
    const orch = new OrchestratorHandle(store, gateway, fakeModel(), site)
    const job = { company_id: COMPANY, job_id: 7, kind: 'publish', project: 'p', work_item: 'work-item-1', brief_ref: '1', revision: 0, staff: MVP_TEAM }
    const statusPosts = () => store.posts.filter((p) => p.post.type === 'status').map((p) => p.post.text)

    const out = JSON.parse(await orch.run(JSON.stringify(job)))
    // Completed with the merge it had; no DeployLanded of its own: the sim waits for the deploy.
    expect(out).toEqual([{ JobCompleted: { job_id: 7, digest: { ok: true, score: 0, words: 0, qa_defects: 0, artifact_sha: 'm1' } } }])
    expect(calls).toEqual(['state #4', 'redeploy #4'])
    expect(statusPosts()).toEqual(['PR #4: its deploy failed; deploying it again.'])
    // Run again (a reload): the deploy is pending, nothing is asked twice.
    await orch.run(JSON.stringify(job))
    expect(calls).toEqual(['state #4', 'redeploy #4', 'state #4'])

    // The redeploy failed too, and GitHub refuses the next re-run: the run rejects (the host
    // retries, then reports JobFailed{Infrastructure}) and the reason is in the item's thread.
    state = 'failed'
    refuse = 'POST /api/gateway/redeploy: 403 GitHub refused to re-run the deploy workflow'
    await expect(orch.run(JSON.stringify({ ...job, job_id: 9 }))).rejects.toThrow(/403 GitHub refused/)
    expect(statusPosts()[1]).toContain('PR #4: the deploy could not be run again: redeploy: ')
    expect(state).toBe('failed')

    // A gateway without the optional methods never redeploys (deploys are not observed).
    const plain = new OrchestratorHandle(store, { openDraft: gateway.openDraft, merge: gateway.merge }, fakeModel(), site)
    expect(JSON.parse(await plain.run(JSON.stringify({ ...job, job_id: 10 })))[0].JobCompleted.digest.ok).toBe(true)
  })

  test('infrastructure failures reject; agent failures resolve not-ok', async () => {
    const store = new MemJsStore()
    const model = createMvpModel()
    // The standup's four calls (opening, two pitches, commission), then the model is gone.
    let left = 4
    const llm = scriptedLlm([], { answer: (call) => (left-- > 0 ? model.answer(call) : (undefined as never)) })
    const gateway = new FakeJsGateway()
    const orch = new OrchestratorHandle(store, gateway, llm, SITE)
    const out = JSON.parse(
      await orch.run(JSON.stringify({ company_id: COMPANY, job_id: 1, kind: 'standup', project: 'p', work_item: null, brief_ref: null, revision: 0, staff: MVP_TEAM })),
    )
    const briefRef: string = out[0].MeetingOutcome.briefs[0].brief_ref
    // The model fails: the draft's first model call fails → JobFailed{Model} + a status post.
    const job = { company_id: COMPANY, job_id: 2, kind: 'draft', project: 'p', work_item: 'w1', brief_ref: briefRef, revision: 0, staff: MVP_TEAM }
    const draft = JSON.parse(await orch.run(JSON.stringify(job)))
    expect(draft).toEqual([{ JobFailed: { job_id: 2, reason: 'Model' } }])
    expect(store.posts.at(-1)?.post.type).toBe('status')
    expect(gateway.prs.size).toBe(0)
    // A review before any draft is an invalid job: the promise rejects.
    await expect(orch.run(JSON.stringify({ ...job, job_id: 3, kind: 'review', work_item: 'w2' }))).rejects.toThrow(/invalid job/)
    // A store that throws rejects the job too.
    const failing = Object.assign(new MemJsStore(), { putBrief: () => Promise.reject(new Error('disk full')) })
    const broken = new OrchestratorHandle(failing, gateway, fakeModel(), SITE)
    await expect(
      broken.run(JSON.stringify({ company_id: COMPANY, job_id: 9, kind: 'standup', project: 'p', work_item: null, brief_ref: null, revision: 0, staff: MVP_TEAM })),
    ).rejects.toThrow(/disk full/)
  })
})


describe('P6: cancel through the handle', () => {
  test('cancel() stops the running job before its next model call; the model call in flight is aborted', async () => {
    const store = new MemJsStore()
    const model = createMvpModel()
    let release: () => void = () => undefined
    let aborted = 0
    // The intro hangs until the bridge's abort() releases it.
    const llm = {
      ...scriptedLlm([], model, 'fake-mvp'),
      abort() {
        aborted++
        release()
      },
    }
    const inner = llm.complete
    llm.complete = async (json: string) => {
      if (/## Task: intro/.test(json)) {
        await new Promise<void>((r) => (release = r))
        return JSON.stringify({ error: { Timeout: 'the model call was cancelled' } })
      }
      return inner(json)
    }
    const orch = new OrchestratorHandle(store, new FakeJsGateway(), llm, SITE)
    const standup = JSON.parse(await orch.run(JSON.stringify({ company_id: COMPANY, job_id: 1, kind: 'standup', project: 'p', work_item: null, brief_ref: null, revision: 0, staff: MVP_TEAM })))
    const briefRef: string = standup[0].MeetingOutcome.briefs[0].brief_ref
    const running = orch.run(JSON.stringify({ company_id: COMPANY, job_id: 2, kind: 'draft', project: 'p', work_item: 'w1', brief_ref: briefRef, revision: 0, staff: MVP_TEAM }))
    await new Promise((r) => setTimeout(r, 20))
    expect(orch.cancel('cancelled')).toBe(2)
    expect(JSON.parse(await running)).toEqual([{ JobFailed: { job_id: 2, reason: 'Cancelled' } }])
    expect(aborted).toBe(1)
    // after the standup's six calls: the draft's research and outline, then the intro was cancelled
    expect(llm.calls.map(task).slice(6)).toEqual(['research', 'outline'])
    expect(orch.cancel()).toBeUndefined()
  })
})
