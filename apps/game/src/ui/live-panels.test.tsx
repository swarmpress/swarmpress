// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALL_COMMANDS, cmd, NOT_AVAILABLE, PLAN_COMMANDS, SIM_COMMANDS, toJson } from './commands'
import { optionLabel, ticketTitle } from './components/Inbox'
import { countdown, gameTime } from './format'
import { fakePlanStore, LIVE_ITEM, LIVE_TICKET, liveSim, liveTicket, setupLive, type LiveSim } from './live-testing'
import { availableViews } from './plan-logic'
import type { PlanTextWire } from './plan-wire'
import { UNAVAILABLE } from './store'
import { flush, setup } from './testing'
import { companyStoreOptions, WasmDataSource } from './wasm-source'

/**
 * The panels on live-shaped data (increment U2): the JSON views are the real
 * sim's (fixtures/live, see live-testing.ts), the plan text is what the
 * orchestrator writes to the CompanyStore.
 */
const TITLE = 'Harvest week in Manarola'
const REPO = 'swarmpress/cinqueterre.travel'

/** The store text of the captured work item: its title and the orchestrator's thread. */
const planText = (): PlanTextWire => ({
  items: { [LIVE_ITEM]: { title: TITLE, brief: 'Angle: the grape harvest on the Volastra terraces.' } },
  posts: {
    [LIVE_ITEM]: [
      { type: 'minutes', author: 'system', text: 'staff-4: Harvest piece this week.', payload: { job: 1, brief: { title: TITLE } } },
      {
        type: 'artifact',
        author: 'system',
        text: `PR #12 on drafts/content-harvest (842 words)`,
        payload: { pr: 12, branch: 'drafts/content-harvest', path: 'content/pages/blog/harvest-week-in-manarola.json', sha: '9f2c1aa7b3e4', revision: 0 },
      },
      { type: 'review', author: 'staff-5', text: 'Strong lead.', payload: { verdict: 'approve', score: 8 } },
      { type: 'artifact', author: 'system', text: 'PR #12 merged (4be81c2)', payload: { pr: 12, merged_sha: '4be81c2d9a01' } },
    ],
  },
})

type Ctx = ReturnType<typeof setupLive> | ReturnType<typeof setup>
let ctx: Ctx | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
  vi.useRealTimers()
})

const live = async (sim: LiveSim, opts: Parameters<typeof setupLive>[1] = { planText: async () => planText() }) => {
  const c = setupLive(sim, opts)
  ctx = c
  await c.store.refresh()
  return c
}
const panel = (name: RegExp) => screen.getByRole('region', { name })
/** A ticket by id, open or under "Resolved" (a closed <details>, so not found by role). */
const ticketEl = (id: string) => panel(/Inbox/).querySelector<HTMLElement>(`article[aria-labelledby="${id}-title"]`)!
const openItem = async (c: Ctx, id = LIVE_ITEM) => {
  c.store.panel.value = 'plan'
  c.store.selectedItem.value = id
  await flush()
  return within(panel(/Media & publishing plan/))
}

