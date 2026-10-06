/**
 * The game session (docs/mvp.md, FEAT-014/FEAT-015): what the real game page
 * runs with `?central=1`. Without it the page stays the offline demo
 * (`Sim.demo`, no store, no network), which the smoke and visual suites use.
 *
 *   dev login → company (created on first login) → company store (OPFS) → lease
 *     (ADR-0045: `acquire`; another executor's live lease leaves this session
 *     read-only, and a session that loses the lease halts)
 *   → restore: the store's snapshot + the log after it, else central sync, else a new company
 *   → site knowledge (ADR-0061, site-knowledge.ts): the pack at the base head, cached by
 *     commit, refetched before each standup and after each merge and DeployLanded
 *   → orchestration loop (sim effects → orchestrator-wasm → commands) + events
 *   → checkpoints: locally every game hour, sealed to central sync every game
 *     day and on `pagehide`
 *   → the clock (ADR-0060, session/clock-driver.ts): held while a job is due,
 *     the model is not ready or the loop is halted; resting at night
 *
 * URL parameters (besides main.ts's):
 *   central=1        turn the session on
 *   login=NAME       dev login (default `ceo`; needs SWARMPRESS_DEV_AUTH=1 on the server)
 *   llm=fake         the scripted MVP model (src/llm/mvp-script.ts)
 *   llm=luna|gemma|bonsai|chrome|transformers
 *                    the local model backend for this page load (ADR-0057; without it the
 *                    company's stored choice, else Bonsai). session/model-runtime.ts starts it;
 *                    the clock holds until it is ready
 *   llmdebug=1       the model worker's test hooks (`hook.destroyModelDevice()`)
 *   store=…          the store engine (src/store)
 *   ff=HH:MM         fast-forward on boot to that time of the current game day
 *   takeover=1       take the company over from the executor that holds it (this
 *                    page load only; the parameter is removed from the URL)
 *   restore=replay   ignore the snapshot and replay the whole log from the seed (the audit path)
 *   board=off        keep the weekly editorial board, the analytics loop and promotion copy off
 *                    for this page load (ADR-0069, ADR-0071, ADR-0073; the one-article end-to-end
 *                    test); without it the session turns them on once
 *   restore=rebase   rebuild the company from its command log alone, ignoring the snapshot and
 *                    the checkpoint, and seal a fresh snapshot: once, after a world format change
 *                    (ADR-0069's format 3) left a snapshot this build cannot read
 *   stagetimeout=S   wall-clock limit of one model call, seconds (P6; default 20 min); past it
 *                    the call is aborted and the stage made once more, then JobFailed{Timeout}
 *   jobtimeout=S     wall-clock limit of one job, seconds (default per kind, loop.ts); past it
 *                    the job is cancelled at its next stage boundary
 *   Both clocks stand still while the model is not ready (a lost GPU device is not a timeout).
 */
import { Sim } from 'swarm-wasm'
import { parseClock, restoreSim, stepsUntil, type LoggedCommand, type ReplayResult, type RestoredSim, type SimFactory } from '../catchup/replay'
import { CentralClient, centralGateway, companyFor, EventStream, leaseHeld, LeaseKeeper, type CentralEvent, type Company, type SiteAudit } from '../net/central'
import type { SiteModels } from '../blueprint/types'
import { OrchestrationLoop, type JobRecord } from '../orchestration/loop'
import { withApprover } from '../orchestration/approver'
import { sweepStages } from '../orchestration/sweeper'
import { recordingGateway, type GatewayCall } from './recording-gateway'
import { ActivityRecorder, heldByText } from '../orchestration/activity'
import { boardContext, minutesPerArticle, standupContext, utteranceMs } from '../orchestration/speech'
import { createOrchestrator, jobsFromEffects, loadRustValidator, localLlmBridge, outcomesForSim, type ProgressEvent, type SiteBindingJson } from '../orchestrator'
import { openCompanyStore, type ActivityRow, type CompanyStore, type Plan } from '../store'
import { commandBytes, decodeSnapshot, encodeSnapshot, type Checkpoint } from '../sync/segments'
import { fetchRemote, NEXT_SEGMENT_KEY, SEALED_SEQ_KEY, SyncUploader, toLogged, type SealResult } from '../sync/uploader'
import type { DataTopic } from '../ui/data-source'
import { mountModelCard } from '../ui/model-card'
import { companyStoreOptions, WasmDataSource, type SimOrgApi } from '../ui/wasm-source'
import { showBootBinding } from '../ui/boot-screen'
import { hudSite } from '../ui/hud'
import { siteBindingView } from '../ui/site-binding'
import { cleanDays, ClockDriver, clockStatus, sessionClockHost, type ClockStatus, type ModelStatus } from './clock-driver'
import { openModelRuntime, type ModelRuntime, type ModelRuntimeInfo } from './model-runtime'
import { StoryDirector, storyLineKey } from '../story/director'
import { storyContext } from '../story/context'
import { REMARK } from '../ui/bubbles/BubbleLayer'
import type { RenderState } from '../state/render-state'
import { refetchAfterMerge, refetchOnDeploy, SiteKnowledgeKeeper, SiteOrchestrator, type KnowledgeStatus, type SiteSummary } from './site-knowledge'

export const SCENARIO = 'cinqueterre'

/**
 * The cinqueterre.travel site binding. Its style guide and writer prompt are
 * the site's own, from the knowledge pack the session fetches
 * (site-knowledge.ts adds `knowledge_pack`); without a pack the house style
 * is empty, and standups, drafts and reviews wait for one.
 */
const SITE: SiteBindingJson = {
  site_id: 'cinqueterre.travel',
  brand_name: 'Cinque Terre Dispatch',
  language: 'en',
  quality_bar: 7,
  // The central server reports the deploy (the GitHub webhook, or SWARMPRESS_SIMULATE_DEPLOY in dev).
  simulate_deploy: false,
  standup_max_turns: 4,
}

