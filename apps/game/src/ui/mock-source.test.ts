import { describe, expect, it } from 'vitest'
import { cmd, eurMonthToCentsPerDay, toJson, type Command } from './commands'
import { FIXTURE_NOW, MockDataSource } from './mock-source'

const apply = (s: MockDataSource, c: Command) => s.applySync(toJson(c))
const check = (s: MockDataSource, c: Command) => s.validateSync(toJson(c))
const staff = (s: MockDataSource, id: string) => s.current.org.staff.find((x) => x.id === id)!

describe('command JSON (serde external tagging, §5)', () => {
  it('encodes struct, newtype and unit variants', () => {
    expect(toJson(cmd.assign('staff-1', 'project-1', 80))).toBe('{"AssignToProject":{"staff":"staff-1","project":"project-1","allocation_pct":80}}')
    expect(cmd.setDelegation('low-and-medium')).toEqual({ SetPolicy: { Delegation: 'LowAndMedium' } })
    expect(cmd.delegate('TriageInbox')).toEqual({ Delegate: { task: 'TriageInbox' } })
    expect(cmd.setStatus('project-1', 'paused')).toEqual({ SetProjectStatus: { project: 'project-1', status: 'Paused' } })
    expect(cmd.setBudgetEurMonth('project-1', 600)).toEqual({ SetProjectBudget: { project: 'project-1', monthly_cents: 60000 } })
    expect(cmd.setItemStatus('work-item-1', 'in-review')).toEqual({ UpdateWorkItem: { item: 'work-item-1', update: { Status: 'InReview' } } })
    expect(cmd.delegate({ ArrangeHiring: { role: 'Translator', project: null } })).toEqual({
      Delegate: { task: { ArrangeHiring: { role: 'Translator', project: null } } },
    })
    expect(cmd.setSalaryEurMonth('staff-1', 3000)).toEqual({ SetSalary: { staff: 'staff-1', cents_per_day: eurMonthToCentsPerDay(3000) } })
    expect(eurMonthToCentsPerDay(3000)).toBe(10000)
  })
})

