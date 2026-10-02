/**
 * Helpers for the overlay's live-data suites (jsdom). Not used at runtime.
 *
 * `liveSim()` is a stand-in for the wasm `Sim` that serves the JSON views
 * captured from the real sim (fixtures/live: the `cinqueterre` company,
 * seed 42, one commissioned article whose draft job failed). The capture and
 * the check that it still has the real sim's shapes are in
 * wasm-live.test.tsx.
 */
import { SIM_COMMANDS } from './commands'
import clock from './fixtures/live/clock.json'
import financeLive from './fixtures/live/finance.json'
import inboxLive from './fixtures/live/inbox.json'
import orgLive from './fixtures/live/org.json'
import planLive from './fixtures/live/plan.json'
import { mountOverlay } from './mount'
import type { PlanJson } from './plan-types'
import type { PlanTextWire } from './plan-wire'
import type { FinanceJson, InboxJson, OrgJson, TicketJson } from './types'
import { WasmDataSource, type PlanTextStore, type SimOrgApi, type WasmOptions } from './wasm-source'

export interface LiveState {
  org: OrgJson
  finance: FinanceJson
  inbox: InboxJson
  plan: PlanJson
}

export interface LiveSim extends SimOrgApi {
  /** The views it serves; change them and call `advance()` like a sim step would. */
  state: LiveState
  /** Every command JSON handed to `apply_command_json` / `validate_command_json`. */
  applied: string[]
  validated: string[]
  /** How often each view was serialised. */
  reads: { org: number; finance: number; inbox: number; plan: number }
  advance(steps?: number): void
  step(): bigint
}

/** The work item and the ticket of the captured escalation. */
export const LIVE_ITEM = (planLive as unknown as PlanJson).items[0].id
export const LIVE_TICKET = (inboxLive as unknown as InboxJson).tickets.find((t) => t.kind === 'escalation')!.id

/** The sim's rejection of a command it has no variant for (serde's message). */
const unknownVariant = (name: string) => `unknown variant \`${name}\`, expected one of ${SIM_COMMANDS.map((c) => `\`${c}\``).join(', ')}`

export function liveSim(): LiveSim {
  const state: LiveState = structuredClone({
    org: orgLive as unknown as OrgJson,
    finance: financeLive as unknown as FinanceJson,
    inbox: inboxLive as unknown as InboxJson,
    plan: planLive as unknown as PlanJson,
  })
  let step = BigInt(clock.step)
  const judge = (json: string, apply: boolean): string | undefined => {
    const c = JSON.parse(json) as Record<string, Record<string, unknown>>
    const [name] = Object.keys(c)
    if (!(SIM_COMMANDS as readonly string[]).includes(name)) return unknownVariant(name)
    if (name !== 'AnswerTicket') return undefined
    const t = state.inbox.tickets.find((x) => x.id === c.AnswerTicket.ticket)
    if (!t) return 'unknown ticket'
    if (t.status !== 'open') return 'ticket is not open'
    if (!t.options.includes(String(c.AnswerTicket.option))) return 'not an option of this ticket'
    if (apply) Object.assign(t, { status: 'answered', resolvedBy: 'ceo', answer: c.AnswerTicket.option })
    return undefined
  }
  const sim: LiveSim = {
    state,
    applied: [],
    validated: [],
    reads: { org: 0, finance: 0, inbox: 0, plan: 0 },
    org_json: () => (sim.reads.org++, JSON.stringify(state.org)),
    finance_json: () => (sim.reads.finance++, JSON.stringify(state.finance)),
    inbox_json: () => (sim.reads.inbox++, JSON.stringify(state.inbox)),
    plan_json: () => (sim.reads.plan++, JSON.stringify(state.plan)),
    apply_command_json(json: string) {
      sim.applied.push(json)
      const reason = judge(json, true)
      if (reason) throw reason
    },
    validate_command_json(json: string) {
      sim.validated.push(json)
      return judge(json, false)
    },
    day: () => clock.day,
    minute_of_day: () => clock.minute,
    step: () => step,
    advance: (steps = 1) => void (step += BigInt(steps)),
  }
  return sim
}

/** A ticket in the sim's `inbox_json` shape (crates/client-wasm/src/json.rs `inbox`), for kinds the captured sim does not raise. */
export function liveTicket(over: Partial<TicketJson> & Pick<TicketJson, 'id' | 'kind' | 'options'>): TicketJson {
  const template = (inboxLive as unknown as InboxJson).tickets.find((t) => t.id === LIVE_TICKET)!
  return { ...structuredClone(template), workItem: null, amountEur: 0, role: null, defaultOption: over.options[0], proposedOption: null, ...over }
}

/** The plan text of a session's CompanyStore: `planJson` and the post API, with the store's post-type check. */
export function fakePlanStore(initial: PlanTextWire = {}): PlanTextStore & { rows: Array<{ company: string; item: string; post: Record<string, unknown> }> } {
  const ORCHESTRATOR_TYPES = ['minutes', 'artifact', 'handoff', 'review', 'status']
  const rows: Array<{ company: string; item: string; post: Record<string, unknown> }> = []
  let seq = 0
  for (const [item, posts] of Object.entries(initial.posts ?? {})) for (const post of posts) rows.push({ company: 'c1', item, post: { ...post, id: `post-${++seq}` } })
  return {
    rows,
    async appendPost(company, item, postJson) {
      const post = JSON.parse(postJson) as Record<string, unknown>
      if (!ORCHESTRATOR_TYPES.includes(String(post.type))) throw new Error(`unknown post type ${JSON.stringify(post.type)}`)
      const id = `post-${++seq}`
      rows.push({ company, item, post: { ...post, id, item } })
      return id
    },
    async planJson(company) {
      const posts: Record<string, unknown[]> = {}
      for (const r of rows) if (r.company === company) (posts[r.item] ??= []).push(r.post)
      return JSON.stringify({ items: initial.items ?? {}, todos: {}, workstreams: {}, goals: {}, posts })
    },
  }
}

/** Mount the overlay over a live source; the returned `cleanup` unmounts it. */
export function setupLive(sim: SimOrgApi, opts: WasmOptions = {}) {
  const source = new WasmDataSource(sim, opts)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const handle = mountOverlay(el, source)
  return {
    source,
    store: handle.store,
    el,
    cleanup() {
      handle.dispose()
      el.remove()
    },
  }
}
