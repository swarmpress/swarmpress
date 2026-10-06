/**
 * A `ToolRun` job in the browser (ADR-0072 §3.5, §7; FEAT-091 T-1, FEAT-092 X-1).
 *
 * The sim asks for a run of an installed tool (on demand, or by its schedule
 * at 06:00) with the tool's ref as the request's `brief_ref`. The host:
 *
 * 1. finds the tool by its ref in the site's models;
 * 2. decides the runs: a tool without inputs runs once (key `latest`); a tool
 *    bound to a slot of a page type runs once per page of that type (at most
 *    {@link MAX_PAGE_RUNS}), its inputs read from the page through the
 *    binding's closed context paths (`page.*`, `site.*`), keyed by the page's
 *    file name; a tool that needs inputs and is bound nowhere cannot run on
 *    its own, and the job fails loudly (rule 11);
 * 3. runs each in the sandbox (`runner.ts`) and writes every bound or
 *    input-free output as site data (`PUT /api/site/data`, validated there);
 * 4. answers the sim with a digest: `ok` when every run succeeded,
 *    `qa_defects` the failed runs, `artifact_sha` over the outputs. A
 *    `keep-last` tool's failed run writes nothing: the last good data stays.
 *
 * The outcome is the orchestrator's JSON (`[{JobCompleted|JobFailed: …}]`),
 * so the loop logs it like any other job's.
 */
import type { SiteModels, SiteTool } from '../blueprint/types'
import { artifactSha, runTool, toolOfRef, type ToolHostFacilities } from './runner'

/** Pages one run of a bound tool covers at most. */
export const MAX_PAGE_RUNS = 20

export interface PackPage {
  path: string
  page_type: string
}

export interface ToolJobDeps {
  models: SiteModels | null
  /** The routed pages of the knowledge pack. */
  pages: readonly PackPage[]
  /** A page's JSON at the base head (`GET /api/gateway/file`). */
  readPage(path: string): Promise<unknown | null>
  facilities: ToolHostFacilities
  /** `PUT /api/site/data`. */
  putData(body: { tool: string; key: string; port?: string; value: unknown }): Promise<{ changed: boolean }>
  site: { name: string; base_url?: string }
  log?: (line: string) => void
}

export interface ToolJob {
  job_id: number
  /** The request's `brief_ref`: the tool's ref. */
  tool_ref: number
}

type Outcome = { JobCompleted: { job_id: number; digest: { ok: boolean; score: number; words: number; qa_defects: number; artifact_sha: string } } } | { JobFailed: { job_id: number; reason: string } }

const failed = (job_id: number, reason: string, deps: ToolJobDeps, why: string): string => {
  deps.log?.(`tool run ${job_id}: ${why}`)
  return JSON.stringify([{ JobFailed: { job_id, reason } }] satisfies Outcome[])
}

/** A closed context path (`page.title`, `site.name`) read from the run's context; a LocalizedString becomes its English text. */
export function readContext(path: string, ctx: { page?: unknown; site: unknown; item?: unknown }): unknown {
  const [root, ...rest] = path.split('.')
  if (root !== 'page' && root !== 'site' && root !== 'item') return undefined
  let v: unknown = (ctx as Record<string, unknown>)[root]
  for (const k of rest) {
    if (v == null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[k]
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).en === 'string') {
    const o = v as Record<string, unknown>
    if (Object.values(o).every((x) => typeof x === 'string')) return o.en
  }
  return v
}

/** The bindings of `tool` in the blueprint: page type, the output port, the inputs' context paths. */
export function bindingsOf(models: SiteModels, tool: SiteTool): { pageType: string; output?: string; inputs: Record<string, string> }[] {
  const out: { pageType: string; output?: string; inputs: Record<string, string> }[] = []
  for (const t of models.blueprint.page_types) {
    for (const s of t.slots ?? []) {
      if (s.source?.tool === tool.id) out.push({ pageType: t.id, output: s.source.output, inputs: s.source.inputs ?? {} })
    }
  }
  return out
}

