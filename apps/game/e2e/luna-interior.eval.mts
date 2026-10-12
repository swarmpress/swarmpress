// The office designer (FEAT-084, ADR-0087 decision 6) end to end on the real model: an
// evaluation driver, not a test (Playwright's testMatch only takes *.spec.ts).
//
// It founds a fresh company through the dev login, buys land and adds an empty archive and
// newsroom (the fixture world of crates/office-designer/tests/common), hires the office
// designer through the MissingRole ticket, commissions one room after the other through the
// overlay store's `commissionInterior` (the Build section's "Ask the office designer"), waits
// for each plan or the job's failure, approves one plan's Build (economic mode) and checks the
// sim builds its items, then writes a JSON record and, with `--bench`, a cockpit.benchmark.v1
// document.
//
// Only the office designer's calls (and the model's warm-up and qualification turns) reach the
// model: every other staff call is answered here with an empty text, so the rest of the company
// fails its jobs at no cost and the budget is the designer's. Calls past `--max-calls` get an
// empty answer too (the job then fails; the record says the budget ran out).
//
// Needs the central server and the Vite dev server (proxying /api to it):
//   cd apps/game && bun e2e/luna-interior.eval.mts [--llm fake] [--runs 2] [--max-calls 40] \
//     [--out <dir>] [--bench ../../artifacts/bench/office-designer-luna.json] [--base http://localhost:5173] \
//     [--merge <an earlier run's record>] [--unrecorded-calls N] [--login name] [--speed 20] [--brief-minutes 15]
// `--llm fake` is a dry run on the scripted model (no model calls).
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { chromium, type Page, type Route } from '@playwright/test'
import { webgpuLaunch } from './webgpu'

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : dflt
}
const LLM = arg('llm', 'hosted') // `fake`: the scripted model (a dry run of the driver, no model calls)
const RUNS = Number(arg('runs', '1'))
const MAX_CALLS = Number(arg('max-calls', '40'))
const BASE = arg('base', 'http://localhost:5173')
const OUT = arg('out', '.')
const BENCH = arg('bench', '')
const LOGIN = arg('login', `lunainterior${Date.now().toString(36)}`)
const BRIEF_MIN = Number(arg('brief-minutes', '15'))
const SPEED = Number(arg('speed', '20'))
const SCREENSHOT = join(OUT, 'luna-interior-room.png')
// An earlier run's record (`luna-interior-<llm>-<login>.json`): its briefs and calls count in the bench document too.
const MERGE = arg('merge', '')
// Model calls an aborted run spent that no record holds (they count in the bench document's total).
const UNRECORDED_CALLS = Number(arg('unrecorded-calls', '0'))
mkdirSync(OUT, { recursive: true })

type Brief = { workstations: number; meeting_seats: number; storage: number; writing_surfaces: number; coffee: number; plants: number; max_cost_cents?: number | null }
const B = (b: Partial<Brief>): Brief => ({ workstations: 0, meeting_seats: 0, storage: 0, writing_surfaces: 0, coffee: 0, plants: 0, ...b })

/** The rooms, by the sim's layout: `kind` and (for the two built here) the rect. */
interface Case {
  name: string
  room: { kind: string; x?: number; z?: number }
  words: string
  brief: Brief
}
const CASES: Case[] = [
  { name: 'newsroom', room: { kind: 'newsroom', x: 26, z: 8 }, words: 'A newsroom for three writers: three workstations with good light from the window, and a plant.', brief: B({ workstations: 3, plants: 1 }) },
  { name: 'meeting-room', room: { kind: 'meeting-room' }, words: 'Our meeting room for eight: two writing surfaces for the board meetings and some green.', brief: B({ meeting_seats: 8, writing_surfaces: 2, plants: 2 }) },
  { name: 'kitchen', room: { kind: 'kitchen' }, words: 'The kitchen: proper coffee and a couple of plants.', brief: B({ meeting_seats: 6, coffee: 1, plants: 2 }) },
  { name: 'archive', room: { kind: 'archive', x: 24, z: 0 }, words: 'The archive for our print issues: five shelves, and a plant by the window.', brief: B({ storage: 5, plants: 1 }) },
  // The SEO lab has one workstation: two more and a plant cost €1,450 at the sim's prices, inside €1,500 only without extra light.
  { name: 'tight-budget', room: { kind: 'seo-lab' }, words: 'Two more workstations in the SEO lab and a plant, on a tight budget: at most €1,500.', brief: B({ workstations: 3, plants: 1, max_cost_cents: 150_000 }) },
]

