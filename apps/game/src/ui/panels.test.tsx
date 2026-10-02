// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { sortTickets } from './components/Inbox'
import { filterItems } from './plan-logic'
import { POST_TYPES } from './plan-types'
import { flush, setup } from './testing'
import type { TicketJson } from './types'

let ctx: ReturnType<typeof setup> | null = null
const open = async (opts?: Parameters<typeof setup>[0]) => {
  ctx = setup(opts)
  await flush()
  return ctx
}
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

const key = async (k: string, target: Element = document.body) => {
  fireEvent.keyDown(target, { key: k })
  await flush()
}
const panel = (name: RegExp) => screen.getByRole('region', { name })

describe('toolbar and shortcuts', () => {
  it('lists the Plan first and opens panels by click, letter and number; Escape closes', async () => {
    await open()
    const nav = screen.getByRole('navigation', { name: 'CEO tools' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons[0].textContent).toMatch(/^Plan/)
    fireEvent.click(within(nav).getByRole('button', { name: /Org chart/ }))
    await flush()
    expect(panel(/Org chart/)).toBeTruthy()
    await key('f')
    expect(panel(/Finance/)).toBeTruthy()
    await key('2')
    expect(panel(/Inbox/)).toBeTruthy()
    await key('Escape')
    expect(screen.queryByRole('region', { name: /Inbox/ })).toBeNull()
  })

  it('does not trigger shortcuts while typing', async () => {
    const { store } = await open()
    store.panel.value = 'inbox'
    await flush()
    const input = document.createElement('input')
    document.body.appendChild(input)
    await key('f', input)
    expect(store.panel.value).toBe('inbox')
    input.remove()
  })
})

describe('profile card', () => {
  it('opens from the org chart with persona details and closes back to the opener', async () => {
    const { store } = await open()
    store.panel.value = 'org'
    await flush()
    const btn = within(panel(/Org chart/)).getByRole('button', { name: /Giulia Rossi/ })
    btn.focus()
    fireEvent.click(btn)
    await flush()
    const dialog = screen.getByRole('dialog', { name: 'Giulia Rossi' })
    const d = within(dialog)
    expect(d.getByText(/she\/her · Food & Culture Writer/)).toBeTruthy()
    expect(d.getByText('making pesto by hand')).toBeTruthy()
    expect(d.getByText(/BSc Gastronomic Sciences/)).toBeTruthy()
    expect(d.getByRole('meter', { name: 'Morale' })).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await flush()
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('allocation slider respects the 100% total and validates via the source', async () => {
    const { store, source } = await open()
    store.openProfile({ staff: 'staff-1' })
    await flush()
    const dialog = screen.getByRole('dialog', { name: 'Giulia Rossi' })
    const d = within(dialog)
    // Giulia: 80% on cinqueterre.travel → at most 20% on the Lunigiana project.
    fireEvent.change(d.getByRole('combobox', { name: 'Project' }), { target: { value: 'project-2' } })
    await flush()
    const slider = d.getByRole('slider') as HTMLInputElement
    expect(slider.max).toBe('20')
    expect(slider.value).toBe('20')
    expect(d.getByText(/Total after: 100% of 100%/)).toBeTruthy()
    fireEvent.input(slider, { target: { value: '10' } })
    await flush()
    expect(d.getByText(/Total after: 90% of 100%/)).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: 'Assign' }))
    await flush()
    expect(source.current.org.staff[0].projects).toContainEqual({ project: 'project-2', allocation: 10 })
    expect(d.getByText(/90% of 100% allocated/)).toBeTruthy()

    // Fully allocated person: slider disabled with a reason.
    store.openProfile({ staff: 'staff-2' })
    await flush()
    const d2 = within(screen.getByRole('dialog', { name: 'Isabella Conti' }))
    fireEvent.change(d2.getByRole('combobox', { name: 'Project' }), { target: { value: 'project-2' } })
    await flush()
    expect((d2.getByRole('slider') as HTMLInputElement).disabled).toBe(true)
    expect(d2.getByText(/Fully allocated elsewhere \(100%\)/)).toBeTruthy()
    expect((d2.getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('fires only after confirmation', async () => {
    const { store, source } = await open()
    store.openProfile({ staff: 'staff-3' })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Fire…' }))
    await flush()
    expect(screen.getByRole('alertdialog', { name: 'Fire Lorenzo?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: fire Lorenzo' }))
    await flush()
    expect(source.current.org.staff.some((s) => s.id === 'staff-3')).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('inbox', () => {
  it('sorts open tickets by priority then deadline, resolved last', () => {
    const t = (id: string, priority: TicketJson['priority'], deadlineMinute: number, status = 'open') =>
      ({ id, priority, deadlineMinute, status }) as TicketJson
    const sorted = sortTickets([t('a', 'low', 10), t('b', 'high', 500), t('c', 'medium', 5), t('d', 'high', 100), t('e', 'high', 1, 'resolved')])
    expect(sorted.map((x) => x.id)).toEqual(['d', 'b', 'c', 'a', 'e'])
  })

  it('renders tickets in priority order with countdown and answers one', async () => {
    const { store, source } = await open()
    store.panel.value = 'inbox'
    await flush()
    const p = within(panel(/Inbox/))
    const list = p.getAllByRole('article')
    const titles = list.map((a) => a.querySelector('h4')!.textContent)
    expect(titles.slice(0, 6)).toEqual(['High risk article', 'Budget overrun', 'Publish approval', 'Missing role', 'Project proposal', 'Kpi report'])
    expect(within(list[0]).getByText('via Secretary')).toBeTruthy()
    expect(within(list[0]).getByText('3h 10m left')).toBeTruthy()
    fireEvent.click(within(list[0]).getByRole('button', { name: /^Hold/ }))
    await flush()
    expect(source.current.inbox.tickets.find((x) => x.id === 'ticket-2')).toMatchObject({ status: 'resolved', answer: 'hold' })
    expect(within(panel(/Inbox/)).getByRole('heading', { name: /Open tickets \(5\)/ })).toBeTruthy()
  })

  it('disables delegation (policy and Delegate menu) without a secretary, with an explanation', async () => {
    const { store, source } = await open()
    source.patch({ org: { ...source.current.org, executive: { ...source.current.org.executive, secretary: null } } })
    store.panel.value = 'inbox'
    await flush()
    const p = within(panel(/Inbox/))
    expect(p.getByText('No secretary: tickets arrive untriaged')).toBeTruthy()
    const policy = p.getByRole('group', { name: 'Delegation policy' }) as HTMLFieldSetElement
    expect(policy.disabled).toBe(true)
    expect(p.getByText('Needs a secretary.')).toBeTruthy()
    const submit = p.getByRole('button', { name: /^Delegate:/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(p.getAllByText(/No executive secretary\. Hire one to delegate/).length).toBeGreaterThan(0)
  })

  it('delegates a meeting with attendees when a secretary exists', async () => {
    const { store, source } = await open()
    store.panel.value = 'inbox'
    await flush()
    const p = within(panel(/Inbox/))
    fireEvent.change(p.getByRole('combobox', { name: 'Task' }), { target: { value: 'schedule-meeting' } })
    await flush()
    const submit = () => p.getByRole('button', { name: 'Delegate: Schedule meeting' }) as HTMLButtonElement
    expect(submit().disabled).toBe(true)
    fireEvent.click(p.getByRole('checkbox', { name: 'Elena Marchetti' }))
    fireEvent.input(p.getByRole('textbox', { name: 'Agenda' }), { target: { value: 'Q4 budget' } })
    await flush()
    expect(submit().disabled).toBe(false)
    fireEvent.click(submit())
    await flush()
    expect(source.current.inbox.secretaryQueue.at(-1)).toMatchObject({ kind: 'schedule-meeting', detail: 'Q4 budget with Elena Marchetti' })
  })
})

describe('finance', () => {
  it('shows the books with a CFO', async () => {
    const { store } = await open()
    store.panel.value = 'finance'
    await flush()
    const p = within(panel(/Finance/))
    expect(p.getByText('61 days')).toBeTruthy()
    expect(p.getByText('Over budget by more than 10%')).toBeTruthy()
    expect(p.getByRole('heading', { name: 'CFO report' })).toBeTruthy()
  })

  it('shows "No CFO — books not reviewed" without a CFO', async () => {
    const { store, source } = await open()
    source.applySync(JSON.stringify({ Fire: { staff: 'staff-7' } }))
    store.panel.value = 'finance'
    await flush()
    const p = within(panel(/Finance/))
    expect(p.getByText('No CFO — books not reviewed')).toBeTruthy()
    expect(p.getByText('Not reviewed')).toBeTruthy()
    expect(p.queryByRole('heading', { name: 'Alerts' })).toBeNull()
    expect(p.queryByRole('heading', { name: 'CFO report' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Runway 61/)
  })
})

describe('projects', () => {
  it('disables Create project with the level reason when locked', async () => {
    const { store } = await open()
    store.panel.value = 'projects'
    await flush()
    const p = within(panel(/Projects/))
    expect(p.getByText(/Company level 2 allows 1 running project\. Level 3 unlocks 2\./)).toBeTruthy()
    expect((p.getByRole('button', { name: 'Create project' }) as HTMLButtonElement).disabled).toBe(true)
    expect(p.getByRole('textbox', { name: 'Name' }).matches(':disabled')).toBe(true)
  })

  it('creates a project once the level allows it', async () => {
    const { store, source } = await open()
    source.patch({ org: { ...source.current.org, company: { level: 3, maxProjects: 2 } } })
    store.panel.value = 'projects'
    await flush()
    const p = within(panel(/Projects/))
    fireEvent.input(p.getByRole('textbox', { name: 'Name' }), { target: { value: 'Portofino Weekly' } })
    await flush()
    fireEvent.click(p.getByRole('button', { name: 'Create project' }))
    await flush()
    expect(source.current.org.projects.at(-1)).toMatchObject({ name: 'Portofino Weekly', slug: 'portofino-weekly' })
  })

  it('shows the project detail with missing roles and budget', async () => {
    const { store } = await open()
    store.panel.value = 'projects'
    await flush()
    fireEvent.click(within(panel(/Projects/)).getByRole('button', { name: 'cinqueterre.travel' }))
    await flush()
    const p = within(panel(/Projects/))
    expect(p.getByText('Missing roles')).toBeTruthy()
    expect(p.getByRole('meter', { name: 'Spent this month' })).toBeTruthy()
    expect(p.getByRole('link', { name: 'cinqueterre.travel' }).getAttribute('href')).toBe('https://cinqueterre.travel')
  })
})

describe('hiring', () => {
  it('lists candidates with the CFO note and hires', async () => {
    const { store, source } = await open()
    store.panel.value = 'hiring'
    await flush()
    const p = within(panel(/Hiring/))
    expect(p.getByText(/CFO: Affordable and fills the missing translator role/)).toBeTruthy()
    fireEvent.click(p.getByRole('button', { name: 'Hire Anna Kowalska' }))
    await flush()
    expect(source.current.org.staff.some((s) => s.persona === 'anna')).toBe(true)
  })
})

describe('plan', () => {
  it('filters the board by project, workstream and person', async () => {
    const { source, store } = await open()
    const items = source.current.plan.items
    expect(filterItems(items, { project: null, workstream: 'ws-3', person: null }).map((i) => i.id)).toEqual(['work-item-5', 'work-item-6'])
    expect(filterItems(items, { project: null, workstream: null, person: 'staff-6' }).map((i) => i.id)).toEqual([
      'work-item-1',
      'work-item-2',
      'work-item-3',
      'work-item-6',
      'work-item-10',
    ])
    expect(filterItems(items, { project: 'project-2', workstream: null, person: null })).toEqual([])

    store.panel.value = 'plan'
    await flush()
    const p = within(panel(/Media & publishing plan/))
    expect(p.getAllByRole('article')).toHaveLength(12)
    fireEvent.change(p.getByRole('combobox', { name: 'Workstream' }), { target: { value: 'ws-4' } })
    await flush()
    const cards = within(panel(/Media & publishing plan/)).getAllByRole('article')
    expect(cards.map((c) => c.querySelector('h4')!.textContent)).toEqual(['Redesign v2: village page template'])
    fireEvent.change(p.getByRole('combobox', { name: 'Workstream' }), { target: { value: '' } })
    fireEvent.change(p.getByRole('combobox', { name: 'Person' }), { target: { value: 'staff-11' } })
    await flush()
    expect(within(panel(/Media & publishing plan/)).getAllByRole('article').length).toBe(5)
  })

  it('switches views with the tabs', async () => {
    const { store } = await open()
    store.panel.value = 'plan'
    await flush()
    for (const name of ['Calendar', 'Timeline', 'Workload', 'Goals', 'Board']) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await flush()
      expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true')
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Calendar' }))
    await flush()
    expect(screen.getByRole('table', { name: /Publish dates/ })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'cinqueterre.travel · DE' })).toBeTruthy()
  })

  it('renders every thread post type distinctly', async () => {
    const { store, source } = await open()
    const all = Object.values(source.planStore.text().posts).flat()
    // The fixture covers every type but todo-done and the CEO's send-back note; add one of each.
    source.planStore.addPost('work-item-1', { type: 'todo-done', author: 'staff-6', day: 9, minute: 600, text: 'Done', todo: 'todo-1' })
    source.planStore.addPost('work-item-2', { type: 'send-back-note', author: 'ceo', day: 11, minute: 610, text: 'Name the producers you visited.' })
    expect(new Set([...all.map((p) => p.type), 'todo-done', 'send-back-note'])).toEqual(new Set(POST_TYPES))

    const seen = new Set<string>()
    for (const id of ['work-item-1', 'work-item-2', 'work-item-5', 'work-item-10']) {
      store.panel.value = 'plan'
      store.selectedItem.value = id
      await flush()
      const thread = screen.getByRole('heading', { name: /^Thread/ }).closest('section')!
      for (const li of thread.querySelectorAll<HTMLElement>('li.post')) seen.add(li.dataset.type!)
    }
    expect(seen).toEqual(new Set(POST_TYPES))

    store.selectedItem.value = 'work-item-1'
    await flush()
    const t = within(screen.getByRole('heading', { name: /^Thread/ }).closest('section')!)
    expect(t.getByText(/Changes requested · score 6\/10/)).toBeTruthy()
    expect(t.getByText(/Approved · score 8\/10/)).toBeTruthy()
    expect(t.getAllByText(/→ Francesca Neri/).length).toBe(1)
    expect(t.getByText(/primary 'Cinque Terre grape harvest'/)).toBeTruthy()
    expect(t.getByText('Harvest newsletter series (3 issues)')).toBeTruthy()
    expect(t.getByText('Daily standup · Sophia, Giulia, Marco, Francesca, Alessia')).toBeTruthy()
    expect(t.getByText('Three photos of the Volastra terraces at golden hour')).toBeTruthy()
    expect(t.getByText(/12 photos · Volastra harvest/)).toBeTruthy()

    store.selectedItem.value = 'work-item-10'
    await flush()
    const perf = screen.getByText('Content performance').closest('li')!
    expect(within(perf).getByText('1,240')).toBeTruthy()
    expect(within(perf).getByText('+38%')).toBeTruthy()
    expect(within(perf).getByText('Matteo Greco')).toBeTruthy()

    store.selectedItem.value = 'work-item-2'
    await flush()
    expect(screen.getByText('Answered by Chiara Galli')).toBeTruthy()
  })

  it('validates phase reassignment by role and team before enabling it', async () => {
    const { store, source } = await open()
    store.panel.value = 'plan'
    store.selectedItem.value = 'work-item-2'
    await flush()
    const draft = screen.getAllByRole('combobox', { name: 'Reassign' })[0] // first not-done phase: draft
    const row = draft.closest('li')!
    const btn = within(row).getByRole('button', { name: 'Reassign' }) as HTMLButtonElement
    fireEvent.change(draft, { target: { value: 'staff-6' } })
    await flush()
    expect(btn.disabled).toBe(true)
    expect(within(row).getByText(/A photographer can't take the draft phase/)).toBeTruthy()
    fireEvent.change(draft, { target: { value: 'staff-9' } })
    await flush()
    expect(within(row).getByText('Chiara is not on the cinqueterre.travel team')).toBeTruthy()
    fireEvent.change(draft, { target: { value: 'staff-3' } })
    await flush()
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await flush()
    expect(source.current.plan.items.find((i) => i.id === 'work-item-2')!.phases[1].assignee).toBe('staff-3')
  })

  it('lets the CEO comment, accept a proposal and send a phase to the Agency', async () => {
    const { store, source } = await open()
    store.panel.value = 'plan'
    store.selectedItem.value = 'work-item-1'
    await flush()
    fireEvent.input(screen.getByRole('textbox', { name: 'Comment as CEO' }), { target: { value: '@sophia schedule it for Sunday' } })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    await flush()
    expect(source.planStore.posts('work-item-1').at(-1)).toMatchObject({ type: 'comment', author: 'ceo', text: '@sophia schedule it for Sunday' })
    expect(screen.getByText('@sophia')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Accept proposal' }))
    await flush()
    expect(screen.getByText('Accepted')).toBeTruthy()

    store.selectedItem.value = 'work-item-8'
    await flush()
    fireEvent.click(screen.getAllByRole('button', { name: 'Send to Agency' })[0])
    await flush()
    expect(source.current.plan.items.find((i) => i.id === 'work-item-8')!.phases[0].agency).toBe(true)
  })
})

describe('performance', () => {
  it('shows KPIs, sparklines and the KPI report', async () => {
    const { store } = await open()
    store.panel.value = 'performance'
    await flush()
    const p = within(panel(/Performance/))
    for (const m of ['Sessions', 'Visitors', 'Pageviews', 'Engagement rate', 'Scroll depth', 'Outbound clicks']) expect(p.getByText(m)).toBeTruthy()
    expect(p.getAllByRole('img').length).toBeGreaterThanOrEqual(4)
    expect(p.getByText(/Sessions up 14% week on week/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Google|GA4/)
  })

  it('shows "Tracker: no data yet" for a project whose tracker has not reported', async () => {
    const { store } = await open()
    store.panel.value = 'performance'
    await flush()
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: 'project-2' } })
    await flush()
    expect(screen.getByText('Tracker: no data yet')).toBeTruthy()
    expect(screen.queryByText('Outbound clicks')).toBeNull()
  })

  it('shows "No data scientist — KPIs not reported" when none is employed', async () => {
    const { store, source } = await open()
    source.applySync(JSON.stringify({ Fire: { staff: 'staff-13' } }))
    store.panel.value = 'performance'
    await flush()
    expect(screen.getByText('No data scientist — KPIs not reported')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /KPI report/ })).toBeNull()
    expect(screen.getByText('Not measured')).toBeTruthy()
  })
})

describe('HUD', () => {
  it('feeds cash, runway and open/high ticket counts into the HUD signal', async () => {
    const { hudBusiness } = await import('./hud')
    const { source } = await open()
    // Six open tickets, three of them high (the publish approval, ticket-7, is one).
    expect(hudBusiness.value).toEqual({ cashEur: 92900.09, runwayDays: 61, booksKept: true, openTickets: 6, highTickets: 3 })
    source.applySync(JSON.stringify({ Fire: { staff: 'staff-7' } }))
    await flush()
    expect(hudBusiness.value?.booksKept).toBe(false)
  })
})
