/**
 * Test harness for the browser runtime (orchestrator.html; built only with
 * `vite build --mode harness`): CompanyStore + CentralClient +
 * orchestrator-wasm + the `?llm=fake` model, exposed as `window.__harness`
 * for e2e/orchestrator.spec.ts. Until the sim drives jobs, the harness plays
 * the sim's side of the MVP loop (runMvpLoop).
 */
import styleGuide from '../../../../crates/agents/tests/fixtures/style-guide.json'
import { CentralClient, centralGateway, EventStream, LeaseKeeper, type CentralEvent, type Company } from '../net/central'
import {
  createOrchestrator,
  jobsFromEffects,
  llmFromQuery,
  localLlmBridge,
  outcomesForSim,
  runMvpLoop,
  type JobRequest,
  type Outcome,
  type SiteBindingJson,
} from '../orchestrator'
import { openCompanyStore, type CompanyStore, type Plan } from '../store'

export interface HarnessInfo {
  engine: string
  persistent: boolean
  fallbackReason: string | null
  crossOriginIsolated: boolean
  companyId: string | null
}

export interface LoopReport {
  jobs: string[]
  scores: number[]
  briefRef: string
  mergedSha: string
  deployLanded: boolean
  postTypes: string[]
  posts: { type: string; author: string; to?: string; verdict?: string }[]
  title: string
}

const SITE: SiteBindingJson = {
  site_id: 'cinqueterre.travel',
  brand_name: 'Cinque Terre Dispatch',
  language: 'en',
  style_guide: styleGuide,
  quality_bar: 7,
  // The central server reports the deploy (SIMPRESS_SIMULATE_DEPLOY or the webhook).
  simulate_deploy: false,
  standup_max_turns: 4,
}

const statusEl = document.getElementById('status')!
const logEl = document.getElementById('log')!
const log = (line: string) => {
  logEl.textContent += `${line}\n`
}

const client = new CentralClient()
let store: CompanyStore
let company: Company | null = null
let lease: LeaseKeeper | null = null
let stream: EventStream | null = null
const received: CentralEvent[] = []
const waiters: (() => void)[] = []

function info(): HarnessInfo {
  return {
    engine: store.engine,
    persistent: store.persistent,
    fallbackReason: store.fallbackReason,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    companyId: company?.id ?? null,
  }
}

async function deviceId(): Promise<string> {
  const have = await store.getKv('device.id')
  if (have) return have
  const id = `dev-${crypto.randomUUID()}`
  await store.setKv('device.id', id)
  return id
}

async function connect(login: string): Promise<{ companyId: string; leaseId: string }> {
  await client.devLogin(login)
  company = (await client.myCompany()) ?? (await client.createCompany({ name: `${login} Dispatch` }))
  await store.setKv('company.id', company.id)
  lease = new LeaseKeeper(client, company.id, await deviceId(), { force: true, onLost: (e) => log(`lease lost: ${e}`) })
  const l = await lease.start()
  stream = new EventStream(client, company.id, store, async (ev) => {
    received.push(ev)
    log(`event #${ev.seq} ${ev.kind} ${JSON.stringify(ev.payload)}`)
    for (const w of waiters.splice(0)) w()
  })
  await stream.start()
  log(`signed in as ${login}; company ${company.id}; lease ${l.lease_id}; events via ${stream.transport}`)
  return { companyId: company.id, leaseId: l.lease_id }
}

async function runLoop(): Promise<LoopReport> {
  if (!company || !lease) throw new Error('connect first')
  const keeper = lease
  const orch = await createOrchestrator({ store, gateway: centralGateway(client, () => keeper.leaseId), llm: fakeLlm(), site: SITE })
  const res = await runMvpLoop(orch, {
    company: company.id,
    onStep: (s) => log(`${s.job.kind} r${s.job.revision} → ${JSON.stringify(s.outcomes)}`),
  })
  const reviewScores = res.steps
    .filter((s) => s.job.kind === 'review')
    .map((s) => (s.outcomes[0] as Extract<Outcome, { JobCompleted: unknown }>).JobCompleted.digest.score)
  const plan = await store.plan(company.id)
  const posts = plan.posts[res.workItem] ?? []
  return {
    jobs: res.steps.map((s) => `${s.job.kind}:${s.job.revision}`),
    scores: reviewScores,
    briefRef: res.briefRef,
    mergedSha: res.mergedSha,
    deployLanded: res.steps.some((s) => s.outcomes.some((o) => 'DeployLanded' in o)),
    postTypes: posts.map((p) => p.type),
    posts: posts.map((p) => ({
      type: p.type,
      author: p.author,
      to: p.to,
      verdict: (p.payload as { verdict?: string } | null)?.verdict,
    })),
    title: plan.items[res.workItem]?.title ?? '',
  }
}

export interface SimLoopReport {
  jobs: string[]
  /** Staff roles each job carried (the sim staffs only who does the work). */
  staff: string[][]
  statusBefore: string
  statusAfter: string
  feed: { kind: string; workItem: string }[]
  postTypes: string[]
  logged: number
  minute: number
}

function fakeLlm() {
  return localLlmBridge(
    llmFromQuery(location.search, () => {
      throw new Error('the harness runs with ?llm=fake')
    }),
  )
}

/**
 * The MVP loop driven by the sim (client-wasm): `Sim.scenario('cinqueterre')`
 * steps until its effects request jobs; each runs through orchestrator-wasm
 * and its outcomes go back as server commands (and into the command log).
 * The deploy is the server's: DeployLanded arrives through the events API
 * and is applied to the sim, which publishes the item.
 */
