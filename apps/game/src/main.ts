import init, { Sim, version } from 'swarm-wasm'
import { createEngine } from './render/engine'
import { formatClock } from './render/daylight'
import { QUALITY, type Quality } from './render/postfx'
import { createGameScene } from './render/scene'
import type { GameSession } from './session/session'
import type { BuildingLayout, RenderState } from './state/render-state'
import { mountHud } from './ui/hud'
import { mountOverlay, selectDataSource } from './ui/mount'

/**
 * URL parameters (also used by the e2e and visual tests):
 *   renderer=webgl     force the WebGL2 fallback
 *   quality=low|medium|high
 *   t=HH:MM            run the sim to this time of day and freeze it (deterministic screenshots)
 *   speed=N            sim steps per 100 ms of real time (fast-forward), default 1 = real time
 *   facing=0..3        camera angle
 *   seed=N             sim seed, default 42
 *   tz=Area/City       HQ timezone for the real-time wall clocks, default Europe/Rome
 *   ui=mock            CEO overlay on the fixture data source (also mounts it on t= pages)
 *   central=1          the MVP loop: dev login, company store, central server, orchestrator
 *                      (src/session/session.ts; also login=, llm=fake, store=, ff=HH:MM)
 * With t=, the loop stops once the scene is ready and 20 frames are drawn
 * (`__swarmpress.still()` turns true) so screenshots are stable and cheap.
 */

/** If the WebGPU device dies before this many frames, reload on WebGL2. */
const WEBGPU_WATCHDOG_FRAMES = 60

async function main() {
  await init()
  const params = new URLSearchParams(location.search)
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

  const { engine, name: renderer } = await createEngine(canvas, params.get('renderer') === 'webgl')

  // Offline sandbox (default): the browser runs its own sim-core replica.
  // `?central=1`: the company's sim, restored from the store or central sync
  // and driven by the orchestration loop (docs/mvp.md). Loaded lazily so the
  // offline page never fetches the session, store or orchestrator code.
  let session: GameSession | null = null
  if (params.get('central') === '1') {
    const { startSession } = await import('./session/session')
    session = await startSession({ params })
  }
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

  const hud = mountHud(document.getElementById('ui')!)

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
  let acc = 0
  let lastStep = -1n
  let stillFrames = 0
  let still = false
  engine.runRenderLoop(() => {
    if (!frozen) {
      acc += engine.getDeltaTime()
      while (acc >= 100) {
        if (session) {
          // Step boundary: apply job outcomes and landed deploys, then step and drain effects.
          session.boundary()
          if (!session.paused) {
            sim.advance(speed)
            session.afterAdvance()
          }
        } else {
          sim.advance(speed)
        }
        acc -= 100
      }
    }
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
    if (frozen && game.scene.isReady() && ++stillFrames >= 20) {
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
    ready: () => game.scene.isReady(),
    frames: () => engine.frameId,
    still: () => still,
    overlay: overlay?.store ?? null,
    session: session?.hook ?? null,
  }
}

main().catch((err) => {
  console.error(err)
  document.body.dataset.error = String(err)
})
