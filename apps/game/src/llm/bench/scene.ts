/**
 * The office scene beside the model (ADR-0057: the model and the renderer
 * share one GPU). The game's own bootstrap, without the session, the HUD or
 * the overlay: the sim-core demo replica, `createEngine` (WebGPU first,
 * WebGL2 fallback) and `createGameScene` at a fixed quality tier, advancing
 * the sim at real time so staff move as they would in the game.
 *
 * Every rendered frame goes to the recorder; the runner tells it what the
 * model is doing.
 */
import { SceneInstrumentation } from '@babylonjs/core'
import init, { Sim } from 'swarm-wasm'
import { createEngine } from '../../render/engine'
import { QUALITY, type Quality } from '../../render/postfx'
import { createGameScene } from '../../render/scene'
import type { BuildingLayout, RenderState } from '../../state/render-state'
import type { BrickOfficeStats } from '../../render/bricks'
import type { FrameRecorder } from './frames'

/** The office the scene draws: today's boxes, or the brick office spike (FEAT-081). */
export type BenchOffice = 'boxes' | 'bricks'

/** What the scene costs to draw: draw calls of the last frame, active meshes, and the brick rooms' counts. */
export interface SceneCounts {
  office: BenchOffice
  drawCalls: number
  activeMeshes: number
  /** Scene build (box office, plus the brick rooms with the kit's load), ms. */
  buildMs: number
  bricks: BrickOfficeStats | null
}

export interface BenchScene {
  renderer: string
  quality: Quality
  /** The page's renderer adapter, as far as the page can see it. */
  gpu: Record<string, unknown> | null
  office: BenchOffice
  counts(): SceneCounts
  stop(): void
}

/** Sim steps per second at real time: one game day is 20 real minutes (ADR-0060). */
const DAY_MS = 20 * 60 * 1000

export async function startScene(host: HTMLElement, quality: Quality, frames: FrameRecorder, forceWebgl = false, office: BenchOffice = 'boxes'): Promise<BenchScene> {
  await init()
  const canvas = document.createElement('canvas')
  canvas.id = 'bench-scene'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'none'
  host.appendChild(canvas)
  const { engine, name: renderer } = await createEngine(canvas, forceWebgl)
  const sim = Sim.demo(42n)
  // Start at 10:00, when the office is busy.
  const stepsPerDay = Number(sim.steps_per_day())
  sim.advance(Math.round(((10 * 60 - sim.minute_of_day() + 1440) % 1440) * (stepsPerDay / 1440)))
  const layout = JSON.parse(sim.layout_json()) as BuildingLayout
  const built0 = performance.now()
  const game = createGameScene(engine, canvas, layout, { quality: QUALITY[quality], postFx: true })
  game.iso.snap()
  // The brick office spike (FEAT-081): a lazy chunk, loaded only for office=bricks.
  const bricks = office === 'bricks' ? await (await import('../../render/bricks')).attachBrickOffice(game, layout) : null
  const buildMs = performance.now() - built0
  const instrumentation = new SceneInstrumentation(game.scene)
  let lastCounts: SceneCounts | null = null
  let stopped: SceneCounts | null = null

  const stepMs = DAY_MS / stepsPerDay
  let carry = 0
  let last = performance.now()
  let lastStep = -1n
  engine.runRenderLoop(() => {
    const now = performance.now()
    carry += Math.min(now - last, 250)
    last = now
    const steps = Math.floor(carry / stepMs)
    if (steps > 0) {
      sim.advance(steps)
      carry -= steps * stepMs
    }
    const step = sim.step()
    if (step !== lastStep) {
      game.update(JSON.parse(sim.render_state_json()) as RenderState)
      lastStep = step
    }
    game.setClock(new Date(), 'Europe/Rome')
    game.scene.render()
    frames.frame(performance.now())
  })
  const onVisibility = () => frames.visibility(document.hidden, performance.now())
  document.addEventListener('visibilitychange', onVisibility)
  const onResize = () => engine.resize()
  window.addEventListener('resize', onResize)

  let gpu: Record<string, unknown> | null = null
  if (renderer === 'webgpu') {
    const adapter = await (navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<{ info?: Record<string, unknown> } | null> } }).gpu
      ?.requestAdapter({ powerPreference: 'high-performance' })
      .catch(() => null)
    const info = adapter?.info
    if (info) gpu = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }
  }
  return {
    renderer,
    quality,
    gpu,
    office,
    counts: () =>
      stopped ??
      (lastCounts = {
        office,
        drawCalls: instrumentation.drawCallsCounter.current,
        activeMeshes: game.scene.getActiveMeshes().length,
        buildMs: Math.round(buildMs * 10) / 10,
        bricks: bricks?.stats() ?? null,
      }),
    stop: () => {
      // The counts stay readable after the scene is gone: the last ones read, else now.
      stopped = lastCounts ?? {
        office,
        drawCalls: instrumentation.drawCallsCounter.current,
        activeMeshes: game.scene.getActiveMeshes().length,
        buildMs: Math.round(buildMs * 10) / 10,
        bricks: bricks?.stats() ?? null,
      }
      engine.stopRenderLoop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
      game.scene.dispose()
      engine.dispose()
    },
  }
}
