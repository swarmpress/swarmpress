import { centsPerDayToEurMonth, kebab, type Command, type CommandResult, type SecretaryTask } from './commands'
import type { DataTopic, GameDataSource, NewPlanPost } from './data-source'
import financeFixture from './fixtures/finance.json'
import inboxFixture from './fixtures/inbox.json'
import orgFixture from './fixtures/org.json'
import performanceFixture from './fixtures/performance.json'
import planTextFixture from './fixtures/plan-text.json'
import planFixture from './fixtures/plan.json'
import { loadFixturePersonas, CANDIDATE_MIN_ID, type Persona } from './personas'
import { MemoryPlanStore, type PlanStore } from './plan-store'
import { normalizePlanText, type PlanTextWire } from './plan-wire'
import type { PlanJson, PlanPost, PlanText, WorkItemJson } from './plan-types'
import {
  allocationTotal,
  humanRole,
  MAX_ALLOCATION,
  noSecretaryReason,
  projectLockReason,
  REQUIRED_ROLES,
  rolesForPhase,
} from './rules'
import type { FinanceJson, InboxJson, OrgJson, PerformanceJson, Seniority, StaffJson } from './types'

export interface MockState {
  org: OrgJson
  finance: FinanceJson
  inbox: InboxJson
  plan: PlanJson
  performance: PerformanceJson
  /** `staff:day` keys; Praise is limited to once per person per day. */
  praised: string[]
}

/** Text-side effects of a command, applied to the PlanStore only on apply(). */
type PlanEffect =
  | { kind: 'post'; item: string; post: Omit<PlanPost, 'id'> }
  | { kind: 'accept'; item: string; post: string }
  | { kind: 'put'; item: string; text: { title: string; brief: string } }

interface Outcome {
  ok: boolean
  reason?: string
  effects: PlanEffect[]
}

export interface MockOptions {
  personas?: Persona[]
  /** Absolute game minute; defaults to the fixture's frozen clock. */
  clock?: () => number
  /** Override parts of the fixture state (tests). */
  state?: Partial<MockState>
  /** Plan text: UI shape or the orchestrator's `plan_json` wire shape. */
  planText?: PlanText | PlanTextWire
}

const SENIORITY: Seniority[] = ['junior', 'mid', 'senior', 'star']

export const fixtureState = (): MockState =>
  structuredClone({
    org: orgFixture as unknown as OrgJson,
    finance: financeFixture as unknown as FinanceJson,
    inbox: inboxFixture as unknown as InboxJson,
    plan: planFixture as unknown as PlanJson,
    performance: performanceFixture as unknown as PerformanceJson,
    praised: [],
  })

export const FIXTURE_NOW = (inboxFixture as { nowMinute: number }).nowMinute

/**
 * In-memory company built from the UI fixtures. Applies the CEO commands with
 * the same rules the sim enforces (organization.md §4–7, publishing-plan.md),
 * so the overlay is fully playable offline and in tests.
 */
export class MockDataSource implements GameDataSource {
  /** Mock-only: the in-memory plan text (tests and dev tools read it synchronously). */
  readonly planStore: PlanStore
  private state: MockState
  private personas: Persona[]
  private listeners = new Set<(topics?: DataTopic[]) => void>()
  private clock: () => number

  constructor(opts: MockOptions = {}) {
    this.state = { ...fixtureState(), ...structuredClone(opts.state ?? {}) }
    // The fixtures reference the fixture personas (candidates included), not the live catalog.
    this.personas = opts.personas ?? loadFixturePersonas().personas
    this.clock = opts.clock ?? (() => FIXTURE_NOW)
    this.planStore = new MemoryPlanStore(normalizePlanText(opts.planText ?? (planTextFixture as unknown as PlanText)))
    for (const p of this.state.org.projects) recomputeMissing(this.state.org, p.id)
    this.planStore.subscribe(() => this.emit(['plan']))
  }

  /** Mock-only synchronous view of the state (tests). */
  get current(): Readonly<MockState> {
    return this.state
  }

  async getOrg() {
    return this.state.org
  }
  async getFinance() {
    return this.state.finance
  }
  async getInbox() {
    return this.state.inbox
  }
  async getPlan() {
    return this.state.plan
  }
  async getPlanText() {
    return this.planStore.text()
  }
  async getPerformance() {
    return this.state.performance
  }
  async getPersona(slug: string) {
    return this.personas.find((p) => p.slug === slug)
  }
  async listPersonas() {
    return this.personas
  }
  async now() {
    return this.clock()
  }

