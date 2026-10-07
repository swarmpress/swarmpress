// @vitest-environment jsdom
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ALL_COMMANDS, cmd, NOT_AVAILABLE, SIM_COMMANDS, toJson, type Command } from './commands'
import { optionLabel } from './components/Inbox'
import { countdown, gameTime } from './format'
import clockLive from './fixtures/live/clock.json'
import financeLive from './fixtures/live/finance.json'
import inboxLive from './fixtures/live/inbox.json'
import orgLive from './fixtures/live/org.json'
import planLive from './fixtures/live/plan.json'
import { OrchestrationLoop, type LoopSim } from '../orchestration/loop'
import { fakePlanStore } from './live-testing'
import { mountOverlay } from './mount'
import { availableViews } from './plan-logic'
import { flush } from './testing'
import type { InboxJson } from './types'
import { companyStoreOptions, hasOrgApi, WasmDataSource, type SimOrgApi } from './wasm-source'

/**
 * The overlay over the real wasm sim (`Sim.demo`, the cinqueterre company),
 * read through `WasmDataSource`. Needs `cargo xtask wasm`; skipped without
 * crates/client-wasm/pkg.
 */
// vitest runs with apps/game as the working directory.
const PKG = resolve(process.cwd(), '../../crates/client-wasm/pkg') + '/'
const built = existsSync(`${PKG}client_wasm.js`)

type RealSim = SimOrgApi & {
  advance(n: number): void
  steps_per_day(): bigint
  step(): bigint
  hash(): bigint
  pending_effects(): number
  drain_effects_json(): string
  next_due_step(): bigint | undefined
  free(): void
}
type WasmModule = {
  initSync(m: { module: BufferSource }): unknown
  Sim: { demo(seed: bigint): RealSim; scenario(name: string, seed: bigint): RealSim }
}
let wasm: WasmModule

const LIVE_FIXTURES = resolve(process.cwd(), 'src/ui/fixtures/live')
const TITLE = 'Harvest week in Manarola'

interface JobEffect {
  job_id: number
  kind: string
}

/**
 * The company a session runs (`cinqueterre`, seed 42) on its first morning:
 * the 09:00 standup commissions one article, its draft job fails, and the
 * sim blocks the item and raises an Escalation about it. Every command is
 * one the orchestration loop sends (crates/client-wasm/README.md).
 */
function escalated() {
  const sim = wasm.Sim.scenario('cinqueterre', 42n)
  const effects = (): JobEffect[] => JSON.parse(sim.drain_effects_json()) as JobEffect[]
  const perDay = Number(sim.steps_per_day())
  for (let i = 0; i < perDay && sim.minute_of_day() < 9 * 60 + 1; i++) sim.advance(1)
  const standup = effects().find((e) => e.kind === 'standup')!
  const staff = (JSON.parse(sim.org_json()) as { staff: Array<{ id: string; role: string }> }).staff
  const writer = staff.find((s) => s.role === 'writer')!.id
  const editor = staff.find((s) => s.role === 'editor')!.id
  sim.apply_command_json(JSON.stringify({ MeetingOutcome: { job_id: standup.job_id, briefs: [{ brief_ref: 42, writer, editor }] } }))
  sim.advance(1)
  const draft = effects().find((e) => e.kind === 'draft')!
  sim.advance(Math.round((perDay / 1440) * 30))
  sim.apply_command_json(JSON.stringify({ JobCompleted: { job_id: draft.job_id, digest: { ok: false, score: 0, words: 0, qa_defects: 0, artifact_sha: null } } }))
  sim.advance(1)
  const inbox = JSON.parse(sim.inbox_json()) as InboxJson
  const ticket = inbox.tickets.find((t) => t.kind === 'escalation')!
  return { sim, ticket, item: ticket.workItem! }
}

