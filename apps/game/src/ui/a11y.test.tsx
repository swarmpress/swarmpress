// @vitest-environment jsdom
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import golden from '../../../../crates/agents/tests/fixtures/article/page.golden.json'
import wire from './fixtures/plan-wire.json'
import { artifactRecordJson, fakeCompanyStore, LIVE_ITEM, liveSim, liveTicket, setupLive } from './live-testing'
import { normalizePlanText, type PlanTextWire } from './plan-wire'
import type { PanelId } from './store'
import { flush, setup } from './testing'
import { companyStoreOptions } from './wasm-source'

/**
 * axe-core accessibility checks for every panel and the profile card (ADR-0018).
 * jsdom has no layout, so colour contrast is checked in the browser instead
 * (e2e/ui.spec.ts screenshots); everything structural is checked here.
 */
async function audit(root: Element) {
  const res = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
    // The article preview's sandboxed frame is opaque to the page, and to axe: its element (title) is
    // checked, its document (model output, article-preview.test.ts) is not.
    iframes: false,
  })
  return res.violations.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
}

let ctx: ReturnType<typeof setup> | null = null
let live: ReturnType<typeof setupLive> | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
  live?.cleanup()
  live = null
})

const PANELS: PanelId[] = ['plan', 'inbox', 'activity', 'org', 'projects', 'finance', 'performance', 'hiring']