describe('inbox on live data', () => {
  it('an Escalation names its article, its deadline in game time and the default that applies', async () => {
    const sim = liveSim()
    const c = await live(sim)
    c.store.panel.value = 'inbox'
    await flush()
    const ticket = sim.state.inbox.tickets.find((t) => t.id === LIVE_TICKET)!
    expect(ticket).toMatchObject({ kind: 'escalation', workItem: LIVE_ITEM, status: 'open' })

    const article = within(panel(/Inbox/)).getByRole('article', { name: 'Escalation' })
    const t = within(article)
    // What it is about: the work item's title from the plan text, not the bare id.
    const about = t.getByRole('button', { name: TITLE })
    expect(article.textContent).not.toContain(LIVE_ITEM)
    // The company has a secretary; the sim exports no summary. No claim about either.
    expect(sim.state.org.executive.secretary).toBeTruthy()
    expect(article.textContent).not.toMatch(/untriaged|no summary|no secretary/i)
    // The deadline as game day and time, the time left, and what happens then.
    const now = await c.source.now()
    expect(article.querySelector('.ticket-deadline')!.textContent).toBe(
      `Due ${gameTime(ticket.deadlineMinute!)} · ${countdown(ticket.deadlineMinute! - now)} · if unanswered: ${optionLabel(ticket.defaultOption!)}`,
    )
    expect(gameTime(ticket.deadlineMinute!)).toMatch(/^Day \d+ · \d\d:\d\d$/)

    // The title opens the work item in the plan.
    fireEvent.click(about)
    await flush()
    expect(c.store.panel.value).toBe('plan')
    expect(c.store.selectedItem.value).toBe(LIVE_ITEM)
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy()
  })

  it('falls back to the work item id while the plan text has no title, and shows the amount and the role when there is one', async () => {
    const sim = liveSim()
    sim.state.inbox.tickets.push(
      liveTicket({ id: 'ticket-90', kind: 'budget-overrun', options: ['approve-overrun', 'cut-scope'], defaultOption: 'cut-scope', amountEur: 3600, project: 'project-1' }),
      liveTicket({ id: 'ticket-91', kind: 'missing-role', options: ['arrange-hiring', 'ignore'], role: 'translator', priority: 'medium' }),
      liveTicket({ id: 'ticket-92', kind: 'loan-offer', options: ['take-loan', 'cut-costs'], amountEur: 10000 }),
    )
    await live(sim, {})
    ctx!.store.panel.value = 'inbox'
    await flush()
    const inbox = within(panel(/Inbox/))
    expect(within(inbox.getByRole('article', { name: 'Escalation' })).getByRole('button', { name: LIVE_ITEM })).toBeTruthy()
    expect(within(inbox.getByRole('article', { name: 'Budget overrun' })).getByText('€3,600 over budget')).toBeTruthy()
    expect(within(inbox.getByRole('article', { name: 'Loan offer' })).getByText('€10,000 loan')).toBeTruthy()
    expect(inbox.getByRole('article', { name: 'Missing role' }).querySelector('.ticket-subject')!.textContent).toBe('Role: translator')
    // No amount on a ticket that carries none (the escalation's `amountEur` is 0).
    expect(inbox.getByRole('article', { name: 'Escalation' }).textContent).not.toContain('€')
  })

  it('renders an unknown ticket kind and unknown options from their ids and keeps the ticket answerable', async () => {
    const sim = liveSim()
    sim.state.inbox.tickets.push(
      // The publish gate (ADR-0059), as the sim increment will raise it.
      liveTicket({ id: 'ticket-93', kind: 'PublishApproval', options: ['Publish', 'SendBack', 'Kill', 'Defer'], defaultOption: 'Defer', workItem: LIVE_ITEM }),
      // A kind and options nobody has told the UI about.
      liveTicket({ id: 'ticket-94', kind: 'quantum-audit', options: ['do-it', 'wait_a_day'], defaultOption: 'wait_a_day', priority: 'low' }),
    )
    await live(sim)
    ctx!.store.panel.value = 'inbox'
    await flush()
    const inbox = () => within(panel(/Inbox/))

    const gate = within(inbox().getByRole('article', { name: 'Publish approval' }))
    expect(gate.getByRole('button', { name: TITLE })).toBeTruthy()
    expect(gate.getAllByRole('button').map((b) => b.textContent)).toEqual([TITLE, 'Publish', 'Send back', 'Kill', 'Defer (default at deadline)'])
    expect(inbox().getByRole('article', { name: 'Publish approval' }).querySelector('.ticket-deadline')!.textContent).toMatch(/if unanswered: Defer$/)

    const unknown = within(inbox().getByRole('article', { name: 'Quantum audit' }))
    expect(unknown.getAllByRole('button').map((b) => b.textContent)).toEqual(['Do it', 'Wait a day (default at deadline)'])

    // Answering sends the option id exactly as the sim named it. Send back on a work item
    // first offers a note for the revision (approval.test.tsx); here it goes without one.
    fireEvent.click(gate.getByRole('button', { name: 'Send back' }))
    await flush()
    expect(sim.applied).toEqual([])
    fireEvent.click(gate.getByRole('button', { name: 'Send back without a note' }))
    await flush()
    fireEvent.click(within(inbox().getByRole('article', { name: 'Quantum audit' })).getByRole('button', { name: 'Do it' }))
    await flush()
    expect(sim.applied).toEqual([
      '{"AnswerTicket":{"ticket":"ticket-93","option":"SendBack"}}',
      '{"AnswerTicket":{"ticket":"ticket-94","option":"do-it"}}',
    ])
    expect(sim.state.inbox.tickets.filter((t) => t.status === 'answered').map((t) => [t.id, t.answer])).toEqual([
      ['ticket-93', 'SendBack'],
      ['ticket-94', 'do-it'],
    ])
    // Both moved to Resolved with the option's label.
    const stillOpen = sim.state.inbox.tickets.filter((t) => t.status === 'open').length
    expect(inbox().getByRole('heading', { name: `Open tickets (${stillOpen})` })).toBeTruthy()
    expect(ticketEl('ticket-93').textContent).toContain('Answered Send back by you.')
    expect(ticketEl('ticket-94').textContent).toContain('Answered Do it by you.')
    expect(ticketEl('ticket-93').querySelector('.options')).toBeNull()
  })

  it('has friendly labels for the new ticket kinds and their options, in either spelling', () => {
    expect(['PublishApproval', 'StandupFailed', 'DeployFailed', 'NeedsMedia', 'NeedsPage'].map(ticketTitle)).toEqual([
      'Publish approval',
      'Standup failed',
      'Deploy failed',
      'Media needed',
      'Page needed',
    ])
    expect(['publish-approval', 'standup_failed', 'needs-media'].map(ticketTitle)).toEqual(['Publish approval', 'Standup failed', 'Media needed'])
    expect(['Publish', 'SendBack', 'send-back', 'Kill', 'Defer', 'Retry', 'Skip', 'Acknowledge', 'approve-overrun'].map(optionLabel)).toEqual([
      'Publish',
      'Send back',
      'Send back',
      'Kill',
      'Defer',
      'Retry',
      'Skip',
      'Acknowledge',
      'Approve overrun',
    ])
  })

  it('says which default applied when a ticket expired', async () => {
    const sim = liveSim()
    Object.assign(sim.state.inbox.tickets.find((t) => t.id === LIVE_TICKET)!, { status: 'expired', resolvedBy: 'default', answer: 'kill' })
    await live(sim)
    ctx!.store.panel.value = 'inbox'
    await flush()
    expect(ticketEl(LIVE_TICKET).textContent).toContain('Not answered by the deadline: Kill applied.')
    expect(ticketEl(LIVE_TICKET).querySelector('.ticket-deadline')).toBeNull()
  })
})

