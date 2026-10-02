/**
 * The game session (docs/mvp.md, FEAT-014/FEAT-015): what the real game page
 * runs with `?central=1`. Without it the page stays the offline demo
 * (`Sim.demo`, no store, no network), which the smoke and visual suites use.
 *
 *   dev login → company (created on first login) → company store (OPFS) → lease
 *     (ADR-0045: `acquire`; another executor's live lease leaves this session
 *     read-only, and a session that loses the lease halts)
 *   → restore: the store's snapshot + the log after it, else central sync, else a new company
 *   → orchestration loop (sim effects → orchestrator-wasm → commands) + events
 *   → checkpoints: locally every game hour, sealed to central sync every game
 *     day and on `pagehide`
 *
 * URL parameters (besides main.ts's):
 *   central=1        turn the session on
 *   login=NAME       dev login (default `ceo`; needs SWARMPRESS_DEV_AUTH=1 on the server)
 *   llm=fake         the scripted MVP model (src/llm/mvp-script.ts)
 *   store=…          the store engine (src/store)
 *   ff=HH:MM         fast-forward on boot to that time of the current game day
 *   takeover=1       take the company over from the executor that holds it (this
 *                    page load only; the parameter is removed from the URL)
 *   restore=replay   ignore the snapshot and replay the whole log from the seed (the audit path)
 */
import styleGuide from '../../../../crates/agents/tests/fixtures/style-guide.json'
import { Sim } from 'swarm-wasm'
import { parseClock, restoreSim, stepsUntil, type LoggedCommand, type ReplayResult, type RestoredSim, type SimFactory } from '../catchup/replay'
import { FakeLlm } from '../llm/fake-llm'
import { CentralClient, centralGateway, EventStream, leaseHeld, LeaseKeeper, type CentralEvent, type Company, type OrchestratorGateway } from '../net/central'
import { OrchestrationLoop, type JobRecord } from '../orchestration/loop'
import { createOrchestrator, jobsFromEffects, llmFromQuery, localLlmBridge, outcomesForSim, type SiteBindingJson } from '../orchestrator'
import { openCompanyStore, type CompanyStore, type Plan } from '../store'
import { commandBytes, decodeSnapshot, encodeSnapshot, type Checkpoint } from '../sync/segments'
import { fetchRemote, NEXT_SEGMENT_KEY, SEALED_SEQ_KEY, SyncUploader, toLogged, type SealResult } from '../sync/uploader'
import type { DataTopic } from '../ui/data-source'
import { companyStoreOptions, WasmDataSource, type SimOrgApi } from '../ui/wasm-source'

export const SCENARIO = 'cinqueterre'

/** The cinqueterre.travel site binding (the style guide is the agents crate's fixture until sites carry their own). */
const SITE: SiteBindingJson = {
  site_id: 'cinqueterre.travel',
  brand_name: 'Cinque Terre Dispatch',
  language: 'en',
  style_guide: styleGuide,
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
    /** The clock is held for a standup job close to the sim's meeting timeout, or because the loop halted. */
    holdClock: boolean
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
  }
  /** `Sim.plan_json()` (the skeleton) parsed. */
  plan(): unknown
  /** Work item id → status, from the sim. */
  items(): Record<string, string>
  /** The plan text in the store (posts of the work-item thread). */
  planText(): Promise<Plan>
  /** The command log in the store (seq, step and kind of every logged command). */
  commandLog(): Promise<{ seq: number; step: number; kind: string }[]>
  gateway(): GatewayCall[]
  events(): CentralEvent[]
  /** Pauses the sim clock (jobs keep running; outcomes still apply at boundaries). Time only: nothing else changes. */
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
 * audit path), replays the whole log from the seed.
 */
