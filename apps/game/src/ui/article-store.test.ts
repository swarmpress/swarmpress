// The article of a work item read from the browser's CompanyStore (memory
// engine, the same SQL as Turso/sqlite in the browser): the records the
// orchestrator writes through its `Store` contract, in the overlay's shape.
import { describe, expect, it } from 'vitest'
import brief from '../../../../crates/agents/tests/fixtures/article/brief.json'
import golden from '../../../../crates/agents/tests/fixtures/article/page.golden.json'
import styleGuide from '../../../../crates/agents/tests/fixtures/style-guide.json'
import { CompanyStore } from '../store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import { artifactRecordJson } from './live-testing'
import { MockDataSource } from './mock-source'
import { articleFromStore, bannedPhrasesOf, companyStoreOptions, toArticleRecord, topLevelNumber, WasmDataSource, type SimOrgApi } from './wasm-source'

/** A u64 above 2^53: `JSON.parse` would round it (to …4568). */
const BRIEF_REF = '6712345678901234567'
const ITEM = 'work-item-1'

const sim: SimOrgApi = {
  org_json: () => JSON.stringify({ ceo: { name: 'You' }, executive: { cfo: null, secretary: null, delegation: 'off' }, departments: [], staff: [], projects: [] }),
  finance_json: () => JSON.stringify({ cashEur: 0, runwayDays: null, dailyBurnEur: 0, month: 1, company: {}, projects: [], alerts: [] }),
  inbox_json: () => JSON.stringify({ delegation: 'off', tickets: [], secretaryQueue: [] }),
  apply_command_json: () => undefined,
  plan_json: () => JSON.stringify({ goals: [], workstreams: [], items: [] }),
  day: () => 0,
  minute_of_day: () => 600,
}

/** What `orchestrator::run` stores for a reviewed revision: a `BriefRecord` and an `ArtifactRecord`. */
const briefRecord = () => ({ job_id: 1, brief, writer: 'staff-1', editor: 'staff-5', minutes: [], work_item: null, staff: [] })
const artifact = (over: Record<string, unknown> = {}) =>
  artifactRecordJson(BRIEF_REF, {
    page: golden,
    review: { decision: 'approve', score: 8, notes: 'Now it has people in it.', issues: ['Name one grower.'], high_risk: [] },
    revision: 1,
    path: 'content/pages/blog/harvest-week-in-manarola.json',
    branch: 'drafts/content-5d2c8e1f0a7b3c49',
    pr_number: 12,
    head_sha: '9f2c1aa7b3e4d5f60718293a4b5c6d7e8f901234',
    merged_sha: null,
    ...over,
  })

async function seeded() {
  const store = await CompanyStore.open(await MemorySqliteDriver.open())
  await store.putBrief('c1', BRIEF_REF, JSON.stringify(briefRecord()))
  await store.claimBrief('c1', BRIEF_REF, ITEM)
  await store.putArtifact('c1', ITEM, artifact())
  return store
}

describe('the article of a work item, from the CompanyStore', () => {
  it('joins the artifact record with its brief, found by the exact u64 reference', async () => {
    const store = await seeded()
    // The golden page carries the same key deeper down, as a string; the record's own is the number.
    expect(golden.metadata.brief_ref).toBe(BRIEF_REF)
    expect(String(JSON.parse(artifact()).brief_ref)).not.toBe(BRIEF_REF)
    const s = new WasmDataSource(sim, { personas: [], ...companyStoreOptions(store, { id: 'c1', site_repo: 'swarmpress/cinqueterre.travel' }, { style_guide: styleGuide }) })

    expect(await s.getArticle(ITEM)).toEqual({
      page: golden,
      review: { decision: 'approve', score: 8, notes: 'Now it has people in it.', issues: ['Name one grower.'], highRisk: [] },
      revision: 1,
      path: 'content/pages/blog/harvest-week-in-manarola.json',
      branch: 'drafts/content-5d2c8e1f0a7b3c49',
      pr: 12,
      headSha: '9f2c1aa7b3e4d5f60718293a4b5c6d7e8f901234',
      mergedSha: null,
      brief: { title: 'Harvest week in Manarola', angle: brief.angle, slug: 'harvest-week-in-manarola', keywords: brief.keywords, targetWords: 400 },
      writer: 'staff-1',
      editor: 'staff-5',
    })
    expect(await s.getArticle('work-item-2')).toBeNull()
    // The session also hands over the repository and the style guide's banned phrases.
    expect(s.capabilities()).toMatchObject({ site: { repo: 'swarmpress/cinqueterre.travel' }, bannedPhrases: styleGuide.vocabulary.avoid })
  })

  it('returns the same object while the record is unchanged, and a new one after the next draft or review', async () => {
    const store = await seeded()
    const read = articleFromStore(store, 'c1')
    const first = await read(ITEM)
    expect(await read(ITEM)).toBe(first)
    await store.putArtifact('c1', ITEM, artifact({ revision: 2, head_sha: 'aaaaaaa1', review: null }))
    const second = await read(ITEM)
    expect(second).not.toBe(first)
    expect(second).toMatchObject({ revision: 2, headSha: 'aaaaaaa1', review: null, brief: { targetWords: 400 } })
    expect(await read(ITEM)).toBe(second)
  })

  it('reads a first draft without a review, and a record whose brief is gone', async () => {
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    await store.putArtifact('c1', ITEM, artifactRecordJson('42', { page: { body: [] }, revision: 0, pr_number: 3, branch: 'drafts/x', head_sha: 'abc1234' }))
    expect(await articleFromStore(store, 'c1')(ITEM)).toEqual({
      page: { body: [] },
      review: null,
      revision: 0,
      path: null,
      branch: 'drafts/x',
      pr: 3,
      headSha: 'abc1234',
      mergedSha: null,
      brief: null,
      writer: null,
      editor: null,
    })
  })

  it('a source without a store has no article and no banned list', async () => {
    const s = new WasmDataSource(sim, { personas: [] })
    expect(await s.getArticle(ITEM)).toBeNull()
    expect(s.capabilities().bannedPhrases).toBeNull()
    // A store that only keeps plan text (no artifact reader): the same.
    const planOnly = { planJson: async () => '{}', appendPost: async () => 'post-1' }
    expect(companyStoreOptions(planOnly, { id: 'c1' })).toMatchObject({ article: undefined, bannedPhrases: null })
  })
})

