import init, { Sim, version } from 'swarm-wasm'
import { createEngine } from './render/engine'
import { formatClock } from './render/daylight'
import { QUALITY, type Quality } from './render/postfx'
import { createGameScene } from './render/scene'
import { ClockDriver, clockStatus, type ClockHost } from './session/clock-driver'
import type { GameSession } from './session/session'
import { startTickTimer } from './session/tick-timer'
import type { BuildingLayout, RenderState } from './state/render-state'
import { DEMO_STAGES, mountBootScreen, SESSION_STAGES, type BootScreen } from './ui/boot-screen'
import { hudNotify, mountHud } from './ui/hud'
import { mountOverlay, selectDataSource } from './ui/mount'

/**
 * URL parameters (also used by the e2e and visual tests):
 *   renderer=webgl     force the WebGL2 fallback
 *   quality=low|medium|high
 *   t=HH:MM            run the sim to this time of day and freeze it (deterministic screenshots)
 *   speed=N            sim steps per 100 ms of real time (fast-forward), default 1 = real time;
 *                      the HUD's speed buttons change it while the page runs
 *   facing=0..3        camera angle
 *   seed=N             sim seed, default 42
 *   tz=Area/City       HQ timezone for the real-time wall clocks, default Europe/Rome
 *   ui=mock            CEO overlay on the fixture data source (also mounts it on t= pages)
 *   central=1          the MVP loop: dev login, company store, central server, orchestrator
 *                      (src/session/session.ts; also login=, llm=fake, store=, ff=HH:MM)
 * With t=, the loop stops once the scene is ready and 20 frames are drawn
 * (`__swarmpress.still()` turns true) so screenshots are stable and cheap.
 *
 * The clock (ADR-0060, src/session/clock-driver.ts): wall time is clamped
 * before it becomes sim steps, so a tab that was hidden never bursts; a
 * session's clock also holds while a job is due and rests at night. The HUD
 * shows its state. Frozen pages (t=) have no clock and no clock HUD.
 */

/** If the WebGPU device dies before this many frames, reload on WebGL2. */
const WEBGPU_WATCHDOG_FRAMES = 60