// ------------------------------------------------------------------ the model's calls

interface Call {
  n: number
  what: 'designer' | 'startup' | 'refused'
  stage: string
  t: number
  status: number
  ms: number
  input: number
  cached: number
  output: number
  reasoning: number
  costMicros: number
  finish: string
  /** A fix call: the checker's issues it was asked to repair (from its prompt). */
  issues?: string[]
}
const calls: Call[] = []
let forwarded = 0
let budgetHit = false
const t0 = Date.now()
const ts = () => `${String(Math.floor((Date.now() - t0) / 60000)).padStart(3, '0')}m${String(Math.floor(((Date.now() - t0) / 1000) % 60)).padStart(2, '0')}`
const log = (s: string) => console.log(`${ts()} ${s}`)

const emptyAnswer = (route: Route, why: string) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job_id: `eval-${why}`, text: '', finish: 'stop', model: 'eval-refused', service_tier: 'flex', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }, cost_micros: 0, duration_ms: 0, searches: 0, sources: [], citations: [] }),
  })

async function onLlm(route: Route) {
  const body = (route.request().postDataJSON() ?? {}) as { messages?: { role: string; content: string }[] }
  const msgs = body.messages ?? []
  const user = msgs.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
  const designer = /## Task: office layout/.test(user)
  const startup = !designer && (/Good morning\. Reply with one word\./.test(user) || /Who speaks next\? Answer \{"next": "giulia"/.test(user))
  const stage = designer ? (/## Task: office layout fix/.test(user) ? 'fix' : 'layout') : startup ? 'startup' : 'other'
  if (!designer && !startup) {
    calls.push({ n: calls.length + 1, what: 'refused', stage, t: Date.now() - t0, status: 200, ms: 0, input: 0, cached: 0, output: 0, reasoning: 0, costMicros: 0, finish: 'refused' })
    return emptyAnswer(route, 'other-staff')
  }
  if (forwarded >= MAX_CALLS) {
    budgetHit = true
    log(`budget: call ${forwarded + 1} (${stage}) refused, ${MAX_CALLS} calls spent`)
    calls.push({ n: calls.length + 1, what: 'refused', stage: `${stage}:over-budget`, t: Date.now() - t0, status: 200, ms: 0, input: 0, cached: 0, output: 0, reasoning: 0, costMicros: 0, finish: 'over-budget' })
    return emptyAnswer(route, 'over-budget')
  }
  forwarded++
  const started = Date.now()
  const res = await route.fetch({ timeout: 600_000 }).catch((e: unknown) => e as Error)
  if (res instanceof Error) {
    calls.push({ n: calls.length + 1, what: designer ? 'designer' : 'startup', stage, t: started - t0, status: 0, ms: Date.now() - started, input: 0, cached: 0, output: 0, reasoning: 0, costMicros: 0, finish: `network: ${res.message}` })
    return route.abort()
  }
  const text = await res.text()
  let j: any = null
  try {
    j = JSON.parse(text)
  } catch {
    /* an error page */
  }
  const u = j?.usage ?? {}
  const issues = stage === 'fix' ? (user.split('The plan has these issues:\n')[1] ?? '').split('\n\n')[0]!.split('\n').filter(Boolean) : undefined
  const c: Call = {
    ...(issues ? { issues } : {}),
    n: calls.length + 1,
    what: designer ? 'designer' : 'startup',
    stage,
    t: started - t0,
    status: res.status(),
    ms: Date.now() - started,
    input: u.input_tokens ?? 0,
    cached: u.cached_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    reasoning: u.reasoning_tokens ?? 0,
    costMicros: j?.cost_micros ?? 0,
    finish: j?.finish ?? `http ${res.status()}: ${text.slice(0, 200)}`,
  }
  calls.push(c)
  log(`model call #${forwarded} ${stage}: ${c.status} ${c.ms} ms, ${c.input} in (${c.cached} cached), ${c.output} out (${c.reasoning} reasoning), ${c.finish}${issues ? ` | fixing: ${issues.join(' / ')}` : ''}`)
  return route.fulfill({ response: res, body: text })
}

// ------------------------------------------------------------------ the page

const browser = await chromium.launch(webgpuLaunch)
const page: Page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => log(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  const t = m.text()
  if (/\[session\]/.test(t) && /interior|designer|room plan|build|error|halt|lease/i.test(t)) log(t.slice(0, 400))
  else if (m.type() === 'error' && !/Failed to load resource/.test(t)) log(`[console] ${t.slice(0, 300)}`)
})
await page.route('**/api/llm/generate', onLlm)
const url = `${BASE}/?central=1&login=${LOGIN}&quality=low&ff=09:00&board=off${LLM === 'hosted' ? '' : `&llm=${LLM}`}`
log(`open ${url}`)
await page.goto(url)
await page.waitForFunction(() => !!(window as any).__swarmpress?.session, null, { timeout: 180_000 })
log('session up')

/** Waits for `fn` to return a truthy value, polling every `every` ms; null after `ms`. */
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms: number, every = 3000): Promise<T | null> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v as T
    if (Date.now() > end) return null
    await page.waitForTimeout(every)
  }
}

