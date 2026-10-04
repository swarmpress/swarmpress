// The brick office spike's benchmark document and go/no-go rows (FEAT-081).
import { describe, expect, it } from 'vitest'
import { bricksFrameDoc, bricksFrameFile, spikeRows, type BricksRun } from './bricks-report'
import { validateBenchmarkDoc, type ReportContext } from './report'

const ctx: ReportContext = {
  provenance: { commit: 'abcdef1', branch: 'main', dirty: false, generatedAt: '2026-10-04T10:00:00Z' },
  machine: { slug: 'apple-m3-max-128gb', os: 'macos', arch: 'aarch64', cpus: 16, cpuModel: 'Apple M3 Max', memoryGb: 128 },
}
const stats = (p50: number, p95: number) => ({ n: 100, p50, p95, min: p50 / 2, max: p95 * 2, mean: p50, samples: [] })
const run = (office: 'boxes' | 'bricks', quality: string, idle: number, gen: number): BricksRun => ({
  office,
  quality,
  renderer: 'webgpu',
  browser: 'Chrome 141',
  frames: { renderer: 'webgpu', quality, hiddenMs: 0, phases: { idle: stats(idle, idle * 1.5), generating: stats(gen * 0.7, gen) } },
  counts: {
    office,
    drawCalls: office === 'bricks' ? 240 : 180,
    activeMeshes: 300,
    buildMs: 120,
    bricks:
      office === 'bricks'
        ? {
            rooms: [{ room: 'room-1', kind: 'newsroom', instances: 6100, studs: 9000, kitInstances: 6100, kitStuds: 9000, meshes: 40, studMeshes: 20, placements: 26, surfaces: 7, compileMs: 30, meshMs: 12 }],
            instances: 6100,
            studs: 9000,
            meshes: 60,
            activeBrickMeshes: 50,
            drawCalls: 240,
            kitLoadMs: 40,
            shellsMs: 5,
            buildMs: 60,
            surfaces: { monitors: 6, boards: 1, close: 0, redraws: 0, maxRedrawsPerFrame: 0 },
            studsShown: true,
          }
        : null,
  },
})

describe('brick spike report', () => {
  it('writes a valid cockpit.benchmark.v1 document with both offices and the room chunks', () => {
    const doc = bricksFrameDoc([run('boxes', 'low', 8, 20), run('bricks', 'low', 12, 30)], ctx, { frames: true, cpu: true })
    expect(validateBenchmarkDoc(doc)).toEqual([])
    expect(doc.name).toBe('frame-time-bricks-low')
    expect(doc.feature_ids).toEqual(['FEAT-081', 'FEAT-082'])
    const m = (name: string, subject: string) => doc.metrics.find((x) => x.name === name && x.subject === subject)
    expect(m('frame.p95_ms', 'bricks/generating')).toMatchObject({ value: 30, budget: { max: 50 } })
    expect(m('frame.p95_ms', 'boxes/generating')?.budget).toBeUndefined()
    expect(m('chunk.build_ms', 'newsroom')).toMatchObject({ value: 42, budget: { max: 200 } })
    expect(m('bricks.instances', 'bricks')).toMatchObject({ value: 6100, determinism: 'deterministic' })
    expect(m('draw_calls', 'boxes')?.value).toBe(180)
    expect(bricksFrameFile('low', 'webgpu')).toBe('frame-time-bricks-low.webgpu.json')
  })

  it('marks timings inconclusive off the target, never as a pass', () => {
    const doc = bricksFrameDoc([run('bricks', 'low', 12, 30)], ctx, { frames: false, cpu: true, reason: 'headless WebGL2' })
    const frame = doc.metrics.find((x) => x.name === 'frame.p50_ms')!
    expect(frame).toMatchObject({ status: 'inconclusive', reason: 'headless WebGL2' })
    expect(doc.metrics.find((x) => x.name === 'chunk.build_ms')!.status).toBeUndefined()
    const rows = spikeRows([run('bricks', 'low', 12, 30)], { frames: false, cpu: true })
    expect(rows.find((r) => r.criterion.startsWith('frame p95'))!.verdict).toBe('inconclusive')
    expect(rows.find((r) => r.criterion.startsWith('chunk build'))!.verdict).toBe('go')
  })

  it('decides go and no-go on the target', () => {
    const rows = spikeRows([run('bricks', 'low', 12, 60), run('bricks', 'high', 20, 70)], { frames: true, cpu: true })
    expect(rows.map((r) => [r.criterion, r.verdict])).toEqual([
      ['idle frame p50, low', 'go'],
      ['idle frame p50, high', 'no-go'],
      ['frame p95 while generating, lowest tier', 'no-go'],
      ['chunk build, newsroom', 'go'],
    ])
  })
})