describe('work item on live data', () => {
  /** The captured item, plus a todo and a proposal: what the sim would have to export for those two actions to show at all. */
  const withTodoAndProposal = () => {
    const sim = liveSim()
    sim.state.plan.items[0].todos = [{ id: 'todo-1', assignee: null, done: false }]
    const text = planText()
    text.todos = { 'todo-1': 'Confirm the festival dates' }
    text.posts![LIVE_ITEM].push({ type: 'proposal', author: 'staff-4', text: 'A newsletter series', proposal: { title: 'Harvest newsletter', kind: 'newsletter' } })
    return { sim, text }
  }

  it('disables every action the sim has no command for, with a tooltip, and sends nothing', async () => {
    const { sim, text } = withTodoAndProposal()
    const c = await live(sim, { planText: async () => text })
    const p = await openItem(c)

    // The sim has UpdateWorkItem (ADR-0069): priority, due day and cancel are its to gate.
    expect((p.getByRole('combobox', { name: 'Priority' }) as HTMLSelectElement).disabled).toBe(false)
    const dead = [
      ...p.getAllByRole('combobox', { name: 'Reassign' }),
      ...p.getAllByRole('button', { name: 'Reassign' }),
      ...p.getAllByRole('button', { name: 'Send to Agency' }),
      p.getByRole('button', { name: 'Accept proposal' }),
      p.getByRole('checkbox', { name: 'Confirm the festival dates' }),
    ] as Array<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>
    // One Reassign and one Send to Agency per open phase of the real item.
    const openPhases = sim.state.plan.items[0].phases.filter((ph) => ph.state !== 'done').length
    expect(openPhases).toBeGreaterThan(0)
    expect(dead).toHaveLength(2 + 3 * openPhases)
    for (const el of dead) {
      expect(el.disabled, el.textContent ?? '').toBe(true)
      expect(el.title, el.textContent ?? '').toBe(NOT_AVAILABLE)
    }
    expect(p.getByText('Greyed-out actions are not available yet.')).toBeTruthy()

    for (const el of dead) fireEvent.click(el)
    await flush()
    expect(sim.applied).toEqual([])
    // only the sim's own command was checked: the plan commands never reach it
    expect(sim.validated.every((json: string) => json.includes('UpdateWorkItem'))).toBe(true)
  })

  it('never hands the sim a command it would reject: the store is the single gate', async () => {
    const sim = liveSim()
    const c = await live(sim)
    expect(PLAN_COMMANDS.map((n) => c.store.can(n))).toEqual([false, false, false, false])
    expect(SIM_COMMANDS.every((n) => c.store.can(n))).toBe(true)

    const plan = [
      cmd.assignPhase(LIVE_ITEM, 0, 'staff-1'),
      cmd.acceptProposal(LIVE_ITEM, 'post-1'),
      cmd.completeTodo(LIVE_ITEM, 'todo-1'),
      cmd.sendToAgency(LIVE_ITEM, 0),
    ]
    for (const command of plan) {
      expect(c.store.check(command)).toBe(UNAVAILABLE)
      expect(await c.store.run(command, 'Done')).toBe(UNAVAILABLE)
    }
    expect(UNAVAILABLE).toEqual({ ok: false, reason: NOT_AVAILABLE })
    expect(c.store.toast.value).toMatchObject({ text: NOT_AVAILABLE, tone: 'error' })
    expect(sim.applied).toEqual([])
    expect(sim.validated).toEqual([])

    // A command the sim has still goes through, validation included.
    const answer = cmd.answer(LIVE_TICKET, 'retry')
    c.store.check(answer)
    await flush()
    expect(c.store.check(answer)).toEqual({ ok: true })
    expect((await c.store.run(answer)).ok).toBe(true)
    expect(sim.validated).toEqual([toJson(answer)])
    expect(sim.applied).toEqual([toJson(answer)])
  })

  it('keeps the same actions live on the mock source, which has every command', async () => {
    const c = setup()
    ctx = c
    await flush()
    expect(ALL_COMMANDS.every((n) => c.store.can(n))).toBe(true)
    const p = await openItem(c, 'work-item-2')
    expect((p.getByRole('button', { name: 'Cancel item…' }) as HTMLButtonElement).disabled).toBe(false)
    expect((p.getAllByRole('combobox', { name: 'Reassign' })[0] as HTMLSelectElement).disabled).toBe(false)
    expect(p.queryByText('Greyed-out actions are not available yet.')).toBeNull()
  })
})

