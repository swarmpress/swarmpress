import init, { Sim, version } from 'swarm-wasm'
import type { WebGPUEngine } from '@babylonjs/core'
import { createEngine, NoWebGpuError, watchDeviceLoss, type DeviceLossInfo } from './render/engine'
import { mountNoWebGpu } from './render/no-webgpu'
import { formatClock } from './render/daylight'
import { QUALITY, type Quality } from './render/postfx'
import { frameDue, isQuality, rendererHooks } from './render/quality'
import { createGameScene, type GameScene } from './render/scene'
import { ClockDriver, clockStatus, type ClockHost } from './session/clock-driver'
import type { GameSession } from './session/session'
import { startTickTimer } from './session/tick-timer'
import type { BuildingLayout, RenderState } from './state/render-state'
import { DEMO_STAGES, mountBootScreen, SESSION_STAGES, type BootScreen } from './ui/boot-screen'
import { hudNotify, mountHud } from './ui/hud'
import { mountOverlay, selectDataSource } from './ui/mount'
import { bubblesOf, mountBubbles } from './ui/bubbles/BubbleLayer'
import { effect } from '@preact/signals'
import { SECTIONS, sectionOf } from './ui/sections'
import { buildBridge } from './build-bridge'

/**
 * URL parameters (also used by the e2e and visual tests):
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
 * The renderer is WebGPU only (ADR-0064, src/render/engine.ts). Without it the
 * page shows the no-WebGPU screen (src/render/no-webgpu.ts). A lost device is
 * recovered on a new WebGPU engine and a rebuilt scene, the clock held meanwhile.
 * A building change (the render state's `layoutRev`, ADR-0087) rebuilds the
 * scene on the same engine from the sim's new layout, the camera kept.
 *
 * The clock (ADR-0060, src/session/clock-driver.ts): wall time is clamped
 * before it becomes sim steps, so a tab that was hidden never bursts; a
 * session's clock also holds while a job is due and rests at night. The HUD
 * shows its state. Frozen pages (t=) have no clock and no clock HUD.
 */

/** Device losses recovered per page before the no-WebGPU screen; and the wait before each new engine. */
const MAX_DEVICE_RECOVERIES = 3
const RECOVERY_DELAY_MS = 250
/** How often a page whose step stands still looks for a building change (`layoutRev`). */
const LAYOUT_POLL_MS = 400