  async validate(commandJson: string): Promise<CommandResult> {
    return this.validateSync(commandJson)
  }

  async apply(commandJson: string): Promise<CommandResult> {
    return this.applySync(commandJson)
  }

  async appendPost(item: string, post: NewPlanPost): Promise<PlanPost> {
    const now = this.clock()
    return this.planStore.addPost(item, { day: Math.floor(now / 1440), minute: now % 1440, ...post })
  }

  /** Mock-only synchronous `validate` (tests). */
  validateSync(commandJson: string): CommandResult {
    const draft = structuredClone(this.state)
    const { ok, reason } = this.run(draft, commandJson)
    return ok ? { ok } : { ok, reason }
  }

  /** Mock-only synchronous `apply` (tests). */
  applySync(commandJson: string): CommandResult {
    const draft = structuredClone(this.state)
    const out = this.run(draft, commandJson)
    if (!out.ok) return { ok: false, reason: out.reason }
    this.state = draft
    for (const e of out.effects) {
      if (e.kind === 'post') this.planStore.addPost(e.item, e.post)
      else if (e.kind === 'accept') this.planStore.markAccepted(e.item, e.post)
      else this.planStore.putItem(e.item, e.text)
    }
    this.emit()
    return { ok: true }
  }

  subscribe(onChange: (topics?: DataTopic[]) => void) {
    this.listeners.add(onChange)
    return () => void this.listeners.delete(onChange)
  }

  /** Test/debug hook: replace parts of the state (e.g. no CFO) and notify. */
  patch(next: Partial<MockState>) {
    this.state = { ...this.state, ...structuredClone(next) }
    this.emit()
  }

  private emit(topics?: DataTopic[]) {
    this.listeners.forEach((l) => l(topics))
  }

  private run(s: MockState, json: string): Outcome {
    let c: Command
    try {
      c = JSON.parse(json) as Command
    } catch {
      return fail('Malformed command JSON')
    }
    try {
      return reduce(s, c, this.personas, this.clock(), this.planStore.text())
    } catch (e) {
      return fail((e as Error).message)
    }
  }
}

const fail = (reason: string): Outcome => ({ ok: false, reason, effects: [] })
const ok = (effects: PlanEffect[] = []): Outcome => ({ ok: true, effects })

class Reject extends Error {}
const must: (cond: unknown, reason: string) => asserts cond = (cond, reason) => {
  if (!cond) throw new Reject(reason)
}

function recomputeMissing(org: OrgJson, projectId: string) {
  const p = org.projects.find((x) => x.id === projectId)
  if (!p) return
  const roles = new Set(p.team.map((m) => org.staff.find((s) => s.id === m.staff)?.role).filter(Boolean) as string[])
  p.missingRoles = REQUIRED_ROLES.filter((r) => !r.satisfiedBy.some((x) => roles.has(x))).map((r) => r.role)
}