export type RestoreSource = 'new' | 'opfs' | 'central'

export interface RestoreInfo {
  source: RestoreSource
  step: number
  hash: string
  /** The sim was rebuilt from a world snapshot (FEAT-060); false when the whole log was replayed from the seed. */
  snapshot: boolean
  /** Commands replayed from the log: with a snapshot only those logged after it, else all of them. */
  replayed: number
  /** The snapshot (or legacy checkpoint) the restore started from or targeted (null for a new company). */
  checkpoint: { step: number; hash: string } | null
  /** The sim's hash == the record's hash at the record's step (null without a record; a mismatch aborts the restore). */
  verified: boolean | null
  ms: number
}

export type { GatewayCall } from './recording-gateway'

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
  /** The lease's fencing epoch and token (`<epoch>.<lease_id>`); null while the lease is not held. */
  epoch: number | null
  leaseToken: string | null
  events: string
  restored: RestoreInfo
  /** Steps the `ff=` fast-forward ran on boot (0 without it, or when that time had passed). */
  fastForwarded: number
}

export interface CheckpointResult {
  step: number
  hash: string
  local: boolean
  central: SealResult | null
}

/** `window.__swarmpress.session`: the e2e test hook (mirrors the orchestrator harness). */
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
    /** The loop holds the clock: a pending job is due (ADR-0060), jobs are being taken in, or the loop halted. */
    holdClock: boolean
    /** The earliest due step of a job in flight; null without one. */
    nextDueStep: number | null
    /** What the HUD chip shows: running, held, resting, model loading, lease lost, halted or paused. */
    status: ClockStatus
    /** Sim steps per 100 ms of clock. */
    speed: number
    /** Days that still start by themselves after the day is done. */
    unattendedDays: number
    /** The day-done card is up: the clock rests until the next day is started. */
    resting: boolean
    model: ModelStatus
    halted: string | null
    /** Why this session does not run the company (another executor holds the lease, or it was lost); null while it does. */
    readOnly: string | null
    /** The executor that asked this one to hand over, if any. */
    handoverRequestedBy: string | null
    /** The last checkpoint that reached the central server (a sealed log and snapshot). */
    sealed: CheckpointResult | null
    pendingCommands: number
    pendingDeploys: string[]
    logged: number
    errors: string[]
    /** The site's knowledge pack (ADR-0061): the one in use, and what the orchestrator is bound to. */
    knowledge: KnowledgeStatus & { bound: string | null; binding: SiteSummary | null }
    /** The stage of the job in flight (ADR-0058 progress event), if any. */
    progress: ProgressEvent | null
  }
  /** `Sim.plan_json()` (the skeleton) parsed. */
  plan(): unknown
  /** Work item id → status, from the sim. */
  items(): Record<string, string>
  /** The plan text in the store (posts of the work-item thread). */
  planText(): Promise<Plan>
  /** The command log in the store (seq, step and kind of every logged command). */
  commandLog(): Promise<{ seq: number; step: number; kind: string }[]>
  /** The activity record in the store (FEAT-078): a row per stage attempt and per job. */
  activity(): Promise<ActivityRow[]>
  gateway(): GatewayCall[]
  events(): CentralEvent[]
  /** Pauses the sim clock (jobs keep running; outcomes still apply at boundaries). Time only: nothing else changes. */
  pause(): void
  resume(): void
  setSpeed(speed: number): void
  setUnattendedDays(days: number): void
  /** The day-done card's button: skips the night. */
  startNextDay(): void
  /** What the model backend reports; only `ready` lets the clock run. */
  setModelStatus(status: ModelStatus): void
  /** The local model runtime: backend, phase, startup stages, losses (session/model-runtime.ts). */
  llm(): ModelRuntimeInfo
  /** Loads the model again after a device loss (the card's "Reload the model"). */
  reloadModel(): Promise<void>
  /** Test hook, only with `?llmdebug=1`: the worker destroys the model's GPU device as a loss would. */
  destroyModelDevice(): Promise<void>
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
  /**
   * The game clock (ADR-0060): the render loop ticks it every frame, the 1 Hz
   * worker timer while the tab is hidden. It calls the loop's boundary, steps
   * the sim and drains its effects; pause, speed and rest are its settings.
   */
  clock: ClockDriver
  /** What the HUD chip shows. */
  status(): ClockStatus
  /** The model backend reports its state here; only `ready` lets the clock run (`?llm=fake` is ready). */
  setModelStatus(status: ModelStatus): void
  /** The local model runtime; main.ts attaches the scene's renderer hooks to it (GPU sharing). */
  models: ModelRuntime
  /** The overlay's data source: the sim (commands logged through the loop) plus the store's plan text. */
  dataSource(): WasmDataSource
  /** Speech bubbles (FEAT-025): a meeting turn's words from the transcript, and how long a turn lasts. */
  speech: {
    text(meeting: string, seq: number, job: number | null): Promise<string | null>
    durationMs(chars: number): number
  }
}

/**
 * The overlay's source for a session. Plan text lives in the store, not the
 * sim, so `WasmDataSource`'s change detection (it compares the sim's JSON
 * views) cannot see a new thread post: the loop reports store writes here.
 */
class SessionDataSource extends WasmDataSource {
  private planListeners = new Set<(topics?: DataTopic[]) => void>()

  override subscribe(onChange: (topics?: DataTopic[]) => void) {
    this.planListeners.add(onChange)
    const off = super.subscribe(onChange)
    return () => {
      this.planListeners.delete(onChange)
      off()
    }
  }

  planTextChanged() {
    this.planListeners.forEach((l) => l(['plan']))
  }

  /** The site's models from the central server (ADR-0072); the session sets them, the overlay reads them. */
  private models: SiteModels | null = null

  setSiteModels(m: SiteModels) {
    this.models = m
    this.planListeners.forEach((l) => l(['site']))
  }