/** Where `fixture` and `real` disagree in shape: a key the real view lacks, or a different JSON type (null matches anything). */
function shapeDiff(fixture: unknown, real: unknown, path: string): string[] {
  if (fixture === null || real === null) return []
  if (Array.isArray(fixture) || Array.isArray(real)) {
    if (!Array.isArray(fixture) || !Array.isArray(real)) return [`${path}: array vs ${typeof real}`]
    return fixture.length && real.length ? shapeDiff(fixture[0], real[0], `${path}[0]`) : []
  }
  if (typeof fixture !== typeof real) return [`${path}: ${typeof fixture} vs ${typeof real}`]
  if (typeof fixture !== 'object') return []
  return Object.entries(fixture as Record<string, unknown>).flatMap(([k, v]) =>
    k in (real as Record<string, unknown>) ? shapeDiff(v, (real as Record<string, unknown>)[k], `${path}.${k}`) : [`${path}.${k}: missing in the sim's view`],
  )
}

/** One sample of every command the overlay builds, by variant. */
const SAMPLES: Record<string, Command> = {
  Hire: cmd.hire('candidate-1'),
  Fire: cmd.fire('staff-1'),
  Promote: cmd.promote('staff-1'),
  SetSalary: cmd.setSalaryEurMonth('staff-1', 4000),
  AssignToProject: cmd.assign('staff-1', 'project-1', 50),
  RemoveFromProject: cmd.remove('staff-1', 'project-1'),
  SetProjectLead: cmd.setLead('project-1', 'staff-1'),
  CreateProject: cmd.createProject({ name: 'Amalfi Dispatch', slug: 'amalfi-dispatch', domain: 'amalfi.travel' }),
  SetProjectStatus: cmd.setStatus('project-1', 'paused'),
  SetProjectBudget: cmd.setBudgetEurMonth('project-1', 40000),
  AnswerTicket: cmd.answer('ticket-1', 'retry'),
  Delegate: cmd.delegate('TriageInbox'),
  Praise: cmd.praise('staff-1'),
  SetDelegation: cmd.setDelegation('low'),
  UpdateWorkItem: cmd.setPriority('work-item-1', 'urgent'),
  RunTool: { RunTool: { tool_ref: 1 } },
  AssignPhase: cmd.assignPhase('work-item-1', 0, 'staff-1'),
  AcceptProposal: cmd.acceptProposal('work-item-1', 'post-1'),
  CompleteTodo: cmd.completeTodo('work-item-1', 'todo-1'),
  SendToAgency: cmd.sendToAgency('work-item-1', 0),
}

