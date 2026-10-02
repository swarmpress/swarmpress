/**
 * Node only (Playwright runner, vitest): writes the files of a qualification
 * run. Never import this from page code.
 *
 *   artifacts/bench/raw/bench-<backend>.<machine>.<label>.json   what the page measured (git-ignored)
 *   artifacts/bench/model-eval-<backend>.<machine>[.<label>].json  cockpit.benchmark.v1, `bench/model-eval`
 *   artifacts/bench/frame-time-llm-<tier>[.<backend>].json         cockpit.benchmark.v1, `bench/frame-time`
 *   <qualification dir>/<date>-<backend>-<machine>.md              the go/no-go report over every raw run kept
 *
 * The qualification directory is `docs/qualification/` (committed) for real
 * backends and `artifacts/bench/qualification/` for the scripted one, so a
 * test run never leaves a report in the tree.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'
import type { BenchResults } from './metrics'
import {
  frameTimeDoc,
  frameTimeFile,
  machineSlug,
  modelEvalDoc,
  modelEvalFile,
  overallVerdict,
  qualificationFile,
  qualificationMarkdown,
  qualify,
  rawFile,
  runLabel,
  validateBenchmarkDoc,
  type Machine,
  type Overall,
  type Provenance,
  type QualificationExtras,
  type ReportContext,
  type Row,
} from './report'

/** What the runner adds to a run's raw file: checks it made outside the page. */
export interface RawFile {
  results: BenchResults
  extras: QualificationExtras
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

export function provenance(root: string, generatedAt = new Date()): Provenance {
  const status = git(root, ['status', '--porcelain', '--untracked-files=no'])
  return {
    commit: git(root, ['rev-parse', 'HEAD']),
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: status === null ? null : status.length > 0,
    generatedAt: generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
}

/** This machine, the way the reports name it. `BENCH_MACHINE` overrides the file-name slug. */
export function machine(env: Record<string, string | undefined> = process.env): Machine {
  const list = cpus()
  const cpuModel = (list[0]?.model ?? 'unknown cpu').trim()
  const os = platform() === 'darwin' ? 'macos' : platform() === 'win32' ? 'windows' : platform()
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch
  let osVersion: string | undefined = release()
  if (platform() === 'darwin') {
    try {
      osVersion = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      /* the kernel release will do */
    }
  }
  const memoryBytes = totalmem()
  const slug = env.BENCH_MACHINE?.trim() || machineSlug(cpuModel, memoryBytes)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`BENCH_MACHINE=${slug}: use lowercase letters, digits and dashes`)
  return { slug, os, arch, cpus: list.length, cpuModel, memoryGb: Math.round(memoryBytes / 1024 ** 3), osVersion }
}

export function reportContext(root: string, env: Record<string, string | undefined> = process.env, at = new Date()): ReportContext {
  return { provenance: provenance(root, at), machine: machine(env) }
}

const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

/** The raw runs kept for one backend on one machine. */
export function readRaw(rawDir: string, backend: string, machineSlug: string): { file: string; raw: RawFile }[] {
  if (!existsSync(rawDir)) return []
  const prefix = `bench-${backend}.${machineSlug}.`
  return readdirSync(rawDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, raw: JSON.parse(readFileSync(join(rawDir, f), 'utf8')) as RawFile }))
}

/** Extras over several runs: the latest golden check, the highest GPU process peak. */
export function mergeExtras(list: QualificationExtras[]): QualificationExtras {
  const out: QualificationExtras = {}
  for (const e of list) {
    if (e.golden) out.golden = e.golden
    if (typeof e.gpuProcessPeakRssBytes === 'number') out.gpuProcessPeakRssBytes = Math.max(out.gpuProcessPeakRssBytes ?? 0, e.gpuProcessPeakRssBytes)
  }
  return out
}

export interface WriteOptions {
  /** The repository root. */
  root: string
  results: BenchResults
  extras?: QualificationExtras
  /** Where the Markdown goes. Default: docs/qualification for real backends, artifacts/bench/qualification for the scripted one. */
  qualificationDir?: string
  /** Overrides the run's label in the file names. */
  label?: string
  context?: ReportContext
}

export interface Written {
  label: string
  raw: string
  modelEval: string
  frameTime: string | null
  qualification: string
  rows: Row[]
  verdict: Overall
}

/** Writes the raw results, the Cockpit documents and the qualification report of a run. Refuses to write a document Cockpit would misread. */
export function writeRun(o: WriteOptions): Written {
  const ctx = o.context ?? reportContext(o.root)
  const r = o.results
  const label = o.label ?? runLabel(r)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) throw new Error(`run label "${label}": use lowercase letters, digits and dashes`)
  const benchDir = join(o.root, 'artifacts', 'bench')
  const rawDir = join(benchDir, 'raw')
  mkdirSync(rawDir, { recursive: true })

  const raw = join(rawDir, rawFile(r.backend, ctx.machine.slug, label))
  writeJson(raw, { results: r, extras: o.extras ?? {} } satisfies RawFile)

  const evalDoc = modelEvalDoc(r, ctx)
  const evalProblems = validateBenchmarkDoc(evalDoc)
  if (evalProblems.length) throw new Error(`the model-eval document is not a valid cockpit.benchmark.v1 document: ${evalProblems.join('; ')}`)
  const modelEval = join(benchDir, modelEvalFile(r.backend, ctx.machine.slug, label))
  writeJson(modelEval, evalDoc)

  let frameTime: string | null = null
  const frames = frameTimeDoc(r, ctx)
  if (frames) {
    const problems = validateBenchmarkDoc(frames)
    if (problems.length) throw new Error(`the frame-time document is not a valid cockpit.benchmark.v1 document: ${problems.join('; ')}`)
    frameTime = join(benchDir, frameTimeFile(frames.workload.quality as string, r.backend))
    writeJson(frameTime, frames)
  }

  const qualification = writeQualification({ root: o.root, backend: r.backend, context: ctx, qualificationDir: o.qualificationDir })
  return { label, raw, modelEval, frameTime, ...qualification }
}

/** (Re)writes the qualification report of one backend on this machine from every raw run kept for it. */
export function writeQualification(o: { root: string; backend: string; context?: ReportContext; qualificationDir?: string }): { qualification: string; rows: Row[]; verdict: Overall } {
  const ctx = o.context ?? reportContext(o.root)
  const rawDir = join(o.root, 'artifacts', 'bench', 'raw')
  const kept = readRaw(rawDir, o.backend, ctx.machine.slug)
  if (kept.length === 0) throw new Error(`no raw results for ${o.backend} on ${ctx.machine.slug} in ${rawDir}`)
  const runs = kept.map((k) => k.raw.results)
  const extras = mergeExtras(kept.map((k) => k.raw.extras ?? {}))
  const dir = o.qualificationDir ?? join(o.root, ...(o.backend === 'fake' ? ['artifacts', 'bench', 'qualification'] : ['docs', 'qualification']))
  mkdirSync(dir, { recursive: true })
  const qualification = join(dir, qualificationFile(ctx.provenance.generatedAt.slice(0, 10), o.backend, ctx.machine.slug))
  writeFileSync(qualification, qualificationMarkdown({ runs, context: ctx, extras, sources: kept.map((k) => `artifacts/bench/raw/${k.file}`) }))
  const rows = qualify(runs, extras)
  return { qualification, rows, verdict: overallVerdict(rows) }
}