  getSiteModels(): Promise<SiteModels | null> {
    return Promise.resolve(this.models)
  }
}

/** The boot stages of a session, in order (the boot screen shows them). */
export type SessionStage = 'login' | 'store' | 'lease' | 'restore' | 'orchestrator'

export interface SessionOptions {
  params: URLSearchParams
  client?: CentralClient
  log?: (line: string) => void
  /** Called when a boot stage starts. */
  onStage?: (stage: SessionStage) => void
  /** Called with every error of the orchestration loop (the HUD shows a toast and marks the chip). */
  onError?: (message: string) => void
}

/** Central events kept for `hook.events()` (the newest; FEAT-085, a week must not grow it without end). */
export const KEEP_EVENTS = 200
/** The newest jobs whose activity rows give a standup its measured minutes per article. */
export const STANDUP_ACTIVITY_JOBS = 30
/** Model calls (whole prompts) the bridge keeps for diagnostics. */
export const SESSION_LLM_CALLS = 20

/** kv key of the "unattended days" setting (host policy; never in the sim or the command log). */
export const UNATTENDED_DAYS_KEY = 'clock.unattended_days'
/** Plan text key of the site audit's summary (ADR-0070): `title` is the sentence, `brief` the counts as JSON. */
export const SITE_AUDIT_ITEM = 'site:audit'

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

/**
 * The lease notice (`#lease-notice`, `role="alert"`): why this session is
 * read-only, or that another device asked to take over. With `takeOver` it
 * carries the one control that takes the company over here: a reload with
 * `takeover=1`, which restores from the sealed state under a new epoch.
 */
function showLeaseNotice(text: string, takeOver: boolean) {
  let el = document.getElementById('lease-notice')
  if (!el) {
    el = document.createElement('div')
    el.id = 'lease-notice'
    el.setAttribute('role', 'alert')
    el.style.cssText =
      'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:1000;max-width:min(90vw,640px);' +
      'padding:10px 14px;border-radius:8px;background:#fff7e0;color:#3a2a00;border:1px solid #d9b34a;' +
      'font:14px/1.4 system-ui,sans-serif;display:flex;gap:12px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,.25)'
    document.body.append(el)
  }
  el.dataset.kind = takeOver ? 'read-only' : 'handover'
  const message = document.createElement('span')
  message.textContent = takeOver ? `Read-only. ${text}` : text
  el.replaceChildren(message)
  if (!takeOver) return
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Take over here'
  button.style.cssText = 'font:inherit;padding:4px 10px;border-radius:6px;border:1px solid #8a6d1a;background:#fff;cursor:pointer'
  button.addEventListener('click', () => {
    const url = new URL(location.href)
    url.searchParams.set('takeover', '1')
    location.assign(url)
  })
  el.append(button)
}

/** The log is `1..n` without holes; anything else is a damaged store or a broken sync. */
function assertContiguous(commands: LoggedCommand[], where: string) {
  commands.forEach((c, i) => {
    if (c.seq !== i + 1) throw new Error(`${where}: the command log has a gap (command #${i + 1} is missing, found #${c.seq})`)
  })
}

/**
 * The seed the company's sim runs on, as the sim itself reports it
 * (`Sim.seed()`): an unsigned 64-bit integer. The server sends the seed's bits
 * as a JSON number, which may be negative and is a double; this is the one
 * conversion, used for the sim and for the text in snapshot records, so a
 * record always names the seed its world was made with.
 */
const simSeed = (company: Company): bigint => BigInt.asUintN(64, BigInt(company.seed))

/** client-wasm's `Sim` as the restore's sim factory. */
const SIMS: SimFactory<Sim> = {
  fromSeed: (scenario, seed) => Sim.scenario(scenario, seed),
  fromSnapshot: (world) => Sim.from_snapshot(world),
}

/**
 * Restores the company's sim: from this device's store, else from central
 * sync, else a new company. With a snapshot record the sim is rebuilt from
 * the world bytes and only the commands logged after it are replayed
 * (FEAT-060); a legacy checkpoint, or `forceReplay` (`?restore=replay`, the
 * audit path), replays the whole log from the seed. `rebase`
 * (`?restore=rebase`, ADR-0069) replays it without the checkpoint either: a
 * world format change moves every hash, so the old checkpoint cannot be met.
 */
async function restore(
  store: CompanyStore,
  client: CentralClient,
  company: Company,
  opts: { forceReplay?: boolean; rebase?: boolean } = {},
): Promise<{ sim: Sim; info: RestoreInfo; result: ReplayResult; lastSeq: number }> {
  const t0 = performance.now()
  let source: RestoreSource = 'opfs'
  let commands: LoggedCommand[] = (await store.commandsAfter(-1)).map(toLogged)
  const local = await store.latestSnapshot()
  const record = local ? decodeSnapshot(local.bytes) : null
  let cp: Checkpoint | null = record?.checkpoint ?? null
  let world: Uint8Array | null = record?.world ?? null
  if (!commands.length && !cp) {
    const remote = await fetchRemote(client, company.id)
    if (remote) {
      source = 'central'
      commands = remote.commands
      cp = remote.checkpoint
      world = remote.world
      // The store becomes this device's copy of the log; what came from central is sealed already.
      await store.appendCommands(commands.map((c) => ({ seq: c.seq, step: c.step, kind: c.kind, payload: commandBytes(c.json) })))
      await store.setKv(SEALED_SEQ_KEY, String(commands.length ? commands[commands.length - 1].seq : 0))
      await store.setKv(NEXT_SEGMENT_KEY, String(remote.segments))
      if (cp && remote.record) await store.putSnapshot(cp.step, remote.record, cp.hash)
    } else source = 'new'
  }
  // A restore that cannot be trusted stops here (the page shows the error) instead of running on a wrong world.
  assertContiguous(commands, `restore from ${source}`)
  let restored: RestoredSim<Sim>
  try {
    restored = opts.rebase
      ? restoreSim(SIMS, { scenario: SCENARIO, seed: simSeed(company), commands, point: null, world: null })
      : restoreSim(SIMS, { scenario: SCENARIO, seed: simSeed(company), commands, point: cp, world, forceReplay: opts.forceReplay })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // A snapshot of an older sim build: the log can rebuild the company once (ADR-0069).
    const hint = /written by sim build/.test(msg) ? ' Open the game with ?restore=rebase once to rebuild the company from its command log.' : ''
    throw new Error(`restore from ${source}: ${msg}${hint}`)
  }
  const { sim, result } = restored
  const info: RestoreInfo = {
    source,
    step: result.step,
    hash: result.hash,
    snapshot: restored.fromSnapshot,
    replayed: result.applied,
    checkpoint: cp ? { step: cp.step, hash: cp.hash } : null,
    verified: restored.verified,
    ms: Math.round(performance.now() - t0),
  }
  return { sim, info, result, lastSeq: commands.length }
}

