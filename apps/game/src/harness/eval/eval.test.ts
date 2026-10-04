// The eval harness (FEAT-036; docs/design/mvp-pipeline.md §9) in Node: the
// briefs from the calendar, the meter, the threshold, the reports, and the
// whole run through orchestrator-wasm on the scripted model against the
// committed cinqueterre-mini pack. Needs `cargo xtask wasm`.
import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { OrchestratorHandle } from 'orchestrator-wasm'
import { validateBenchmarkDoc } from '../../llm/bench/report'
import { fakeMvpLlm, localLlmBridge, type LlmCallRecord, type ProgressEvent } from '../../orchestrator'
import { articleEntries, briefOf, calendarTopics, parseSitePack, pickBriefs, slugify, targetWords, type EvalSite } from './briefs'
import { LocalGateway, MemoryOrchestratorStore } from './local'
import { checksReject, failedChecks, median, overallVerdict, summarize, thresholdRows } from './metrics'
import { articleBlocks, articleText, evalBenchmarkDoc, evalDocFile, evalMarkdown } from './report'
import { Meter, runEval, truncatedAnswer, type EvalChecks, type EvalConfig, type EvalOrchestrator, type EvalResults } from './runner'

const FIXTURE = new URL('../fixtures/cinqueterre-mini.eval.json', import.meta.url)
let site: EvalSite

beforeAll(async () => {
  const url = new URL('../../../../../crates/orchestrator-wasm/pkg/orchestrator_wasm_bg.wasm', import.meta.url)
  await init({ module_or_path: await readFile(url) })
  site = parseSitePack(await readFile(FIXTURE, 'utf8'))
})

const CTX = {
  provenance: { commit: 'abcdef1', branch: 'main', dirty: false, generatedAt: '2026-10-04T10:00:00Z' },
  machine: { slug: 'test-machine', os: 'macos', arch: 'aarch64', cpus: 8, cpuModel: 'Test CPU', memoryGb: 16 },
}

describe('the inputs', () => {
  it('splits the pack from the articles and takes the unpublished calendar topics by priority', () => {
    expect(site.pack.commit).toBe('3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b')
    expect(JSON.parse(site.packJson)).not.toHaveProperty('articles')
    expect(articleEntries(site).map(([p]) => p)).toEqual([
      'content/pages/blog/5-hidden-gelaterias-you-need-to-try.json',
      'content/pages/blog/day-trip-to-portovenere.json',
      'content/pages/blog/last-light-on-sentiero-azzurro.json',
    ])
    const picked = pickBriefs(site.pack, 10)
    expect(picked.available).toBe(4)
    expect(picked.published).toEqual(['day-trip-to-portovenere'])
    expect(picked.briefs.map((b) => b.slug)).toEqual([
      'cinque-terre-train-schedule-guide',
      'beat-the-crowds-cinque-terre-summer',
      'wine-harvest-cinque-terre-vendemmia',
      'winter-restaurants-cinque-terre-local-favorites',
    ])
    expect(pickBriefs(site.pack, 2).briefs).toHaveLength(2)
    expect(picked.briefs[2]).toMatchObject({ content_id: 'eval-wine-harvest', title: 'The Grape Harvest in Manarola', target_words: 900, language: 'en' })
  })

  it('reads the calendar shape and clamps target lengths to the MVP range', () => {
    const topics = calendarTopics({ seasonal_content: { fall: { topics: [{ id: 'a', title: 'A', slug: 'a' }, { bad: 1 }] } }, evergreen_content: { topics: [{ id: 'b', title: 'B', slug: 'b' }] } })
    expect(topics.map((t) => [t.id, t.group])).toEqual([
      ['a', 'fall'],
      ['b', 'evergreen'],
    ])
    expect(targetWords('1800-2200 words')).toBe(1200)
    expect(targetWords('300-400 words')).toBe(600)
    expect(targetWords('800-1000 words')).toBe(900)
    expect(targetWords(undefined)).toBe(800)
    expect(slugify('Più Vino, più Città!')).toBe('piu-vino-piu-citta')
    expect(briefOf({ id: 'X Y', title: 'T', slug: 'S S', group: 'g' })).toMatchObject({ content_id: 'eval-x-y', slug: 's-s', angle: 'T', keywords: [] })
    expect(() => pickBriefs({ ...site.pack, files: {} }, 1)).toThrow(/content-calendar/)
    expect(() => parseSitePack('{"x":1}')).toThrow(/not a site pack/)
  })
})