// The model: ready, or started ("Start the model").
const ready = await until(async () => {
  const btn = page.getByRole('button', { name: 'Start the model' })
  if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => undefined)
  const m = await page.evaluate(() => (window as any).__swarmpress.session.state().model)
  return m.state === 'ready' ? m : null
}, 5 * 60_000)
if (!ready) throw new Error('the model never became ready')
log(`model ready: ${JSON.stringify(ready)}`)
await page.evaluate((speed) => {
  const s = (window as any).__swarmpress.session
  s.setUnattendedDays(7)
  s.setSpeed(speed)
}, SPEED)

/** Applies a JSON command through the overlay's source (logged like the CEO's). */
async function apply(cmd: unknown): Promise<{ ok: boolean; reason?: string }> {
  return page.evaluate(async (json) => {
    const h = (window as any).__swarmpress
    const r = await h.overlay.source.apply(json)
    await h.overlay.refresh?.()
    return r
  }, JSON.stringify(cmd))
}

// The fixture world's extra rooms: land to the east, an empty archive and an empty newsroom.
for (const cmd of [
  { BuyFloorSpace: { side: 'East', tiles: 8 } },
  { PlaceRoom: { kind: 'Archive', rect: { x: 24, z: 0, w: 4, d: 6 }, floor: 0, doors: [{ side: 'South', at: 2 }], windows: [{ side: 'North', at_mm: 1000, width_mm: 2000 }] } },
  { PlaceRoom: { kind: 'Newsroom', rect: { x: 26, z: 8, w: 6, d: 6 }, floor: 0, doors: [{ side: 'North', at: 1 }], windows: [{ side: 'East', at_mm: 1000, width_mm: 4000 }] } },
]) {
  const r = await apply(cmd)
  log(`${Object.keys(cmd)[0]}: ${r.ok ? 'ok' : r.reason}`)
  if (!r.ok) throw new Error(`setup refused: ${r.reason}`)
}

interface LayoutRoom {
  id: string
  kind: string
  x: number
  z: number
  w: number
  d: number
}
const layoutRooms = async (): Promise<LayoutRoom[]> => page.evaluate(() => JSON.parse((window as any).__swarmpress.sim.layout_json()).rooms)
const roomFor = (rooms: LayoutRoom[], c: Case) =>
  rooms.find((r) => r.kind === c.room.kind && (c.room.x === undefined || (Math.round(r.x) === c.room.x && Math.round(r.z) === c.room.z))) ??
  rooms.find((r) => r.kind === c.room.kind)

const planItems = async (): Promise<{ id: string; status: string; kind?: string }[]> =>
  page.evaluate(() => JSON.parse((window as any).__swarmpress.sim.plan_json()).items)
const openTickets = async (): Promise<any[]> => page.evaluate(() => JSON.parse((window as any).__swarmpress.sim.inbox_json()).tickets.filter((t: any) => t.status === 'open'))
const answer = async (ticket: string, option: string) => apply({ AnswerTicket: { ticket, option } })

async function commission(c: Case, roomId: string): Promise<{ ok: boolean; reason?: string; item?: string }> {
  const before = new Set((await planItems()).map((i) => i.id))
  const r = await page.evaluate(
    (input) => (window as any).__swarmpress.overlay.commissionInterior(input),
    { room: roomId, words: c.words, brief: c.brief },
  )
  if (!r.ok) return r
  const item = (await planItems()).find((i) => !before.has(i.id))?.id
  return { ok: true, item }
}