describe('axe: no violations', () => {
  it.each(PANELS)('%s panel', async (id) => {
    ctx = setup()
    ctx.store.panel.value = id
    await flush()
    expect(await audit(ctx.el)).toEqual([])
  })

  it('plan views and work item detail', async () => {
    ctx = setup()
    ctx.store.panel.value = 'plan'
    await flush()
    for (const tab of ['Calendar', 'Timeline', 'Workload', 'Goals']) {
      ;(Array.from(document.querySelectorAll('[role=tab]')).find((t) => t.textContent === tab) as HTMLElement).click()
      await flush()
      expect(await audit(ctx.el), tab).toEqual([])
    }
    for (const item of ['work-item-1', 'work-item-10', 'work-item-5']) {
      ctx.store.selectedItem.value = item
      await flush()
      expect(await audit(ctx.el), item).toEqual([])
    }
  })

  it('text-only work item from an orchestrator thread', async () => {
    ctx = setup()
    const text = normalizePlanText(wire as PlanTextWire)
    for (const [id, t] of Object.entries(text.items)) ctx.source.planStore.putItem(id, t)
    for (const [id, posts] of Object.entries(text.posts)) for (const { id: _id, ...p } of posts) ctx.source.planStore.addPost(id, p)
    ctx.store.panel.value = 'plan'
    await flush()
    expect(await audit(ctx.el), 'board').toEqual([])
    ctx.store.selectedItem.value = 'work-item-21'
    await flush()
    expect(document.querySelectorAll('li.post')).toHaveLength(6)
    expect(await audit(ctx.el), 'detail').toEqual([])
  })

  it('activity: the pinned job, expanded stages, filters, links, the empty state and an unfinished job', async () => {
    ctx = setup({ site: { repo: 'swarmpress/cinqueterre.travel' } })
    ctx.store.openActivity(10)
    await flush()
    await flush()
    // Opened on the job in flight: expanded.
    expect(document.querySelector('#activity-job-10 [aria-expanded="true"]')).not.toBeNull()
    for (const id of [4, 8]) (document.querySelector(`#activity-job-${id} .activity-toggle`) as HTMLElement).click()
    await flush()
    expect(document.querySelectorAll('.activity-stages table')).toHaveLength(3)
    expect(document.querySelectorAll('.activity-job a[rel="noopener noreferrer"]').length).toBeGreaterThan(0)
    expect(await audit(ctx.el), 'expanded').toEqual([])
    const kind = document.querySelectorAll<HTMLSelectElement>('[aria-label="Filter the activity"] select')[2]
    kind.value = 'publish'
    kind.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(await audit(ctx.el), 'filtered').toEqual([])
    ctx.cleanup()
    ctx = setup({ activity: [] })
    ctx.store.panel.value = 'activity'
    await flush()
    await flush()
    expect(document.querySelector('.activity-empty')).not.toBeNull()
    expect(await audit(ctx.el), 'empty').toEqual([])
  })

  it('project detail', async () => {
    ctx = setup()
    ctx.store.panel.value = 'projects'
    ctx.store.selectedProject.value = 'project-1'
    await flush()
    expect(await audit(ctx.el)).toEqual([])
  })

  it('profile card (staff and candidate)', async () => {
    ctx = setup()
    ctx.store.openProfile({ staff: 'staff-1' })
    await flush()
    expect(await audit(ctx.el)).toEqual([])
    ctx.store.openProfile({ persona: 'anna' })
    await flush()
    expect(await audit(ctx.el)).toEqual([])
  })

  it('live data: tickets of known and unknown kinds, a work item with disabled actions and links, the board alone, finance', async () => {
    const sim = liveSim()
    sim.state.inbox.tickets.push(
      liveTicket({ id: 'ticket-90', kind: 'PublishApproval', options: ['Publish', 'SendBack', 'Kill', 'Defer'], defaultOption: 'Defer', workItem: LIVE_ITEM }),
      liveTicket({ id: 'ticket-91', kind: 'budget-overrun', options: ['approve-overrun', 'cut-scope'], amountEur: 3600, project: 'project-1' }),
      liveTicket({ id: 'ticket-92', kind: 'quantum-audit', options: ['do-it'], status: 'expired', resolvedBy: 'default', answer: 'do-it' }),
    )
    const text: PlanTextWire = {
      items: { [LIVE_ITEM]: { title: 'Harvest week in Manarola', brief: 'Angle: the grape harvest.' } },
      posts: {
        [LIVE_ITEM]: [
          { type: 'artifact', author: 'system', text: 'PR #12 on drafts/content-harvest (842 words)', payload: { pr: 12, branch: 'drafts/content-harvest', path: 'content/pages/blog/harvest.json' } },
          { type: 'artifact', author: 'system', text: 'PR #12 merged (4be81c2)', payload: { pr: 12, merged_sha: '4be81c2d9a01' } },
        ],
      },
    }
    const c = (live = setupLive(sim, { planText: async () => text, site: { repo: 'swarmpress/cinqueterre.travel' } }))
    await c.store.refresh()
    for (const id of ['inbox', 'plan', 'finance'] as PanelId[]) {
      c.store.panel.value = id
      await flush()
      expect(await audit(c.el), id).toEqual([])
    }
    c.store.panel.value = 'plan'
    c.store.selectedItem.value = LIVE_ITEM
    await flush()
    expect(document.querySelectorAll('.work-item a[href^="https://github.com/"]').length).toBeGreaterThan(0)
    expect(await audit(c.el), 'work item').toEqual([])
  })

  it('publish approval: the ticket with its checks and review, the Send back note, the preview dialog (mock and live)', async () => {
    ctx = setup()
    ctx.store.panel.value = 'inbox'
    await flush()
    await flush()
    const ticket = document.querySelector<HTMLElement>('article[data-kind="publish-approval"]')!
    expect(ticket.querySelector('[role="group"][aria-labelledby$="-measured"]')).not.toBeNull()
    expect(await audit(ctx.el), 'ticket').toEqual([])
    ;[...ticket.querySelectorAll('button')].find((b) => b.textContent === 'Send back')!.click()
    await flush()
    expect(ticket.querySelector('form.send-back')).not.toBeNull()
    expect(await audit(ctx.el), 'send-back note').toEqual([])
    ctx.store.openArticle('work-item-1')
    await flush()
    expect(document.querySelector('[role="dialog"] iframe[sandbox=""]')).not.toBeNull()
    expect(await audit(ctx.el), 'preview dialog').toEqual([])
    ctx.store.closeArticle()

    // Live data: the same ticket with the article from a CompanyStore, and an article the store does not have.
    const sim = liveSim()
    sim.state.inbox.tickets.push(liveTicket({ id: 'ticket-90', kind: 'publish-approval', options: ['publish', 'send-back', 'kill', 'defer'], defaultOption: 'defer', workItem: LIVE_ITEM }))
    sim.state.inbox.tickets.push(liveTicket({ id: 'ticket-91', kind: 'publish-approval', options: ['publish', 'send-back', 'kill', 'defer'], defaultOption: 'defer', workItem: 'work-item-9' }))
    const store = fakeCompanyStore({}, { artifacts: { [LIVE_ITEM]: artifactRecordJson('1', { page: golden, review: { decision: 'approve', score: 8, notes: 'Good.', issues: [], high_risk: [] }, revision: 1, pr_number: 12 }) } })
    const c = (live = setupLive(sim, companyStoreOptions(store, { id: 'c1', site_repo: 'swarmpress/cinqueterre.travel' })))
    await c.store.refresh()
    c.store.panel.value = 'inbox'
    await flush()
    await flush()
    // The gate and the escalation on the same item show the article; the other gate says its text is missing.
    expect(c.el.querySelectorAll('.approval')).toHaveLength(2)
    expect(c.el.querySelectorAll('.approval-missing')).toHaveLength(1)
    expect(await audit(c.el), 'live inbox').toEqual([])
    c.store.openArticle(LIVE_ITEM)
    await flush()
    expect(await audit(c.el), 'live preview').toEqual([])
  })

  it('degraded states (no CFO, no secretary, no data scientist)', async () => {
    ctx = setup()
    for (const s of ['staff-7', 'staff-8', 'staff-13']) ctx.source.applySync(JSON.stringify({ Fire: { staff: s } }))
    for (const id of ['finance', 'inbox', 'performance', 'hiring'] as PanelId[]) {
      ctx.store.panel.value = id
      await flush()
      expect(await audit(ctx.el), id).toEqual([])
    }
  })
})
