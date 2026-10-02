/**
 * The game session (docs/mvp.md, FEAT-014/FEAT-015): what the real game page
 * runs with `?central=1`. Without it the page stays the offline demo
 * (`Sim.demo`, no store, no network), which the smoke and visual suites use.
 *
 *   dev login → company (created on first login) → company store (OPFS) → lease
 *   → restore: the store's log + checkpoint, else central sync, else a new company
 *   → orchestration loop (sim effects → orchestrator-wasm → commands) + events
 *   → checkpoints: locally every game hour, sealed to central sync every game
 *     day and on `pagehide`
 *
 * URL parameters (besides main.ts's):
 *   central=1        turn the session on
 *   login=NAME       dev login (default `ceo`; needs SIMPRESS_DEV_AUTH=1 on the server)
 *   llm=fake         the scripted MVP model (src/llm/mvp-script.ts)
 *   store=…          the store engine (src/store)
 *   ff=HH:MM         fast-forward on boot to that time of the current game day
 */
import styleGuide from '../../../../crates/agents/tests/fixtures/style-guide.json'
import { Sim } from 'swarm-wasm'
import { parseClock, replay, stepsUntil, type LoggedCommand, type ReplayResult } from '../catchup/replay'
import { FakeLlm } from '../llm/fake-llm'
import { CentralClient, centralGateway, EventStream, LeaseKeeper, type CentralEvent, type Company, type OrchestratorGateway } from '../net/central'
import { OrchestrationLoop, type JobRecord } from '../orchestration/loop'
import { createOrchestrator, jobsFromEffects, llmFromQuery, localLlmBridge, outcomesForSim, type SiteBindingJson } from '../orchestrator'
import { openCompanyStore, type CompanyStore, type Plan } from '../store'
import { commandBytes, decodeCheckpoint, encodeCheckpoint, type Checkpoint } from '../sync/segments'
import { fetchRemote, NEXT_SEGMENT_KEY, SEALED_SEQ_KEY, SyncUploader, toLogged, type SealResult } from '../sync/uploader'
import { planTextFromStore, WasmDataSource, type SimOrgApi } from '../ui/wasm-source'

export const SCENARIO = 'cinqueterre'

/** The cinqueterre.travel site binding (the style guide is the agents crate's fixture until sites carry their own). */
const SITE: SiteBindingJson = {
  site_id: 'cinqueterre.travel',
  brand_name: 'Cinque Terre Dispatch',
  language: 'en',
  style_guide: styleGuide,
  quality_bar: 7,
  // The central server reports the deploy (the GitHub webhook, or SIMPRESS_SIMULATE_DEPLOY in dev).
  simulate_deploy: false,
  standup_max_turns: 4,
}

export type RestoreSource = 'new' | 'opfs' | 'central'

export interface RestoreInfo {
  source: RestoreSource
  step: number
  hash: string
  /** Commands replayed from the log. */
  replayed: number
  /** The checkpoint the replay targeted (null for a new company). */
  checkpoint: { step: number; hash: string } | null
  /** Replay hash == checkpoint hash (null when there was no checkpoint at that step). */
  verified: boolean | null
  ms: number
}

export interface GatewayCall {
  op: 'draft' | 'merge'
  workItem?: string | null
  number: number
  branch?: string
  headSha?: string
  mergedSha?: string
}

export interface SessionInfo {
  login: string
  companyId: string
  companyName: string
  seed: number
  engine: string
  persistent: boolean
  fallbackReason: string | null
  crossOriginIsolated: boolean
  leaseId: string | null
  events: string
  restored: RestoreInfo
}

export interface CheckpointResult {
  step: number
  hash: string
  local: boolean
  central: SealResult | null
}

/** `window.__simpress.session`: the e2e test hook (mirrors the orchestrator harness). */
export interface SessionHook {
  info(): SessionInfo
  state(): {
    step: number
    hash: string
    day: number
    minute: number
    paused: boolean
    jobs: JobRecord[]
    queued: number
    pendingCommands: number
    pendingDeploys: string[]
    logged: number
    errors: string[]
  }
  /** `Sim.plan_json()` (the skeleton) parsed. */
  plan(): unknown
  /** Work item id → status, from the sim. */
  items(): Record<string, string>
  /** The plan text in the store (posts of the work-item thread). */
  planText(): Promise<Plan>
  gateway(): GatewayCall[]
  events(): CentralEvent[]
  /** Pauses the sim clock (jobs keep running; outcomes still apply at boundaries). */
  pause(): void
  resume(): void
  /** Waits until queued jobs ran and their outcomes are applied and logged. */
  idle(): Promise<void>
  /** Local checkpoint + sealed segment and checkpoint on the central server. */
  checkpoint(): Promise<CheckpointResult>
  errors(): string[]
}

export interface GameSession {
  sim: Sim
  store: CompanyStore
  company: Company
  loop: OrchestrationLoop
  hook: SessionHook
  readonly paused: boolean
  /** Call at every step boundary, before `sim.advance`. */
  boundary(): void
  /** Call after every `sim.advance`. */
  afterAdvance(): void
  /** The overlay's data source: the sim (commands logged through the loop) plus the store's plan text. */
  dataSource(): WasmDataSource
}

