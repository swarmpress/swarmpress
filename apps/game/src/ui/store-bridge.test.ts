// The overlay's plan text read from the browser's CompanyStore (memory
// engine, same SQL as Turso/sqlite in the browser), which the orchestrator
// writes through its `Store` contract.
import { describe, expect, it } from 'vitest'
import { CompanyStore } from '../store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import { planTextFromStore, WasmDataSource, type SimOrgApi } from './wasm-source'

const sim: SimOrgApi = {
  org_json: () => JSON.stringify({ ceo: { name: 'You' }, executive: { cfo: null, secretary: null, delegation: 'off' }, departments: [], staff: [], projects: [] }),
  finance_json: () => JSON.stringify({ cashEur: 0, runwayDays: null, dailyBurnEur: 0, month: 1, company: {}, projects: [], alerts: [] }),
  inbox_json: () => JSON.stringify({ delegation: 'off', tickets: [], secretaryQueue: [] }),
  apply_command_json: () => undefined,
  plan_json: () => JSON.stringify({ goals: [], workstreams: [], items: [{ id: 'work-item-1', project: 'project-1', workstream: null, kind: 'article', status: 'in-review', priority: 'normal', owner: null, phases: [], todos: [], dependsOn: [], dueDay: null, publishDay: null, tickets: [] }] }),
  day: () => 0,
  minute_of_day: () => 600,
}

describe('WasmDataSource + CompanyStore plan text', () => {
  it('reads the orchestrator thread from the store and keeps CEO comments beside it', async () => {
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    await store.setItemText('c1', 'work-item-1', 'Harvest week in Manarola', 'Angle: the grape harvest')
    await store.appendPost('c1', 'work-item-1', JSON.stringify({ type: 'minutes', author: 'system', text: 'staff-4: Harvest piece this week.', payload: { job: 1, brief: { title: 'Harvest week in Manarola' } } }))
    await store.appendPost('c1', 'work-item-1', JSON.stringify({ type: 'artifact', author: 'system', text: 'PR #3 on draft/work-item-1 (900 words)', payload: { pr: 3, branch: 'draft/work-item-1', path: 'content/pages/en/harvest.json' } }))
    await store.appendPost('c1', 'work-item-1', JSON.stringify({ type: 'handoff', author: 'staff-1', to: 'staff-5', text: 'Draft is in PR #3.', payload: {} }))
    await store.appendPost('c1', 'work-item-1', JSON.stringify({ type: 'review', author: 'staff-5', text: 'Tighten the intro.', payload: { verdict: 'changes', score: 6 } }))

    const s = new WasmDataSource(sim, { personas: [], planText: planTextFromStore(store, 'c1') })
    expect((await s.getPlan()).items.map((i) => i.id)).toEqual(['work-item-1'])
    let text = await s.getPlanText()
    expect(text.items['work-item-1'].title).toBe('Harvest week in Manarola')
    expect(text.posts['work-item-1'].map((p) => p.type)).toEqual(['minutes', 'artifact', 'handoff', 'review'])
    expect(text.posts['work-item-1'][3]).toMatchObject({ verdict: 'changes', score: 6 })
    expect(text.posts['work-item-1'][1].artifact).toEqual({ label: 'draft/work-item-1', path: 'content/pages/en/harvest.json' })

    await s.appendPost('work-item-1', { type: 'comment', author: 'ceo', text: 'Add the festival dates' })
    text = await s.getPlanText()
    expect(text.posts['work-item-1'].map((p) => p.type)).toEqual(['minutes', 'artifact', 'handoff', 'review', 'comment'])
    // The store keeps only the orchestrator's posts.
    expect((await store.plan('c1')).posts['work-item-1']).toHaveLength(4)
  })
})
