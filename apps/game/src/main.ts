import init, { Sim, version } from 'swarm-wasm'
import { createEngine } from './render/engine'
import { formatClock } from './render/daylight'
import { QUALITY, type Quality } from './render/postfx'
import { createGameScene } from './render/scene'
import { DEMO_BUILDING, demoRenderState } from './state/render-state'
import { mountHud } from './ui/hud'

/**
 * URL parameters (also used by the visual tests):
 *   renderer=webgl     force the WebGL2 fallback
 *   quality=low|medium|high
 *   t=HH:MM            freeze the clock at this time (deterministic screenshots)
 *   speed=N            sim steps per 100 ms (sandbox fast-forward), default 50
 *   facing=0..3        camera angle
 */
async function main() {
  await init()
  const params = new URLSearchParams(location.search)
  const quality = (params.get('quality') as Quality) || 'high'
  const frozen = params.get('t')
  const speed = Number(params.get('speed') ?? 50)

  const canvas = document.createElement('canvas')
  canvas.id = 'game'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'none'
  document.getElementById('stage')!.appendChild(canvas)

  const { engine, name: renderer } = await createEngine(canvas, params.get('renderer') === 'webgl')
  const game = createGameScene(engine, canvas, DEMO_BUILDING, { quality: QUALITY[quality] ?? QUALITY.high, postFx: true })

  if (params.has('facing')) game.iso.setFacing(Number(params.get('facing')))
  game.iso.snap()

  const sim = new Sim(42n)
  let minuteOverride: number | null = null
  if (frozen) {
    const [h, m] = frozen.split(':').map(Number)
    minuteOverride = h * 60 + (m || 0)
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'q') game.iso.rotate(-1)
    if (e.key === 'e') game.iso.rotate(1)
  })

  const hud = mountHud(document.getElementById('ui')!)
  let acc = 0
  let lastMinute = -1
  engine.runRenderLoop(() => {
    if (minuteOverride === null) {
      acc += engine.getDeltaTime()
      while (acc >= 100) {
        sim.advance(speed)
        acc -= 100
      }
    }
    const minute = minuteOverride ?? sim.minute_of_day()
    if (minute !== lastMinute) {
      game.update(demoRenderState(minute, sim.day()))
      lastMinute = minute
    }
    game.scene.render()
    hud.set({ clock: formatClock(minute), day: sim.day(), renderer, version: version(), fps: Math.round(engine.getFps()) })
  })
  window.addEventListener('resize', () => engine.resize())

  ;(window as unknown as { __simpress: unknown }).__simpress = {
    renderer,
    sim,
    scene: game.scene,
    ready: () => game.scene.isReady(),
    frames: () => engine.frameId,
  }
}

main().catch((err) => {
  console.error(err)
  document.body.dataset.error = String(err)
})