describe('MockDataSource', () => {
  it('serves the fixtures and the fixture clock', async () => {
    const s = new MockDataSource()
    expect(s.current.org.staff).toHaveLength(13)
    expect(s.current.org.executive).toMatchObject({ cfo: 'staff-7', secretary: 'staff-8' })
    expect((await s.getPersona('giulia'))?.name).toBe('Giulia Rossi')
    expect(await s.now()).toBe(FIXTURE_NOW)
    expect(s.current.org.projects[0].missingRoles).toEqual(['translator'])
  })

  it('validate() never mutates', () => {
    const s = new MockDataSource()
    const before = JSON.stringify(s.current.org)
    expect(check(s, cmd.assign('staff-1', 'project-2', 20)).ok).toBe(true)
    expect(JSON.stringify(s.current.org)).toBe(before)
  })

  it('enforces the 100% allocation rule', () => {
    const s = new MockDataSource()
    // Giulia is 80% on cinqueterre.travel.
    expect(check(s, cmd.assign('staff-1', 'project-2', 30))).toEqual({ ok: false, reason: 'Giulia would be at 110% (max 100%)' })
    expect(apply(s, cmd.assign('staff-1', 'project-2', 20)).ok).toBe(true)
    expect(staff(s, 'staff-1').projects).toEqual([
      { project: 'project-1', allocation: 80 },
      { project: 'project-2', allocation: 20 },
    ])
    expect(s.current.org.projects[1].team).toEqual([{ staff: 'staff-1', allocation: 20 }])
    // Re-allocating on the same project replaces, not adds.
    expect(apply(s, cmd.assign('staff-1', 'project-1', 70)).ok).toBe(true)
    expect(check(s, cmd.assign('staff-1', 'project-2', 30)).ok).toBe(true)
    expect(check(s, cmd.assign('staff-1', 'project-2', 0)).ok).toBe(false)
    expect(check(s, cmd.assign('staff-7', 'project-1', 10)).reason).toMatch(/Executive Office/)
  })

  it('removes from projects and clears the lead', () => {
    const s = new MockDataSource()
    expect(apply(s, cmd.remove('staff-4', 'project-1')).ok).toBe(true)
    expect(s.current.org.projects[0].lead).toBeNull()
    expect(staff(s, 'staff-4').projects).toEqual([])
    expect(check(s, cmd.remove('staff-4', 'project-1')).ok).toBe(false)
  })

  it('requires a project lead to be on the team', () => {
    const s = new MockDataSource()
    expect(check(s, cmd.setLead('project-1', 'staff-9')).reason).toMatch(/must be on the cinqueterre\.travel team/)
    expect(apply(s, cmd.setLead('project-1', 'staff-5')).ok).toBe(true)
    expect(s.current.org.projects[0].lead).toBe('staff-5')
  })

  it('gates CreateProject and activating projects by company level', () => {
    const s = new MockDataSource()
    const create = cmd.createProject({ name: 'Portofino Weekly', slug: 'portofino-weekly', domain: 'portofino.travel', budgetEurMonth: 10000 })
    expect(check(s, create).reason).toMatch(/Locked: Company level 2 allows 1 running project\. Level 3 unlocks 2\./)
    expect(check(s, cmd.setStatus('project-2', 'active')).ok).toBe(false)
    s.patch({ org: { ...s.current.org, company: { level: 3, maxProjects: 2 } } })
    expect(apply(s, create).ok).toBe(true)
    expect(s.current.org.projects.at(-1)).toMatchObject({ slug: 'portofino-weekly', status: 'active', budgetEurMonth: 10000 })
    expect(s.current.finance.projects.at(-1)).toMatchObject({ budgetEurMonth: 10000, spentEurMonth: 0 })
  })

  it('sets budgets and clears a resolved overrun alert', () => {
    const s = new MockDataSource()
    expect(s.current.finance.projects[0].overBudget).toBe(true)
    expect(apply(s, cmd.setBudgetEurMonth('project-1', 50000)).ok).toBe(true)
    expect(s.current.finance.projects[0]).toMatchObject({ budgetEurMonth: 50000, overBudget: false })
    expect(s.current.finance.alerts).toEqual([])
  })

  it('answers tickets once, with a valid option, and posts a decision to linked work items', () => {
    const s = new MockDataSource()
    expect(check(s, cmd.answer('ticket-3', 'nope')).reason).toMatch(/not an option/)
    expect(apply(s, cmd.answer('ticket-3', 'cut-scope')).ok).toBe(true)
    const t = s.current.inbox.tickets.find((x) => x.id === 'ticket-3')!
    expect(t).toMatchObject({ status: 'resolved', resolvedBy: 'ceo', answer: 'cut-scope' })
    expect(check(s, cmd.answer('ticket-3', 'cut-scope')).reason).toBe('Ticket already resolved')
    const last = s.planStore.posts('work-item-5').at(-1)!
    expect(last).toMatchObject({ type: 'decision', author: 'ceo' })
  })

  it('delegates to the secretary, and refuses without one', () => {
    const s = new MockDataSource()
    expect(apply(s, cmd.delegate({ ScheduleMeeting: { attendees: ['staff-7', 'staff-4'], agenda: 'Budget review', project: null } })).ok).toBe(true)
    expect(s.current.inbox.secretaryQueue.at(-1)).toMatchObject({ kind: 'schedule-meeting', status: 'queued' })
    expect(check(s, cmd.delegate({ ScheduleMeeting: { attendees: [], agenda: 'x', project: null } })).reason).toMatch(/attendee/)
    expect(apply(s, cmd.fire('staff-8')).ok).toBe(true)
    expect(s.current.org.executive.secretary).toBeNull()
    expect(check(s, cmd.delegate({ PrepareBriefing: { project: null } })).reason).toMatch(/No executive secretary/)
    expect(check(s, cmd.setDelegation('low')).ok).toBe(false)
    expect(check(s, cmd.setDelegation('off')).ok).toBe(true)
  })

  it('sets the delegation policy', () => {
    const s = new MockDataSource()
    expect(apply(s, cmd.setDelegation('low-and-medium')).ok).toBe(true)
    expect(s.current.inbox.delegation).toBe('low-and-medium')
    expect(s.current.org.executive.delegation).toBe('low-and-medium')
  })

  it('stops keeping the books when the CFO is fired', () => {
    const s = new MockDataSource()
    expect(apply(s, cmd.fire('staff-7')).ok).toBe(true)
    expect(s.current.org.executive.cfo).toBeNull()
    expect(s.current.finance).toMatchObject({ booksKept: false, alerts: [], report: null })
  })

  it('praises once per person per day, promotes, sets salary', () => {
    const s = new MockDataSource()
    const m = staff(s, 'staff-1').morale
    expect(apply(s, cmd.praise('staff-1')).ok).toBe(true)
    expect(staff(s, 'staff-1').morale).toBeCloseTo(m + 0.05)
    expect(check(s, cmd.praise('staff-1')).reason).toMatch(/already praised Giulia today/)
    expect(apply(s, cmd.promote('staff-1')).ok).toBe(true)
    expect(staff(s, 'staff-1').seniority).toBe('star')
    expect(check(s, cmd.promote('staff-1')).reason).toMatch(/already a star/)
    expect(apply(s, cmd.setSalaryEurMonth('staff-2', 3600)).ok).toBe(true)
    expect(staff(s, 'staff-2').salaryEurMonth).toBe(3600)
  })

  it('hires from the pool', () => {
    const s = new MockDataSource()
    expect(apply(s, cmd.hire('candidate-101')).ok).toBe(true)
    const anna = s.current.org.staff.at(-1)!
    expect(anna).toMatchObject({ id: 'staff-14', persona: 'anna', role: 'translator', projects: [] })
    expect(s.current.org.candidates?.some((c) => c.id === 'candidate-101')).toBe(false)
    expect(check(s, cmd.hire('candidate-101')).ok).toBe(false)
    // Staffing the translator clears the missing role.
    expect(apply(s, cmd.assign(anna.id, 'project-1', 100)).ok).toBe(true)
    expect(s.current.org.projects[0].missingRoles).toEqual([])
  })

  describe('plan commands (publishing-plan.md)', () => {
    it('role-checks and team-checks phase reassignment', () => {
      const s = new MockDataSource()
      // work-item-2 phase 1 is "draft".
      expect(check(s, cmd.assignPhase('work-item-2', 1, 'staff-6')).reason).toBe(
        "A photographer can't take the draft phase (needs writer, editor, editor in chief)",
      )
      expect(check(s, cmd.assignPhase('work-item-2', 1, 'staff-9')).reason).toBe('Chiara is not on the cinqueterre.travel team')
      expect(check(s, cmd.assignPhase('work-item-2', 0, 'staff-2')).reason).toMatch(/already done/)
      expect(apply(s, cmd.assignPhase('work-item-2', 1, 'staff-2')).ok).toBe(true)
      expect(s.current.plan.items.find((i) => i.id === 'work-item-2')!.phases[1].assignee).toBe('staff-2')
      expect(s.planStore.posts('work-item-2').at(-1)).toMatchObject({ type: 'decision', author: 'ceo' })
    })

    it('unblocks a phase when a qualified person is assigned', () => {
      const s = new MockDataSource()
      apply(s, cmd.hire('candidate-101'))
      apply(s, cmd.assign('staff-14', 'project-1', 100))
      expect(apply(s, cmd.assignPhase('work-item-8', 0, 'staff-14')).ok).toBe(true)
      const it8 = s.current.plan.items.find((i) => i.id === 'work-item-8')!
      expect(it8.phases[0].state).toBe('pending')
      expect(it8.status).toBe('planned')
    })

    it('re-prioritizes, approves only items in review, cancels', () => {
      const s = new MockDataSource()
      expect(apply(s, cmd.setPriority('work-item-3', 'urgent')).ok).toBe(true)
      expect(s.current.plan.items.find((i) => i.id === 'work-item-3')!.priority).toBe('urgent')
      expect(check(s, cmd.setItemStatus('work-item-3', 'approved')).reason).toMatch(/Only items in review/)
      expect(apply(s, cmd.setItemStatus('work-item-12', 'approved')).ok).toBe(true)
      expect(apply(s, cmd.setItemStatus('work-item-4', 'cancelled')).ok).toBe(true)
      expect(check(s, cmd.setItemStatus('work-item-10', 'cancelled')).reason).toMatch(/already published/)
    })

    it('accepts a proposal into a new backlog item, once', () => {
      const s = new MockDataSource()
      const n = s.current.plan.items.length
      expect(apply(s, cmd.acceptProposal('work-item-1', 'post-14')).ok).toBe(true)
      const created = s.current.plan.items.at(-1)!
      expect(s.current.plan.items).toHaveLength(n + 1)
      expect(created).toMatchObject({ kind: 'newsletter', status: 'backlog', workstream: 'ws-1' })
      expect(s.planStore.text().items[created.id].title).toBe('Harvest newsletter series (3 issues)')
      expect(s.planStore.posts('work-item-1').find((p) => p.id === 'post-14')!.accepted).toBe(true)
      expect(check(s, cmd.acceptProposal('work-item-1', 'post-14')).reason).toBe('Proposal already accepted')
      expect(check(s, cmd.acceptProposal('work-item-1', 'post-12')).reason).toBe('Not a proposal')
    })

    it('sends a phase to the Agency and books the fee', () => {
      const s = new MockDataSource()
      const agency = s.current.finance.company.agencyEur
      expect(apply(s, cmd.sendToAgency('work-item-8', 0)).ok).toBe(true)
      const it8 = s.current.plan.items.find((i) => i.id === 'work-item-8')!
      expect(it8.phases[0]).toMatchObject({ agency: true, assignee: null, state: 'working' })
      expect(it8.status).toBe('in-progress')
      expect(s.current.finance.company.agencyEur).toBe(agency + 360)
      expect(check(s, cmd.sendToAgency('work-item-8', 0)).reason).toBe('Already with the Agency')
    })

    it('completes todos', () => {
      const s = new MockDataSource()
      expect(apply(s, cmd.completeTodo('work-item-2', 'todo-5')).ok).toBe(true)
      expect(check(s, cmd.completeTodo('work-item-2', 'todo-5')).reason).toBe('Already done')
    })
  })

  it('notifies subscribers on apply and on plan posts', () => {
    const s = new MockDataSource()
    let n = 0
    const off = s.subscribe(() => n++)
    apply(s, cmd.praise('staff-2'))
    s.planStore.addPost('work-item-1', { type: 'comment', author: 'ceo', day: 11, minute: 600, text: 'Nice' })
    expect(n).toBe(2)
    off()
    apply(s, cmd.praise('staff-3'))
    expect(n).toBe(2)
  })
})