describe('links on live data', () => {
  const published = () => {
    const sim = liveSim()
    Object.assign(sim.state.plan.items[0], { status: 'published', publishDay: 0 })
    for (const ph of sim.state.plan.items[0].phases) Object.assign(ph, { state: 'done', progress: 1 })
    return sim
  }

  it('links the pull request and the merge commit to the repository of the company', async () => {
    const c = await live(liveSim(), { planText: async () => planText(), site: { repo: REPO } })
    const p = await openItem(c)
    const prs = p.getAllByRole('link', { name: 'PR #12' }) as HTMLAnchorElement[]
    // Twice in the thread (draft, merge) and twice under "Artifacts & links".
    expect(prs).toHaveLength(4)
    for (const a of prs) {
      expect(a.getAttribute('href')).toBe(`https://github.com/${REPO}/pull/12`)
      expect(a.target).toBe('_blank')
      expect(a.rel).toBe('noopener noreferrer')
    }
    for (const a of p.getAllByRole('link', { name: 'commit 4be81c2' })) expect(a.getAttribute('href')).toBe(`https://github.com/${REPO}/commit/4be81c2d9a01`)
    expect(p.getAllByText('content/pages/blog/harvest-week-in-manarola.json').length).toBeGreaterThan(0)
  })

  it('follows the repository the session names, and shows text when it names none', async () => {
    const fork = await live(liveSim(), { planText: async () => planText(), site: { repo: 'drietsch/ct-rehearsal' } })
    let p = await openItem(fork)
    expect(p.getAllByRole('link', { name: 'PR #12' })[0].getAttribute('href')).toBe('https://github.com/drietsch/ct-rehearsal/pull/12')
    fork.cleanup()

    const none = await live(liveSim())
    p = await openItem(none)
    expect(none.store.site).toEqual({ repo: null, publicBaseUrl: null })
    expect(p.queryAllByRole('link')).toEqual([])
    expect(p.getAllByText('PR #12').length).toBeGreaterThan(0)
  })

  it('shows no published-page link while the session does not know the public address, even for a published item', async () => {
    const c = await live(published(), { planText: async () => planText(), site: { repo: REPO } })
    const p = await openItem(c)
    expect(c.store.plan.value.items[0].status).toBe('published')
    expect(p.queryByRole('link', { name: 'Published page' })).toBeNull()
    expect(p.getAllByRole('link').every((a) => a.getAttribute('href')!.startsWith('https://github.com/'))).toBe(true)
  })

  it('links the published page once a source provides the public address, and only once the item is published (the hook)', async () => {
    const site = { repo: REPO, publicBaseUrl: 'https://cinqueterre.travel' }
    const c = await live(published(), { planText: async () => planText(), site })
    let p = await openItem(c)
    expect(p.getByRole('link', { name: 'Published page' }).getAttribute('href')).toBe('https://cinqueterre.travel/en/blog/harvest-week-in-manarola/')
    c.cleanup()

    const draft = await live(liveSim(), { planText: async () => planText(), site })
    p = await openItem(draft)
    expect(p.queryByRole('link', { name: 'Published page' })).toBeNull()
  })
})

