/**
 * The week-long soak (docs/mvp.md track W, docs/design/mvp-pipeline.md §7,
 * FEAT-085): one company on the real wasm sim and the real orchestrator
 * (orchestrator-wasm), wired as session.ts wires them (the loop, the clock
 * driver, the activity recorder, the bridge, the approver, the company store
 * on sqlite-wasm), with fakes only at the edges:
 *
 *   - the model: the brief-driven fake (`?llm=fake`'s `fakeMvpLlm`) behind a
 *     seeded fault injector: 2–40 s per call, a share of invalid answers and
 *     of calls that hang until the stage limit, and one model loss;
 *   - the central server: a gateway that opens one PR per item and merges
 *     once (idempotent, as the server), with a share of failed calls, and a
 *     deploy event per merge after a delay (one deploy fails);
 *   - the CEO: answers the inbox by policy, and stays away for one day;
 *   - the page: reloaded once while a draft runs (the old page's model and
 *     gateway calls never answer again; the new one restores from the store).
 *
 * Wall time is whatever `advance` says (vitest fake timers): a game week
 * takes seconds, and every wait, limit and retry in the code under test runs
 * on its real timers. Reported per day: items and outcomes, the in-memory
 * collections, store rows per table and the JS heap.
 */
import { replay, restoreSim, type LoggedCommand, type RestorableSim, type SimFactory } from '../catchup/replay'
import type { CentralEvent, OrchestratorGateway } from '../net/central'
import { ActivityRecorder } from '../orchestration/activity'
import { withApprover } from '../orchestration/approver'
import { OrchestrationLoop, type LoopSim, type LoopSizes } from '../orchestration/loop'
import { minutesPerArticle, standupContext } from '../orchestration/speech'
import { sweepStages } from '../orchestration/sweeper'
import { createOrchestrator, fakeMvpLlm, jobsFromEffects, localLlmBridge, outcomesForSim, type SiteBindingJson } from '../orchestrator'
import { recordingGateway, type GatewayCall } from '../session/recording-gateway'
import { ClockDriver, sessionClockHost } from '../session/clock-driver'
import type { CompanyStore } from '../store'
import { runStructured } from '../llm/structured'
import { LlmCancelledError, LlmUnavailableError, type ChatMessage, type GenerateOptions, type GenerateResult, type JsonSchema, type LocalLlm, type ResearchResult, type StructuredOptions } from '../llm/types'
import { urlsIn } from '../llm/research'
import { decodeSnapshot, encodeSnapshot } from '../sync/segments'
import { toLogged } from '../sync/uploader'

// ------------------------------------------------------------------ seeded randomness

/** mulberry32: a small seeded PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ------------------------------------------------------------------ the sim

/** client-wasm's `Sim`, as far as the soak uses it. */
export interface SoakSim extends LoopSim, RestorableSim {
  inbox_json(): string
  finance_json(): string
  snapshot(): Uint8Array
  next_due_step(): bigint | number | null | undefined
  free(): void
}

export interface SoakWasm {
  Sim: { scenario(name: string, seed: bigint): SoakSim; from_snapshot(bytes: Uint8Array): SoakSim }
}

// ------------------------------------------------------------------ the model

export interface ModelFaults {
  /** Wall time of one model call, ms: uniform in [min, max]. */
  latencyMs: [number, number]
  /** Share of calls answered with text that is not what was asked for. */
  invalid: number
  /** Share of calls that never answer (until the stage limit aborts them). */
  hang: number
}

/**
 * The fake model of `?llm=fake` behind a fault injector: each call waits its
 * latency (aborted by the signal), then hangs, answers nonsense, or answers.
 * While `lost()` every call fails as a lost GPU device does. A `dead` model
 * (the page was reloaded) never answers again.
 */
export class SoakLlm implements LocalLlm {
  readonly inner = fakeMvpLlm()
  dead = false
  calls = 0
  /** The next calls that hang whatever the dice say (a job that times out). */
  hangNext = 0

  constructor(
    private f: ModelFaults,
    private random: () => number,
    private lost: () => boolean,
    /** Counts of injected faults (shared across page loads). */
    readonly faults = { invalid: 0, hang: 0, unavailable: 0 },
  ) {}

  get modelId(): string | null {
    return this.inner.modelId
  }

  async load(): Promise<void> {}