async function hireDesigner(): Promise<string> {
  const has = async () => page.evaluate(() => JSON.parse((window as any).__swarmpress.sim.org_json()).staff.find((s: any) => s.role === 'office-designer')?.id ?? null)
  const already = await has()
  if (already) return already
  const t = await until(async () => (await openTickets()).find((x) => x.kind === 'missing-role'), 60_000, 1000)
  if (!t) throw new Error('no MissingRole ticket for the office designer')
  const a = await answer(t.id, 'arrange-hiring')
  log(`MissingRole ${t.id} → arrange-hiring: ${a.ok ? 'ok' : a.reason}`)
  // Which candidate is an office designer with a catalogue persona: each hire tried on a copy of the
  // world (a snapshot), never on the company. (ArrangeHiring can add a nameless `persona-0` designer
  // when the catalogue's only one is already on today's list; hiring that one fails every job.)
  const pool = await page.evaluate(() => {
    const sim = (window as any).__swarmpress.sim
    const Sim = sim.constructor
    const out: { id: string; role: string; persona: string }[] = []
    const before = new Set(JSON.parse(sim.org_json()).staff.map((s: any) => s.id))
    for (let n = 1; n < 400; n++) {
      const id = `candidate-${n}`
      const cmd = JSON.stringify({ Hire: { candidate: id } })
      if (sim.validate_command_json(cmd)) continue
      const copy = Sim.from_snapshot(sim.snapshot())
      copy.apply_command_json(cmd)
      const hired = JSON.parse(copy.org_json()).staff.find((s: any) => !before.has(s.id))
      copy.free?.()
      if (hired) out.push({ id, role: hired.role, persona: hired.persona })
    }
    return out
  })
  log(`candidates: ${pool.map((c) => `${c.id} ${c.role} ${c.persona}`).join(', ')}`)
  const designers = pool.filter((c) => c.role === 'office-designer')
  const cand = (designers.find((c) => !/^persona-0$/.test(c.persona)) ?? designers[designers.length - 1])?.id ?? null
  if (!cand) throw new Error('no candidate to hire')
  const h = await apply({ Hire: { candidate: cand } })
  log(`Hire ${cand}: ${h.ok ? 'ok' : h.reason}`)
  const id = await has()
  if (!id) throw new Error(`the hire did not bring an office designer (${cand})`)
  return id
}

// ------------------------------------------------------------------ one brief

interface Result {
  case: string
  run: number
  room: string
  roomKind: string
  item: string | null
  brief: Brief
  outcome: 'plan' | 'failed' | 'timeout' | 'refused'
  reason: string | null
  failurePost: string | null
  repairs: number | null
  issues: { code: string; severity: string; message: string }[]
  failureErrors: string[]
  items: number
  designs: Record<string, number>
  costCents: number | null
  budgetCents: number | null
  withinBudget: boolean | null
  fulfilment: Record<string, { wanted: number; have: number }>
  briefMet: boolean | null
  calls: number
  layoutCalls: number
  fixCalls: number
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  costMicros: number
  modelMs: number
  wallMs: number
  ticket: string | null
  /** What the room had before (designs). */
  existing: Record<string, number>
  /** The checker's issues each repair round was asked to fix. */
  repairIssues: string[][]
  /** Which company (login) the brief ran in. */
  login?: string
}

const SCREENS = new Set(['monitor', 'color-monitor'])
function fulfilment(brief: Brief, existing: any[], items: { design: string; on_desk: any }[]) {
  const all = [...existing.map((e) => ({ design: e.design, on: e.on_desk ? { existing: e.on_desk } : null, id: e.id })), ...items.map((i, n) => ({ design: i.design, on: i.on_desk, id: `planned-${n}` }))]
  const count = (f: (d: string) => boolean) => all.filter((x) => f(x.design)).length
  const desks = all.filter((x) => x.design === 'desk')
  const ws = desks.filter((d) =>
    all.some((x) => SCREENS.has(x.design) && x.on && ((x.on.existing && x.on.existing === d.id) || (x.on.planned !== undefined && `planned-${x.on.planned}` === d.id))),
  ).length
  const out: Record<string, { wanted: number; have: number }> = {}
  const add = (k: keyof Brief, have: number) => {
    const wanted = Number(brief[k] ?? 0)
    if (wanted > 0) out[k] = { wanted, have }
  }
  add('workstations', ws)
  add('storage', count((d) => d === 'archive-shelf'))
  add('writing_surfaces', count((d) => d === 'whiteboard' || d === 'mood-board-wall'))
  add('coffee', count((d) => d === 'coffee-machine'))
  add('plants', count((d) => d === 'plant'))
  return out
}