async function runSimLoop(): Promise<SimLoopReport> {
  if (!company || !lease) throw new Error('connect first')
  const keeper = lease
  const companyId = company.id
  const { default: initSim, Sim } = await import('swarm-wasm')
  await initSim()
  const sim = Sim.scenario('cinqueterre', BigInt(company.seed))
  const orch = await createOrchestrator({ store, gateway: centralGateway(client, () => keeper.leaseId), llm: fakeLlm(), site: SITE })
  const enc = new TextEncoder()
  const report: SimLoopReport = { jobs: [], staff: [], statusBefore: '', statusAfter: '', feed: [], postTypes: [], logged: 0, minute: 0 }
  const apply = async (cmd: string) => {
    sim.apply_command_json(cmd)
    await store.appendCommands([{ step: Number(sim.step()), kind: Object.keys(JSON.parse(cmd))[0], payload: enc.encode(cmd) }])
    report.logged++
  }
  const item = () => (JSON.parse(sim.plan_json()).items as { id: string; status: string }[]).find((i) => i.id === 'work-item-1')
  let published = false
  for (let i = 0; i < 2000 && !published; i++) {
    sim.advance(10)
    for (const jobJson of await jobsFromEffects(sim.drain_effects_json(), companyId)) {
      const job = JSON.parse(jobJson) as JobRequest
      report.jobs.push(`${job.kind}:${job.revision}`)
      report.staff.push(job.staff.map((s) => s.role))
      const out = await orch.run(jobJson)
      log(`sim ${sim.minute_of_day()}: ${job.kind} r${job.revision} → ${out}`)
      for (const cmd of await outcomesForSim(out)) await apply(cmd)
      if (job.kind === 'publish') {
        const ev = await waitForEvent('DeployLanded', 'work-item-1', 30_000)
        // The deploy can land before the sim's publish phase has run its
        // course (the item is `approved` until then): hold the event and apply
        // it at the first step boundary where the sim accepts it.
        const cmd = JSON.stringify({ DeployLanded: { work_item: ev.payload.work_item } })
        for (let k = 0; k < 1000 && sim.validate_command_json(cmd) !== undefined; k++) sim.advance(10)
        report.statusBefore = item()?.status ?? ''
        await apply(cmd)
        sim.advance(1)
        report.statusAfter = item()?.status ?? ''
        published = true
      }
    }
  }
  const plan = JSON.parse(sim.plan_json()) as { feed: { kind: string; workItem: string }[] }
  report.feed = plan.feed.map((f) => ({ kind: f.kind, workItem: f.workItem }))
  report.postTypes = ((await store.plan(companyId)).posts['work-item-1'] ?? []).map((p) => p.type)
  report.minute = sim.minute_of_day()
  sim.free()
  return report
}

async function waitForEvent(kind: string, workItem: string, timeoutMs = 30_000): Promise<CentralEvent> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const hit = received.find((e) => e.kind === kind && e.payload.work_item === workItem)
    if (hit) return hit
    if (Date.now() > deadline) throw new Error(`no ${kind} for ${workItem} within ${timeoutMs} ms`)
    await new Promise<void>((r) => {
      waiters.push(r)
      setTimeout(r, 500)
    })
  }
}

/** The plan of the company remembered in the store (works offline, after a reload). */
async function plan(): Promise<{ companyId: string | null; plan: Plan | null; cursor: string | null }> {
  const id = await store.getKv('company.id')
  return {
    companyId: id,
    plan: id ? await store.plan(id) : null,
    cursor: id ? await store.getKv(`events.cursor.${id}`) : null,
  }
}

/** Log segment + snapshot round trip through the central sync API and the store. */
async function syncRoundTrip(): Promise<{ segmentStatus: number; segmentBack: number[]; snapshotStep: number; snapshotBack: number[] }> {
  if (!company) throw new Error('connect first')
  const payload = new Uint8Array([7, 1, 2])
  const [seq] = await store.appendCommands([{ step: 120, kind: 'Harness', payload }])
  const cmds = await store.commandsAfter(0)
  const segment = new Uint8Array(cmds.flatMap((c) => [c.seq, ...c.payload]))
  const put = await client.putLogSegment(company.id, 0, segment)
  const back = await client.getLogSegment(company.id, 0)
  await store.putSnapshot(120, new Uint8Array([seq, 42]), 'harness')
  const snap = (await store.latestSnapshot())!
  await client.putSnapshot(company.id, snap.step, snap.bytes)
  const remote = (await client.getSnapshot(company.id))!
  return { segmentStatus: put.status, segmentBack: Array.from(back ?? []), snapshotStep: remote.step, snapshotBack: Array.from(remote.bytes) }
}

async function disconnect(): Promise<void> {
  stream?.stop()
  await lease?.stop()
}

declare global {
  interface Window {
    __harness: {
      ready: Promise<HarnessInfo>
      info: typeof info
      connect: typeof connect
      runLoop: typeof runLoop
      runSimLoop: typeof runSimLoop
      waitForEvent: typeof waitForEvent
      events: () => CentralEvent[]
      plan: typeof plan
      syncRoundTrip: typeof syncRoundTrip
      disconnect: typeof disconnect
    }
  }
}

const ready = openCompanyStore({ name: 'simpress-harness.db' }).then((s) => {
  store = s
  const i = info()
  statusEl.textContent = JSON.stringify(i, null, 2)
  return i
})
ready.catch((e) => {
  statusEl.textContent = `store failed: ${e instanceof Error ? e.stack : String(e)}`
})

window.__harness = {
  ready,
  info,
  connect,
  runLoop,
  runSimLoop,
  waitForEvent,
  events: () => [...received],
  plan,
  syncRoundTrip,
  disconnect,
}