function reduce(s: MockState, c: Command, personas: Persona[], now: number, text: PlanText): Outcome {
  const { org } = s
  const day = Math.floor(now / 1440)
  const staff = (id: string) => {
    const x = org.staff.find((p) => p.id === id)
    must(x, `Unknown staff ${id}`)
    return x
  }
  const project = (id: string) => {
    const x = org.projects.find((p) => p.id === id)
    must(x, `Unknown project ${id}`)
    return x
  }
  const item = (id: string) => {
    const x = s.plan.items.find((i) => i.id === id)
    must(x, `Unknown work item ${id}`)
    return x
  }
  const name = (st: StaffJson) => personas.find((p) => p.slug === st.persona)?.name.split(' ')[0] ?? st.persona
  const ceoPost = (it: string, text: string, type: PlanPost['type'] = 'decision'): PlanEffect => ({
    kind: 'post',
    item: it,
    post: { type, author: 'ceo', day, minute: now % 1440, text },
  })

  const [variant] = Object.keys(c) as Array<keyof Command>
  const body = (c as Record<string, unknown>)[variant as string] as Record<string, unknown>

  try {
    switch (variant as string) {
      case 'Hire': {
        const id = String(body.candidate)
        const cand = org.candidates?.find((x) => x.id === id)
        const slug = cand?.persona ?? personas.find((p) => `candidate-${p.id}` === id && p.id >= CANDIDATE_MIN_ID)?.slug
        must(slug, `${id} is not in the hiring pool`)
        must(!org.staff.some((x) => x.persona === slug), 'Already employed')
        const persona = personas.find((p) => p.slug === slug)
        must(persona, `Persona ${slug} is missing from the catalog`)
        const next = Math.max(0, ...org.staff.map((x) => Number(x.id.split('-')[1]))) + 1
        const hired: StaffJson = {
          id: `staff-${next}`,
          persona: persona.slug,
          role: persona.role,
          department: persona.department,
          seniority: persona.seniority,
          salaryEurMonth: cand?.askingEurMonth ?? persona.salaryEurMonth,
          morale: 0.8,
          fatigue: 0,
          activity: 'onboarding',
          projects: [],
        }
        org.staff.push(hired)
        org.departments.find((d) => d.id === hired.department)?.members.push(hired.id)
        if (hired.role === 'cfo' && !org.executive.cfo) org.executive.cfo = hired.id
        if (hired.role === 'secretary' && !org.executive.secretary) org.executive.secretary = hired.id
        org.candidates = org.candidates?.filter((x) => x.id !== id)
        return ok()
      }
      case 'Fire': {
        const st = staff(String(body.staff))
        org.staff = org.staff.filter((x) => x !== st)
        for (const d of org.departments) {
          d.members = d.members.filter((m) => m !== st.id)
          if (d.head === st.id) d.head = null
        }
        for (const p of org.projects) {
          p.team = p.team.filter((m) => m.staff !== st.id)
          if (p.lead === st.id) p.lead = null
          recomputeMissing(org, p.id)
        }
        for (const it of s.plan.items) for (const ph of it.phases) if (ph.assignee === st.id) ph.assignee = null
        if (org.executive.cfo === st.id) {
          org.executive.cfo = null
          s.finance.booksKept = false
          s.finance.alerts = []
          s.finance.report = null
          for (const c of org.candidates ?? []) c.affordability = null
        }
        if (org.executive.secretary === st.id) {
          org.executive.secretary = null
          org.executive.delegation = 'off'
          s.inbox.delegation = 'off'
          s.inbox.secretaryQueue = []
        }
        if (st.role === 'data-scientist' && !org.staff.some((x) => x.role === 'data-scientist')) s.performance.report = null
        return ok()
      }
      case 'Promote': {
        const st = staff(String(body.staff))
        const i = SENIORITY.indexOf(st.seniority)
        must(i < SENIORITY.length - 1, `${name(st)} is already a star`)
        st.seniority = SENIORITY[i + 1]
        st.salaryEurMonth = Math.round(st.salaryEurMonth * 1.1)
        st.morale = Math.min(1, st.morale + 0.1)
        return ok()
      }
      case 'SetSalary': {
        const st = staff(String(body.staff))
        const cents = Number(body.cents_per_day)
        must(Number.isFinite(cents) && cents > 0, 'Salary must be positive')
        const eur = centsPerDayToEurMonth(cents)
        must(eur <= 20000, 'Salary above €20,000/month needs a board decision')
        st.morale = Math.max(0, Math.min(1, st.morale + (eur > st.salaryEurMonth ? 0.08 : eur < st.salaryEurMonth ? -0.15 : 0)))
        st.salaryEurMonth = eur
        return ok()
      }
      case 'AssignToProject': {
        const st = staff(String(body.staff))
        const p = project(String(body.project))
        const pct = Number(body.allocation_pct)
        must(Number.isInteger(pct) && pct >= 1 && pct <= MAX_ALLOCATION, 'Allocation must be 1–100%')
        must(p.status !== 'archived', `${p.name} is archived`)
        must(!['cfo', 'secretary'].includes(st.role), `${name(st)} works for the Executive Office, not on projects`)
        const total = allocationTotal(st, p.id) + pct
        must(total <= MAX_ALLOCATION, `${name(st)} would be at ${total}% (max ${MAX_ALLOCATION}%)`)
        const a = st.projects.find((x) => x.project === p.id)
        if (a) a.allocation = pct
        else st.projects.push({ project: p.id, allocation: pct })
        const m = p.team.find((x) => x.staff === st.id)
        if (m) m.allocation = pct
        else p.team.push({ staff: st.id, allocation: pct })
        recomputeMissing(org, p.id)
        return ok()
      }
      case 'RemoveFromProject': {
        const st = staff(String(body.staff))
        const p = project(String(body.project))
        must(p.team.some((m) => m.staff === st.id), `${name(st)} is not on ${p.name}`)
        p.team = p.team.filter((m) => m.staff !== st.id)
        st.projects = st.projects.filter((a) => a.project !== p.id)
        if (p.lead === st.id) p.lead = null
        recomputeMissing(org, p.id)
        return ok()
      }
      case 'SetProjectLead': {
        const p = project(String(body.project))
        const st = staff(String(body.staff))
        must(p.team.some((m) => m.staff === st.id), `${name(st)} must be on the ${p.name} team to lead it`)
        p.lead = st.id
        return ok()
      }
      case 'CreateProject': {
        const prop = body as { name: string; slug: string; domain: string }
        must(prop?.name?.trim(), 'A project needs a name')
        must(/^[a-z0-9][a-z0-9-]*$/.test(prop.slug ?? ''), 'Slug must be lowercase kebab-case')
        must(!org.projects.some((p) => p.slug === prop.slug), `Slug ${prop.slug} is taken`)
        const lock = projectLockReason(org)
        must(!lock, `Locked: ${lock}`)
        const id = `project-${Math.max(0, ...org.projects.map((p) => Number(p.id.split('-')[1]))) + 1}`
        const budget = 0
        org.projects.push({
          id,
          slug: prop.slug,
          name: prop.name.trim(),
          domain: prop.domain,
          status: 'active',
          lead: null,
          team: [],
          budgetEurMonth: budget,
          missingRoles: [],
          analytics: { connected: false, sessions7d: 0, visitors7d: 0, pageviews7d: 0, engagementRate: 0 },
        })
        recomputeMissing(org, id)
        s.finance.projects.push({ id, budgetEurMonth: budget, spentEurMonth: 0, revenueEurMonth: 0, overBudget: false })
        return ok()
      }
      case 'SetProjectStatus': {
        const p = project(String(body.project))
        const next = String(body.status).toLowerCase() as typeof p.status
        must(['proposed', 'active', 'paused', 'archived'].includes(next), `Unknown status ${body.status}`)
        if ((next === 'active' || next === 'paused') && !(p.status === 'active' || p.status === 'paused')) {
          const lock = projectLockReason(org)
          must(!lock, `Locked: ${lock}`)
        }
        p.status = next
        return ok()
      }
      case 'SetProjectBudget': {
        const p = project(String(body.project))
        const cents = Number(body.monthly_cents)
        must(Number.isFinite(cents) && cents >= 0, 'Budget cannot be negative')
        p.budgetEurMonth = Math.round(cents / 100)
        const f = s.finance.projects.find((x) => x.id === p.id)
        if (f) {
          f.budgetEurMonth = p.budgetEurMonth
          f.overBudget = f.spentEurMonth > f.budgetEurMonth
        }
        if (!f?.overBudget) s.finance.alerts = s.finance.alerts.filter((a) => !(a.kind === 'budget-overrun' && a.project === p.id))
        return ok()
      }
      case 'AnswerTicket': {
        const t = s.inbox.tickets.find((x) => x.id === body.ticket)
        must(t, `Unknown ticket ${body.ticket}`)
        must(t.status === 'open', 'Ticket already resolved')
        const option = String(body.option)
        must(t.options.includes(option), `"${option}" is not an option on this ticket`)
        t.status = 'resolved'
        t.resolvedBy = 'ceo'
        t.answer = option
        s.finance.alerts = s.finance.alerts.filter((a) => a.ticket !== t.id)
        const effects = s.plan.items
          .filter((i) => i.tickets.includes(t.id))
          .map((i) => ceoPost(i.id, `Answered ${t.id}: ${option.replace(/-/g, ' ')}.`))
        return ok(effects)
      }
      case 'Delegate': {
        must(org.executive.secretary, noSecretaryReason)
        const task = body.task as SecretaryTask
        const [kind, detail] = describeTask(task, s, personas)
        const next = Math.max(0, ...s.inbox.secretaryQueue.map((t) => Number(t.id.split('-')[1]) || 0)) + 1
        s.inbox.secretaryQueue.push({ id: `task-${next}`, kind, status: 'queued', detail })
        return ok()
      }
      case 'Praise': {
        const st = staff(String(body.staff))
        const key = `${st.id}:${day}`
        must(!s.praised.includes(key), `You already praised ${name(st)} today`)
        s.praised.push(key)
        st.morale = Math.min(1, st.morale + 0.05)
        return ok()
      }
      case 'SetDelegation': {
        const d = kebab(String((body as { policy?: string }).policy ?? ''))
        must(['off', 'low', 'low-and-medium'].includes(d), `Unknown delegation ${d}`)
        must(d === 'off' || org.executive.secretary, noSecretaryReason)
        const wire = d as 'off' | 'low' | 'low-and-medium'
        org.executive.delegation = wire
        s.inbox.delegation = wire
        return ok()
      }
      case 'UpdateWorkItem': {
        const it = item(String(body.item))
        const u = body.update as Record<string, string | number>
        const [field] = Object.keys(u ?? {})
        must(field, 'Nothing to update')
        const value = u[field]
        if (field === 'Priority') {
          const pr = String(value).toLowerCase() as WorkItemJson['priority']
          must(['urgent', 'high', 'normal', 'low'].includes(pr), `Unknown priority ${value}`)
          it.priority = pr
          return ok([ceoPost(it.id, `Priority set to ${pr}.`)])
        }
        if (field === 'Status') {
          const st = kebab(String(value)) as WorkItemJson['status']
          must(it.status !== 'published' && it.status !== 'cancelled', `Item is already ${it.status}`)
          if (st === 'approved') must(it.status === 'in-review' || it.status === 'blocked', 'Only items in review can be approved')
          const from = it.status
          it.status = st
          return ok([
            ceoPost(it.id, st === 'approved' ? 'Approved by the CEO.' : st === 'cancelled' ? 'Cancelled by the CEO.' : `Status set to ${st}.`),
            { kind: 'post', item: it.id, post: { type: 'status', author: 'system', day, minute: now % 1440, text: `Status: ${from} → ${st}`, from, toStatus: st } },
          ])
        }
        if (field === 'Owner') {
          const st = staff(String(value))
          must(st.projects.some((a) => a.project === it.project), `${name(st)} is not on the project team`)
          it.owner = st.id
          return ok()
        }
        if (field === 'DueDay') {
          must(Number(value) >= day, 'Due date is in the past')
          it.dueDay = Number(value)
          return ok()
        }
        throw new Reject(`Unknown work item field ${field}`)
      }
      case 'AssignPhase': {
        const it = item(String(body.item))
        const ph = it.phases[Number(body.phase)]
        must(ph, 'Unknown phase')
        must(ph.state !== 'done', `The ${ph.kind} phase is already done`)
        const st = staff(String(body.staff))
        const p = project(it.project)
        must(p.team.some((m) => m.staff === st.id), `${name(st)} is not on the ${p.name} team`)
        const allowed = rolesForPhase(ph.kind)
        must(
          allowed.includes(st.role),
          `A ${humanRole(st.role)} can't take the ${ph.kind} phase (needs ${allowed.map(humanRole).join(', ') || 'a specialist'})`,
        )
        const before = ph.assignee
        ph.assignee = st.id
        ph.agency = false
        if (ph.state === 'blocked' && !before) ph.state = 'pending'
        if (it.status === 'blocked' && it.phases.every((x) => x.state !== 'blocked')) it.status = 'planned'
        return ok([ceoPost(it.id, `Reassigned the ${ph.kind} phase to @${st.persona}.`)])
      }
      case 'AcceptProposal': {
        const it = item(String(body.item))
        const postId = String(body.post)
        // Proposals live in the plan text; the sim only needs to create the item.
        const post = text.posts[it.id]?.find((x) => x.id === postId)
        must(post?.type === 'proposal' && post.proposal, 'Not a proposal')
        must(!post.accepted, 'Proposal already accepted')
        const proposal = post.proposal
        const next = Math.max(0, ...s.plan.items.map((i) => Number(i.id.split('-').pop()))) + 1
        const id = `work-item-${next}`
        s.plan.items.push({
          id,
          project: it.project,
          workstream: proposal.workstream ?? it.workstream,
          goal: it.goal ?? null,
          kind: proposal.kind,
          status: 'backlog',
          priority: 'normal',
          owner: org.projects.find((p) => p.id === it.project)?.lead ?? null,
          phases: [],
          todos: [],
          dependsOn: [],
          dueDay: null,
          publishDay: null,
          tickets: [],
        })
        return ok([
          { kind: 'accept', item: it.id, post: postId },
          { kind: 'put', item: id, text: { title: proposal.title, brief: `Accepted from a proposal on ${it.id}.` } },
          ceoPost(it.id, `Accepted the proposal "${proposal.title}" (${id}).`),
        ])
      }
      case 'CompleteTodo': {
        const it = item(String(body.item))
        const td = it.todos.find((t) => t.id === body.todo)
        must(td, 'Unknown todo')
        must(!td.done, 'Already done')
        td.done = true
        return ok()
      }
      case 'SendToAgency': {
        const it = item(String(body.item))
        const ph = it.phases[Number(body.phase)]
        must(ph, 'Unknown phase')
        must(ph.state !== 'done', `The ${ph.kind} phase is already done`)
        must(!ph.agency, 'Already with the Agency')
        must(it.status !== 'cancelled' && it.status !== 'published', `Item is ${it.status}`)
        const fee = Math.round(ph.estimateMinutes * 1.5)
        must(s.finance.cashEur >= fee, 'Not enough cash for the Agency fee')
        ph.agency = true
        ph.assignee = null
        ph.state = 'working'
        if (it.status === 'blocked' && it.phases.every((x) => x.state !== 'blocked')) it.status = 'in-progress'
        s.finance.company.agencyEur += fee
        s.finance.cashEur = Math.round((s.finance.cashEur - fee) * 100) / 100
        return ok([ceoPost(it.id, `Sent the ${ph.kind} phase to the Agency (fee €${fee}).`)])
      }
      default:
        throw new Reject(`Unsupported command ${String(variant)}`)
    }
  } catch (e) {
    if (e instanceof Reject) return fail(e.message)
    throw e
  }
}