async function runCase(c: Case, run: number): Promise<Result> {
  const rooms = await layoutRooms()
  const room = roomFor(rooms, c)
  const base: Result = {
    case: c.name, run, room: room?.id ?? '?', roomKind: c.room.kind, item: null, brief: c.brief, outcome: 'refused', reason: null, failurePost: null, repairs: null, issues: [], failureErrors: [],
    items: 0, designs: {}, costCents: null, budgetCents: c.brief.max_cost_cents ?? null, withinBudget: null, fulfilment: {}, briefMet: null,
    calls: 0, layoutCalls: 0, fixCalls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costMicros: 0, modelMs: 0, wallMs: 0, ticket: null, existing: {}, repairIssues: [],
  }
  if (!room) return { ...base, reason: `no ${c.room.kind} room` }
  const callsBefore = calls.length
  const started = Date.now()
  const r = await commission(c, room.id)
  log(`${c.name}#${run}: commission ${room.id}: ${r.ok ? `ok (${r.item})` : r.reason}`)
  if (!r.ok || !r.item) return { ...base, reason: r.reason ?? 'no item' }
  const item = r.item
  if (!(await page.evaluate(() => JSON.parse((window as any).__swarmpress.sim.org_json()).staff.some((s: any) => s.role === 'office-designer')))) await hireDesigner()
  // The room as the designer sees it (its existing equipment), while the item is open.
  const ctx = await until(async () => page.evaluate((i) => (window as any).__swarmpress.sim.interior_context_json(i) ?? null, item), 30_000, 500)
  const existing: any[] = ctx ? (JSON.parse(ctx as string).room?.equipment ?? []) : []
  for (const e of existing) base.existing[e.design] = (base.existing[e.design] ?? 0) + 1
  let lastLine = ''
  const done = await until(
    async () => {
      const s = await page.evaluate(
        async ({ item }) => {
          const h = (window as any).__swarmpress
          const st = h.session.state()
          const it = JSON.parse(h.sim.plan_json()).items.find((x: any) => x.id === item)
          const tickets = JSON.parse(h.sim.inbox_json()).tickets.filter((t: any) => t.status === 'open' && t.workItem === item)
          const posts = ((await h.session.planText()).posts[item] ?? []) as any[]
          return {
            status: it?.status ?? 'gone',
            jobs: st.jobs.filter((j: any) => j.work_item === item || j.workItem === item).map((j: any) => `${j.kind}#${j.job_id}:${j.state}`).join(' '),
            progress: st.progress ? `${st.progress.stage ?? ''}${st.progress.index ?? ''}/${st.progress.state ?? ''}` : '',
            tickets: tickets.map((t: any) => ({ id: t.id, kind: t.kind })),
            artifact: posts.find((p) => p.type === 'artifact' && p.payload?.room_plan) ?? null,
            failed: posts.find((p) => p.payload?.room_plan === 'failed') ?? null,
            last: posts.length ? `${posts[posts.length - 1].type}: ${String(posts[posts.length - 1].text).slice(0, 600)}` : null,
            clock: `d${st.day} ${Math.floor(st.minute / 60)}:${String(st.minute % 60).padStart(2, '0')}`,
          }
        },
        { item },
      )
      const line = `${s.status} ${s.jobs} ${s.progress} ${s.tickets.map((t: any) => t.kind).join(',')}`
      if (line !== lastLine) {
        lastLine = line
        log(`${c.name}#${run} ${s.clock} ${line}`)
      }
      if (s.failed || s.status === 'blocked' || s.status === 'cancelled') return { ...s, kind: 'failed' as const }
      if (s.artifact && s.tickets.some((t: any) => t.kind === 'build-approval')) return { ...s, kind: 'plan' as const }
      return null
    },
    BRIEF_MIN * 60_000,
    2000,
  )
  const mine = calls.slice(callsBefore).filter((x) => x.what === 'designer')
  const usage = {
    calls: mine.length,
    layoutCalls: mine.filter((x) => x.stage === 'layout').length,
    fixCalls: mine.filter((x) => x.stage === 'fix').length,
    inputTokens: mine.reduce((a, x) => a + x.input, 0),
    cachedTokens: mine.reduce((a, x) => a + x.cached, 0),
    outputTokens: mine.reduce((a, x) => a + x.output, 0),
    reasoningTokens: mine.reduce((a, x) => a + x.reasoning, 0),
    costMicros: mine.reduce((a, x) => a + x.costMicros, 0),
    modelMs: mine.reduce((a, x) => a + x.ms, 0),
    wallMs: Date.now() - started,
    repairIssues: mine.filter((x) => x.issues).map((x) => x.issues!),
  }
  if (!done) return { ...base, item, outcome: 'timeout', reason: `no plan or failure within ${BRIEF_MIN} minutes`, ...usage }
  if (done.kind === 'failed') {
    const p = done.failed
    return {
      ...base, item, outcome: 'failed', ...usage,
      reason: p ? String(p.text).split('\n')[0] : `the item is ${done.status}; last post: ${done.last}`,
      failurePost: p ? String(p.text) : null,
      failureErrors: (p?.payload?.errors ?? []) as string[],
      ticket: done.tickets[0]?.id ?? null,
    }
  }
  const plan = await until(async () => page.evaluate((i) => (window as any).__swarmpress.overlay.roomPlanOf(i) ?? null, item), 30_000, 500)
  const meta = done.artifact.payload.room_plan
  const items = (plan?.items ?? []) as { design: string; on_desk: any }[]
  const designs: Record<string, number> = {}
  for (const i of items) designs[i.design] = (designs[i.design] ?? 0) + 1
  const ful = fulfilment(c.brief, existing, items)
  const cost = plan?.cost_cents ?? meta.cost_cents ?? null
  return {
    ...base, item, outcome: 'plan', ...usage,
    repairs: plan?.repairs ?? meta.repairs ?? null,
    issues: (plan?.issues ?? []).map((i: any) => ({ code: i.code, severity: i.severity, message: i.message })),
    items: items.length,
    designs,
    costCents: cost,
    withinBudget: c.brief.max_cost_cents ? cost !== null && cost <= c.brief.max_cost_cents : null,
    fulfilment: ful,
    briefMet: Object.values(ful).every((f) => f.have >= f.wanted),
    ticket: done.tickets.find((t: any) => t.kind === 'build-approval')?.id ?? null,
  }
}