  async generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    this.calls++
    if (this.lost()) {
      this.faults.unavailable++
      throw new LlmUnavailableError('the GPU device was lost')
    }
    const [lo, hi] = this.f.latencyMs
    const latency = lo + this.random() * (hi - lo)
    const roll = this.random()
    const forced = this.hangNext > 0
    if (forced) this.hangNext--
    await this.wait(latency, opts.signal, forced || roll < this.f.hang)
    if (this.lost()) {
      this.faults.unavailable++
      throw new LlmUnavailableError('the GPU device was lost')
    }
    if (roll < this.f.hang + this.f.invalid) {
      this.faults.invalid++
      const text = 'Sorry, I lost my train of thought there.'
      return { text, finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 8, durationMs: latency, tokensPerSec: 1 } }
    }
    return this.inner.generate(messages, opts)
  }

  /** Waits `ms`, or forever with `hang`; an abort rejects. A dead model never resolves. */
  private wait(ms: number, signal: AbortSignal | undefined, hang: boolean): Promise<void> {
    if (hang) this.faults.hang++
    return new Promise<void>((resolve, reject) => {
      const t = hang ? null : setTimeout(() => (this.dead ? undefined : resolve()), ms)
      signal?.addEventListener('abort', () => {
        if (t) clearTimeout(t)
        if (!this.dead) reject(new LlmCancelledError())
      })
    })
  }

  stream(): AsyncIterable<string> {
    throw new Error('not used')
  }

  async structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    return (await runStructured<T>((m, o) => this.generate(m, o), messages, schema, opts)).value
  }

  /** Research under the same faults (ADR-0068): its sources are the URLs its answer names. */
  async research<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<ResearchResult<T>> {
    const value = await this.structured<T>(messages, schema, opts)
    return { value, sources: urlsIn(value), searches: 1 }
  }

  async dispose(): Promise<void> {}
}

// ------------------------------------------------------------------ the central server

interface Pr {
  number: number
  workItem: string
  head: string
  commits: number
  merged: string | null
  /** Merge order (a deploy carries every merge up to its own). */
  mergedAt: number
  landed: boolean
  failed: boolean
  /** Redeploys so far (the server's `attempt`, FEAT-085). */
  attempt: number
  /** Deploy failures so far. */
  failures: number
}

/**
 * The central server's gateway and deploy events, as far as the browser sees
 * them: one PR per work item (a later draft commits to it), a merge at the
 * reviewed head that is idempotent, a deploy per merge that lands (or fails)
 * after a delay, the deploy state of a merge and a redeploy of a failed one
 * (a new deploy run, FEAT-085). A share of gateway calls fail, half before
 * and half after the server did the work (the answer is lost).
 */
export class FakeCentral {
  prs = new Map<number, Pr>()
  byItem = new Map<string, number>()
  /** Effective merges per PR (a repeated merge of a merged PR is idempotent and not counted). */
  merges = new Map<number, number>()
  /** Deploy runs in flight: one per merge, finishing at `at` (wall ms). */
  runs: { at: number; number: number; fail: boolean }[] = []
  delivered = 0
  deployFailures = 0
  /** Redeploys the server started (a repeated call for a merge already pending starts none). */
  redeploys = 0
  /** Work items redeployed. */
  redeployed = new Set<string>()
  failedCalls = 0
  anomalies: string[] = []
  /** Calls that fail once each, whatever the dice say (`openDraft:after`: the PR was committed, the answer lost). */
  forceFail: string[] = ['openDraft:after', 'merge:after']
  /** Fail the first deploy that starts at or after this wall time. */
  failNextDeployAfter: number | null = null
  private seq = 0
  private shas = 0
  private mergeSeq = 0

  constructor(
    private random: () => number,
    private errorRate: number,
    private deployDelayMs: [number, number],
  ) {}

