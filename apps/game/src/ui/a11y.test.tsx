// @vitest-environment jsdom
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { PanelId } from './store'
import { flush, setup } from './testing'

/**
 * axe-core accessibility checks for every panel and the profile card (ADR-0018).
 * jsdom has no layout, so colour contrast is checked in the browser instead
 * (e2e/ui.spec.ts screenshots); everything structural is checked here.
 */
async function audit(root: Element) {
  const res = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  })
  return res.violations.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
}

let ctx: ReturnType<typeof setup> | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

const PANELS: PanelId[] = ['plan', 'inbox', 'org', 'projects', 'finance', 'performance', 'hiring']

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

  it('degraded states (no CFO, no secretary, no data scientist)', async () => {
    ctx = setup()
    for (const s of ['staff-7', 'staff-8', 'staff-13']) ctx.source.apply(JSON.stringify({ Fire: { staff: s } }))
    for (const id of ['finance', 'inbox', 'performance', 'hiring'] as PanelId[]) {
      ctx.store.panel.value = id
      await flush()
      expect(await audit(ctx.el), id).toEqual([])
    }
  })
})