// ------------------------------------------------------------------ the runs

const results: Result[] = []
let construction: Record<string, unknown> | null = null
const roomEquipment = async (roomId: string): Promise<number> =>
  page.evaluate((id) => {
    const r = JSON.parse((window as any).__swarmpress.sim.layout_json()).rooms.find((x: any) => x.id === id)
    if (!r) return -1
    return (r.desks?.length ?? 0) + (r.props?.length ?? 0) + (r.ceilingLights?.length ?? 0)
  }, roomId)

let stopped: string | null = null
for (let run = 1; run <= RUNS && !stopped; run++) {
  for (const c of CASES) {
    if (budgetHit) {
      stopped = `the budget of ${MAX_CALLS} model calls is spent`
      break
    }
    // A room built in this session already has what its brief asks for: not asked again.
    if (construction && (construction as { case?: string }).case === c.name) {
      log(`${c.name}#${run}: skipped (built in run ${run - 1 || 1})`)
      continue
    }
    const res = await runCase(c, run)
    results.push(res)
    log(`${c.name}#${run}: ${res.outcome}${res.reason ? ` (${res.reason})` : ''}; repairs ${res.repairs}; items ${res.items}; cost ${res.costCents}; calls ${res.calls}; ${Math.round(res.wallMs / 1000)} s`)
    const errorsInRow = calls.slice(-3).filter((x) => x.status === 503 || x.status === 429).length
    if (errorsInRow >= 3) {
      stopped = 'the server answered 503/429 three times in a row'
      break
    }
    if (res.outcome === 'timeout') {
      stopped = `${c.name} hung past ${BRIEF_MIN} minutes`
      break
    }
    if (res.outcome === 'failed' && res.item) {
      // The failed item's escalation: kill it, so the room can be asked for again.
      const esc = (await openTickets()).find((t) => t.workItem === res.item && t.options?.includes('kill'))
      if (esc) log(`${esc.kind} ${esc.id} → kill: ${(await answer(esc.id, 'kill')).ok ? 'ok' : 'refused'}`)
    }
    if (res.outcome !== 'plan' || !res.ticket) continue
    // The first plan is built (economic: Build at the plan's price); the others are declined, to free the room.
    if (!construction) {
      const before = await roomEquipment(res.room)
      const cash0 = await page.evaluate(() => Number((window as any).__swarmpress.sim.cash_cents()))
      const a = await answer(res.ticket, 'build')
      log(`BuildApproval ${res.ticket} → build: ${a.ok ? 'ok' : a.reason}`)
      const tb = Date.now()
      const built = await until(
        async () => {
          const it = (await planItems()).find((i) => i.id === res.item)
          const n = await roomEquipment(res.room)
          return it && ['published', 'blocked', 'cancelled'].includes(it.status) ? { status: it.status, n } : null
        },
        15 * 60_000,
        2000,
      )
      const after = await roomEquipment(res.room)
      const cash1 = await page.evaluate(() => Number((window as any).__swarmpress.sim.cash_cents()))
      construction = {
        case: res.case,
        room: res.room,
        item: res.item,
        planned: res.items,
        equipmentBefore: before,
        equipmentAfter: after,
        added: after - before,
        status: built?.status ?? 'timeout',
        cashSpentCents: cash0 - cash1,
        planCostCents: res.costCents,
        wallMs: Date.now() - tb,
      }
      log(`construction: ${JSON.stringify(construction)}`)
      // The finished room, from above: the Build section's view.
      await page.waitForTimeout(3000)
      await page.screenshot({ path: SCREENSHOT })
      log(`screenshot ${SCREENSHOT}`)
    } else {
      const a = await answer(res.ticket, 'decline')
      log(`BuildApproval ${res.ticket} → decline: ${a.ok ? 'ok' : a.reason}`)
    }
  }
}