/** A positive number of seconds from the URL, in ms; undefined otherwise. */
function secondsParam(params: URLSearchParams, name: string): number | undefined {
  const n = Number(params.get(name))
  return params.has(name) && n > 0 ? n * 1000 : undefined
}

export async function startSession(opts: SessionOptions): Promise<GameSession> {
  const { params } = opts
  const log = opts.log ?? ((line: string) => console.info(`[session] ${line}`))
  const client = opts.client ?? new CentralClient()
  const login = params.get('login') || 'ceo'
  const stage = opts.onStage ?? (() => undefined)

  stage('login')
  const me = await signIn(client, login)
  // Founded with the binding the server's owner configured (G2), never one from the URL;
  // which repository the company writes to is on screen from here on (boot screen, then the HUD).
  const company = await companyFor(client, me, `${login} Dispatch`)
  const binding = siteBindingView(company, me.default_binding)
  showBootBinding(binding)
  hudSite.value = binding
  // One database per company: the command log and checkpoints are the company's.
  stage('store')
  const store = await openCompanyStore({ name: `swarmpress-${company.id}.db` })
  await store.setKv('company.id', company.id)

  // One executor runs a company (ADR-0045). This device takes the lease when
  // it is free, expired, released or its own; another executor's live lease
  // leaves this session read-only until the player takes over explicitly
  // (`takeover=1`, which the notice's button sets).
  stage('lease')
  const takeover = params.get('takeover') === '1'
  // (`as`: these are assigned from callbacks, which narrowing cannot see.)
  let readOnly = null as string | null
  let handoverBy = null as string | null
  // Set once the loop and the event stream exist.
  let halt = null as ((reason: string) => void) | null
  const goReadOnly = (reason: string) => {
    if (readOnly) return
    readOnly = reason
    log(`read-only: ${reason}`)
    halt?.(reason)
    showLeaseNotice(reason, true)
  }
  const lease = new LeaseKeeper(client, company.id, await deviceId(store), {
    mode: takeover ? 'force' : 'acquire',
    onLost: (e) => goReadOnly(`This device no longer runs the company: ${e instanceof Error ? e.message : String(e)}.`),
    onHandoverRequested: (by) => {
      handoverBy = by ?? 'another device'
      log(`handover requested by ${handoverBy}`)
      if (!readOnly) showLeaseNotice(`Another device (${handoverBy}) asked to take over this company.`, false)
    },
  })
  try {
    await lease.start()
  } catch (e) {
    const held = leaseHeld(e)
    if (!held) throw e
    goReadOnly(`${held.holder_kind === 'browser' ? 'Another device' : 'A runner'} (${held.holder}) is running this company.`)
  }
  if (takeover) {
    // The takeover was this page load's decision, not the next reload's.
    const url = new URL(location.href)
    url.searchParams.delete('takeover')
    history.replaceState(null, '', url)
  }

  stage('restore')
  const rebase = params.get('restore') === 'rebase'
  // The latest site audit (ADR-0070) and how to refresh it (set once the loop exists).
  let siteAudit: SiteAudit | null = null
  let auditSite: () => Promise<SiteAudit | null> = async () => null
  let loadSiteModels: () => Promise<void> = async () => undefined
  // The analytics signals' delivery (ADR-0071), set once the loop exists.
  let deliverSignals: () => Promise<void> = async () => undefined
  const { sim, info: restored, result, lastSeq } = await restore(store, client, company, { forceReplay: params.get('restore') === 'replay', rebase })
  log(
    `company ${company.id} restored from ${restored.source} at step ${restored.step} (${restored.snapshot ? 'snapshot + ' : ''}${restored.replayed} commands replayed, ${restored.ms} ms)`,
  )

  stage('orchestrator')
  // The site's knowledge pack (ADR-0061): the store's newest (an earlier
  // session's), then the server's at the base head, before the first
  // standup. A failed fetch keeps the stored pack (site-knowledge.ts).
  const knowledge = new SiteKnowledgeKeeper(readOnly ? null : { knowledge: (etag) => client.knowledge(lease.token, etag) }, store, {
    log,
    onError: opts.onError,
  })
  await knowledge.load()
  if (!readOnly) await knowledge.refresh('start')
  const calls: GatewayCall[] = []
  const gateway = refetchAfterMerge(recordingGateway(centralGateway(client, () => lease.token), calls), knowledge)
  // The model (ADR-0067): the backend is chosen here (`?llm=`, else the company's stored choice,
  // else the hosted GPT-6-Luna through this server); it starts once the clock exists (below).
  // `?llm=fake` is the scripted model; `?llm=gemma` the opt-in local one.
  const models = await openModelRuntime({
    search: location.search,
    companyId: company.id,
    store,
    readOnly: !!readOnly,
    validate: () => loadRustValidator(),
    debug: params.get('llmdebug') === '1',
    hosted: (body, signal) => client.llmGenerate(lease.token, body, signal),
    log: (line) => log(`model: ${line}`),
  })
  // P6: a call past its limit is aborted; the clock stands still while the model is not ready.
  const modelAway = () => models.status().state !== 'ready'
  // `calls` keeps whole prompts (tens of kB each with a real pack): the newest few are enough for diagnostics (W).
  // Standard tier while the clock holds for a due job (the player waits), Flex otherwise (ADR-0067); bound once the clock exists.
  let playerWaits = () => false
  const llm = localLlmBridge(models.llm, {
    stageTimeoutMs: secondsParam(params, 'stagetimeout'),
    paused: modelAway,
    maxCalls: SESSION_LLM_CALLS,
    interactive: () => playerWaits(),
  })
  // The activity record and the chip's "section 3 of 5": progress events plus the bridge's usage (ADR-0058).
  const activity = new ActivityRecorder({ store, companyId: company.id, clock: () => ({ step: Number(sim.step()), day: sim.day(), minute: sim.minute_of_day() }), log })
  llm.onCall = (call) => activity.call(call)
  // Meeting turns (`turn` events, ADR-0062) go to the loop as utterances; set once the loop exists.
  let speak: (e: ProgressEvent) => void = () => undefined
  // Rebound to a new pack at the next job after it changed; refreshes before every standup.
  const orchestrator = new SiteOrchestrator({
    keeper: knowledge,
    // G6: who runs the jobs, as the server itself would name the lease holder.
    site: { ...SITE, ...(lease.current ? { executor: `${lease.current.holder_kind} ${lease.current.holder} epoch ${lease.current.epoch}` } : {}) },
    create: (site) =>
      createOrchestrator({
        store,
        gateway,
        llm,
        site,
        onProgress: (e) => {
          activity.progress(e)
          speak(e)
        },
      }),
    log,
  })
  // The clock's speed paces meeting turns; the clock is made after the loop.
  let clockSpeed = () => 1
  await orchestrator.bind().catch((e) => opts.onError?.(`The orchestrator could not be bound to the site: ${String(e)}`))
  // One per `dataSource()` call: main.ts makes one per page load, so this does not grow with play.
  const sources = new Set<SessionDataSource>()
  const loop = new OrchestrationLoop({
    sim,
    store,
    companyId: company.id,
    // G6: a publish job carries the CEO who approved it (the answered ticket, the signed-in player).
    orchestrator: withApprover(orchestrator, { inboxJson: () => sim.inbox_json(), ceoName: () => me.user.name || me.user.login }),
    codec: { jobsFromEffects, outcomesForSim },
    paused: modelAway,
    ...(secondsParam(params, 'jobtimeout') ? { jobTimeoutMs: secondsParam(params, 'jobtimeout') } : {}),
    log,
    onError: opts.onError,
    onPlanText: () => sources.forEach((s) => s.planTextChanged()),
    // A published item is the moment worth keeping: seal the log and a checkpoint to central sync (docs/mvp.md).
    onLanded: () => void checkpoint(),
    // The standup's context (ADR-0062): the sim's work in progress, titles from the plan store,
    // the measured model minutes per article from the activity record, and today's date.
    standupContext: async ({ project }) => {
      // The newest jobs' rows only (W): the whole activity record grows with every job.
      const [plan, page] = await Promise.all([store.plan(company.id), activity.flush().then(() => store.activityPage(company.id, { limit: STANDUP_ACTIVITY_JOBS }))])
      const titles = Object.fromEntries(Object.entries(plan.items).map(([id, i]) => [id, i.title]))
      return standupContext(sim.plan_json(), project, { now: new Date(), titles, minutesPerArticle: minutesPerArticle(page.rows) })
    },
    // The editorial board's context (ADR-0069): the standup's, with the planned items' titles from the board's briefs,
    // and the site audit's stale articles and broken pages for the board to plan care (ADR-0070).
    boardContext: async ({ project }) => {
      const [plan, page] = await Promise.all([store.plan(company.id), activity.flush().then(() => store.activityPage(company.id, { limit: STANDUP_ACTIVITY_JOBS }))])
      const titles = Object.fromEntries(Object.entries(plan.items).map(([id, i]) => [id, i.title]))
      const ctx = boardContext(sim.plan_json(), project, { now: new Date(), titles, minutesPerArticle: minutesPerArticle(page.rows) })
      const audit = siteAudit ?? (await auditSite().catch(() => null))
      // Articles whose 14-day follow-up scored 3 or less (ADR-0071): refresh candidates, by brief ref.
      const items = (JSON.parse(sim.plan_json()) as { items: { project: string; performance?: number | null; briefRefText?: string | null }[] }).items
      const underperforming = items
        .filter((i) => i.project === project && i.performance != null && i.performance <= 3 && i.briefRefText)
        .map((i) => ({ brief_ref: i.briefRefText!, title: '', score: i.performance! }))
      return { ...ctx, site: { stale: audit?.stale ?? [], broken: audit?.broken_pages ?? [], underperforming, untranslated: audit?.untranslated ?? [] } }
    },
    speechSpeed: () => clockSpeed(),
    // The data scientist's numbers (ADR-0071): a follow-up's page since 14 days, the KPI report's two weeks.
    analysisContext: async ({ kind, project, jobJson }) => {
      if (kind === 'kpi-report') {
        const two = await client.analytics(project, 14).catch(() => null)
        if (!two) return null
        const sum = (ds: typeof two.days) => ds.reduce((t, d) => ({ sessions: t.sessions + d.sessions, visitors: t.visitors + d.visitors, pageviews: t.pageviews + d.pageviews }), { sessions: 0, visitors: 0, pageviews: 0 })
        const week = await client.analytics(project, 7).catch(() => null)
        return week ? { week: { totals: week.totals, topPages: week.topPages, languages: week.languages, sources: week.sources }, previous: { totals: sum(two.days.slice(0, 7)) } } : null
      }
      const job = JSON.parse(jobJson) as { brief_ref?: string | number | null }
      const rec = job.brief_ref != null ? await store.getBrief(company.id, String(job.brief_ref)) : null
      const brief = rec ? (JSON.parse(rec) as { target?: string; brief?: { slug?: string } }) : null
      const file = brief?.target ?? (brief?.brief?.slug ? `content/pages/blog/${brief.brief.slug}.json` : null)
      const slug = file?.split('/').pop()?.replace(/\.json$/, '')
      if (!slug) return { page: null }
      const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
      const page = await client.analyticsPage(lease.token, `/en/blog/${slug}`, from).catch(() => null)
      return { page }
    },
  })
  speak = (e) => loop.turnFinished(e)
  loop.seed(result.completedJobs, result.landed, lastSeq)
  await loop.loadPendingDeploys()
  // A read-only session shows the restored world and runs nothing.
  if (readOnly) loop.halt(readOnly)
  // Jobs requested before the reload that the sim still waits for run again
  // (or reuse their stored outcome, if `run()` had finished).
  else for (const e of result.effects) void loop.enqueueEffects(e, { pendingOnly: true })

  // Fast-forward (dev and e2e): deterministic stepping, no commands.
  const ff = readOnly ? null : parseClock(params.get('ff'))
  let fastForwarded = 0
  if (ff != null) {
    const n = stepsUntil(sim, ff)
    fastForwarded = n
    for (let left = n; left > 0; left -= Math.min(left, 1000)) {
      sim.advance(Math.min(left, 1000))
      loop.afterAdvance()
    }
    if (n) log(`fast-forwarded ${n} steps to ${params.get('ff')}`)
  }

  const received: CentralEvent[] = []
  const deployRefetch = refetchOnDeploy(knowledge, () => !readOnly)
  const events = new EventStream(client, company.id, store, async (ev) => {
    received.push(ev)
    if (received.length > KEEP_EVENTS) received.splice(0, received.length - KEEP_EVENTS)
    // DeployLanded publishes the item; DeployFailed blocks it with a ticket (ADR-0059).
    await loop.deployEvent(ev)
    // The site changed (a merge of this or another device): its pack too.
    if (ev.kind === 'DeployLanded' && typeof ev.payload.work_item === 'string') deployRefetch(ev)
    // The inbox keeps old lease events; only the one that names this
    // session's own epoch concerns it (`revoked` checks).
    if (ev.kind === 'LeaseRevoked' && typeof ev.payload.epoch === 'number') {
      lease.revoked(ev.payload.epoch, typeof ev.payload.by === 'string' ? ev.payload.by : undefined)
    }
  })
  // From here on losing the lease halts the session (ADR-0045 decision 10):
  // no job, no command, no clock, no seal, no event intake.
  halt = (reason) => {
    loop.halt(reason)
    events.stop()
  }
  if (readOnly) halt(readOnly)
  else await events.start()

  const sync = new SyncUploader(client, store, company.id)

  let sealed: CheckpointResult | null = null
  // Step, hash and log position are read in one synchronous turn: commands
  // applied later are not part of this checkpoint.
  const capture = () => ({ step: Number(sim.step()), hash: sim.hash().toString(), lastSeq: loop.lastSeq })
  // A checkpoint is a snapshot: the world bytes are taken in the same turn as
  // the step, hash and log position they belong to (FEAT-060).
  const captureWorld = () => ({ ...capture(), world: sim.snapshot() })
  const checkpointLocal = async (at = captureWorld()) => {
    await loop.flush()
    if (loop.halted) throw new Error(`no checkpoint: ${loop.halted}`)
    const { world, ...point } = at
    // The store keeps the newest three (company-store.ts `putSnapshot`).
    await store.putSnapshot(at.step, encodeSnapshot({ scenario: SCENARIO, seed: simSeed(company).toString(), ...point }, world), at.hash)
    return at
  }
  async function checkpoint(): Promise<CheckpointResult> {
    const at = captureWorld()
    let local = false
    let central: SealResult | null = null
    // Only the lease holder writes: a read-only session seals nothing.
    if (readOnly) return { step: at.step, hash: at.hash, local, central }
    try {
      await checkpointLocal(at)
      local = true
      central = await sync.seal({ scenario: SCENARIO, seed: simSeed(company).toString(), ...at })
    } catch (e) {
      loop.errors.push(`checkpoint failed: ${String(e)}`)
      console.error(`[session] checkpoint failed: ${String(e)}`)
    }
    const r: CheckpointResult = { step: at.step, hash: at.hash, local, central }
    if (central && (!sealed || r.step >= sealed.step)) sealed = r
    return r
  }

  // The sweeper (W): stage rows no job can re-run or adopt any more go, at boot and every game day.
  const sweep = () => {
    if (readOnly || loop.halted) return
    sweepStages(store, company.id, sim.plan_json())
      .then((jobs) => jobs.length && log(`swept the stage rows of ${jobs.length} finished jobs`))
      .catch((e) => log(`stage sweep failed: ${String(e)}`))
  }
  sweep()

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
      sweep()
      void auditSite().catch((e) => log(`site audit failed: ${String(e)}`))
      void loadSiteModels().catch((e) => log(`site models failed: ${String(e)}`))
      void deliverSignals().catch((e) => log(`analytics signals failed: ${String(e)}`))
  // The analytics signals (ADR-0071): each pending row logged once, oldest first, on a game day
  // counted back from today, then acknowledged.
  deliverSignals = async () => {
    if (readOnly || loop.halted) return
    const rows = await client.analyticsSignals(lease.token)
    if (!rows.length) return
    const today = sim.day()
    const acked: { project_key: string; day: string }[] = []
    rows.forEach((r, i) => {
      const day = Math.max(0, today - (rows.length - 1 - i))
      // The digest is a u64: written into the JSON as its digits, never through a JS number.
      const cmd = `{"AnalyticsSignals":{"project":${JSON.stringify(r.project)},"day":${day},"sessions":${r.sessions},"visitors":${r.visitors},"pageviews":${r.pageviews},"engagement_pm":${r.engagement_pm},"top_pages_digest":${/^\d+$/.test(r.top_pages_digest) ? r.top_pages_digest : 0}}}`
      const res = loop.apply(cmd)
      if (res.ok) acked.push({ project_key: r.project_key, day: r.day })
      else log(`analytics signal of ${r.day} not applied: ${res.reason}`)
    })
    if (acked.length) await client.ackAnalyticsSignals(lease.token, acked)
    log(`analytics: ${acked.length} of ${rows.length} signals logged`)
  }
  void deliverSignals().catch((e) => log(`analytics signals failed: ${String(e)}`))
    } else if (!localBusy) {
      localBusy = true
      void checkpointLocal()
        .catch((e) => console.error(`[session] local checkpoint failed: ${String(e)}`))
        .finally(() => (localBusy = false))
    }
  }
  window.addEventListener('pagehide', () => {
    void checkpoint()
  })
  // The site audit (ADR-0070): fetched at boot and at each new game day; its signals enter the sim as a
  // logged command when they changed, its summary is plan text for the Plan panel, its findings feed the board.
  auditSite = async () => {
    if (readOnly || loop.halted) return siteAudit
    const a = await client.siteAudit(lease.token)
    siteAudit = a
    // Logged only when the sim holds other signals: the same on every device that restores the log.
    const held = (JSON.parse(sim.plan_json()) as { site?: { livePages: number; languages: number; brokenLinks: number; mediaCount: number } | null }).site
    const same =
      held != null &&
      held.livePages === a.signals.live_pages &&
      held.languages === a.signals.languages &&
      held.brokenLinks === a.signals.broken_links &&
      held.mediaCount === a.signals.media_count
    if (!same) {
      const r = loop.apply(JSON.stringify({ SiteSignals: a.signals }))
      if (!r.ok) log(`site signals not applied: ${r.reason}`)
    }
    const summary = `${a.stale_count} stale articles (over ${a.stale_days} days), ${a.broken_pages.length} pages with broken links (${a.broken_links} links), ${a.orphan_count} orphan pages, ${a.policy_count} linking-policy findings`
    await store.setItemText(company.id, SITE_AUDIT_ITEM, summary, JSON.stringify({ commit: a.commit, stale: a.stale_count, broken: a.broken_links, orphans: a.orphan_count, policy: a.policy_count }))
    sources.forEach((s) => s.planTextChanged())
    log(`site audit at ${a.commit.slice(0, 7)}: ${summary}`)
    return a
  }
  void auditSite().catch((e) => log(`site audit failed: ${String(e)}`))
  // The site's blueprint, tools and brick town (ADR-0072): read at boot and with each audit, cached per commit by the server.
  loadSiteModels = async () => {
    if (readOnly || loop.halted) return
    const m = await client.siteBlueprint(lease.token)
    sources.forEach((s) => s.setSiteModels(m))
    log(`site models at ${m.commit.slice(0, 7)}: ${m.source} blueprint, ${m.blueprint.page_types.length} page types, ${m.tools.length} tools, ${m.issues.length} issues`)
  }
  void loadSiteModels().catch((e) => log(`site models failed: ${String(e)}`))
  // The weekly editorial board plans the week (ADR-0069): on once, as a logged command, so a
  // replay of an older log holds no board before it.
  if (!readOnly && !loop.halted && params.get('board') !== 'off') {
    const org = JSON.parse(sim.org_json()) as { policies?: { editorialBoard?: boolean; analytics?: boolean; distribution?: boolean } }
    if (org.policies?.editorialBoard === false) {
      const r = loop.apply(JSON.stringify({ SetPolicy: { EditorialBoard: true } }))
      log(r.ok ? 'the weekly editorial board is on' : `the editorial board could not be turned on: ${r.reason}`)
    }
    // The analytics loop's jobs (ADR-0071): the data scientist's follow-ups and the weekly report.
    if (org.policies?.analytics === false) {
      const r = loop.apply(JSON.stringify({ SetPolicy: { Analytics: true } }))
      log(r.ok ? 'the analytics loop is on' : `the analytics loop could not be turned on: ${r.reason}`)
    }
    // Promotion copy when a page goes live (ADR-0073): written for the CEO, never sent.
    if (org.policies?.distribution === false) {
      const r = loop.apply(JSON.stringify({ SetPolicy: { Distribution: true } }))
      log(r.ok ? 'promotion copy is on' : `promotion copy could not be turned on: ${r.reason}`)
    }
  }
  // A rebased company seals its new world at once: the old snapshot is of another sim build.
  if (rebase && !readOnly) {
    void checkpoint().then((r) => log(`rebased: a fresh snapshot at step ${r.step} (local ${r.local}, central ${r.central ? 'sealed' : 'not sealed'})`))
    const url = new URL(location.href)
    url.searchParams.delete('restore')
    history.replaceState(null, '', url)
  }

  // The clock (ADR-0060). The model runtime reports through `setModelStatus`:
  // the scripted `?llm=fake` model is ready at once; a real backend holds the
  // clock until its startup's qualification turn passed (session/model-runtime.ts).
  let model: ModelStatus = models.status()
  const speed = Number(params.get('speed') ?? 1)
  // The "unattended days" setting is host policy: it lives in the kv, not in the sim.
  let savedDays = cleanDays(Number((await store.getKv(UNATTENDED_DAYS_KEY)) ?? 0))
  const clock = new ClockDriver(
    // Per slice: the loop's boundary (outcomes and landed deploys), then single steps with the effects drained after each.
    sessionClockHost(sim, loop, { modelReady: () => model.state === 'ready', onStep: onClock }),
    {
      speed,
      unattendedDays: savedDays,
      onChange: (state) => {
        if (state.unattendedDays === savedDays) return
        savedDays = state.unattendedDays
        // A setting, kept across reloads; a failed write only loses the setting.
        store.setKv(UNATTENDED_DAYS_KEY, String(savedDays)).catch((e) => log(`unattended days not saved: ${String(e)}`))
      },
    },
  )
  const heldBy = () => {
    const job = loop.heldFor
    // "Giulia · draft · section 3 of 5" while a stage runs (counts, never a percentage).
    return job ? heldByText(job, activity.label(job.job_id)) : null
  }
  const status = () => clockStatus({ hold: clock.hold, phase: clock.state.phase, halted: loop.halted, leaseLost: readOnly, model, heldBy: heldBy() })
  const setModelStatus = (next: ModelStatus) => {
    model = { ...next }
    clock.refresh()
  }
  clock.refresh()
  clockSpeed = () => clock.state.speed
  playerWaits = () => clock.hold === 'due'
  // The model starts in the background: the office opens at once, the card and the chip show the stages.
  models.onChange(() => setModelStatus(models.status()))
  mountModelCard(models)

  // The story director (ADR-0074): ten-minute chapters of studio life as remarks, on the hosted
  // model by default (`?story=on|off` overrides); only running clock time counts.
  const storyParam = params.get('story')
  const storyOn = !readOnly && storyParam !== 'off' && (storyParam === 'on' || models.info().backend === 'luna')
  if (storyOn) {
    const director = new StoryDirector({
      ask: (messages, schema) => models.llm.structured(messages, schema, { maxRepairs: 1 }),
      context: async () =>
        storyContext({
          render: JSON.parse(sim.render_state_json()) as RenderState,
          plan: JSON.parse(sim.plan_json()),
          text: await store.plan(company.id),
          brand: SITE.brand_name,
        }),
      apply: (json) => loop.apply(json),
      nextRemark: () => (JSON.parse(sim.render_state_json()) as RenderState).nextRemark,
      getKv: (k) => store.getKv(k),
      setKv: (k, v) => store.setKv(k, v),
      deleteKv: (k) => store.deleteKv(k),
      running: () => !loop.halted && clock.hold === null && clock.state.phase !== 'night' && model.state === 'ready',
      durationMs: (chars) => utteranceMs(chars, clock.state.speed),
      log: (line) => log(line),
    })
    let last = performance.now()
    setInterval(() => {
      const now = performance.now()
      const seconds = (now - last) / 1000
      last = now
      void director.tick(seconds).catch((e) => log(`story: ${String(e)}`))
    }, 1000)
    log('the story director is on')
  }
  void models.start()

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
      epoch: lease.current?.epoch ?? null,
      leaseToken: lease.current?.token ?? null,
      events: events.transport,
      restored,
      fastForwarded,
    }),
    state: () => ({
      ...capture(),
      day: sim.day(),
      minute: sim.minute_of_day(),
      paused: clock.state.paused,
      jobs: loop.jobs.map((j) => ({ ...j })),
      queued: loop.queued,
      holdClock: loop.holdClock,
      nextDueStep: loop.nextDueStep,
      status: status(),
      speed: clock.state.speed,
      unattendedDays: clock.state.unattendedDays,
      resting: clock.resting,
      model: { ...model },
      halted: loop.halted,
      readOnly,
      handoverRequestedBy: handoverBy,
      sealed: sealed ? { ...sealed } : null,
      pendingCommands: loop.pendingCommands,
      pendingDeploys: loop.pendingDeploys,
      logged: loop.logged,
      errors: [...loop.errors],
      knowledge: { ...knowledge.status(), bound: orchestrator.commit, binding: orchestrator.summary() },
      progress: activity.current(),
    }),
    plan: () => JSON.parse(sim.plan_json()),
    items,
    planText: () => store.plan(company.id),
    commandLog: async () => {
      await loop.flush()
      return (await store.commandsAfter(-1)).map((c) => ({ seq: c.seq, step: c.step, kind: c.kind }))
    },
    activity: async () => {
      await activity.flush()
      return store.activity(company.id)
    },
    gateway: () => calls.map((c) => ({ ...c })),
    events: () => [...received],
    pause: () => clock.pause(),
    resume: () => clock.resume(),
    setSpeed: (n) => clock.setSpeed(n),
    setUnattendedDays: (n) => clock.setUnattendedDays(n),
    startNextDay: () => clock.startNextDay(),
    setModelStatus,
    llm: () => models.info(),
    reloadModel: () => models.reload(),
    destroyModelDevice: () => models.destroyDevice(),
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
    clock,
    status,
    setModelStatus,
    models,
    speech: {
      // The loop knows which transcript row each utterance it applied spoke; after a reload the seqs coincide.
      text: async (meeting, seq, job) => {
        if (meeting === REMARK) return store.getKv(storyLineKey(seq))
        const at = loop.spokenAt(meeting, seq) ?? (job != null ? { job, seq } : null)
        return at ? ((await store.transcriptLine(company.id, at.job, at.seq))?.text ?? null) : null
      },
      durationMs: (chars) => utteranceMs(chars, clock.state.speed),
    },
    dataSource: () => {
      // The Inbox's banned-phrase check reads the site's own style guide (the pack's, when the source is made).
      const site = { style_guide: knowledge.current?.styleGuide ?? undefined }
      // The Activity panel and the HUD's Now strip (U4): rows from the store; the job in flight from progress events, while the loop still runs it.
      const recorder = {
        live: () => activity.live().filter((j) => loop.jobs.some((r) => r.job_id === j.jobId && r.state === 'running')),
        version: () => activity.written,
      }
      const s = new SessionDataSource(orgApi, { ...companyStoreOptions(store, company, site, recorder), changeKey: () => `${sim.step()}:${loop.lastSeq}` })
      sources.add(s)
      return s
    },
  }
}