  gateway(alive: () => boolean): OrchestratorGateway {
    const never = new Promise<never>(() => undefined)
    const maybeFail = (op: 'openDraft' | 'merge' | 'redeploy', stage: 'before' | 'after') => {
      const forced = this.forceFail.indexOf(`${op}:${stage}`)
      if (forced >= 0) this.forceFail.splice(forced, 1)
      if (forced >= 0 || this.random() < this.errorRate / 2) {
        this.failedCalls++
        throw new Error(`gateway: 502 Bad Gateway (${op}, ${stage} the server did it)`)
      }
    }
    return {
      openDraft: async (_contentId, _path, _page, _message, workItem) => {
        if (!alive()) return never
        maybeFail('openDraft', 'before')
        const key = workItem ?? _path
        let n = this.byItem.get(key)
        if (n == null) {
          n = this.prs.size + 1
          this.byItem.set(key, n)
          this.prs.set(n, { number: n, workItem: key, head: '', commits: 0, merged: null, mergedAt: 0, landed: false, failed: false, attempt: 0, failures: 0 })
        }
        const pr = this.prs.get(n)!
        if (pr.merged) this.anomalies.push(`draft for ${key} after its PR #${n} was merged`)
        pr.head = this.sha()
        pr.commits++
        maybeFail('openDraft', 'after')
        return { number: n, branch: `drafts/${key}`, head_sha: pr.head }
      },
      merge: async (number, headSha) => {
        if (!alive()) return never
        maybeFail('merge', 'before')
        const pr = this.prs.get(number)
        if (!pr) throw new Error(`gateway: 404 PR #${number}`)
        if (pr.merged) {
          // A repeated merge is idempotent: the same sha, no second merge and no second deploy (server gateway.rs).
          if (pr.head !== headSha) throw new Error(`gateway: 409 PR #${number} was merged at another head`)
          return pr.merged
        }
        if (pr.head !== headSha) throw new Error(`gateway: 409 PR #${number} is not at the reviewed head`)
        pr.merged = this.sha()
        pr.mergedAt = ++this.mergeSeq
        this.merges.set(number, (this.merges.get(number) ?? 0) + 1)
        this.deploy(pr)
        maybeFail('merge', 'after')
        return pr.merged
      },
      // The server's deploy state (GET /api/gateway/deploy-status).
      deployState: async (number) => {
        if (!alive()) return never
        const pr = this.prs.get(number)
        if (!pr) return null
        return pr.landed ? 'landed' : pr.failed ? 'failed' : pr.merged ? 'pending' : 'open'
      },
      // POST /api/gateway/redeploy (crates/server/src/deploys.rs): a failed merge gets a new deploy run.
      redeploy: async (number) => {
        if (!alive()) return never
        maybeFail('redeploy', 'before')
        const pr = this.prs.get(number)
        if (!pr?.merged) throw new Error(`gateway: 409 PR #${number} is not merged`)
        if (pr.landed) throw new Error(`gateway: 409 PR #${number} has landed: there is nothing to redeploy`)
        const result = (requested: boolean) => ({ number, work_item: pr.workItem, state: 'pending' as const, requested, run_id: number, run_attempt: pr.attempt + 1, attempt: pr.attempt, detail: null })
        if (!pr.failed) return result(false)
        pr.failed = false
        pr.attempt++
        this.redeploys++
        this.redeployed.add(pr.workItem)
        if (this.redeploys > [...this.prs.values()].reduce((n, p) => n + p.failures, 0)) this.anomalies.push(`PR #${number} redeployed more often than it failed`)
        this.deploy(pr)
        maybeFail('redeploy', 'after')
        return result(true)
      },
    }
  }

  /**
   * Deploy runs finished by `now`, as the server reports them
   * (crates/server/src/deploys.rs): a failed run fails its own pending merge
   * (one `DeployFailed`); a run that succeeds lands every merge it carries,
   * i.e. every pending or failed merge up to its own (one `DeployLanded` each).
   */
  due(now: number): CentralEvent[] {
    const out: CentralEvent[] = []
    this.runs.sort((a, b) => a.at - b.at)
    while (this.runs.length && this.runs[0].at <= now) {
      const run = this.runs.shift()!
      const own = this.prs.get(run.number)!
      if (run.fail) {
        if (!own.landed && !own.failed) {
          own.failed = true
          own.failures++
          this.deployFailures++
          out.push(this.event('DeployFailed', own, run.at))
        }
        continue
      }
      for (const pr of this.prs.values()) {
        if (pr.merged && !pr.landed && pr.mergedAt <= own.mergedAt) {
          pr.landed = true
          out.push(this.event('DeployLanded', pr, run.at))
        }
      }
    }
    this.delivered += out.length
    return out
  }

  /** Whether a deploy run still to come will carry the item's merge. */
  carries(workItem: string): boolean {
    const n = this.byItem.get(workItem)
    const pr = n == null ? null : this.prs.get(n)
    if (!pr?.merged || pr.landed) return false
    return this.runs.some((r) => !r.fail && this.prs.get(r.number)!.mergedAt >= pr.mergedAt) || (!pr.failed && this.runs.some((r) => r.number === pr.number))
  }

  private event(kind: string, pr: Pr, at: number): CentralEvent {
    return { seq: ++this.seq, company_id: 'soak', kind, payload: { work_item: pr.workItem, merged_sha: pr.merged, source: 'soak', attempt: pr.attempt }, created_at: at }
  }