async function main(params: URLSearchParams, boot: BootScreen) {
  boot.stage('wasm')
  await init()
  const quality = (params.get('quality') as Quality) || 'high'
  const frozen = params.get('t')
  const speed = Math.max(1, Number(params.get('speed') ?? 1))
  const seed = BigInt(params.get('seed') ?? 42)
  // The company's HQ timezone; comes from the company record once a server is connected.
  const timeZone = params.get('tz') ?? 'Europe/Rome'

  // The canvas is replaced when a lost device is recovered: its listeners belong to the old scene.
  const newCanvas = () => {
    const c = document.createElement('canvas')
    c.id = 'game'
    c.style.width = '100%'
    c.style.height = '100%'
    c.style.touchAction = 'none'
    return c
  }
  let canvas = newCanvas()
  document.getElementById('stage')!.appendChild(canvas)

  boot.stage('renderer')
  // WebGPU only (ADR-0064): a NoWebGpuError ends here, and the page shows the no-WebGPU screen.
  let engine: WebGPUEngine = await createEngine(canvas)
  const renderer = 'webgpu' as const

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
  // Read again on every building change (`layoutRev`, ADR-0087).
  let layout = JSON.parse(sim.layout_json()) as BuildingLayout
  const tier: Quality = isQuality(quality) ? quality : 'high'
  // The office is bricks (FEAT-081, ADR-0085): every room, the hallway and the street from the construction kit.
  const brickMod = await import('./render/bricks')
  // The quality the GPU scheduler last asked for; a rebuilt scene starts at the tier, then takes it.
  let liveQuality = QUALITY[tier]
  const buildScene = async (on: WebGPUEngine, facing: number | null, fresh: readonly string[] = []) => {
    const g = createGameScene(on, canvas, layout, { quality: QUALITY[tier], postFx: true })
    if (facing !== null) g.iso.setFacing(facing)
    g.iso.snap()
    if (liveQuality !== QUALITY[tier]) g.setQuality(liveQuality)
    // The low tier draws merged walls (level of detail, ADR-0063).
    const signs = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label]))
    const b = await brickMod.attachBrickOffice(g, layout, { detail: tier === 'low' ? 'merged' : 'full', signs, fresh })
    return { game: g, bricks: b }
  }
  let { game, bricks } = await buildScene(engine, params.has('facing') ? Number(params.get('facing')) : null)
  // Build mode's bridge (ADR-0087): picking, ghost, highlight and camera for the Build section.
  const kit = await brickMod.loadKit()
  // GPU sharing with the local model (ADR-0057, FEAT-040): while it generates, the scene drops
  // a tier, pauses SSAO and bloom, and draws at most `fpsCap` frames a second; then it comes back.
  let fpsCap: number | null = null
  let lastDraw = 0
  const qualityTarget = {
    setQuality: (q: typeof liveQuality) => {
      liveQuality = q
      game.setQuality(q)
    },
  }
  session?.models.attachRenderer(rendererHooks(qualityTarget, tier, (fps) => (fpsCap = fps)))

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
  // While a lost device is recovered the clock holds: no frame and no idle tick runs it.
  let recovering = false
  if (session && clock) startTickTimer(() => {
    if (!recovering) clock.idleTickAt(performance.now())
  })

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
  // Labels never cover the HUD or the overlay's toolbar and panels. Live pages only: on frozen
  // screenshot pages the HUD's text (fps) varies, and the labels must not vary with it.
  const screenRects = () => {
    const c = canvas.getBoundingClientRect()
    return Array.from(document.querySelectorAll('.hud, .hud-card, .toolbar, .panel, #model-startup'), (el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left - c.left, top: r.top - c.top, right: r.right - c.left, bottom: r.bottom - c.top }
    })
  }
  // The share of the stage a side panel covers (sections frame their building in what stays visible).
  const coveredShare = () => {
    const stage = canvas.getBoundingClientRect()
    const panel = document.querySelector('.panel:not(.is-full)')?.getBoundingClientRect()
    return panel && stage.width > 0 ? Math.max(0, stage.right - panel.left) / stage.width : 0
  }
  // (again on every scene a device recovery or a building change builds)
  let bridge: ReturnType<typeof brickMod.createBuildBridge> | null = null
  let unwatchModel: (() => void) | null = null
  let unwatchSection: (() => void) | null = null
  const wireScene = (game: GameScene, bricks: Awaited<ReturnType<typeof buildScene>>['bricks']) => {
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
    if (!frozen) game.setOccluders(screenRects)
    if (overlay) bricks.setSources(brickMod.surfaceSourcesFrom(overlay.store))
    // The model table (ADR-0072): the site's brick town, kept current from the store.
    unwatchModel?.()
    unwatchModel = overlay ? brickMod.watchModel(overlay.store, bricks) : null
    // The shell's sections move the camera to their building (ADR-0086); not at boot, which frames the office.
    unwatchSection?.()
    unwatchSection = null
    if (overlay && !frozen) {
      const store = overlay.store
      let last: string | null = null
      unwatchSection = effect(() => {
        const section = sectionOf(store.panel.value ?? null, store.studioTab.value ?? 'town')
        if (last !== null && section !== last) {
          // After the panel has rendered: how much of the stage it covers.
          requestAnimationFrame(() => game.iso.frame(brickMod.townFrame(layout, bricks.town, section), coveredShare()))
        }
        last = section
      })
    }
    // The bridge to the new scene; a gesture under way (capture, ghost, highlight) carries over.
    const carry = bridge?.state()
    bridge?.dispose()
    bridge = brickMod.createBuildBridge({ game, bricks, kit, layout, canvas: () => canvas, covered: coveredShare }, carry)
    buildBridge.value = bridge
  }
  wireScene(game, bricks)
  // --- end scene ↔ overlay ---
  let latest: RenderState | null = null
  // Meeting speech bubbles (FEAT-025): live session pages only, never on frozen screenshot pages.
  if (session && !frozen) {
    const speech = session.speech
    mountBubbles(document.getElementById('ui')!, {
      current: () => bubblesOf(latest),
      text: (b) => speech.text(b.meeting, b.seq, b.job),
      name: (id) => overlay?.store.personaOf(id).name,
      anchor: (id) => game.speechAnchor(id),
      obstacles: () => [...game.labelRects(), ...screenRects()],
      view: () => ({ w: canvas.clientWidth, h: canvas.clientHeight }),
      durationMs: (chars) => speech.durationMs(chars),
    })
  }
  let lastStep = -1n
  let lastSeq = -1
  // The layout revision drawn; a new one rebuilds the scene (not on frozen pages).
  let lastRev: number | null = null
  let lastRead = 0
  const followLayout = (state: RenderState) => {
    const rev = (state as RenderState & { layoutRev?: number }).layoutRev
    if (frozen || typeof rev !== 'number') return
    if (lastRev !== null && rev !== lastRev) {
      latest = state
      requestRebuild()
    }
    lastRev = rev
  }
  let stillFrames = 0
  let still = false
  boot.done()
  const frame = () => {
    // Wall time since the last tick, clamped: per 100 ms slice a step boundary
    // (job outcomes and landed deploys are applied), then the steps the clock allows.
    const now = performance.now()
    clock?.tickAt(now)
    const step = sim.step()
    // A command applied while the clock holds (a meeting turn) changes the state at the same step.
    const seq = session?.loop.lastSeq ?? 0
    if (step !== lastStep || seq !== lastSeq) {
      latest = JSON.parse(sim.render_state_json()) as RenderState
      game.update(latest)
      lastStep = step
      lastSeq = seq
      lastRead = now
      followLayout(latest)
    } else if (!frozen && now - lastRead > LAYOUT_POLL_MS) {
      // A build command applied while the clock stands (paused, sandbox) changes no step:
      // look at the layout's revision now and then, without redrawing anything else.
      lastRead = now
      followLayout(JSON.parse(sim.render_state_json()) as RenderState)
    }
    game.setClock(frozenInstant ?? new Date(), frozenInstant ? 'UTC' : timeZone)
    // The clock always ticks; under the generation cap only the drawing waits.
    if (frameDue(now, lastDraw, fpsCap)) {
      game.scene.render()
      lastDraw = now
    }
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
  }
  engine.runRenderLoop(frame)
  window.addEventListener('resize', () => engine.resize())
  // The shell (ADR-0086) sizes the stage, not the window: follow the canvas' own box.
  new ResizeObserver(() => engine.resize()).observe(document.getElementById('stage')!)

  // --- device loss (ADR-0064): a new WebGPU engine on a new canvas, the scene rebuilt from the sim ---
  let recoveries = 0
  let framesBefore = 0
  let lastLoss: DeviceLossInfo | null = null
  // Recoveries and layout rebuilds run one after another: a new device lost while its scene is built waits its turn.
  let sceneChain: Promise<void> = Promise.resolve()
  const onLost = (info: DeviceLossInfo) => {
    lastLoss = info
    console.warn(`[render] WebGPU device lost (${info.reason}): ${info.message}`)
    sceneChain = sceneChain.then(recover).catch((err) => {
      recovering = false
      showFailure(err)
    })
  }
  let device = watchDeviceLoss(engine, onLost)
  const recover = async () => {
    recovering = true
    engine.stopRenderLoop()
    framesBefore += engine.frameId
    const facing = game.iso.facing()
    const view = game.iso.view()
    device.dispose()
    if (++recoveries > MAX_DEVICE_RECOVERIES) throw new NoWebGpuError('device-lost', `lost ${recoveries} times; last: ${lastLoss?.reason}: ${lastLoss?.message}`)
    await new Promise((r) => setTimeout(r, RECOVERY_DELAY_MS))
    const fresh = newCanvas()
    canvas.replaceWith(fresh)
    canvas = fresh
    engine = await createEngine(canvas)
    device = watchDeviceLoss(engine, onLost)
    ;({ game, bricks } = await buildScene(engine, facing))
    game.iso.setView(view)
    wireScene(game, bricks)
    lastStep = -1n
    stillFrames = 0
    recovering = false
    engine.runRenderLoop(frame)
  }

  // --- building changes (ADR-0087): the sim's new layout, a new scene on the same engine ---
  // The whole scene is rebuilt (the box office, lights, labels and staff hang on the layout too),
  // then swapped in between two frames; the old one is disposed with everything in it.
  let rebuilds = 0
  let rebuildMs: number | null = null
  let rebuildQueued = false
  const rebuildLayout = async () => {
    rebuildQueued = false
    const t0 = performance.now()
    const old = { game, bricks }
    const facing = old.game.iso.facing()
    const view = old.game.iso.view()
    const before = layout
    layout = JSON.parse(sim.layout_json()) as BuildingLayout
    // Construction (FEAT-084): the equipment that was not there before drops into place; never on
    // frozen pages, nor for a viewer who prefers reduced motion.
    const fresh = brickMod.arrivalsFor(before, layout, { frozen: !!frozen, reducedMotion: brickMod.prefersReducedMotion() })
    const next = await buildScene(engine, facing, fresh)
    brickMod.animateArrivals(next.game.scene, next.bricks.arrivals)
    next.game.iso.setView(view)
    ;({ game, bricks } = next)
    wireScene(game, bricks)
    if (latest) game.update(latest)
    // The overlay's lookups and the model table were wired to the new scene: the old one goes.
    old.bricks.dispose()
    old.game.dispose()
    rebuilds++
    rebuildMs = performance.now() - t0
  }
  const requestRebuild = () => {
    if (rebuildQueued) return
    rebuildQueued = true
    sceneChain = sceneChain.then(rebuildLayout).catch((err) => {
      rebuildQueued = false
      console.error('[render] the layout rebuild failed', err)
      hudNotify(`The office could not be redrawn: ${String(err)}`)
    })
  }

  ;(window as unknown as { __swarmpress: unknown }).__swarmpress = {
    renderer,
    sim,
    get scene() {
      return game.scene
    },
    ready: () => game.isReady(),
    // Frames drawn on this page, across device recoveries.
    frames: () => framesBefore + engine.frameId,
    // Device-loss recovery (ADR-0064): how many so far, and a test hook that destroys the device.
    recoveries: () => recoveries,
    recovering: () => recovering,
    loseDevice: () => device.destroyDevice(),
    still: () => still,
    overlay: overlay?.store ?? null,
    session: session?.hook ?? null,
    // The company's WordPress (?site=wordpress, ADR-0078): its runtime, both channels included; else null.
    wordpress: session?.wordpress ?? null,
    // Its site engine and exports, and a knowledge refresh (the WordPress e2e seeds media, then refreshes).
    wordpressSite: session?.wordpressSite ?? null,
    refreshKnowledge: session ? () => session!.refreshKnowledge() : null,
    clock,
    // Everyone on site, where they are drawn this frame and on the canvas (e2e smooth-movement check).
    // In page coordinates (the shell puts the canvas between its bars), labels too.
    people: () => {
      const c = canvas.getBoundingClientRect()
      const at = <R extends { left: number; top: number; right: number; bottom: number }>(r: R) => ({ ...r, left: r.left + c.left, right: r.right + c.left, top: r.top + c.top, bottom: r.bottom + c.top })
      return game.people().map((p) => ({ ...p, screenX: p.screenX + c.left, screenY: p.screenY + c.top, label: p.label ? at(p.label) : p.label }))
    },
    // The brick office's counts and timings.
    bricks: () => bricks.stats(),
    // Layout rebuilds so far (ADR-0087) and the last one's duration, ms.
    layoutRebuilds: () => ({ count: rebuilds, lastMs: rebuildMs }),
  }
}

const params = new URLSearchParams(location.search)
const boot = mountBootScreen(document.body, params.get('central') === '1' ? SESSION_STAGES : DEMO_STAGES)
main(params, boot).catch(showFailure)

function showFailure(err: unknown) {
  console.error(err)
  document.body.dataset.error = String(err)
  // No usable WebGPU (ADR-0064): its own screen, which says what is missing and which browsers work.
  if (err instanceof NoWebGpuError) {
    boot.el.remove()
    document.body.dataset.noWebgpu = err.reason
    if (!document.getElementById('no-webgpu')) mountNoWebGpu(document.body, err.reason, err.detail)
    return
  }
  // A visible error, whatever stage failed (after boot the screen is put back up).
  if (!boot.el.isConnected) document.body.append(boot.el)
  boot.fail(err)
}
