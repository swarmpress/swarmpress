// CompanyStore on the `memory` engine (sqlite-wasm in-memory, in Node): the
// same migrations and SQL the turso and sqlite engines run in the browser
// (both are exercised by e2e/orchestrator.spec.ts).
import { describe, expect, it } from 'vitest'
import { CompanyStore, MIGRATIONS, PLAN_POSTS_PER_ITEM, SCHEMA_VERSION, storeChoiceFromQuery } from './index'
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
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2])
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

  it('a store of schema 1 gains the site_knowledge table when it opens', async () => {
    const s = await store()
    await s.setKv('device.id', 'dev-1')
    await s.driver.exec('DROP TABLE site_knowledge')
    await s.driver.run('DELETE FROM schema_migrations WHERE version = 2')
    expect(await s.schemaVersion()).toBe(1)
    const again = await CompanyStore.open(s.driver)
    expect(await again.schemaVersion()).toBe(2)
    expect(await again.getKv('device.id')).toBe('dev-1')
    await again.putKnowledge({ commit: 'c', etag: '"c"', pack: '{}' })
    expect((await again.latestKnowledge())!.pack).toBe('{}')
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