  private deploy(pr: Pr) {
    const [lo, hi] = this.deployDelayMs
    const at = Date.now() + lo + this.random() * (hi - lo)
    let fail = false
    if (this.failNextDeployAfter != null && Date.now() >= this.failNextDeployAfter) {
      fail = true
      this.failNextDeployAfter = null
    }
    this.runs.push({ at, number: pr.number, fail })
  }

  private sha(): string {
    return (++this.shas).toString(16).padStart(40, '0')
  }
}

// ------------------------------------------------------------------ options and report

export interface SoakOptions {
  wasm: SoakWasm
  store: CompanyStore
  /** Advances wall time (vitest: `vi.advanceTimersByTimeAsync`); timers due run inside it. */
  advance: (ms: number) => Promise<void>
  /** The site binding's knowledge pack (JSON text). */
  knowledgePack: string
  days: number
  seed?: number
  /** Sim steps per 100 ms slice (the HUD's fastest is 10). */
  speed?: number
  /** Scales the model's latency (1: 2–40 s per call). */
  timeFactor?: number
  invalidRate?: number
  hangRate?: number
  gatewayErrorRate?: number
  /** The model is lost on this game day (index from the start) at `lossAt` minutes for `lossMinutes` of wall time; null: never. */
  lossDay?: number | null
  /** The page is reloaded on this game day while a draft runs; null: never. */
  reloadDay?: number | null
  /** The first deploy after this game day starts fails; null: none. */
  deployFailDay?: number | null
  /** The CEO answers nothing on this game day; null: always there. */
  absentDay?: number | null
  /** On this game day one draft hangs twice in a row mid-job: `JobFailed{Timeout}`, an Escalation, the CEO's Retry. */
  jobFailDay?: number | null
  /** A full garbage collection before each day's heap reading (Node: `--expose-gc`, or v8 flags). */
  gc?: () => void
  log?: (line: string) => void
}

export interface DayRow {
  day: number
  step: number
  items: number
  published: number
  cancelled: number
  blocked: number
  open: number
  jobsRun: number
  jobsFailed: number
  modelCalls: number
  loop: LoopSizes
  activity: { jobs: number; latest: number; errors: number }
  bridgeCalls: number
  fakeCalls: number
  gatewayCalls: number
  received: number
  rows: Record<string, number>
  heapMb: number | null
}

export interface SoakReport {
  days: DayRow[]
  startDay: number
  steps: number
  hash: string
  replayHash: string
  items: { id: string; status: string; covered: string }[]
  stuck: string[]
  duplicates: string[]
  clockViolations: string[]
  financeTickets: string[]
  rejections: string[]
  loopErrors: string[]
  halted: string | null
  events: {
    reloads: number
    modelLosses: number
    deployFailures: number
    /** Redeploys after the CEO's Retry on a DeployFailed ticket (FEAT-085), and the redeployed items that were published. */
    redeploys: number
    redeployedPublished: number
    absentDay: number | null
    jobTimeouts: number
  }
  /** Stage rows reused (after the reload) or adopted (by a retried phase), from the activity record. */
  reusedStages: number
  adoptedStages: number
  activityRows: number
  faults: { invalid: number; hang: number; unavailable: number; gateway: number }
  answers: Record<string, number>
  /** `plan_json()` calls per sim step (the per-step parse is gone when this is far below 1). */
  planJsonPerStep: number
  wallMs: number
  sweptJobs: number
}

const SITE: SiteBindingJson = {
  site_id: 'cinqueterre.travel',
  brand_name: 'Cinque Terre Dispatch',
  language: 'en',
  quality_bar: 7,
  simulate_deploy: false,
  standup_max_turns: 4,
}

const SCENARIO = 'cinqueterre'
const COMPANY = 'company-soak'
const KEEP_EVENTS = 200
const CLOSED = new Set(['published', 'cancelled'])

interface PlanView {
  items: { id: string; status: string; awaitingApproval?: boolean; tickets?: string[]; escalations?: number }[]
  jobs?: { id: number; kind: string; workItem: string | null }[]
}

interface Ticket {
  id: string
  kind: string
  status: string
  workItem: string | null
  options: string[]
  defaultOption: string
}

// ------------------------------------------------------------------ the run

/** One page load: everything session.ts builds after the restore. */
interface Page {
  sim: SoakSim
  loop: OrchestrationLoop
  clock: ClockDriver
  llm: SoakLlm
  bridge: ReturnType<typeof localLlmBridge>
  activity: ActivityRecorder
  alive: boolean
  calls: GatewayCall[]
}

