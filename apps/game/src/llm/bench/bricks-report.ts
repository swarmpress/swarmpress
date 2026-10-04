/**
 * The brick office spike's measurements (FEAT-081; docs/design/brick-office.md
 * section 8): one `cockpit.benchmark.v1` document per quality tier with the
 * box office and the brick office side by side, from bench.html runs on the
 * scripted backend (`e2e/bricks-bench.spec.ts`), and the go/no-go rows of
 * section 8.5 that the numbers can answer.
 *
 * Pure, like report.ts: no Babylon, no JSON imports, runs under vitest and
 * in Node.
 */
import type { FrameSummary } from './metrics'
import { BENCHMARK_SCHEMA, TOOL, type BenchmarkDoc, type BenchmarkMetric, type ReportContext } from './report'
import type { SceneCounts } from './scene'

export interface BricksRun {
  office: 'boxes' | 'bricks'
  quality: string
  renderer: string
  browser: string | null
  frames: FrameSummary
  counts: SceneCounts
}

/** Section 8.5 and section 4's targets. */
export const SPIKE_TARGETS = {
  /** 60 fps with the model idle. */
  idleP50Ms: 1000 / 60,
  /** p95 while the model generates, at the scheduler's lowest tier. */
  generatingP95Ms: 50,
  /** Building one room's chunk. */
  chunkBuildMs: 200,
} as const

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d

/** `frame-time-bricks-<tier>.<renderer>.json`. */
export const bricksFrameFile = (tier: string, renderer: string) => `frame-time-bricks-${tier}.${renderer}.json`

/**
 * Whether a run's numbers mean anything for the decision: frame times only
 * on the target GPU and browser (headless software rendering, SwiftShader or
 * WebGL2, is marked inconclusive with the reason, never a pass); build times
 * on the target CPU.
 */
export interface Conclusive {
  frames: boolean
  cpu: boolean
  reason?: string
}

/** The document of one tier. */
export function bricksFrameDoc(runs: readonly BricksRun[], ctx: ReportContext, measuredOn: Conclusive): BenchmarkDoc {
  const tier = runs[0]?.quality ?? 'unknown'
  const renderer = runs[0]?.renderer ?? 'unknown'
  const metrics: BenchmarkMetric[] = []
  const why = { status: 'inconclusive' as const, reason: measuredOn.reason ?? 'not the target machine' }
  const timing = (name: string, subject: string, value: number | null | undefined, budget?: number, extra: Partial<BenchmarkMetric> = {}, cpu = false) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return
    const ok = cpu ? measuredOn.cpu : measuredOn.frames
    metrics.push({ name, subject, unit: 'ms', value: round(value), determinism: 'environment-sensitive', direction: 'lower_is_better', ...(budget !== undefined ? { budget: { max: round(budget) } } : {}), ...extra, ...(ok ? {} : why) })
  }
  const count = (name: string, subject: string, unit: string, value: number | null | undefined, determinism: BenchmarkMetric['determinism'] = 'deterministic') => {
    if (value === null || value === undefined || !Number.isFinite(value)) return
    metrics.push({ name, subject, unit, value, determinism, direction: 'informational' })
  }

  for (const r of runs) {
    const o = r.office
    for (const phase of ['idle-unloaded', 'idle', 'generating'] as const) {
      const s = r.frames.phases[phase]
      if (!s) continue
      const subject = `${o}/${phase}`
      const idle = phase !== 'generating'
      timing('frame.p50_ms', subject, s.p50, o === 'bricks' && idle ? SPIKE_TARGETS.idleP50Ms : undefined)
      timing('frame.p95_ms', subject, s.p95, o === 'bricks' && !idle && tier === 'low' ? SPIKE_TARGETS.generatingP95Ms : undefined, {
        statistics: { n: s.n, mean: round(s.mean), p50: round(s.p50), p95: round(s.p95), min: round(s.min), max: round(s.max) },
      })
      count('frames', subject, 'frames', s.n, 'environment-sensitive')
    }
    count('draw_calls', o, 'calls', r.counts.drawCalls, 'semi-deterministic')
    count('active_meshes', o, 'meshes', r.counts.activeMeshes, 'semi-deterministic')
    timing('scene.build_ms', o, r.counts.buildMs, undefined, {}, true)
    const b = r.counts.bricks
    if (b) {
      count('bricks.instances', 'bricks', 'parts', b.instances)
      count('bricks.studs', 'bricks', 'studs', b.studs)
      count('bricks.meshes', 'bricks', 'meshes', b.meshes)
      count('surfaces', 'bricks', 'surfaces', b.surfaces.monitors + b.surfaces.boards)
      timing('kit.load_ms', 'bricks', b.kitLoadMs, undefined, {}, true)
      timing('kit.shells_ms', 'layout', b.shellsMs, undefined, {}, true)
      for (const room of b.rooms) {
        count('chunk.instances', room.kind, 'parts', room.instances)
        count('chunk.studs', room.kind, 'studs', room.studs)
        count('chunk.meshes', room.kind, 'meshes', room.meshes + room.studMeshes)
        timing('chunk.compile_ms', room.kind, room.compileMs, undefined, {}, true)
        timing('chunk.mesh_ms', room.kind, room.meshMs, undefined, {}, true)
        timing('chunk.build_ms', room.kind, room.compileMs + room.meshMs, SPIKE_TARGETS.chunkBuildMs, {}, true)
      }
    }
  }

  const p = ctx.provenance
  return {
    schema: BENCHMARK_SCHEMA,
    name: `frame-time-bricks-${tier}`,
    feature_ids: ['FEAT-081', 'FEAT-082'],
    component: 'render',
    provenance: {
      ...(p.commit ? { commit: p.commit } : {}),
      ...(p.branch ? { branch: p.branch } : {}),
      ...(p.dirty !== null ? { dirty: p.dirty } : {}),
      generated_at: p.generatedAt,
      tool: TOOL,
    },
    build: { profile: 'harness' },
    machine: { os: ctx.machine.os, arch: ctx.machine.arch, cpus: ctx.machine.cpus, cpu_model: ctx.machine.cpuModel, runner: 'local' },
    workload: { scene: 'office', quality: tier, renderer, browser: runs[0]?.browser ?? null, backend: 'fake', offices: runs.map((r) => r.office).join(',') },
    metrics,
  }
}