describe('the meter', () => {
  const rec = (turns: number, tokens = 10): LlmCallRecord => ({ kind: 'structured', model: 'm', promptTokens: tokens, completionTokens: tokens, reasoningTokens: 0, turns, wallMs: 5, ok: true })
  const ev = (stage: string, state: ProgressEvent['state'], index = 0, detail: Record<string, unknown> | null = null): ProgressEvent => ({
    job_id: 1, kind: 'draft', revision: 0, work_item: 'w', staff: 's', persona: 'p', role: 'writer', stage, index, total: 1, state, detail,
  })

  it('gives every call to the stage open when it was made', () => {
    let t = 0
    const m = new Meter(() => (t += 100))
    m.beginJob(1, 'draft', 0, 'w')
    m.progress(ev('job', 'started'))
    m.progress(ev('context', 'done'))
    m.progress(ev('outline', 'started'))
    m.call(rec(1), false)
    m.progress(ev('outline', 'done'))
    m.progress(ev('section', 'started', 1))
    m.call(rec(1), true)
    m.call(rec(2), false)
    m.progress(ev('section', 'failed', 1, { error: 'too short' }))
    m.progress(ev('closing', 'reused'))
    m.endJob()
    expect(m.stages.map((s) => [s.stage, s.index, s.state, s.calls, s.turns, s.truncated, s.error])).toEqual([
      ['context', 0, 'done', 0, 0, 0, null],
      ['outline', 0, 'done', 1, 1, 0, null],
      ['section', 1, 'failed', 2, 3, 1, 'too short'],
      ['closing', 0, 'reused', 0, 0, 0, null],
    ])
    expect(m.stages[1].wallMs).toBe(100)
    expect(truncatedAnswer('{"text":"a.","truncated":true}')).toBe(true)
    expect(truncatedAnswer('{"error":{"Truncated":{"partial":"x"}}}')).toBe(true)
    expect(truncatedAnswer('{"value":{}}')).toBe(false)
  })
})

describe('the local store and gateway', () => {
  it('keep first stage writes, deduplicate posts and record what the gateway would say', async () => {
    const s = new MemoryOrchestratorStore()
    expect(s.putStage('c', 1, 'outline', 0, '{"a":1}')).toBe('{"a":1}')
    expect(s.putStage('c', 1, 'outline', 0, '{"a":2}')).toBe('{"a":1}')
    const id = s.appendPost('c', 'w', '{"type":"review","dedupe":"1:review:0"}')
    expect(s.appendPost('c', 'w', '{"type":"review","dedupe":"1:review:0"}')).toBe(id)
    expect(JSON.parse(s.planJson('c')).posts.w).toHaveLength(1)
    expect(s.claimBrief('c', '1', 'w')).toBe(true)
    expect(s.claimBrief('c', '1', 'x')).toBe(false)
    const g = new LocalGateway((cid) => (cid === 'bad' ? ['nope'] : []))
    const a = await g.openDraft('ok', 'content/pages/blog/a.json', '{}', 'Draft', 'w')
    const b = await g.openDraft('ok', 'content/pages/blog/a.json', '{"x":1}', 'Revision 1', 'w')
    expect(b.number).toBe(a.number)
    expect(b.head_sha).not.toBe(a.head_sha)
    await g.openDraft('bad', 'content/pages/blog/a.json', '{}', 'Draft', null)
    expect(g.drafts.map((d) => [d.contentId, d.issues, d.pathTaken])).toEqual([
      ['ok', [], false],
      ['ok', [], false],
      ['bad', ['nope'], true],
    ])
    await expect(g.merge()).rejects.toThrow(/never merges/)
  })
})

const config = (o: Partial<EvalConfig> = {}): EvalConfig => ({ backend: 'fake', modelId: 'fake-mvp', n: 3, bar: 7, maxRevisions: 3, jobTimeoutMs: 60_000, controls: true, seeded: true, ...o })

async function run(o: Partial<EvalConfig> = {}, evalSite: EvalSite = site): Promise<EvalResults> {
  const site = evalSite
  const cfg = config(o)
  const store = new MemoryOrchestratorStore()
  const meter = new Meter()
  let handle: EvalOrchestrator | null = null
  const gateway = new LocalGateway((contentId, path, pageJson) => JSON.parse(handle!.evalOp('gateway_checks', JSON.stringify({ content_id: contentId, path, page: JSON.parse(pageJson) }))) as string[])
  let record: LlmCallRecord | null = null
  const bridge = localLlmBridge(fakeMvpLlm(), { onCall: (r) => (record = r) })
  const llm = {
    async complete(req: string) {
      record = null
      const out = await bridge.complete(req)
      const r = record as LlmCallRecord | null
      if (r) meter.call(r, truncatedAnswer(out))
      return out
    },
  }
  const h = new OrchestratorHandle(store, gateway, llm, JSON.stringify({ site_id: 'cinqueterre.travel', brand_name: 'Cinque Terre Dispatch', language: 'en', knowledge_pack: site.packJson, quality_bar: 7, seo_suffix: 'The Dispatch' }))
  h.setProgress((json: string) => meter.progress(JSON.parse(json) as ProgressEvent))
  handle = h as unknown as EvalOrchestrator
  const picked = pickBriefs(site.pack, cfg.n)
  return runEval({ orch: handle, store, gateway, meter, site, briefs: picked.briefs, topicsAvailable: picked.available, published: picked.published, config: cfg })
}