async function main(params: URLSearchParams, boot: BootScreen) {
  boot.stage('wasm')
  await init()
  const quality = (params.get('quality') as Quality) || 'high'
  const frozen = params.get('t')
  const speed = Math.max(1, Number(params.get('speed') ?? 1))
  const seed = BigInt(params.get('seed') ?? 42)
  // The company's HQ timezone; comes from the company record once a server is connected.
  const timeZone = params.get('tz') ?? 'Europe/Rome'

  const canvas = document.createElement('canvas')
  canvas.id = 'game'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'none'
  document.getElementById('stage')!.appendChild(canvas)

  boot.stage('renderer')
  const { engine, name: renderer } = await createEngine(canvas, params.get('renderer') === 'webgl')

  // Offline sandbox (default): the browser runs its own sim-core replica.
  // `?central=1`: the company's sim, restored from the store or central sync
  // and driven by the orchestration loop (docs/mvp.md). Loaded lazily so the
  // offline page never fetches the session, store or orchestrator code.
  let session: GameSession | null = null
  if (params.get('central') === '1') {
    const { startSession } = await import('./session/session')
    // Loop errors (a failed or timed-out job, a rejected outcome) become a toast and a mark on the chip.
    session = await startSession({ params, onStage: (stage) => boot.stage(stage), onError: hudNotify })
  }
  boot.stage('scene')
  const sim = session?.sim ?? Sim.demo(seed)
  const layout = JSON.parse(sim.layout_json()) as BuildingLayout
  const game = createGameScene(engine, canvas, layout, { quality: QUALITY[quality] ?? QUALITY.high, postFx: true })
  if (params.has('facing')) game.iso.setFacing(Number(params.get('facing')))
  game.iso.snap()

  if (renderer === 'webgpu') {
    engine.onContextLostObservable.addOnce(() => {
      if (engine.frameId < WEBGPU_WATCHDOG_FRAMES) {
        const next = new URL(location.href)
        next.searchParams.set('renderer', 'webgl')
        next.searchParams.set('fallback', 'webgpu-device-lost')
        location.replace(next)
      }
    })
  }

  // Wall clocks show the real time, except when frozen for screenshots, where
  // they show the frozen time so visual tests stay deterministic.
  let frozenInstant: Date | null = null
  if (frozen) {
    const [h, m] = frozen.split(':').map(Number)
    frozenInstant = new Date(Date.UTC(2026, 9, 1, h, m || 0, 0))
    const target = h * 60 + (m || 0)
    const stepsPerMinute = Number(sim.steps_per_day()) / 1440
    const minutes = (target - sim.minute_of_day() + 1440) % 1440
    sim.advance(Math.round(minutes * stepsPerMinute))
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'q') game.iso.rotate(-1)
    if (e.key === 'e') game.iso.rotate(1)
  })

  // The clock. A session brings its own (holds, rest, the model's readiness);
  // the offline demo only needs the clamp, pause and speed. Frozen pages have none.
  const demoHost: ClockHost = {
    view: () => ({
      step: Number(sim.step()),
      minuteOfDay: sim.minute_of_day(),
      stepsPerDay: Number(sim.steps_per_day()),
      halted: false,
      modelReady: true,
      nextDueStep: null,
      busy: false,
      settling: false,
    }),
    boundary: () => undefined,
    advance: (steps) => {
      sim.advance(steps)
      return steps
    },
  }
  const clock = frozen ? null : (session?.clock ?? new ClockDriver(demoHost, { speed, policy: { rest: false } }))
  const clockHud = () => {
    if (!clock) return null
    const status = session
      ? session.status()
      : clockStatus({ hold: clock.hold, phase: clock.state.phase, halted: null, leaseLost: null, model: { state: 'ready' }, heldBy: null })
    return {
      status,
      paused: clock.state.paused,
      speed: clock.state.speed,
      unattendedDays: session ? clock.state.unattendedDays : null,
      resting: clock.resting,
    }
  }
  // While the tab is hidden the render loop stops; a 1 Hz worker timer keeps a
  // session's clock ticking (bounded by the same clamp) so work in flight can finish.
  if (session && clock) startTickTimer(() => clock.idleTickAt(performance.now()))

  const hud = mountHud(document.getElementById('ui')!, clock)

  // --- CEO management overlay (ADR-0018, docs/game-design/organization.md) ---
  // Uses the sim's organization API when it exists (feature-detected), else
  // fixtures; `?ui=mock` forces the fixtures. Frozen screenshot pages (?t=)
  // stay overlay-free unless they ask for it with ?ui=.
  const overlay =
    frozen && !params.has('ui')
      ? null
      : mountOverlay(
          document.getElementById('overlay')!,
          session?.dataSource() ?? selectDataSource(sim, params, () => sim.day() * 1440 + sim.minute_of_day()),
        )
  // --- end CEO overlay ---
  // --- scene ↔ overlay (FEAT-024): label texts and picking come from the store here; render/ reads none ---
  if (overlay) {
    const store = overlay.store
    game.setLookups({
      staff: (id) => {
        const s = store.staff(id)
        return s ? { name: store.personaOf(id).name, role: s.role } : undefined
      },
      workItem: (id) => store.planText.peek().items[id]?.title || undefined,
    })
    game.onPick({
      person: (id) => store.openProfile({ staff: id }),
      workItem: (id) => {
        store.selectedItem.value = id
        store.panel.value = 'plan'
      },
    })
  }
  // Labels never cover the HUD or the overlay's toolbar and panels. Live pages only: on frozen
  // screenshot pages the HUD's text (fps) varies, and the labels must not vary with it.
  if (!frozen) {
    game.setOccluders(() => {
      const c = canvas.getBoundingClientRect()
      return Array.from(document.querySelectorAll('.hud, .hud-card, .toolbar, .panel'), (el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left - c.left, top: r.top - c.top, right: r.right - c.left, bottom: r.bottom - c.top }
      })
    })
  }
  // --- end scene ↔ overlay ---
  let lastStep = -1n
  let stillFrames = 0
  let still = false
  boot.done()
  engine.runRenderLoop(() => {
    // Wall time since the last tick, clamped: per 100 ms slice a step boundary
    // (job outcomes and landed deploys are applied), then the steps the clock allows.
    clock?.tickAt(performance.now())
    const step = sim.step()
    if (step !== lastStep) {
      game.update(JSON.parse(sim.render_state_json()) as RenderState)
      lastStep = step
    }
    game.setClock(frozenInstant ?? new Date(), frozenInstant ? 'UTC' : timeZone)
    game.scene.render()
    hud.set({
      clock: formatClock(sim.minute_of_day()),
      day: sim.day(),
      renderer,
      version: version(),
      fps: Math.round(engine.getFps()),
    })
    hud.setClock(clockHud())
    if (frozen && game.isReady() && ++stillFrames >= 20) {
      engine.stopRenderLoop()
      still = true
    }
  })
  window.addEventListener('resize', () => engine.resize())

  ;(window as unknown as { __swarmpress: unknown }).__swarmpress = {
    renderer,
    fallback: params.get('fallback'),
    sim,
    scene: game.scene,
    ready: () => game.isReady(),
    frames: () => engine.frameId,
    still: () => still,
    overlay: overlay?.store ?? null,
    session: session?.hook ?? null,
    clock,
    // Everyone on site, where they are drawn this frame and on the canvas (e2e smooth-movement check).
    people: () => game.people(),
  }
}

const params = new URLSearchParams(location.search)
const boot = mountBootScreen(document.body, params.get('central') === '1' ? SESSION_STAGES : DEMO_STAGES)
main(params, boot).catch((err) => {
  console.error(err)
  document.body.dataset.error = String(err)
  // A visible error, whatever stage failed (after boot the screen is put back up).
  if (!boot.el.isConnected) document.body.append(boot.el)
  boot.fail(err)
})