export interface SessionOptions {
  params: URLSearchParams
  client?: CentralClient
  log?: (line: string) => void
}

/** A LocalLlm that fails loudly: the real model runtime is not wired into the session yet (use `?llm=fake`). */
function unwiredLlm(): FakeLlm {
  return new FakeLlm({
    script: [],
    responder: () => new Error('the local model runtime is not wired into the game session yet; use ?llm=fake'),
  })
}

async function signIn(client: CentralClient, login: string) {
  const me = await client.me()
  if (me && me.user.login === login) return me
  await client.devLogin(login)
  const again = await client.me()
  if (!again) throw new Error('dev login did not create a session')
  return again
}

async function deviceId(store: CompanyStore): Promise<string> {
  const have = await store.getKv('device.id')
  if (have) return have
  const id = `dev-${crypto.randomUUID()}`
  await store.setKv('device.id', id)
  return id
}

async function restore(store: CompanyStore, client: CentralClient, company: Company): Promise<{ sim: Sim; info: RestoreInfo; result: ReplayResult }> {
  const t0 = performance.now()
  let source: RestoreSource = 'opfs'
  let commands: LoggedCommand[] = (await store.commandsAfter(-1)).map(toLogged)
  const local = await store.latestSnapshot()
  let cp: Checkpoint | null = local ? decodeCheckpoint(local.bytes) : null
  if (!commands.length && !cp) {
    const remote = await fetchRemote(client, company.id)
    if (remote) {
      source = 'central'
      commands = remote.commands
      cp = remote.checkpoint
      // The store becomes this device's copy of the log; what came from central is sealed already.
      await store.appendCommands(commands.map((c) => ({ seq: c.seq, step: c.step, kind: c.kind, payload: commandBytes(c.json) })))
      await store.setKv(SEALED_SEQ_KEY, String(commands.length ? commands[commands.length - 1].seq : 0))
      await store.setKv(NEXT_SEGMENT_KEY, String(remote.segments))
      if (cp) await store.putSnapshot(cp.step, encodeCheckpoint(cp), cp.hash)
    } else source = 'new'
  }
  if (cp && cp.seed !== String(company.seed)) throw new Error(`checkpoint seed ${cp.seed} is not the company's seed ${company.seed}`)
  const sim = Sim.scenario(cp?.scenario ?? SCENARIO, BigInt(company.seed))
  const result = replay(sim, commands, cp?.step ?? 0)
  const verified = cp && result.step === cp.step ? result.hash === cp.hash : null
  if (verified === false) console.error(`[session] replay desync: step ${result.step} hash ${result.hash}, checkpoint ${cp!.hash}`)
  const info: RestoreInfo = {
    source,
    step: result.step,
    hash: result.hash,
    replayed: result.applied,
    checkpoint: cp ? { step: cp.step, hash: cp.hash } : null,
    verified,
    ms: Math.round(performance.now() - t0),
  }
  return { sim, info, result }
}

function recordingGateway(inner: OrchestratorGateway, calls: GatewayCall[]): OrchestratorGateway {
  return {
    async openDraft(contentId, path, pageJson, message, workItem) {
      const r = await inner.openDraft(contentId, path, pageJson, message, workItem)
      calls.push({ op: 'draft', workItem, number: r.number, branch: r.branch, headSha: r.head_sha })
      return r
    },
    async merge(number, headSha) {
      const sha = await inner.merge(number, headSha)
      calls.push({ op: 'merge', number, headSha, mergedSha: sha })
      return sha
    },
  }
}