describe.skipIf(!built)('WasmDataSource over the real sim', () => {
  beforeAll(async () => {
    wasm = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}client_wasm.js`).href)) as WasmModule
    wasm.initSync({ module: readFileSync(`${PKG}client_wasm_bg.wasm`) })
  })
  let dispose: (() => void) | null = null
  afterEach(() => {
    dispose?.()
    dispose = null
    vi.useRealTimers()
  })
  const demo = () => {
    const sim = wasm.Sim.demo(42n)
    sim.advance(Number(sim.steps_per_day()) / 2)
    return sim
  }
  const mount = (source: WasmDataSource) => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const h = mountOverlay(el, source)
    dispose = () => {
      h.dispose()
      el.remove()
    }
    return h
  }
  const region = (name: RegExp) => screen.getByRole('region', { name })

  it('exposes the organization API and every staff persona is in the catalog', async () => {
    const sim = demo()
    expect(hasOrgApi(sim)).toBe(true)
    const s = new WasmDataSource(sim)
    const org = await s.getOrg()
    expect(org.executive).toMatchObject({ cfo: expect.any(String), secretary: expect.any(String) })
    expect(org.staff.length).toBeGreaterThanOrEqual(12)
    for (const st of org.staff) expect(await s.getPersona(st.persona), st.persona).toBeDefined()
    const f = await s.getFinance()
    expect(typeof f.cashEur).toBe('number')
    expect(Array.isArray((await s.getInbox()).tickets)).toBe(true)
    expect(Array.isArray((await s.getPlan()).items)).toBe(true)
  })

  it('applies and rejects commands with the sim reasons', async () => {
    const s = new WasmDataSource(demo())
    expect(await s.validate(toJson(cmd.praise('staff-1')))).toEqual({ ok: true })
    expect(await s.apply(toJson(cmd.praise('staff-1')))).toEqual({ ok: true })
    const over = await s.validate(toJson(cmd.assign('staff-1', 'project-1', 150)))
    expect(over.ok).toBe(false)
    expect(over.reason).toBeTruthy()
    expect(await s.validate(toJson(cmd.setDelegation('low-and-medium')))).toEqual({ ok: true })
    expect(await s.validate(toJson(cmd.createProject({ name: 'Amalfi Dispatch', slug: 'amalfi-dispatch', domain: 'amalfi.travel' })))).toBeDefined()
    // Plan commands are not in the sim yet: the sim itself rejects them (the store never sends one, see below).
    const plan = await s.validate(toJson(cmd.assignPhase('work-item-1', 0, 'staff-1')))
    expect(plan).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown variant `AssignPhase`/) })
  })

  it('SIM_COMMANDS is exactly the set of overlay commands the sim has', () => {
    const sim = demo()
    expect(Object.keys(SAMPLES).sort()).toEqual([...ALL_COMMANDS].sort())
    const known = ALL_COMMANDS.filter((name) => !/unknown variant/.test(String(sim.validate_command_json!(toJson(SAMPLES[name])) ?? '')))
    expect(known).toEqual([...SIM_COMMANDS])
    const caps = new WasmDataSource(sim).capabilities()
    expect([...caps.commands]).toEqual([...SIM_COMMANDS])
    expect(caps).toMatchObject({ performance: false, site: { repo: null, publicBaseUrl: null } })
  })

  it('renders the org chart, finance and inbox from the sim', async () => {
    const h = mount(new WasmDataSource(demo()))
    await h.store.refresh()
    for (const id of ['org', 'finance', 'inbox', 'projects', 'plan'] as const) {
      h.store.panel.value = id
      await flush()
      expect(document.getElementById(`panel-${id}`), id).toBeTruthy()
      expect(document.body.textContent).not.toContain('Loading…')
    }
    h.store.panel.value = 'org'
    await flush()
    const giulia = h.store.persona('giulia')!.name
    expect(within(region(/Org chart/)).getByRole('button', { name: new RegExp(giulia) })).toBeTruthy()
  })

  // ---------------------------------------------------------------- increment U2: truthful on live data

  it('the live fixtures of the jsdom suites have the shapes the sim exports', () => {
    const { sim } = escalated()
    const real = {
      clock: { day: sim.day(), minute: sim.minute_of_day(), step: Number(sim.step()) },
      org: JSON.parse(sim.org_json()) as unknown,
      finance: JSON.parse(sim.finance_json()) as unknown,
      inbox: JSON.parse(sim.inbox_json()) as unknown,
      plan: JSON.parse(sim.plan_json!()) as unknown,
    }
    // `UPDATE_LIVE_FIXTURES=1 vitest run src/ui/wasm-live.test.tsx` captures them again from the sim.
    if (process.env.UPDATE_LIVE_FIXTURES) {
      mkdirSync(LIVE_FIXTURES, { recursive: true })
      for (const [name, view] of Object.entries(real)) writeFileSync(`${LIVE_FIXTURES}/${name}.json`, `${JSON.stringify(view, null, 2)}\n`)
      return
    }
    const fixtures = { clock: clockLive, org: orgLive, finance: financeLive, inbox: inboxLive, plan: planLive }
    for (const [name, fixture] of Object.entries(fixtures)) expect(shapeDiff(fixture, real[name as keyof typeof real], name), name).toEqual([])
    // What the jsdom suites rely on: an open escalation about a work item of the plan.
    const ticket = (inboxLive as unknown as InboxJson).tickets.find((t) => t.kind === 'escalation')!
    expect(ticket).toMatchObject({ status: 'open', workItem: (planLive as { items: Array<{ id: string }> }).items[0].id })
  })

  it('an Escalation raised by the sim names its article and says when which default applies', async () => {
    const { sim, ticket, item } = escalated()
    expect(ticket).toMatchObject({ kind: 'escalation', status: 'open', workItem: expect.stringMatching(/^work-item-\d+$/) })
    const source = new WasmDataSource(sim, { planText: async () => ({ items: { [item]: { title: TITLE, brief: 'Angle: the grape harvest.' } } }) })
    const h = mount(source)
    await h.store.refresh()
    h.store.panel.value = 'inbox'
    await flush()
    const article = within(region(/Inbox/)).getByRole('article', { name: 'Escalation' })
    expect(within(article).getByRole('button', { name: TITLE })).toBeTruthy()
    expect(article.textContent).not.toMatch(/untriaged|no summary|no secretary/i)
    const now = await source.now()
    expect(article.querySelector('.ticket-deadline')!.textContent).toBe(
      `Due ${gameTime(ticket.deadlineMinute!)} · ${countdown(ticket.deadlineMinute! - now)} · if unanswered: ${optionLabel(ticket.defaultOption!)}`,
    )
    // One button per option of the ticket, labelled from the option id (plus the Secretary's proposal and the default marker).
    expect(within(article).getAllByRole('button').map((b) => b.textContent!.replace(/ \((proposed|default at deadline)\)/g, ''))).toEqual([TITLE, ...ticket.options.map(optionLabel)])

    // Answering it with one of its own options is accepted by the sim.
    const other = ticket.options.find((o) => o !== ticket.defaultOption)!
    fireEvent.click(within(article).getByRole('button', { name: optionLabel(other) }))
    await flush()
    expect((await source.getInbox()).tickets.find((t) => t.id === ticket.id)).toMatchObject({ status: 'answered', answer: other, resolvedBy: 'ceo' })
  })

  it('the dead actions of a real work item are disabled, the sim gates the rest, and nothing changes', async () => {
    const { sim, item } = escalated()
    const sent: string[] = []
    const watched: SimOrgApi = {
      org_json: () => sim.org_json(),
      finance_json: () => sim.finance_json(),
      inbox_json: () => sim.inbox_json(),
      plan_json: () => sim.plan_json!(),
      day: () => sim.day(),
      minute_of_day: () => sim.minute_of_day(),
      step: () => sim.step(),
      apply_command_json: (json) => (sent.push(json), sim.apply_command_json(json)),
      validate_command_json: (json) => (sent.push(json), sim.validate_command_json!(json)),
    }
    const h = mount(new WasmDataSource(watched, { planText: async () => ({ items: { [item]: { title: TITLE, brief: '' } } }) }))
    await h.store.refresh()
    h.store.panel.value = 'plan'
    h.store.selectedItem.value = item
    await flush()
    const hash = sim.hash()
    const p = within(region(/Media & publishing plan/))
    // Approving is the publish gate's, never a status change: the sim says so.
    const approve = p.getByRole('button', { name: 'Approve' }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(approve.title).toMatch(/only cancelling is the CEO's/)
    const dead = [
      ...p.getAllByRole('button', { name: 'Reassign' }),
      ...p.getAllByRole('button', { name: 'Send to Agency' }),
    ] as HTMLButtonElement[]
    expect(dead.length).toBeGreaterThanOrEqual(2)
    for (const b of dead) {
      expect(b.disabled, b.textContent!).toBe(true)
      expect(b.title, b.textContent!).toBe(NOT_AVAILABLE)
      fireEvent.click(b)
    }
    await flush()
    // the escalated item has an open ticket: the sim refuses to cancel it, and nothing is applied
    expect((await h.store.run(cmd.setItemStatus(item, 'cancelled'))).ok).toBe(false)
    expect(sent.every((json) => json.includes('UpdateWorkItem'))).toBe(true)
    expect(sim.hash()).toBe(hash)
  })

  it('live navigation and finance: no Performance panel, no empty plan views, the revenue note, no empty report', async () => {
    const { sim } = escalated()
    const h = mount(new WasmDataSource(sim))
    await h.store.refresh()
    await flush()
    const tools = within(screen.getByRole('navigation', { name: 'CEO tools' })).getAllByRole('button').map((b) => b.querySelector('.tool-label')!.textContent)
    expect(tools).toEqual(['Plan', 'Inbox', 'Org chart', 'Projects', 'Finance', 'Hiring'])

    // No schedule before the first editorial board; the sim's goal per project from the start (ADR-0069).
    expect(availableViews(h.store.plan.value)).toEqual(['board', 'goals'])
    h.store.panel.value = 'plan'
    await flush()
    const tabs = within(within(region(/Media & publishing plan/)).getByRole('tablist')).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Board', 'Goals'])
    expect(within(region(/Media & publishing plan/)).getAllByRole('article')).toHaveLength(1)
    expect(h.store.planText.value.goals['goal-project-1']?.title).toBe('Monthly readers')

    h.store.panel.value = 'finance'
    await flush()
    expect(h.store.finance.value.revenueStubbed).toBe(true)
    expect(within(region(/Finance/)).getByRole('note').textContent).toMatch(/^Revenue is not modelled yet/)
    expect(region(/Finance/).querySelector('blockquote')).toBeNull()
    expect(within(region(/Finance/)).queryByRole('heading', { name: 'CFO report' })).toBeNull()
  })

  it('a session source sees what its loop applies while the clock is held, and keeps its commands in the log', async () => {
    // The pieces session.ts wires together: the sim, the orchestration loop
    // (here with a scripted orchestrator) and the data source built from
    // `companyStoreOptions` plus the step-and-log change key.
    const sim = wasm.Sim.scenario('cinqueterre', 42n)
    const staff = (JSON.parse(sim.org_json()) as { staff: Array<{ id: string; role: string }> }).staff
    const brief = { brief_ref: 42, writer: staff.find((s) => s.role === 'writer')!.id, editor: staff.find((s) => s.role === 'editor')!.id }
    const kv = new Map<string, string>()
    const logged: Array<{ seq?: number; kind: string }> = []
    const store = {
      ...fakePlanStore(),
      appendCommands: async (cmds: Array<{ seq?: number; kind: string }>) => (logged.push(...cmds), cmds.map((c) => c.seq ?? 0)),
      getKv: async (k: string) => kv.get(k) ?? null,
      setKv: async (k: string, v: string) => void kv.set(k, v),
      deleteKv: async (k: string) => void kv.delete(k),
    }
    const loop = new OrchestrationLoop({
      sim: sim as unknown as LoopSim,
      store,
      companyId: 'c1',
      orchestrator: {
        // The standup commissions one article; its draft job fails.
        run: async (jobJson) => {
          const job = JSON.parse(jobJson) as JobEffect
          return JSON.stringify(
            job.kind === 'standup'
              ? [{ MeetingOutcome: { job_id: job.job_id, briefs: [brief] } }]
              : [{ JobCompleted: { job_id: job.job_id, digest: { ok: false, score: 0, words: 0, qa_defects: 0, artifact_sha: null } } }],
          )
        },
      },
      codec: {
        jobsFromEffects: (effects) => (JSON.parse(effects) as unknown[]).map((j) => JSON.stringify(j)),
        outcomesForSim: (outcomes) => (JSON.parse(outcomes) as unknown[]).map((o) => JSON.stringify(o)),
      },
      retries: 0,
      retryMs: 0,
    })
    const orgApi: SimOrgApi = {
      org_json: () => sim.org_json(),
      finance_json: () => sim.finance_json(),
      inbox_json: () => sim.inbox_json(),
      plan_json: () => sim.plan_json!(),
      day: () => sim.day(),
      minute_of_day: () => sim.minute_of_day(),
      validate_command_json: (json) => sim.validate_command_json!(json),
      apply_command_json: (json) => {
        const r = loop.apply(json)
        if (!r.ok) throw new Error(r.reason)
      },
    }
    const session = new WasmDataSource(orgApi, {
      pollMs: 20,
      ...companyStoreOptions(store, { id: 'c1', site_repo: 'swarmpress/cinqueterre.travel' }),
      changeKey: () => `${sim.step()}:${loop.lastSeq}`,
    })
    // The default key (the step alone) is right for the offline sandbox, where nothing but the source applies commands.
    const stepOnly = new WasmDataSource({ ...orgApi, step: () => sim.step() }, { pollMs: 20 })
    const tick = () => new Promise((r) => setTimeout(r, 80))

    // Run to the 09:00 standup; the loop takes its job and the outcome waits for a boundary.
    const perDay = Number(sim.steps_per_day())
    for (let i = 0; i < perDay && sim.minute_of_day() < 9 * 60 + 1; i++) {
      loop.boundary()
      sim.advance(1)
      loop.afterAdvance()
    }
    await loop.settled()
    expect(loop.pendingCommands).toBe(1)
    const seen: Array<string[] | undefined> = []
    const off = [session.subscribe((t) => seen.push(t)), stepOnly.subscribe(() => undefined)]
    expect((await session.getPlan()).items).toEqual([])
    expect((await stepOnly.getPlan()).items).toEqual([])

    // The clock is held (a model is at work): boundaries pass, the step does not move.
    const held = sim.step()
    loop.boundary() // MeetingOutcome: the work item exists, its draft job is requested
    await loop.settled()
    loop.boundary() // JobCompleted{ok: false}: blocked, with an escalation
    await loop.idle()
    expect(loop.errors).toEqual([])
    expect(sim.step()).toBe(held)
    await tick()
    expect((await session.getPlan()).items.map((i) => i.status)).toEqual(['blocked'])
    expect((await session.getInbox()).tickets.map((t) => [t.kind, t.status])).toEqual([['escalation', 'open']])
    expect(seen.flat()).toEqual(expect.arrayContaining(['plan', 'inbox']))
    expect((await stepOnly.getPlan()).items).toEqual([])

    // A CEO command goes through the loop: applied, logged, and seen at the same step.
    const ticket = (await session.getInbox()).tickets[0]
    expect(await session.apply(toJson(cmd.answer(ticket.id, 'retry')))).toEqual({ ok: true })
    await loop.flush()
    expect((await session.getInbox()).tickets[0]).toMatchObject({ status: 'answered', answer: 'retry' })
    expect(logged.map((c) => c.kind)).toEqual(['MeetingOutcome', 'JobCompleted', 'AnswerTicket'])
    expect(loop.lastSeq).toBe(3)
    expect(sim.step()).toBe(held)
    off.forEach((f) => f())
  })

  it('does not re-serialise the views while the sim stands still', async () => {
    vi.useFakeTimers()
    const sim = demo()
    let reads = 0
    const counted: SimOrgApi = {
      org_json: () => (reads++, sim.org_json()),
      finance_json: () => (reads++, sim.finance_json()),
      inbox_json: () => (reads++, sim.inbox_json()),
      plan_json: () => (reads++, sim.plan_json!()),
      day: () => sim.day(),
      minute_of_day: () => sim.minute_of_day(),
      step: () => sim.step(),
      apply_command_json: (json) => sim.apply_command_json(json),
    }
    const s = new WasmDataSource(counted, { pollMs: 1000 })
    const seen: Array<string[] | undefined> = []
    const off = s.subscribe((t) => seen.push(t))
    await s.getOrg()
    expect(reads).toBe(4)
    vi.advanceTimersByTime(5000)
    expect(reads).toBe(4)
    expect(seen).toEqual(Array.from({ length: 5 }, () => ['clock']))
    sim.advance(Number(sim.steps_per_day()) / 24)
    vi.advanceTimersByTime(1000)
    expect(reads).toBe(8)
    // A command at the same step is seen at once.
    expect(await s.apply(toJson(cmd.praise('staff-1')))).toEqual({ ok: true })
    expect(reads).toBe(12)
    off()
  })

  /**
   * The publish gate (ADR-0059, FEAT-079): an article that passed its review
   * shows in the Inbox as a `publish-approval` ticket; nothing is published
   * until the CEO clicks Publish there.
   */
  it('shows the publish approval in the Inbox and publishes only on the CEO’s click', async () => {
    const sim = wasm.Sim.demo(42n)
    const drain = () => JSON.parse(sim.drain_effects_json()) as { job_id: number; kind: string; work_item: string | null }[]
    const done = (job_id: number, score: number) =>
      JSON.stringify({ JobCompleted: { job_id, digest: { ok: true, score, words: 900, qa_defects: 0, artifact_sha: null } } })
    expect(sim.next_due_step()).toBeUndefined()
    sim.advance(1000) // 09:00: the standup
    const [standup] = drain()
    // The view the clock hold reads (ADR-0060): a standup is due 30 game minutes (250 steps) after its request.
    expect(sim.next_due_step()).toBe(1250n)
    expect((JSON.parse(sim.plan_json!()) as { jobs: { kind: string; dueStep: number }[] }).jobs).toMatchObject([{ kind: 'standup', dueStep: 1250 }])
    sim.apply_command_json(JSON.stringify({ MeetingOutcome: { job_id: standup.job_id, briefs: [{ brief_ref: 7, writer: 'staff-1', editor: 'staff-5' }] } }))
    const [draft] = drain()
    sim.apply_command_json(done(draft.job_id, 0))
    sim.advance(1000)
    const [review] = drain()
    sim.apply_command_json(done(review.job_id, 8))
    sim.advance(600)
    expect(drain(), 'no job at the gate').toEqual([])
    expect(sim.next_due_step()).toBeUndefined()

    const el = document.createElement('div')
    document.body.appendChild(el)
    const h = mountOverlay(el, new WasmDataSource(sim))
    dispose = () => {
      h.dispose()
      el.remove()
    }
    await h.store.refresh()
    h.store.panel.value = 'inbox'
    await flush()
    const inbox = within(screen.getByRole('region', { name: /Inbox/ }))
    const ticket = within(inbox.getByRole('heading', { name: 'Publish approval' }).closest('article')!)
    expect(ticket.getByText(/passed its review and waits for your approval/)).toBeTruthy()
    expect(ticket.getByText(/work-item-1/)).toBeTruthy()
    const options = within(ticket.getByRole('group', { name: 'Answer Publish approval' }))
    expect(options.getAllByRole('button').map((b) => b.textContent?.replace(/\s*\(.*$/, '').trim())).toEqual(['Publish', 'Send back', 'Kill', 'Defer'])
    expect(options.getByRole('button', { name: /^Defer/ }).textContent).toContain('default at deadline')

    options.getByRole('button', { name: /^Publish/ }).click()
    await flush()
    await h.store.refresh()
    await flush()
    // The click is the `AnswerTicket{Publish}` command: now the sim asks for the Publish job.
    expect(drain().map((e) => [e.kind, e.work_item])).toEqual([['publish', 'work-item-1']])
    expect(within(screen.getByRole('region', { name: /Inbox/ })).queryByRole('group', { name: 'Answer Publish approval' })).toBeNull()
    const approval = (await h.store.source.getInbox()).tickets.find((t) => t.kind === 'publish-approval')
    expect(approval).toMatchObject({ status: 'answered', answer: 'publish', resolvedBy: 'ceo', workItem: 'work-item-1' })
  })

  it('shows a failed standup with its reason and its Retry and Skip options', async () => {
    // Half a day in, nobody answered the 09:00 standup: the sim raised the ticket itself.
    const h = mountOverlay(document.body.appendChild(document.createElement('div')), new WasmDataSource(demo()))
    dispose = () => h.dispose()
    await h.store.refresh()
    h.store.panel.value = 'inbox'
    await flush()
    const inbox = within(screen.getByRole('region', { name: /Inbox/ }))
    const ticket = within(inbox.getByRole('heading', { name: 'Standup failed' }).closest('article')!)
    expect(ticket.getByText(/failed: timeout/)).toBeTruthy()
    expect(ticket.getByText(/The standup produced no briefs/)).toBeTruthy()
    const options = within(ticket.getByRole('group', { name: 'Answer Standup failed' }))
    expect(options.getAllByRole('button').map((b) => b.textContent?.replace(/\s*\(.*$/, '').trim())).toEqual(['Retry', 'Skip'])
  })
})