function describeTask(task: SecretaryTask, s: MockState, personas: Persona[]): [string, string] {
  const projectName = (id: string | null) => (id ? (s.org.projects.find((p) => p.id === id)?.name ?? id) : 'the company')
  const who = (id: string) => {
    const st = s.org.staff.find((x) => x.id === id)
    must(st, `Unknown staff ${id}`)
    return personas.find((p) => p.slug === st.persona)?.name ?? st.persona
  }
  if (task === 'TriageInbox') return ['triage-inbox', 'Triage the inbox']
  const [kind] = Object.keys(task)
  switch (kind) {
    case 'ScheduleMeeting': {
      const t = (task as Extract<SecretaryTask, { ScheduleMeeting: unknown }>).ScheduleMeeting
      must(t.attendees.length > 0, 'Pick at least one attendee')
      must(t.agenda?.trim(), 'A meeting needs an agenda')
      return ['schedule-meeting', `${t.agenda?.trim()} with ${t.attendees.map(who).join(', ')}`]
    }
    case 'PrepareBriefing': {
      const t = (task as Extract<SecretaryTask, { PrepareBriefing: unknown }>).PrepareBriefing
      return ['prepare-briefing', `Briefing for ${projectName(t.project)}`]
    }
    case 'DraftReply': {
      const t = (task as Extract<SecretaryTask, { DraftReply: unknown }>).DraftReply
      const tk = s.inbox.tickets.find((x) => x.id === t.ticket)
      must(tk && tk.status === 'open', 'Pick an open ticket')
      return ['draft-reply', `Draft a reply to ${tk.id} (${tk.kind.replace(/-/g, ' ')})`]
    }
    case 'ArrangeHiring': {
      const t = (task as Extract<SecretaryTask, { ArrangeHiring: unknown }>).ArrangeHiring
      must(t.role, 'Pick a role')
      return ['arrange-hiring', `Three ${kebab(t.role).replace(/-/g, ' ')} candidates for ${projectName(t.project)}`]
    }
    case 'FollowUp': {
      const t = (task as Extract<SecretaryTask, { FollowUp: unknown }>).FollowUp
      must(t.topic.trim(), 'A follow-up needs a topic')
      return ['follow-up', `Follow up with ${who(t.staff)}: ${t.topic.trim()}`]
    }
  }
  throw new Reject(`Unknown task ${kind}`)
}