describe('the eval on the scripted model', () => {
  let res: EvalResults
  beforeAll(async () => {
    res = await run()
  })

  it('runs every brief through draft, review and one revision to approval, each draft passing the gateway', () => {
    expect(res.errors).toEqual([])
    const briefs = res.articles.filter((a) => a.kind === 'brief')
    expect(briefs.map((a) => [a.outcome, a.reviews.map((r) => r.score), a.drafts.length])).toEqual([
      ['approved', [6, 8], 2],
      ['approved', [6, 8], 2],
      ['approved', [6, 8], 2],
    ])
    for (const a of briefs) {
      expect(a.drafts.every((d) => d.committed && d.gatewayIssues.length === 0)).toBe(true)
      expect(a.checks).toMatchObject({ site_issues: [], gateway_issues: [], banned_phrases: [], near_duplicates: 0, headings_ok: true })
      expect(articleBlocks(a.page)[0]).toMatchObject({ kind: 'title' })
      expect(a.jobs.map((j) => `${j.kind}:${j.revision}`)).toEqual(['draft:0', 'review:0', 'draft:1', 'review:1'])
    }
  })

  it('reviews every existing article and rejects every seeded-bad draft', () => {
    const controls = res.articles.filter((a) => a.kind === 'control')
    expect(controls.map((a) => a.source)).toEqual(articleEntries(site).map(([p]) => p))
    expect(controls.every((a) => a.reviews.length === 1)).toBe(true)
    const seeded = res.articles.filter((a) => a.kind === 'seeded')
    expect(seeded.map((a) => a.seedKind)).toEqual(['block-order', 'banned-phrase', 'unknown-entity', 'too-short', 'raw-html', 'duplicate-slug'])
    for (const a of seeded) expect(checksReject(a.checks), `${a.seedKind}: ${JSON.stringify(a.checks)}`).toBe(true)
    const kinds = Object.fromEntries(seeded.map((a) => [a.seedKind, failedChecks(a.checks as EvalChecks)]))
    expect(kinds['too-short']).toContain('words')
    expect(kinds['banned-phrase']).toContain('banned-phrases')
    expect(kinds['unknown-entity']).toContain('links-and-media')
    expect(kinds['raw-html']).toContain('plain-text')
    expect(seeded.find((a) => a.seedKind === 'duplicate-slug')!.checks!.gateway_issues.join(' ')).toContain('create-only')
  })

  it('summarizes, scores the threshold and writes a valid Cockpit document and record', () => {
    const s = summarize(res)
    expect(s).toMatchObject({ briefs: 3, approved: 3, revisions: [1, 1, 1], committed: 6, committedPass: 6, seeded: 6, seededChecksRejected: 6, seededEditorRejected: 6, controls: 3, truncated: 0, jobsOverTimeout: 0 })
    expect(s.firstTryPct).toBe(100)
    const rows = thresholdRows(s, res)
    expect(rows.find((r) => r.id === 'briefs')?.verdict).toBe('fail')
    expect(rows.find((r) => r.id === 'owner')?.verdict).toBe('pending')
    expect(overallVerdict(rows)).toBe('fail')
    const approved = res.articles.filter((a) => a.outcome === 'approved')
    const marks = Object.fromEntries(approved.map((a) => [a.id, { publish: true, factualError: false }]))
    expect(thresholdRows(summarize(res, marks), res).find((r) => r.id === 'owner')?.verdict).toBe('pass')
    const wrong = { ...marks, [approved[0].id]: { publish: true, factualError: true } }
    expect(thresholdRows(summarize(res, wrong), res).find((r) => r.id === 'owner')?.verdict).toBe('fail')

    const doc = evalBenchmarkDoc(res, CTX)
    expect(validateBenchmarkDoc(doc)).toEqual([])
    expect(doc.name).toBe('agent-pipeline-eval-fake')
    expect(evalDocFile('fake', 'm')).toBe('agent-pipeline-eval-fake.json')
    expect(evalDocFile('bonsai', 'm')).toBe('agent-pipeline-eval-bonsai.m.json')
    expect(doc.metrics.filter((m) => m.determinism === 'environment-sensitive').every((m) => m.status === 'inconclusive')).toBe(true)
    const md = evalMarkdown(res, CTX, marks)
    expect(md).toContain('**Verdict: FAIL**')
    expect(md).toContain('## Articles')
    expect(articleText(approved[0].page)).toMatch(/^# /)
  })

  it('scores the site’s own articles on the legacy profile and names every rule they break', () => {
    const controls = res.articles.filter((a) => a.kind === 'control')
    // The mini fixture copies the live shapes: a plural banned phrase ("tourist traps") and two heroes outside its media index.
    expect(Object.fromEntries(controls.map((a) => [a.source.split('/').pop(), a.checks?.rules]))).toEqual({
      '5-hidden-gelaterias-you-need-to-try.json': ['banned-phrase', 'create-only'],
      'day-trip-to-portovenere.json': ['create-only', 'media'],
      'last-light-on-sentiero-azzurro.json': ['create-only', 'media'],
    })
    const s = summarize(res)
    expect(s.controlRules).toEqual({ 'banned-phrase': 1, media: 2 })
    expect(s.controlsWithinLegacy).toBe(3)
    expect(s.controlsOutsideLegacy).toEqual([])
    expect(thresholdRows(s, res).find((r) => r.id === 'calibration')).toMatchObject({ verdict: 'pass', measured: '3 of 3; rules broken: banned-phrase 1 (legacy), media 2 (legacy)' })
    // The legacy profile is for controls only: an approved brief with a banned phrase still fails threshold 4.
    expect(s.approvedBanned).toBe(0)
    // A rule outside the legacy profile fails the calibration row and is named.
    const broken = structuredClone(res)
    const c = broken.articles.find((a) => a.kind === 'control')!
    c.checks = { ...c.checks!, rules: ['create-only', 'profile'] }
    const sb = summarize(broken)
    expect(sb.controlsOutsideLegacy).toEqual([{ source: c.source, rules: ['profile'] }])
    expect(thresholdRows(sb, broken).find((r) => r.id === 'calibration')?.verdict).toBe('fail')
    expect(evalMarkdown(broken, CTX)).toContain(`Outside the legacy profile: ${c.source} (profile).`)
    // Results exported before `rules` existed fall back to the failing checks, none of them legacy.
    const old = structuredClone(res)
    for (const a of old.articles) if (a.checks) delete a.checks.rules
    expect(summarize(old).controlsOutsideLegacy.map((x) => x.rules)).toEqual([['banned-phrases', 'site-validator'], ['links-and-media', 'site-validator', 'gateway'], ['links-and-media', 'site-validator', 'gateway']])
    const doc = evalBenchmarkDoc(res, CTX)
    expect(doc.metrics.filter((m) => m.name === 'controls.failing_rule').map((m) => [m.subject, m.value])).toEqual([
      ['banned-phrase', 1],
      ['media', 2],
    ])
    expect(doc.metrics.find((m) => m.name === 'controls.outside_legacy')?.value).toBe(0)
  })

  it('is deterministic on the scripted model', async () => {
    const again = await run()
    const strip = (r: EvalResults) => r.articles.map((a) => [a.id, a.outcome, a.reviews.map((x) => x.score), a.checks?.words, JSON.stringify(a.page)])
    expect(strip(again)).toEqual(strip(res))
    expect(again.stages.map((s) => [s.stage, s.calls, s.turns])).toEqual(res.stages.map((s) => [s.stage, s.calls, s.turns]))
  })

  it('can leave out the controls and the seeded set', async () => {
    const r = await run({ n: 1, controls: false, seeded: false })
    expect(r.articles.map((a) => a.kind)).toEqual(['brief'])
    expect(median([3, 1, 2])).toBe(2)
    expect(median([])).toBeNull()
  })
})

// The owner's site pack on the scripted model, local only (docs/qualification/check-calibration.md):
// EVAL_PACK=<cargo xtask site-pack <site> --articles --out file> pnpm exec vitest run src/harness/eval
describe.skipIf(!process.env.EVAL_PACK)('the eval on a real site pack (EVAL_PACK, scripted model)', () => {
  it('passes the gate for new drafts, rejects the seeded set and scores the controls on the legacy profile', async () => {
    const real = parseSitePack(await readFile(process.env.EVAL_PACK!, 'utf8'))
    const res = await run({}, real)
    const s = summarize(res)
    const rows = thresholdRows(s, res)
    for (const r of rows) console.log(`[calib] ${r.id}: ${r.measured} → ${r.verdict}`)
    console.log(`[calib] checks failed by controls: ${JSON.stringify(s.calibration)}`)
    console.log(`[calib] rules broken by controls: ${JSON.stringify(s.controlRules)}`)
    for (const a of res.articles.filter((x) => x.kind === 'control')) console.log(`[calib] ${a.source.split('/').pop()}: ${(a.checks?.rules ?? []).join(', ')}`)
    expect(res.errors).toEqual([])
    expect(s.committedPass).toBe(s.committed)
    expect(s.seededRejected).toBe(6)
    expect(s.seededChecksRejected).toBe(6)
    expect(s.controlsOutsideLegacy).toEqual([])
  }, 600_000)
})