describe('CEO comments on live data', () => {
  it('a comment is written through the store post API and is still in the thread after a reload', async () => {
    const store = fakePlanStore({ items: planText().items, posts: planText().posts })
    const company = { id: 'c1', site_repo: REPO }
    const before = store.rows.length

    const first = await live(liveSim(), companyStoreOptions(store, company))
    let p = await openItem(first)
    fireEvent.input(p.getByRole('textbox', { name: 'Comment as CEO' }), { target: { value: '@giulia add the festival dates' } })
    await flush()
    fireEvent.click(p.getByRole('button', { name: 'Post comment' }))
    expect(await p.findByText('@giulia')).toBeTruthy()
    // One more row in the store, in a type its post API accepts.
    expect(store.rows).toHaveLength(before + 1)
    expect(store.rows.at(-1)).toMatchObject({ company: 'c1', item: LIVE_ITEM, post: { type: 'status', author: 'ceo', text: '@giulia add the festival dates' } })

    // Reload: the page and its data source are gone; the company store is what stays.
    first.cleanup()
    expect(screen.queryByText('@giulia')).toBeNull()
    const second = await live(liveSim(), companyStoreOptions(store, company))
    p = await openItem(second)
    const posts = [...panel(/Media & publishing plan/).querySelectorAll<HTMLElement>('li.post')]
    expect(posts.map((li) => li.dataset.type)).toEqual(['minutes', 'artifact', 'review', 'artifact', 'comment'])
    const comment = within(posts.at(-1)!)
    expect(comment.getByText('You (CEO)')).toBeTruthy()
    expect(comment.getByText('Comment')).toBeTruthy()
    expect(comment.getByText('@giulia')).toBeTruthy()
    expect(posts.at(-1)!.textContent).toContain('add the festival dates')
    // The game time it was written at came back with it.
    expect(posts.at(-1)!.querySelector('.post-time')!.textContent).toMatch(/Day \d+ · \d\d:\d\d/)
    // The session also got the repository for the links from the company row.
    expect(second.store.site.repo).toBe(REPO)
  })
})