async function restore(
  store: CompanyStore,
  client: CentralClient,
  company: Company,
  opts: { forceReplay?: boolean } = {},
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
    restored = restoreSim(SIMS, { scenario: SCENARIO, seed: BigInt(company.seed), commands, point: cp, world, forceReplay: opts.forceReplay })
  } catch (e) {
    throw new Error(`restore from ${source}: ${e instanceof Error ? e.message : String(e)}`)
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
  const store = await openCompanyStore({ name: `swarmpress-${company.id}.db` })
  await store.setKv('company.id', company.id)

  // One executor runs a company (ADR-0045). This device takes the lease when
  // it is free, expired, released or its own; another executor's live lease
  // leaves this session read-only until the player takes over explicitly
  // (`takeover=1`, which the notice's button sets).
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

  const { sim, info: restored, result, lastSeq } = await restore(store, client, company, { forceReplay: params.get('restore') === 'replay' })
  log(
    `company ${company.id} restored from ${restored.source} at step ${restored.step} (${restored.snapshot ? 'snapshot + ' : ''}${restored.replayed} commands replayed, ${restored.ms} ms)`,
  )

  const calls: GatewayCall[] = []
  const orchestrator = await createOrchestrator({
    store,
    gateway: recordingGateway(
      centralGateway(client, () => lease.token),
      calls,
    ),
    llm: localLlmBridge(llmFromQuery(location.search, unwiredLlm)),
    site: SITE,
  })
  const sources = new Set<SessionDataSource>()
  const loop = new OrchestrationLoop({
    sim,
    store,
    companyId: company.id,
    orchestrator,
    codec: { jobsFromEffects, outcomesForSim },
    log,
    onPlanText: () => sources.forEach((s) => s.planTextChanged()),
    // A published item is the moment worth keeping: seal the log and a checkpoint to central sync (docs/mvp.md).
    onLanded: () => void checkpoint(),
  })
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
  const events = new EventStream(client, company.id, store, async (ev) => {
    received.push(ev)
    if (ev.kind === 'DeployLanded' && typeof ev.payload.work_item === 'string') {
      await loop.deployLanded(ev.payload.work_item, {
        mergedSha: typeof ev.payload.merged_sha === 'string' ? ev.payload.merged_sha : undefined,
        source: typeof ev.payload.source === 'string' ? ev.payload.source : undefined,
      })
    }
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
  let paused = false

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
    await store.putSnapshot(at.step, encodeSnapshot({ scenario: SCENARIO, seed: String(company.seed), ...point }, world), at.hash)
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
      central = await sync.seal({ scenario: SCENARIO, seed: String(company.seed), ...at })
    } catch (e) {
      loop.errors.push(`checkpoint failed: ${String(e)}`)
      console.error(`[session] checkpoint failed: ${String(e)}`)
    }
    const r: CheckpointResult = { step: at.step, hash: at.hash, local, central }
    if (central && (!sealed || r.step >= sealed.step)) sealed = r
    return r
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
      void checkpointLocal()
        .catch((e) => console.error(`[session] local checkpoint failed: ${String(e)}`))
        .finally(() => (localBusy = false))
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
      paused,
      jobs: loop.jobs.map((j) => ({ ...j })),
      queued: loop.queued,
      holdClock: loop.holdClock,
      halted: loop.halted,
      readOnly,
      handoverRequestedBy: handoverBy,
      sealed: sealed ? { ...sealed } : null,
      pendingCommands: loop.pendingCommands,
      pendingDeploys: loop.pendingDeploys,
      logged: loop.logged,
      errors: [...loop.errors],
    }),
    plan: () => JSON.parse(sim.plan_json()),
    items,
    planText: () => store.plan(company.id),
    commandLog: async () => {
      await loop.flush()
      return (await store.commandsAfter(-1)).map((c) => ({ seq: c.seq, step: c.step, kind: c.kind }))
    },
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
      return paused || loop.holdClock
    },
    boundary: () => loop.boundary(),
    afterAdvance: () => {
      loop.afterAdvance()
      onClock()
    },
    dataSource: () => {
      const s = new SessionDataSource(orgApi, { ...companyStoreOptions(store, company), changeKey: () => `${sim.step()}:${loop.lastSeq}` })
      sources.add(s)
      return s
    },
  }
}