export async function runSoak(o: SoakOptions): Promise<SoakReport> {
  const log = o.log ?? (() => undefined)
  const random = rng(o.seed ?? 20261004)
  const seed = BigInt(o.seed ?? 20261004)
  const store = o.store
  const speed = o.speed ?? 1
  const t = o.timeFactor ?? 1
  const central = new FakeCentral(random, o.gatewayErrorRate ?? 0.01, [60_000, 240_000])
  const received: CentralEvent[] = []
  const rejections: string[] = []
  const clockViolations: string[] = []
  const answers: Record<string, number> = {}
  const financeTickets = new Set<string>()
  let planJsonCalls = 0
  let lostUntil = 0
  let modelLosses = 0
  let reloads = 0
  let sweptJobs = 0
  let steppedTotal = 0
  const reuse = { reused: 0, adopted: 0 }
  let failArmed = false
  const faults = { invalid: 0, hang: 0, unavailable: 0 }
  const lost = () => Date.now() < lostUntil
  const wall0 = Date.now()

  const sims: SimFactory<SoakSim> = {
    fromSeed: (scenario, s) => o.wasm.Sim.scenario(scenario, s),
    fromSnapshot: (bytes) => o.wasm.Sim.from_snapshot(bytes),
  }
  /** The sim with `plan_json` counted. */
  const counted = (sim: SoakSim): SoakSim =>
    new Proxy(sim, {
      get(target, prop) {
        if (prop === 'plan_json') {
          return (p?: string | null) => {
            planJsonCalls++
            return target.plan_json(p)
          }
        }
        const v = Reflect.get(target, prop, target)
        return typeof v === 'function' ? v.bind(target) : v
      },
    })

  /** Builds a page on a restored sim (session.ts, after `restore`). */
  async function openPage(sim: SoakSim, restored: { effects: string[]; completedJobs: Iterable<number>; landed: Iterable<string>; lastSeq: number }): Promise<Page> {
    const page = { alive: true } as Page
    page.sim = sim
    page.calls = []
    page.llm = new SoakLlm({ latencyMs: [2000 * t, 40_000 * t], invalid: o.invalidRate ?? 0.05, hang: o.hangRate ?? 0.02 }, random, lost, faults)
    const gateway = recordingGateway(central.gateway(() => page.alive), page.calls)
    // As session.ts (SESSION_LLM_CALLS): the bridge keeps the newest 20 prompts.
    page.bridge = localLlmBridge(page.llm, { stageTimeoutMs: 120_000, paused: lost, maxCalls: 20 })
    page.activity = new ActivityRecorder({ store, companyId: COMPANY, clock: () => ({ step: Number(sim.step()), day: sim.day(), minute: sim.minute_of_day() }), log })
    page.bridge.onCall = (c) => page.activity.call(c)
    let speak: (e: Parameters<OrchestrationLoop['turnFinished']>[0]) => void = () => undefined
    const orch = await createOrchestrator({
      store,
      gateway,
      llm: page.bridge,
      site: { ...SITE, knowledge_pack: o.knowledgePack },
      onProgress: (e) => {
        if (!page.alive) return
        page.activity.progress(e)
        if (e.state === 'reused') {
          reuse.reused++
          if (e.detail?.adopted_from != null) reuse.adopted++
        }
        speak(e)
      },
    })
    page.loop = new OrchestrationLoop({
      sim,
      store,
      companyId: COMPANY,
      orchestrator: withApprover(orch, { inboxJson: () => sim.inbox_json(), ceoName: () => 'Owner' }),
      codec: { jobsFromEffects, outcomesForSim },
      paused: lost,
      log,
      standupContext: async ({ project }) => {
        const [plan, pageRows] = await Promise.all([store.plan(COMPANY), page.activity.flush().then(() => store.activityPage(COMPANY, { limit: 30 }))])
        const titles = Object.fromEntries(Object.entries(plan.items).map(([id, i]) => [id, i.title]))
        return standupContext(sim.plan_json(), project, { now: new Date(), titles, minutesPerArticle: minutesPerArticle(pageRows.rows) })
      },
      speechSpeed: () => page.clock.state.speed,
    })
    speak = (e) => page.loop.turnFinished(e)
    page.loop.seed(restored.completedJobs, restored.landed, restored.lastSeq)
    await page.loop.loadPendingDeploys()
    for (const e of restored.effects) void page.loop.enqueueEffects(e, { pendingOnly: true })
    let hourMark = sim.day() * 24 + Math.floor(sim.minute_of_day() / 60)
    let dayMark = sim.day()
    const onStep = () => {
      const hour = sim.day() * 24 + Math.floor(sim.minute_of_day() / 60)
      if (hour === hourMark) return
      hourMark = hour
      // Locally every game hour (session.ts), and the sweeper at day start.
      const at = { step: Number(sim.step()), hash: sim.hash().toString(), lastSeq: page.loop.lastSeq, world: sim.snapshot() }
      void page.loop.flush().then(() =>
        store.putSnapshot(at.step, encodeSnapshot({ scenario: SCENARIO, seed: seed.toString(), step: at.step, hash: at.hash, lastSeq: at.lastSeq }, at.world), at.hash),
      )
      if (sim.day() !== dayMark) {
        dayMark = sim.day()
        void sweepStages(store, COMPANY, sim.plan_json()).then((j) => (sweptJobs += j.length))
      }
    }
    page.clock = new ClockDriver(sessionClockHost(sim, page.loop, { modelReady: () => !lost(), onStep }), { speed, unattendedDays: 365 })
    return page
  }

  /** A new company: the sim from the seed (session.ts `restore`, source `new`). */
  let page = await openPage(counted(o.wasm.Sim.scenario(SCENARIO, seed)), { effects: [], completedJobs: [], landed: [], lastSeq: 0 })
  const startDay = page.sim.day()
  const endDay = startDay + o.days
  const onRejection = (e: unknown) => rejections.push(String(e instanceof Error ? (e.stack ?? e.message) : e))
  process.on('unhandledRejection', onRejection)

  /** The page reloads: the old one never answers again; the new one restores from the store. */
  async function reload() {
    reloads++
    page.alive = false
    page.llm.dead = true
    page.loop.halt('the page was reloaded')
    const commands: LoggedCommand[] = (await store.commandsAfter(-1)).map(toLogged)
    const snap = await store.latestSnapshot()
    const rec = snap ? decodeSnapshot(snap.bytes) : null
    const restored = restoreSim(sims, { scenario: SCENARIO, seed, commands, point: rec?.checkpoint ?? null, world: rec?.world ?? null })
    log(`reload at step ${page.sim.step()}: restored at step ${restored.result.step} from ${restored.fromSnapshot ? 'a snapshot' : 'the seed'} (${restored.result.applied} replayed)`)
    page = await openPage(counted(restored.sim), { ...restored.result, lastSeq: commands.length })
  }

  /** The CEO's policy: every ticket answered at once, except on the absent day. */
  function ceo() {
    const day = page.sim.day() - startDay
    const inbox = JSON.parse(page.sim.inbox_json()) as { tickets: Ticket[] }
    for (const tk of inbox.tickets) {
      if (['budget-overrun', 'runway-low', 'payroll-spike', 'loan-offer', 'hire-affordability'].includes(tk.kind)) financeTickets.add(`${tk.kind} ${tk.id}`)
      if (tk.status !== 'open' || day === o.absentDay) continue
      let option = tk.defaultOption
      if (tk.kind === 'publish-approval') option = 'publish'
      else if (tk.kind === 'deploy-failed') option = 'retry'
      if (!tk.options.includes(option)) option = tk.defaultOption
      const r = page.loop.apply(JSON.stringify({ AnswerTicket: { ticket: tk.id, option } }))
      if (r.ok) answers[`${tk.kind}:${option}`] = (answers[`${tk.kind}:${option}`] ?? 0) + 1
      else log(`answer ${tk.kind} ${tk.id} ${option} rejected: ${r.reason}`)
    }
  }

  const days: DayRow[] = []
  let lastDay = page.sim.day()
  let reloadArmed = o.reloadDay ?? null
  let reloadTarget = null as { job: number; calls: number } | null
  let jobFailArmed = o.jobFailDay ?? null
  /** The draft the forced timeout is aimed at, and the model calls when it was first seen running. */
  let failTarget = null as { job: number; calls: number } | null
  let lossArmed = o.lossDay ?? null
  const failDay = o.deployFailDay ?? null

  async function record(day: number) {
    await page.loop.flush()
    await page.activity.flush()
    const plan = JSON.parse(page.sim.plan_json()) as PlanView
    const count = (s: string) => plan.items.filter((i) => i.status === s).length
    o.gc?.()
    const jobs = page.loop.jobs
    days.push({
      day: day - startDay,
      step: Number(page.sim.step()),
      items: plan.items.length,
      published: count('published'),
      cancelled: count('cancelled'),
      blocked: count('blocked'),
      open: plan.items.filter((i) => !CLOSED.has(i.status)).length,
      jobsRun: jobs.filter((j) => j.state === 'done' || j.state === 'failed').length,
      jobsFailed: jobs.filter((j) => j.state === 'failed').length,
      modelCalls: page.llm.calls,
      loop: page.loop.sizes(),
      activity: page.activity.sizes(),
      bridgeCalls: page.bridge.calls.length,
      fakeCalls: page.llm.inner.calls.length,
      gatewayCalls: page.calls.length,
      received: received.length,
      rows: await store.rowCounts(),
      heapMb: typeof process !== 'undefined' && process.memoryUsage ? Math.round(process.memoryUsage().heapUsed / 1e5) / 10 : null,
    })
  }

  try {
    while (page.sim.day() < endDay) {
      const sim = page.sim
      const day = sim.day() - startDay
      if (sim.day() !== lastDay) {
        await record(lastDay)
        lastDay = sim.day()
      }
      // Fault schedule.
      // The GPU device is lost while a job runs; the model is back ten minutes later.
      if (lossArmed != null && day >= lossArmed && sim.minute_of_day() >= 11 * 60 && page.loop.heldFor?.state === 'running' && page.loop.heldFor.kind !== 'standup') {
        lossArmed = null
        modelLosses++
        lostUntil = Date.now() + 10 * 60_000
        log(`model lost at day ${day} ${sim.minute_of_day()} min`)
      }
      if (failDay != null && day >= failDay && central.failNextDeployAfter == null && !failArmed) {
        failArmed = true
        central.failNextDeployAfter = Date.now()
      }
      // The page reloads in the middle of a draft (a few of its model calls done).
      if (reloadArmed != null && day >= reloadArmed && page.loop.heldFor?.state === 'running' && page.loop.heldFor.kind === 'draft') {
        const job = page.loop.heldFor.job_id
        if (reloadTarget?.job !== job) reloadTarget = { job, calls: page.llm.calls }
        else if (page.llm.calls - reloadTarget.calls >= 4) {
          reloadArmed = null
          await reload()
          continue
        }
      }
      // A draft that hangs twice in a row once it made a few calls: the stage is made once more, then JobFailed{Timeout}.
      // (Not the draft the reload is aimed at: one fault per job.)
      if (
        jobFailArmed != null &&
        day >= jobFailArmed &&
        reloadArmed == null &&
        page.loop.heldFor?.state === 'running' &&
        page.loop.heldFor.kind === 'draft' &&
        page.loop.heldFor.job_id !== reloadTarget?.job
      ) {
        const job = page.loop.heldFor.job_id
        if (failTarget?.job !== job) failTarget = { job, calls: page.llm.calls }
        else if (page.llm.calls - failTarget.calls >= 3) {
          jobFailArmed = null
          page.llm.hangNext = 2
          log(`draft job ${job}: the model hangs on its next two calls`)
        }
      }
      // Central events (the EventStream handler of session.ts).
      for (const ev of central.due(Date.now())) {
        received.push(ev)
        if (received.length > KEEP_EVENTS) received.splice(0, received.length - KEEP_EVENTS)
        await page.loop.deployEvent(ev)
      }
      ceo()
      // One clock tick: 100 ms while the clock runs; a second while it is held.
      const dt = page.clock.hold === null || page.clock.hold === 'resting' ? 100 : 1000
      const before = page.loop.jobs.filter((j) => j.state === 'queued' || j.state === 'running').map((j) => ({ id: j.job_id, due: j.due_step }))
      const r = page.clock.tick(dt)
      steppedTotal += r.steps
      if (r.steps > 0) {
        const now = Number(sim.step())
        for (const j of before) if (now >= j.due) clockViolations.push(`step ${now} reached due step ${j.due} of job ${j.id}, whose outcome was not applied`)
      }
      await o.advance(dt)
      if (page.loop.halted) break
    }
    await record(lastDay)
  } finally {
    process.off('unhandledRejection', onRejection)
  }

  // ---------------------------------------------------------------- end checks
  await page.loop.flush()
  const sim = page.sim
  const plan = JSON.parse(sim.plan_json()) as PlanView
  const inbox = JSON.parse(sim.inbox_json()) as { tickets: Ticket[] }
  const openTickets = new Map<string, Ticket[]>()
  for (const tk of inbox.tickets) if (tk.status === 'open' && tk.workItem) openTickets.set(tk.workItem, [...(openTickets.get(tk.workItem) ?? []), tk])
  const pendingJobs = new Set((plan.jobs ?? []).map((j) => j.workItem).filter((w): w is string => !!w))
  const held = new Set(page.loop.pendingDeploys)
  const items = plan.items.map((i) => {
    let covered = ''
    if (CLOSED.has(i.status)) covered = i.status
    else if (pendingJobs.has(i.id)) covered = 'pending job'
    else if (openTickets.has(i.id)) covered = `ticket ${openTickets.get(i.id)!.map((t) => t.kind).join(',')}`
    else if (i.status === 'scheduled' && (central.carries(i.id) || held.has(i.id))) covered = 'deploy in flight'
    else if (i.awaitingApproval) covered = 'parked for approval (re-raised at 08:30)'
    else if (i.status === 'backlog' || i.status === 'planned') covered = 'waiting for a writer'
    return { id: i.id, status: i.status, covered }
  })
  const stuck = items.filter((i) => !i.covered).map((i) => `${i.id} (${i.status})`)

  // Duplicates: PRs, merges, posts, utterances, outcomes.
  const duplicates: string[] = [...central.anomalies]
  for (const [n, c] of central.merges) if (c > 1) duplicates.push(`PR #${n} merged ${c} times`)
  const prsPerItem = new Map<string, number>()
  for (const pr of central.prs.values()) prsPerItem.set(pr.workItem, (prsPerItem.get(pr.workItem) ?? 0) + 1)
  for (const [w, c] of prsPerItem) if (c > 1) duplicates.push(`${w} has ${c} PRs`)
  const commands = (await store.commandsAfter(-1)).map(toLogged)
  const settled = new Map<number, number>()
  const utterances = new Set<string>()
  const landedLog = new Map<string, number>()
  for (const c of commands) {
    const body = JSON.parse(c.json) as Record<string, Record<string, unknown>>
    if (c.kind === 'JobCompleted' || c.kind === 'JobFailed' || c.kind === 'MeetingOutcome' || c.kind === 'BoardOutcome') {
      const id = Number(body[c.kind].job_id)
      settled.set(id, (settled.get(id) ?? 0) + 1)
    }
    if (c.kind === 'Utterance') {
      const u = body.Utterance
      const key = `${String(u.meeting)}:${String(u.seq)}`
      if (utterances.has(key)) duplicates.push(`utterance ${key} applied twice`)
      utterances.add(key)
    }
    if (c.kind === 'DeployLanded') landedLog.set(String(body.DeployLanded.work_item), (landedLog.get(String(body.DeployLanded.work_item)) ?? 0) + 1)
  }
  for (const [id, c] of settled) if (c > 1) duplicates.push(`job ${id} settled ${c} times`)
  for (const [w, c] of landedLog) if (c > 1) duplicates.push(`${w} landed ${c} times`)
  const posts = await store.plan(COMPANY)
  for (const [item, list] of Object.entries(posts.posts)) {
    const seen = new Map<string, number>()
    for (const p of list) {
      const { id: _id, item: _item, ...rest } = p
      const k = JSON.stringify(rest)
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    for (const [k, c] of seen) if (c > 1) duplicates.push(`${item}: post posted ${c} times: ${k.slice(0, 120)}`)
  }

  // Replay: the command log from the seed gives the live world's hash.
  const check = o.wasm.Sim.scenario(SCENARIO, seed)
  const res = replay(check, commands, Number(sim.step()))
  await page.activity.flush()
  const activityRows = await store.activity(COMPANY)
  check.free()

  return {
    days,
    startDay,
    steps: Number(sim.step()),
    hash: sim.hash().toString(),
    replayHash: res.hash,
    items,
    stuck,
    duplicates,
    clockViolations,
    financeTickets: [...financeTickets],
    rejections,
    loopErrors: [...page.loop.errors],
    halted: page.loop.halted,
    events: {
      reloads,
      modelLosses,
      deployFailures: central.deployFailures,
      redeploys: central.redeploys,
      redeployedPublished: items.filter((i) => central.redeployed.has(i.id) && i.status === 'published').length,
      absentDay: o.absentDay ?? null,
      jobTimeouts: commands.filter((c) => c.kind === 'JobFailed').length,
    },
    reusedStages: reuse.reused,
    adoptedStages: reuse.adopted,
    activityRows: activityRows.length,
    faults: { ...faults, gateway: central.failedCalls },
    answers,
    planJsonPerStep: steppedTotal > 0 ? planJsonCalls / steppedTotal : 0,
    wallMs: Date.now() - wall0,
    sweptJobs,
  }
}