describe('navigation and plan views', () => {
  const tools = () => within(screen.getByRole('navigation', { name: 'CEO tools' })).getAllByRole('button').map((b) => b.querySelector('.tool-label')!.textContent)
  const key = async (k: string) => {
    fireEvent.keyDown(document.body, { key: k })
    await flush()
  }

  it('live: no Performance panel (it has no data source) and only the plan views the sim has data for', async () => {
    const sim = liveSim()
    const c = await live(sim)
    await flush()
    expect(tools()).toEqual(['Plan', 'Inbox', 'Org chart', 'Projects', 'Finance', 'Hiring'])
    // Its shortcut is gone too; the numbers follow the visible order.
    await key('k')
    expect(c.store.panel.value).toBeNull()
    c.store.togglePanel('performance')
    expect(c.store.panel.value).toBeNull()
    await key('6')
    expect(c.store.panel.value).toBe('hiring')

    // The plan: the sim exports no schedule, due days or goals, so the board stands alone.
    expect(availableViews(c.store.plan.value)).toEqual(['board'])
    await key('p')
    const plan = within(panel(/Media & publishing plan/))
    expect(plan.queryByRole('tablist')).toBeNull()
    expect(plan.queryAllByRole('tab')).toEqual([])
    expect(plan.getByRole('button', { name: TITLE })).toBeTruthy()
    expect(plan.getByRole('heading', { name: /^Blocked/ })).toBeTruthy()
  })

  it('live: a view comes back as soon as the sim exports data for it', async () => {
    const sim = liveSim()
    const c = await live(sim)
    c.store.panel.value = 'plan'
    await flush()
    // A planned publish day and a goal (what the plan design has and the sim does not export yet).
    Object.assign(sim.state.plan.items[0], { status: 'approved', publishDay: 3 })
    sim.state.plan.goals = [{ id: 'goal-1', metric: 'articles-published', target: 10, current: 2 }]
    sim.advance()
    await c.store.run(cmd.praise('staff-1'))
    await flush()
    expect(availableViews(c.store.plan.value)).toEqual(['board', 'calendar', 'workload', 'goals'])
    const plan = within(panel(/Media & publishing plan/))
    expect(plan.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Board', 'Calendar', 'Workload', 'Goals'])
    fireEvent.click(plan.getByRole('tab', { name: 'Goals' }))
    await flush()
    expect(plan.getByRole('meter', { name: 'Articles published' })).toBeTruthy()
  })

  it('live with a KPI source offers the Performance panel', async () => {
    await live(liveSim(), { performance: async () => ({ asOfDay: 0, projects: [], report: null }) })
    await flush()
    expect(tools()).toContain('Performance')
  })

  it('live with the company store offers the Activity panel (its activity record), after the Inbox', async () => {
    const store = { ...fakePlanStore(planText()), activityPage: async () => ({ rows: [], more: false }) }
    await live(liveSim(), companyStoreOptions(store, { id: 'c1', site_repo: REPO }))
    await flush()
    expect(tools()).toEqual(['Plan', 'Inbox', 'Activity', 'Org chart', 'Projects', 'Finance', 'Hiring'])
    await key('a')
    expect(panel(/^Activity/)).toBeTruthy()
  })

  it('mock: Performance and all five plan views stay', async () => {
    const c = setup()
    ctx = c
    await flush()
    expect(tools()).toEqual(['Plan', 'Inbox', 'Activity', 'Org chart', 'Projects', 'Finance', 'Performance', 'Hiring'])
    expect(availableViews(c.store.plan.value)).toEqual(['board', 'calendar', 'timeline', 'workload', 'goals'])
    await key('k')
    expect(panel(/Performance/)).toBeTruthy()
    await key('p')
    expect(within(panel(/Media & publishing plan/)).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Board', 'Calendar', 'Timeline', 'Workload', 'Goals'])
  })
})

describe('finance on live data', () => {
  it('labels the alert kinds the sim emits and never shows a raw slug', async () => {
    const sim = liveSim()
    // The sim's alerts are its open financial tickets (json.rs ALERT_KINDS), by ticket kind.
    sim.state.finance.alerts = [
      { kind: 'budget-overrun', project: 'project-1', ticket: 'ticket-90' },
      { kind: 'runway-low', project: null, ticket: 'ticket-91' },
      { kind: 'payroll-spike', project: null, ticket: 'ticket-92' },
      { kind: 'loan-offer', project: null, ticket: 'ticket-93' },
      { kind: 'tax-audit', project: null, ticket: null },
    ]
    const c = await live(sim)
    c.store.panel.value = 'finance'
    await flush()
    const alerts = within(within(panel(/Finance/)).getByRole('heading', { name: 'Alerts' }).closest('section')!)
    expect(alerts.getAllByRole('listitem').map((li) => li.querySelector('strong')!.textContent)).toEqual([
      'Over budget by more than 10%',
      'Runway under 30 days',
      'Payroll up more than 15% from a single hire',
      'Cash below zero: loan offer pending',
      'Tax audit',
    ])
    expect(panel(/Finance/).textContent).not.toMatch(/payroll-spike|loan-offer|runway-low|budget-overrun|Payroll spike|Loan offer/)
  })

  it('says that revenue is not modelled while the sim stubs it, and not otherwise', async () => {
    const sim = liveSim()
    expect(sim.state.finance.revenueStubbed).toBe(true)
    const c = await live(sim)
    c.store.panel.value = 'finance'
    await flush()
    expect(within(panel(/Finance/)).getByRole('note').textContent).toBe('Revenue is not modelled yet: the books show costs only, so revenue stays at €0.')
    c.cleanup()

    const modelled = liveSim()
    modelled.state.finance.revenueStubbed = false
    const c2 = await live(modelled)
    c2.store.panel.value = 'finance'
    await flush()
    expect(within(panel(/Finance/)).queryByRole('note')).toBeNull()
    c2.cleanup()

    // The fixtures model revenue.
    const mock = setup()
    ctx = mock
    mock.store.panel.value = 'finance'
    await flush()
    expect(panel(/Finance/).textContent).not.toContain('not modelled')
  })

  it('renders no CFO report block when the sim exports no report, or an empty one', async () => {
    const sim = liveSim()
    expect(sim.state.org.executive.cfo).toBeTruthy()
    expect(sim.state.finance.report).toBeUndefined()
    const c = await live(sim)
    c.store.panel.value = 'finance'
    await flush()
    expect(within(panel(/Finance/)).queryByRole('heading', { name: 'CFO report' })).toBeNull()
    expect(panel(/Finance/).querySelector('blockquote')).toBeNull()
    c.cleanup()

    const blank = liveSim()
    blank.state.finance.report = '  \n '
    const c2 = await live(blank)
    c2.store.panel.value = 'finance'
    await flush()
    expect(within(panel(/Finance/)).queryByRole('heading', { name: 'CFO report' })).toBeNull()
    expect(panel(/Finance/).querySelector('blockquote')).toBeNull()
    c2.cleanup()

    const written = liveSim()
    written.state.finance.report = 'Costs are on plan.'
    const c3 = await live(written)
    c3.store.panel.value = 'finance'
    await flush()
    expect(panel(/Finance/).querySelector('blockquote')!.textContent).toBe('Costs are on plan.')
  })
})

describe('change detection of the live source', () => {
  const total = (sim: LiveSim) => sim.reads.org + sim.reads.finance + sim.reads.inbox + sim.reads.plan

  it('re-serialises the views only when the sim step moved, and after its own commands', async () => {
    vi.useFakeTimers()
    const sim = liveSim()
    const s = new WasmDataSource(sim, { pollMs: 1000 })
    const seen: Array<string[] | undefined> = []
    const off = s.subscribe((t) => seen.push(t))
    await s.getOrg()
    expect(sim.reads).toEqual({ org: 1, finance: 1, inbox: 1, plan: 1 })

    // A held clock: ten polls, nothing serialised, subscribers still tick.
    vi.advanceTimersByTime(10_000)
    expect(total(sim)).toBe(4)
    expect(seen).toEqual(Array.from({ length: 10 }, () => ['clock']))

    // The step moved and a view changed with it: read once, reported as before.
    sim.state.org.staff[0].morale = 0.11
    sim.advance()
    vi.advanceTimersByTime(1000)
    expect(total(sim)).toBe(8)
    expect(seen.at(-1)).toEqual(['org'])
    expect((await s.getOrg()).staff[0].morale).toBe(0.11)

    // The step moved and nothing changed: read, compared, a clock tick.
    sim.advance(5)
    vi.advanceTimersByTime(1000)
    expect(total(sim)).toBe(12)
    expect(seen.at(-1)).toEqual(['clock'])

    // A command changes the inbox at the same step: re-read at once.
    const before = seen.length
    expect(await s.apply(toJson(cmd.answer(LIVE_TICKET, 'retry')))).toEqual({ ok: true })
    expect(total(sim)).toBe(16)
    expect(seen.slice(before)).toEqual([['inbox']])
    expect((await s.getInbox()).tickets.find((t) => t.id === LIVE_TICKET)!.status).toBe('answered')
    off()
  })

  it('reads every poll, as before, when the sim offers no step', async () => {
    vi.useFakeTimers()
    const sim = liveSim()
    delete (sim as Partial<LiveSim>).step
    const s = new WasmDataSource(sim, { pollMs: 1000 })
    const off = s.subscribe(() => undefined)
    await s.getOrg()
    vi.advanceTimersByTime(3000)
    expect(total(sim)).toBe(16)
    off()
  })

  it('takes the change key a session passes: step and the commands its loop applied between steps', async () => {
    vi.useFakeTimers()
    const sim = liveSim()
    let lastSeq = 7
    const s = new WasmDataSource(sim, { pollMs: 1000, changeKey: () => `${sim.step()}:${lastSeq}` })
    const seen: Array<string[] | undefined> = []
    const off = s.subscribe((t) => seen.push(t))
    await s.getOrg()
    vi.advanceTimersByTime(2000)
    expect(total(sim)).toBe(4)
    // An outcome applied while the clock is held: the step stands, the log moved.
    sim.state.plan.items[0].status = 'in-review'
    lastSeq++
    vi.advanceTimersByTime(1000)
    expect(total(sim)).toBe(8)
    expect(seen.at(-1)).toEqual(['plan'])
    off()
  })
})