export interface SpikeRow {
  criterion: string
  target: string
  measured: string
  verdict: 'go' | 'no-go' | 'inconclusive' | 'not measured'
}

/** The rows of section 8.5 the runs can fill (every tier's bricks run). */
export function spikeRows(runs: readonly BricksRun[], measuredOn: Conclusive): SpikeRow[] {
  const bricks = runs.filter((r) => r.office === 'bricks')
  const verdictOn = (conclusive: boolean) => (ok: boolean): SpikeRow['verdict'] => (!conclusive ? 'inconclusive' : ok ? 'go' : 'no-go')
  const verdict = verdictOn(measuredOn.frames)
  const cpuVerdict = verdictOn(measuredOn.cpu)
  const rows: SpikeRow[] = []
  for (const r of bricks) {
    const idle = r.frames.phases.idle ?? r.frames.phases['idle-unloaded']
    if (idle) rows.push({ criterion: `idle frame p50, ${r.quality}`, target: `≤ ${round(SPIKE_TARGETS.idleP50Ms, 1)} ms (60 fps)`, measured: `${round(idle.p50, 1)} ms`, verdict: verdict(idle.p50 <= SPIKE_TARGETS.idleP50Ms) })
  }
  const low = bricks.find((r) => r.quality === 'low')
  const gen = low?.frames.phases.generating
  rows.push(
    gen
      ? { criterion: 'frame p95 while generating, lowest tier', target: `≤ ${SPIKE_TARGETS.generatingP95Ms} ms`, measured: `${round(gen.p95, 1)} ms`, verdict: verdict(gen.p95 <= SPIKE_TARGETS.generatingP95Ms) }
      : { criterion: 'frame p95 while generating, lowest tier', target: `≤ ${SPIKE_TARGETS.generatingP95Ms} ms`, measured: 'not measured', verdict: 'not measured' },
  )
  const rooms = bricks[0]?.counts.bricks?.rooms ?? []
  for (const room of rooms) {
    const ms = room.compileMs + room.meshMs
    rows.push({ criterion: `chunk build, ${room.kind}`, target: `< ${SPIKE_TARGETS.chunkBuildMs} ms`, measured: `${round(ms, 1)} ms`, verdict: cpuVerdict(ms < SPIKE_TARGETS.chunkBuildMs) })
  }
  return rows
}
