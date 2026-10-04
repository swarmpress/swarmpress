// CompanyStore on the `memory` engine (sqlite-wasm in-memory, in Node): the
// same migrations and SQL the turso and sqlite engines run in the browser
// (both are exercised by e2e/orchestrator.spec.ts).
import { describe, expect, it } from 'vitest'
import { CompanyStore, MIGRATIONS, PLAN_POSTS_PER_ITEM, SCHEMA_VERSION, storeChoiceFromQuery, type ActivityRow } from './index'
import { MemorySqliteDriver } from './sqlite-driver'

async function store() {
  return CompanyStore.open(await MemorySqliteDriver.open())
}

const BIG_REF = '9007199254740993' // 2^53 + 1: not representable as a JS number

describe('CompanyStore (memory engine)', () => {
  it('migrates once and records the schema version', async () => {
    const s = await store()
    expect(s.engine).toBe('memory')
    expect(s.persistent).toBe(false)
    expect(await s.schemaVersion()).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length)
    // A second open on the same database is a no-op.
    const again = await CompanyStore.open(s.driver)
    expect(await again.schemaVersion()).toBe(SCHEMA_VERSION)
  })

  it('keeps the first brief, claims it once, and overlays work_item', async () => {
    const s = await store()
    const rec = { job_id: 1, brief: { title: 'A' }, writer: 'staff-1', editor: 'staff-5', minutes: [] }
    await s.putBrief('c1', BIG_REF, JSON.stringify(rec))
    await s.putBrief('c1', BIG_REF, JSON.stringify({ ...rec, writer: 'other' }))
    const got = JSON.parse((await s.getBrief('c1', BIG_REF))!)
    expect(got.writer).toBe('staff-1')
    expect(got.work_item).toBeNull()
    expect(await s.claimBrief('c1', BIG_REF, 'work-item-1')).toBe(true)
    expect(await s.claimBrief('c1', BIG_REF, 'work-item-2')).toBe(false)
    expect(JSON.parse((await s.getBrief('c1', BIG_REF))!).work_item).toBe('work-item-1')
    await expect(s.claimBrief('c1', '1', 'x')).rejects.toThrow(/unknown brief_ref/)
    expect(await s.getBrief('c2', BIG_REF)).toBeNull()
  })

  it('stores artifact JSON verbatim (u64 brief_ref survives)', async () => {
    const s = await store()
    const text = `{"brief_ref":${BIG_REF},"revision":1,"pr_number":3}`
    await s.putArtifact('c1', 'w1', text)
    expect(await s.getArtifact('c1', 'w1')).toBe(text)
    await s.putArtifact('c1', 'w1', '{"brief_ref":1}')
    expect(await s.getArtifact('c1', 'w1')).toBe('{"brief_ref":1}')
    expect(await s.getArtifact('c1', 'nope')).toBeNull()
  })

  it('appends transcripts idempotently on (job, seq)', async () => {
    const s = await store()
    await s.appendTranscript('c1', 1, 1, 'staff-1', 'hello')
    await s.appendTranscript('c1', 1, 1, 'staff-1', 'again')
    await s.appendTranscript('c1', 1, 0, 'staff-4', 'first')
    expect(await s.transcripts('c1')).toEqual([
      { job_id: 1, seq: 0, speaker: 'staff-4', text: 'first' },
      { job_id: 1, seq: 1, speaker: 'staff-1', text: 'hello' },
    ])
  })

  it('builds the plan view: item text, ordered posts, ids, type check, newest 50', async () => {
    const s = await store()
    await s.setItemText('c1', 'w1', 'Title', null)
    await s.setItemText('c1', 'w1', null, 'Angle')
    const a = await s.appendPost('c1', 'w1', JSON.stringify({ type: 'minutes', author: 'system', text: 'm', payload: {} }))
    const b = await s.appendPost('c1', 'w1', JSON.stringify({ type: 'handoff', author: 'staff-1', to: 'staff-5', text: 'h', payload: {} }))
    expect(a).toMatch(/^post-\d+$/)
    expect(a).not.toBe(b)
    await expect(s.appendPost('c1', 'w1', JSON.stringify({ type: 'gossip', author: 'x', text: '', payload: {} }))).rejects.toThrow(
      /unknown post type/,
    )
    const plan = JSON.parse(await s.planJson('c1'))
    expect(plan.items).toEqual({ w1: { title: 'Title', brief: 'Angle' } })
    expect(Object.keys(plan)).toEqual(['items', 'todos', 'workstreams', 'goals', 'posts'])
    expect(plan.posts.w1.map((p: { type: string }) => p.type)).toEqual(['minutes', 'handoff'])
    expect(plan.posts.w1[1]).toMatchObject({ id: b, item: 'w1', author: 'staff-1', to: 'staff-5' })
    for (let i = 0; i < PLAN_POSTS_PER_ITEM + 5; i++) {
      await s.appendPost('c1', 'w2', JSON.stringify({ type: 'status', author: 'system', text: String(i), payload: {} }))
    }
    const w2 = (await s.plan('c1')).posts.w2
    expect(w2).toHaveLength(PLAN_POSTS_PER_ITEM)
    expect(w2[0].text).toBe('5')
    expect((await s.plan('other')).items).toEqual({})
  })

  it('appends the command log atomically and reads it back by step', async () => {
    const s = await store()
    const seqs = await s.appendCommands([
      { step: 10, kind: 'Player', payload: new Uint8Array([1, 2, 3]) },
      { step: 20, kind: 'Server', payload: new Uint8Array([4]) },
    ])
    expect(seqs).toEqual([1, 2])
    expect(await s.appendCommands([{ seq: 7, step: 30, kind: 'Player', payload: new Uint8Array([9]) }])).toEqual([7])
    // A duplicate seq fails the whole batch.
    await expect(
      s.appendCommands([
        { seq: 8, step: 40, kind: 'Player', payload: new Uint8Array([1]) },
        { seq: 7, step: 41, kind: 'Player', payload: new Uint8Array([1]) },
      ]),
    ).rejects.toThrow()
    const after = await s.commandsAfter(10)
    expect(after.map((c) => [c.seq, c.step])).toEqual([
      [2, 20],
      [7, 30],
    ])
    expect(Array.from(after[0].payload)).toEqual([4])
    expect(await s.lastSeq()).toBe(7)
  })

  it('keeps the newest snapshots', async () => {
    const s = await store()
    expect(await s.latestSnapshot()).toBeNull()
    for (const step of [100, 300, 200, 400]) await s.putSnapshot(step, new Uint8Array([step % 256, 1]), `h${step}`, 2)
    const snap = await s.latestSnapshot()
    expect(snap).toMatchObject({ step: 400, hash: 'h400' })
    expect(Array.from(snap!.bytes)).toEqual([400 % 256, 1])
    const steps = await s.driver.all<{ step: number }>('SELECT step FROM snapshots ORDER BY step')
    expect(steps.map((r) => r.step)).toEqual([300, 400])
  })

  it('keeps site knowledge packs by commit, verbatim, the newest two (migration 2)', async () => {
    const s = await store()
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3])
    expect(await s.latestKnowledge()).toBeNull()
    // Text kept byte for byte: whitespace, key order and a u64 survive.
    const pack = (c: string) => `{"commit":"${c}","files":{"content/config/style-guide.json":"{\\n  \\"voice\\": \\"warm\\"\\n}\\n"},"manifest":{"n":18446744073709551615},"pages":[]}`
    await s.putKnowledge({ commit: 'aaa', etag: '"aaa"', pack: pack('aaa') })
    expect(await s.latestKnowledge()).toMatchObject({ commit: 'aaa', etag: '"aaa"', pack: pack('aaa') })
    // Two writes in the same millisecond still order newest last.
    await s.putKnowledge({ commit: 'bbb', etag: '"bbb"', pack: pack('bbb') })
    await s.putKnowledge({ commit: 'ccc', etag: '"ccc"', pack: pack('ccc') })
    const latest = (await s.latestKnowledge())!
    expect(latest.commit).toBe('ccc')
    expect(latest.pack).toBe(pack('ccc'))
    expect(latest.fetchedAt).toBeGreaterThan((await s.knowledgeAt('bbb'))!.fetchedAt)
    expect(await s.knowledgeAt('aaa')).toBeNull()
    // Storing a commit again makes it the newest.
    await s.putKnowledge({ commit: 'bbb', etag: '"bbb"', pack: pack('bbb') })
    expect((await s.latestKnowledge())!.commit).toBe('bbb')
    const rows = await s.driver.all<{ n: number }>('SELECT COUNT(*) AS n FROM site_knowledge')
    expect(Number(rows[0].n)).toBe(2)
  })

  it('a store of schema 1 gains the site_knowledge, stage and activity tables when it opens', async () => {
    const s = await store()
    await s.setKv('device.id', 'dev-1')
    for (const t of ['site_knowledge', 'job_stages', 'post_dedupe', 'activity']) await s.driver.exec(`DROP TABLE ${t}`)
    await s.driver.run('DELETE FROM schema_migrations WHERE version >= 2')
    expect(await s.schemaVersion()).toBe(1)
    const again = await CompanyStore.open(s.driver)
    expect(await again.schemaVersion()).toBe(3)
    expect(await again.getKv('device.id')).toBe('dev-1')
    await again.putKnowledge({ commit: 'c', etag: '"c"', pack: '{}' })
    expect((await again.latestKnowledge())!.pack).toBe('{}')
    expect(await again.putStage('c1', 1, 'outline', 0, '{"input_hash":"h","value":{}}')).toBe('{"input_hash":"h","value":{}}')
  })

  it('a store of schema 2 gains the stage, dedupe and activity tables and keeps its posts (migration 3)', async () => {
    const s = await store()
    await s.appendPost('c1', 'w1', JSON.stringify({ type: 'status', author: 'ceo', text: 'before' }))
    for (const t of ['job_stages', 'post_dedupe', 'activity']) await s.driver.exec(`DROP TABLE ${t}`)
    await s.driver.run('DELETE FROM schema_migrations WHERE version = 3')
    expect(await s.schemaVersion()).toBe(2)
    const again = await CompanyStore.open(s.driver)
    expect(await again.schemaVersion()).toBe(3)
    const id = await again.appendPost('c1', 'w1', JSON.stringify({ type: 'status', author: 'system', text: 'after', dedupe: '7:status:0' }))
    expect(id).toBe('post-2')
    expect((await again.plan('c1')).posts.w1.map((p) => p.text)).toEqual(['before', 'after'])
  })

  it('keeps stage results by (company, job, stage, index), first write wins, values verbatim', async () => {
    const s = await store()
    expect(await s.getStage('c1', 7, 'section', 2)).toBeNull()
    // A u64 in a value is not rounded: the value stays JSON text.
    const first = '{"input_hash":"abc","value":{"blocks":[],"n":9007199254740993}}'
    expect(await s.putStage('c1', 7, 'section', 2, first)).toBe('{"input_hash":"abc","value":{"blocks":[],"n":9007199254740993}}')
    // A second write of the key keeps the first.
    expect(await s.putStage('c1', 7, 'section', 2, '{"input_hash":"zzz","value":{"blocks":[1]}}')).toBe(first)
    expect(await s.getStage('c1', 7, 'section', 2)).toBe(first)
    // Other keys are their own.
    await s.putStage('c1', 7, 'section', 3, '{"input_hash":"d","value":[]}')
    await s.putStage('c1', 8, 'section', 2, '{"input_hash":"e","value":null}')
    await s.putStage('c2', 7, 'section', 2, '{"input_hash":"f","value":"x"}')
    expect(await s.getStage('c2', 7, 'section', 2)).toBe('{"input_hash":"f","value":"x"}')
    expect(await s.stages('c1', 7)).toEqual([
      { stage: 'section', index: 2, inputHash: 'abc' },
      { stage: 'section', index: 3, inputHash: 'd' },
    ])
    await expect(s.putStage('c1', 1, 'x', 0, '{"value":1}')).rejects.toThrow(/input_hash/)
    await s.deleteStages('c1', [7])
    expect(await s.stages('c1', 7)).toEqual([])
    expect(await s.getStage('c1', 8, 'section', 2)).not.toBeNull()
  })

  it('writes a post with a dedupe key once (a re-run job never posts twice)', async () => {
    const s = await store()
    const post = (text: string, dedupe?: string) => JSON.stringify({ type: 'artifact', author: 'system', text, payload: {}, ...(dedupe ? { dedupe } : {}) })
    const a = await s.appendPost('c1', 'w1', post('PR #1', '2:artifact:0'))
    const b = await s.appendPost('c1', 'w1', post('PR #1 again', '2:artifact:0'))
    expect(b).toBe(a)
    // The same key in another company is another post; posts without a key always append.
    await s.appendPost('c2', 'w1', post('PR #1', '2:artifact:0'))
    await s.appendPost('c1', 'w1', post('comment'))
    await s.appendPost('c1', 'w1', post('comment'))
    const plan = await s.plan('c1')
    expect(plan.posts.w1.map((p) => p.text)).toEqual(['PR #1', 'comment', 'comment'])
    expect(plan.posts.w1[0]).toMatchObject({ id: a, dedupe: '2:artifact:0' })
    expect((await s.plan('c2')).posts.w1).toHaveLength(1)
  })

  it('keeps activity rows: replace by key, keep an existing attempt, read back in job order', async () => {
    const s = await store()
    const row = (over: Partial<ActivityRow>): ActivityRow => ({
      job_id: 2,
      stage: 'section',
      idx: 1,
      attempt: 1,
      kind: 'draft',
      revision: 0,
      work_item: 'work-item-1',
      staff: 'staff-1',
      role: 'writer',
      persona: 'giulia',
      model: 'fake-mvp',
      tokens_in: 900,
      tokens_out: 240,
      wall_ms: 1200,
      game_step: 1100,
      day: 0,
      minute: 552,
      result: 'done',
      detail: { words: 150 },
      ...over,
    })
    await s.putActivity('c1', row({}))
    await s.putActivity('c1', row({ stage: 'job', idx: 0, tokens_in: 4000, detail: { pr: 1, branch: 'drafts/content-x', sha: 'abc' } }))
    // A reused stage never overwrites the attempt that produced it; a re-run job row replaces.
    await s.putActivity('c1', row({ result: 'reused', tokens_in: 0 }), 'keep')
    await s.putActivity('c1', row({ stage: 'job', idx: 0, tokens_in: 4100, detail: { pr: 1 } }))
    await s.putActivity('c1', row({ job_id: 1, kind: 'standup', stage: 'job', idx: 0 }))
    const rows = await s.activity('c1')
    expect(rows.map((r) => [r.job_id, r.stage, r.result, r.tokens_in])).toEqual([
      [1, 'job', 'done', 900],
      [2, 'section', 'done', 900],
      [2, 'job', 'done', 4100],
    ])
    expect(rows[1]).toEqual(row({}))
    expect(await s.activity('c1', 2)).toHaveLength(2)
    expect(await s.activity('c2')).toEqual([])
  })

  it('reads the activity record a window of jobs at a time, newest job first (the Activity panel, U4)', async () => {
    const s = await store()
    const row = (job_id: number, stage: string, idx = 0): ActivityRow => ({
      job_id,
      stage,
      idx,
      attempt: 1,
      kind: 'draft',
      revision: 0,
      work_item: 'work-item-1',
      staff: 'staff-1',
      role: 'writer',
      persona: 'giulia',
      model: 'fake-mvp',
      tokens_in: 10,
      tokens_out: 5,
      wall_ms: 40,
      game_step: 1100,
      day: 0,
      minute: 552,
      result: 'done',
      detail: {},
    })
    // Seven jobs, each a stage row and a job row; job 7 is in flight (no job row yet); another company's rows.
    for (let j = 1; j <= 7; j++) {
      await s.putActivity('c1', row(j, 'section', 1))
      if (j < 7) await s.putActivity('c1', row(j, 'job'))
    }
    await s.putActivity('c2', row(9, 'job'))
    const first = await s.activityPage('c1', { limit: 3 })
    expect(first.more).toBe(true)
    expect(first.rows.map((r) => `${r.job_id}:${r.stage}`)).toEqual(['7:section', '6:section', '6:job', '5:section', '5:job'])
    expect(first.rows.every((r) => typeof r.created_at === 'number' && r.created_at > 0)).toBe(true)
    const second = await s.activityPage('c1', { limit: 3, before: 5 })
    expect(second.rows.map((r) => r.job_id)).toEqual([4, 4, 3, 3, 2, 2])
    expect(second.more).toBe(true)
    const last = await s.activityPage('c1', { limit: 3, before: 2 })
    expect(last).toMatchObject({ more: false })
    expect(last.rows.map((r) => r.job_id)).toEqual([1, 1])
    expect(await s.activityPage('c1', { limit: 3, before: 1 })).toEqual({ rows: [], more: false })
    expect((await s.activityPage('c2', { limit: 200 })).rows.map((r) => r.job_id)).toEqual([9])
  })

  it('has a key/value table', async () => {
    const s = await store()
    expect(await s.getKv('events.cursor')).toBeNull()
    await s.setKv('events.cursor', '41')
    await s.setKv('events.cursor', '42')
    expect(await s.getKv('events.cursor')).toBe('42')
    await s.deleteKv('events.cursor')
    expect(await s.getKv('events.cursor')).toBeNull()
  })
})

describe('storeChoiceFromQuery', () => {
  it('reads ?store=', () => {
    expect(storeChoiceFromQuery('?store=turso')).toBe('turso')
    expect(storeChoiceFromQuery('?store=sqlite&x=1')).toBe('sqlite')
    expect(storeChoiceFromQuery('?store=memory')).toBe('memory')
    expect(storeChoiceFromQuery('?store=duckdb')).toBe('auto')
    expect(storeChoiceFromQuery('')).toBe('auto')
  })
})
