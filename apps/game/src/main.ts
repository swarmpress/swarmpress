import init, { Sim, version } from 'swarm-wasm'
import { createEngine } from './render/engine'
import { formatClock } from './render/daylight'
import { QUALITY, type Quality } from './render/postfx'
import { createGameScene } from './render/scene'
import type { BuildingLayout, RenderState } from './state/render-state'
import { mountHud } from './ui/hud'

/**
 * URL parameters (also used by the e2e and visual tests):
 *   renderer=webgl     force the WebGL2 fallback
 *   quality=low|medium|high
 *   t=HH:MM            run the sim to this time of day and freeze it (deterministic screenshots)
 *   speed=N            sim steps per 100 ms (offline sandbox fast-forward), default 1 = real time
 *   facing=0..3        camera angle
 *   seed=N             sim seed, default 42
 * With t=, the loop stops once the scene is ready and 20 frames are drawn
 * (`__simpress.still()` turns true) so screenshots are stable and cheap.
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

  const canvas = document.createElement('canvas')
  canvas.id = 'game'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'none'
  document.getElementById('stage')!.appendChild(canvas)

  const { engine, name: renderer } = await createEngine(canvas, params.get('renderer') === 'webgl')

  // Offline sandbox: the browser runs its own sim-core replica. With a server
  // connection (M2) the same Sim is driven by lockstep frames instead.
  const sim = Sim.demo(seed)
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

  if (frozen) {
    const [h, m] = frozen.split(':').map(Number)
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
  let acc = 0
  let lastStep = -1n
  let stillFrames = 0
  let still = false
  engine.runRenderLoop(() => {
    if (!frozen) {
      acc += engine.getDeltaTime()
      while (acc >= 100) {
        sim.advance(speed)
        acc -= 100
      }
    }
    const step = sim.step()
    if (step !== lastStep) {
      game.update(JSON.parse(sim.render_state_json()) as RenderState)
      lastStep = step
    }
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

  ;(window as unknown as { __simpress: unknown }).__simpress = {
    renderer,
    fallback: params.get('fallback'),
    sim,
    scene: game.scene,
    ready: () => game.scene.isReady(),
    frames: () => engine.frameId,
    still: () => still,
  }
}

main().catch((err) => {
  console.error(err)
  document.body.dataset.error = String(err)
})