describe('record shapes', () => {
  it('topLevelNumber reads the digits of a top-level key only', () => {
    expect(topLevelNumber(`{"branch":"x","brief_ref":${BRIEF_REF},"page":{"brief_ref":7}}`, 'brief_ref')).toBe(BRIEF_REF)
    expect(topLevelNumber(`{"page":{"brief_ref":7,"list":[{"brief_ref":8}]},"brief_ref": 9 }`, 'brief_ref')).toBe('9')
    // Inside a string, as a string value, or missing: not a number of the record.
    expect(topLevelNumber('{"note":"\\"brief_ref\\":5,","other":1}', 'brief_ref')).toBeNull()
    expect(topLevelNumber('{"brief_ref":"12"}', 'brief_ref')).toBeNull()
    expect(topLevelNumber('{"page":{"brief_ref":7}}', 'brief_ref')).toBeNull()
    expect(topLevelNumber('', 'brief_ref')).toBeNull()
  })

  it('accepts review issues tagged by section (the shape increment P3 brings)', () => {
    const rec = toArticleRecord({ review: { decision: 'needs_changes', score: 6, notes: 'n', issues: [{ section: 's2', problem: 'No source for the dates.', fix: 'Cite the cantina.' }, 'Plain issue', 7], high_risk: ['Names a court case'] } }, null)
    expect(rec.review).toEqual({
      decision: 'needs_changes',
      score: 6,
      notes: 'n',
      issues: ['[s2] No source for the dates. Fix: Cite the cantina.', 'Plain issue'],
      highRisk: ['Names a court case'],
    })
    expect(toArticleRecord('junk', 'junk')).toMatchObject({ page: null, review: null, revision: 0, pr: null, brief: null })
  })

  it('bannedPhrasesOf reads vocabulary.avoid of a style guide', () => {
    expect(bannedPhrasesOf(styleGuide)).toEqual(styleGuide.vocabulary.avoid)
    expect(bannedPhrasesOf({ vocabulary: { avoid: ['a', '', 3, 'b'] } })).toEqual(['a', 'b'])
    for (const none of [undefined, null, {}, { vocabulary: {} }, { vocabulary: { avoid: 'x' } }]) expect(bannedPhrasesOf(none)).toBeNull()
  })
})

describe('the mock source', () => {
  it('holds the golden article behind its approval ticket, with a review, a pull request and the brief', async () => {
    const s = new MockDataSource()
    const ticket = (await s.getInbox()).tickets.find((t) => t.kind === 'publish-approval')!
    expect(ticket).toMatchObject({ status: 'open', priority: 'high', workItem: ITEM, options: ['publish', 'send-back', 'kill', 'defer'], defaultOption: 'defer' })
    expect((await s.getPlan()).items.find((i) => i.id === ITEM)).toMatchObject({ status: 'approved', tickets: [ticket.id] })
    const article = (await s.getArticle(ITEM))!
    expect(article.page).toEqual(golden)
    expect(article).toMatchObject({ pr: 31, revision: 1, writer: 'staff-1', editor: 'staff-5', review: { score: 8, decision: 'approve' }, brief: { targetWords: 400 } })
    expect(await s.getArticle('work-item-2')).toBeNull()
    expect(s.capabilities().bannedPhrases).toEqual(styleGuide.vocabulary.avoid)
    // Its thread has the pull request as an artifact post.
    expect((await s.getPlanText()).posts[ITEM].find((p) => p.artifact?.pr === 31)).toMatchObject({ type: 'artifact', artifact: { path: 'content/pages/blog/harvest-week-in-manarola.json' } })
  })

  it('an answer at the gate moves the parked item; Defer leaves it parked', async () => {
    const answer = async (option: string) => {
      const s = new MockDataSource()
      expect(await s.apply(JSON.stringify({ AnswerTicket: { ticket: 'ticket-7', option } }))).toEqual({ ok: true })
      return (await s.getPlan()).items.find((i) => i.id === ITEM)!.status
    }
    expect(await answer('publish')).toBe('scheduled')
    expect(await answer('send-back')).toBe('in-progress')
    expect(await answer('kill')).toBe('cancelled')
    expect(await answer('defer')).toBe('approved')
  })
})