export async function startSession(opts: SessionOptions): Promise<GameSession> {
  const { params } = opts
  const log = opts.log ?? ((line: string) => console.info(`[session] ${line}`))
  const client = opts.client ?? new CentralClient()
  const login = params.get('login') || 'ceo'

  const me = await signIn(client, login)
  const company = me.company ?? (await client.myCompany()) ?? (await client.createCompany({ name: `${login} Dispatch` }))
  // One database per company: the command log and checkpoints are the company's.
  const store = await openCompanyStore({ name: `simpress-${company.id}.db` })
  await store.setKv('company.id', company.id)

  // The newest device takes the company over (dev/MVP; the lease UI comes later).
  const lease = new LeaseKeeper(client, company.id, await deviceId(store), {
    force: true,
    onLost: (e) => log(`lease lost: ${String(e)}`),
  })
  await lease.start()

  const { sim, info: restored, result } = await restore(store, client, company)
  log(`company ${company.id} restored from ${restored.source} at step ${restored.step} (${restored.replayed} commands, ${restored.ms} ms)`)

  const calls: GatewayCall[] = []
  const orchestrator = await createOrchestrator({
    store,
    gateway: recordingGateway(
      centralGateway(client, () => lease.leaseId),
      calls,
    ),
    llm: localLlmBridge(llmFromQuery(location.search, unwiredLlm)),
    site: SITE,
  })
  const loop = new OrchestrationLoop({ sim, store, companyId: company.id, orchestrator, codec: { jobsFromEffects, outcomesForSim }, log })
  loop.seed(result.completedJobs, result.landed)
  await loop.loadPendingDeploys()
  // Jobs requested before the reload whose outcome never made it into the log run again (idempotent by job id).
  for (const e of result.effects) void loop.enqueueEffects(e)

  // Fast-forward (dev and e2e): deterministic stepping, no commands.
  const ff = parseClock(params.get('ff'))
  if (ff != null) {
    const n = stepsUntil(sim, ff)
    for (let left = n; left > 0; left -= Math.min(left, 1000)) {
      sim.advance(Math.min(left, 1000))
      loop.afterAdvance()
    }
    if (n) log(`fast-forwarded ${n} steps to ${params.get('ff')}`)
  }

  const received: CentralEvent[] = []
  const events = new EventStream(client, company.id, store, async (ev) => {
    received.push(ev)
    if (ev.kind === 'DeployLanded' && typeof ev.payload.work_item === 'string') {
      await loop.deployLanded(ev.payload.work_item, {
        mergedSha: typeof ev.payload.merged_sha === 'string' ? ev.payload.merged_sha : undefined,
        source: typeof ev.payload.source === 'string' ? ev.payload.source : undefined,
      })
    }
  })
  await events.start()

  const sync = new SyncUploader(client, store, company.id)
  let paused = false

  const capture = () => ({ step: Number(sim.step()), hash: sim.hash().toString() })
  const checkpointLocal = async (at = capture()) => {
    await loop.flush()
    const lastSeq = await store.lastSeq()
    await store.putSnapshot(at.step, encodeCheckpoint({ scenario: SCENARIO, seed: String(company.seed), lastSeq, ...at }), at.hash)
    return at
  }
  const checkpoint = async (): Promise<CheckpointResult> => {
    const at = capture()
    await checkpointLocal(at)
    let central: SealResult | null = null
    try {
      central = await sync.seal({ scenario: SCENARIO, seed: String(company.seed), ...at })
    } catch (e) {
      loop.errors.push(`sync failed: ${String(e)}`)
    }
    return { ...at, local: true, central }
  }

  // Checkpoints: locally every game hour, to central every game day.
  let hourMark = sim.day() * 24 + Math.floor(sim.minute_of_day() / 60)
  let dayMark = sim.day()
  let localBusy = false
  const onClock = () => {
    const hour = sim.day() * 24 + Math.floor(sim.minute_of_day() / 60)
    if (hour === hourMark) return
    hourMark = hour
    if (sim.day() !== dayMark) {
      dayMark = sim.day()
      void checkpoint()
    } else if (!localBusy) {
      localBusy = true
      void checkpointLocal().finally(() => (localBusy = false))
    }
  }
  window.addEventListener('pagehide', () => {
    void checkpoint()
  })

  const items = (): Record<string, string> =>
    Object.fromEntries((JSON.parse(sim.plan_json()) as { items: { id: string; status: string }[] }).items.map((i) => [i.id, i.status]))

  const hook: SessionHook = {
    info: () => ({
      login,
      companyId: company.id,
      companyName: company.name,
      seed: company.seed,
      engine: store.engine,
      persistent: store.persistent,
      fallbackReason: store.fallbackReason,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      leaseId: lease.current?.lease_id ?? null,
      events: events.transport,
      restored,
    }),
    state: () => ({
      ...capture(),
      day: sim.day(),
      minute: sim.minute_of_day(),
      paused,
      jobs: loop.jobs.map((j) => ({ ...j })),
      queued: loop.queued,
      pendingCommands: loop.pendingCommands,
      pendingDeploys: loop.pendingDeploys,
      logged: loop.logged,
      errors: [...loop.errors],
    }),
    plan: () => JSON.parse(sim.plan_json()),
    items,
    planText: () => store.plan(company.id),
    gateway: () => calls.map((c) => ({ ...c })),
    events: () => [...received],
    pause: () => {
      paused = true
    },
    resume: () => {
      paused = false
    },
    idle: () => loop.idle(),
    checkpoint,
    errors: () => [...loop.errors],
  }

  // The overlay's CEO commands go through the loop, so they are logged (and replayed) like outcomes.
  const orgApi: SimOrgApi = {
    org_json: () => sim.org_json(),
    finance_json: () => sim.finance_json(),
    inbox_json: () => sim.inbox_json(),
    plan_json: () => sim.plan_json(),
    day: () => sim.day(),
    minute_of_day: () => sim.minute_of_day(),
    validate_command_json: (json: string) => sim.validate_command_json(json),
    apply_command_json: (json: string) => {
      const r = loop.apply(json)
      if (!r.ok) throw new Error(r.reason)
    },
  }

  return {
    sim,
    store,
    company,
    loop,
    hook,
    get paused() {
      return paused
    },
    boundary: () => loop.boundary(),
    afterAdvance: () => {
      loop.afterAdvance()
      onClock()
    },
    dataSource: () => new WasmDataSource(orgApi, { planText: planTextFromStore(store, company.id) }),
  }
}