const stem = (path: string) => (path.split('/').pop() ?? path).replace(/\.json$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

/** Runs one `ToolRun` job; resolves with the orchestrator-shaped outcomes JSON. */
export async function runToolJob(job: ToolJob, deps: ToolJobDeps): Promise<string> {
  const models = deps.models
  if (!models) return failed(job.job_id, 'Infrastructure', deps, 'the site models are not loaded yet')
  const tool = toolOfRef(models.tools, job.tool_ref)
  if (!tool) return failed(job.job_id, 'Infrastructure', deps, `no installed tool has ref ${job.tool_ref}`)
  if (tool.issues.length) return failed(job.job_id, 'InvalidOutput', deps, `${tool.id} does not check (${tool.issues.length} issues)`)

  const inputs = Object.keys(tool.graph.inputs ?? {})
  const bindings = bindingsOf(models, tool)
  const runs: { key: string; input: Record<string, unknown>; port?: string }[] = []
  if (!inputs.length) {
    runs.push({ key: 'latest', input: {}, port: bindings[0]?.output })
  } else if (bindings.length) {
    for (const b of bindings) {
      const pages = deps.pages
        .filter((p) => p.page_type === b.pageType || p.page_type.toLowerCase().replace(/_/g, '-') === b.pageType)
        .slice(0, MAX_PAGE_RUNS)
      for (const p of pages) {
        const page = await deps.readPage(p.path)
        if (!page) continue
        const input: Record<string, unknown> = {}
        for (const name of inputs) {
          const path = b.inputs[name]
          if (path) input[name] = readContext(path, { page, site: deps.site })
        }
        runs.push({ key: stem(p.path), input, port: b.output })
      }
    }
    if (!runs.length) return failed(job.job_id, 'NeedsPage', deps, `${tool.id} is bound to page types without pages`)
  } else {
    return failed(job.job_id, 'InvalidOutput', deps, `${tool.id} needs inputs and is bound to no page type: it runs only when called`)
  }

  const types = models.types as Record<string, unknown>
  let failures = 0
  const outputs: Record<string, unknown> = {}
  for (const r of runs) {
    const result = await runTool(tool, types, r.input, deps.facilities)
    if (!result.ok) {
      failures++
      deps.log?.(`tool ${tool.id} (${r.key}) failed: ${result.error ?? 'unknown'}`)
      continue
    }
    const ports = Object.keys(result.outputs)
    const port = r.port ?? (ports.length === 1 ? ports[0] : undefined)
    if (!port) {
      failures++
      deps.log?.(`tool ${tool.id} (${r.key}): name one output in the binding (${ports.join(', ')})`)
      continue
    }
    outputs[r.key] = result.outputs[port]
    const w = await deps.putData({ tool: tool.id, key: r.key, port, value: result.outputs[port] })
    deps.log?.(`tool ${tool.id} (${r.key}) ${w.changed ? 'wrote' : 'kept'} content/data/${tool.id}/${r.key}.json`)
  }
  const sha = await artifactSha(outputs)
  const digest = {
    ok: failures === 0,
    score: 0,
    words: 0,
    qa_defects: failures,
    artifact_sha: sha.map((b) => b.toString(16).padStart(2, '0')).join(''),
  }
  return JSON.stringify([{ JobCompleted: { job_id: job.job_id, digest } }] satisfies Outcome[])
}

/** The routed pages of a knowledge pack's JSON text (`pages[].path`, `page_type`); none without a pack. */
export function packPages(packText: string | undefined): PackPage[] {
  if (!packText) return []
  try {
    const pack = JSON.parse(packText) as { pages?: { path?: string; page_type?: string }[] }
    return (pack.pages ?? []).filter((p): p is PackPage => typeof p.path === 'string' && typeof p.page_type === 'string')
  } catch {
    return []
  }
}