// ------------------------------------------------------------------ the record

const designerCalls = calls.filter((x) => x.what === 'designer')
const summary = {
  login: LOGIN,
  llm: LLM,
  base: BASE,
  model: LLM === 'hosted' ? 'gpt-6-luna' : LLM,
  runs: RUNS,
  maxCalls: MAX_CALLS,
  stopped,
  budgetHit,
  modelCalls: forwarded,
  designerCalls: designerCalls.length,
  startupCalls: calls.filter((x) => x.what === 'startup').length,
  refusedOtherStaffCalls: calls.filter((x) => x.what === 'refused' && x.stage === 'other').length,
  wallMs: Date.now() - t0,
  construction,
  results,
  calls,
}
const recordPath = join(OUT, `luna-interior-${LLM}-${LOGIN}.json`)
writeFileSync(recordPath, JSON.stringify(summary, null, 2))
log(`record ${recordPath}`)

if (BENCH) {
  const git = (cmd: string) => {
    try {
      return execSync(cmd, { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  const prior = MERGE ? (JSON.parse(readFileSync(MERGE, 'utf8')) as typeof summary) : null
  const priorRuns = prior ? Math.max(0, ...prior.results.map((r) => r.run)) : 0
  const all: Result[] = [...(prior?.results.map((r) => ({ login: prior.login, ...r })) ?? []), ...results.map((r) => ({ ...r, login: LOGIN, run: r.run + priorRuns }))]
  const allCalls = [...(prior?.calls ?? []), ...calls]
  const designerCalls = allCalls.filter((x) => x.what === 'designer')
  const modelCalls = (prior?.modelCalls ?? 0) + forwarded + UNRECORDED_CALLS
  const done = all.filter((r) => r.outcome !== 'refused')
  const plans = done.filter((r) => r.outcome === 'plan')
  const met = plans.filter((r) => r.briefMet)
  const budgeted = plans.filter((r) => r.withinBudget !== null)
  const sum = (f: (r: Result) => number) => done.reduce((a, r) => a + f(r), 0)
  const m = (name: string, subject: string, unit: string, value: number, direction: string, determinism = 'nondeterministic') => ({ name, subject, unit, value, determinism, direction })
  const metrics = [
    m('briefs', 'office-designer', 'briefs', done.length, 'informational'),
    m('plans', 'office-designer', 'briefs', plans.length, 'higher_is_better'),
    m('plans_pct', 'office-designer', '%', done.length ? Math.round((plans.length * 1000) / done.length) / 10 : 0, 'higher_is_better'),
    m('failed', 'office-designer', 'briefs', done.filter((r) => r.outcome === 'failed').length, 'lower_is_better'),
    m('brief_met', 'office-designer', 'briefs', met.length, 'higher_is_better'),
    m('within_budget', 'office-designer', 'briefs', budgeted.filter((r) => r.withinBudget).length, 'higher_is_better'),
    m('repair_rounds_total', 'office-designer', 'rounds', plans.reduce((a, r) => a + (r.repairs ?? 0), 0), 'lower_is_better'),
    m('model_calls', 'office-designer', 'calls', designerCalls.length, 'lower_is_better'),
    m('model_calls_total', 'eval', 'calls', modelCalls, 'informational'),
    m('input_tokens', 'office-designer', 'tokens', sum((r) => r.inputTokens), 'lower_is_better'),
    m('output_tokens', 'office-designer', 'tokens', sum((r) => r.outputTokens), 'lower_is_better'),
    m('cost', 'office-designer', 'usd', Math.round(sum((r) => r.costMicros)) / 1e6, 'lower_is_better'),
    m('wall_time_mean', 'office-designer', 's', done.length ? Math.round(sum((r) => r.wallMs) / done.length / 100) / 10 : 0, 'lower_is_better'),
    ...done.map((r) => m(`wall_time`, `${r.case}#${r.run}`, 's', Math.round(r.wallMs / 100) / 10, 'lower_is_better')),
    ...done.map((r) => m(`plan`, `${r.case}#${r.run}`, 'bool', r.outcome === 'plan' ? 1 : 0, 'higher_is_better')),
    ...plans.map((r) => m(`repair_rounds`, `${r.case}#${r.run}`, 'rounds', r.repairs ?? 0, 'lower_is_better')),
    ...plans.map((r) => m(`items`, `${r.case}#${r.run}`, 'items', r.items, 'informational')),
    ...plans.map((r) => m(`cost_cents`, `${r.case}#${r.run}`, 'cents', r.costCents ?? 0, 'informational')),
    ...done.map((r) => m(`calls`, `${r.case}#${r.run}`, 'calls', r.calls, 'lower_is_better')),
    ...[prior?.construction, construction].filter(Boolean).map((c: any, i) => m('construction_items_built', `${c.case}#${i + 1}`, 'items', Number(c.added), 'higher_is_better')),
  ]
  const doc = {
    schema: 'cockpit.benchmark.v1',
    name: 'office-designer-luna',
    feature_ids: ['FEAT-084'],
    component: 'agents',
    provenance: {
      commit: git('git rev-parse HEAD'),
      branch: git('git rev-parse --abbrev-ref HEAD'),
      dirty: git('git status --porcelain') !== '',
      generated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      tool: { name: 'luna-interior.eval.mts', version: '1' },
    },
    build: { profile: 'dev' },
    machine: { os: os.platform() === 'darwin' ? 'macos' : os.platform(), arch: os.arch() === 'arm64' ? 'aarch64' : os.arch(), cpus: os.cpus().length, cpu_model: os.cpus()[0]?.model ?? '', runner: 'local' },
    workload: {
      backend: LLM,
      model: summary.model,
      briefs: CASES.map((c) => c.name),
      runs: RUNS + priorRuns,
      companies: [...(prior ? [prior.login] : []), LOGIN],
      // The cap this run had plus what the earlier ones spent: the whole eval's budget.
      max_calls: MAX_CALLS + (prior?.modelCalls ?? 0) + UNRECORDED_CALLS,
      model_calls: modelCalls,
      startup_calls: allCalls.filter((x) => x.what === 'startup').length,
      unrecorded_calls: UNRECORDED_CALLS,
      stopped: [prior?.stopped, stopped].filter(Boolean).join('; ') || null,
      construction: [...(prior?.construction ? [{ login: prior.login, ...prior.construction }] : []), ...(construction ? [{ login: LOGIN, ...construction }] : [])],
      complete: !stopped && !prior?.stopped,
      results: all.map(({ failurePost: _f, ...r }) => r),
    },
    metrics,
  }
  writeFileSync(BENCH, JSON.stringify(doc, null, 2) + '\n')
  log(`bench ${BENCH}`)
}
await browser.close()
