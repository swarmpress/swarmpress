/**
 * Running the site's tools in the browser (ADR-0072 §7, FEAT-091 T-1).
 *
 * A tool runs in the QuickJS sandbox (CLAUDE.md rule 14), with the one
 * interpreter bundle (`@swarm-press/toolgraph/runtime.js`) and the graph as
 * the call's data. The sandbox's capabilities and fetch origins are the
 * tool's derived manifest, so the sandbox, not the graph, decides what can be
 * reached. The sandbox's web goes through the central server's fetch proxy
 * (CORS, SSRF guard, rate limit; ADR-0040); an agent step goes to the hosted
 * model. Results are data: the caller turns them into a sim digest and,
 * for bound tools, a data file (`PUT /api/site/data`).
 */
import type { HostLlm, HostWeb } from '@swarm-press/sandbox'
import { parseToolGraph } from '@swarm-press/toolgraph'
import type { RunResult } from '@swarm-press/toolgraph/interpret'
import runtimeJs from '@swarm-press/toolgraph/runtime.js?raw'
import type { SiteTool } from '../blueprint/types'
import { signRequest, type CredentialStore } from './credentials'

/** What the browser gives a tool. */
export interface ToolHostFacilities {
  /** `GET /web/fetch?url=`: the central proxy (status, content type, body text). */
  webFetch(url: string): Promise<{ status: number; contentType: string; text: string }>
  /** One completion on the hosted model for an agent step (`tier` low, mid or high). */
  llm?(tier: string, prompt: string): Promise<string>
  /**
   * `POST /web/request` (ADR-0076): any method, the answer raw. With it every
   * request of a tool goes there; without it a tool may only GET.
   */
  webRequest?(req: { url: string; method: string; headers: Record<string, string>; body: string | null }): Promise<{ status: number; contentType: string; headers: Record<string, string>; body: string }>
  /** The player's credentials: a request naming one is signed here, outside the sandbox. */
  credentials?: CredentialStore
}

/** The tool's ref in the sim: the first 6 bytes of its hash, big-endian (exact in a JS number). */
export function toolRef(hashHex: string): number {
  return Number.parseInt(hashHex.slice(0, 12), 16)
}

/** The site tool a sim ref names. */
export function toolOfRef(tools: readonly SiteTool[], ref: number): SiteTool | undefined {
  return tools.find((t) => toolRef(t.hash) === ref)
}

/** The sim's facts of a tool (`ServerCommand::ToolsChanged`): schedule and the agent step's role. */
export function toolStub(t: SiteTool): { tool_ref: number; schedule_days: number; role: string | null } {
  const schedule = (t.graph.triggers ?? []).find((x) => x.kind === 'schedule') as { every_game_days?: number } | undefined
  const agent = t.graph.nodes.find((n) => n.kind === 'agent') as { role?: string } | undefined
  return { tool_ref: toolRef(t.hash), schedule_days: schedule?.every_game_days ?? 0, role: agent?.role ?? null }
}

let sandboxModule: Promise<typeof import('@swarm-press/sandbox')> | null = null
/** The sandbox, its QuickJS wasm served by Vite (outside Bun the sandbox needs it handed over). */
const loadSandbox = () =>
  (sandboxModule ??= (async () => {
    const mod = await import('@swarm-press/sandbox')
    const { default: url } = await import('@jitl/quickjs-wasmfile-release-sync/wasm?url')
    mod.configureQuickJS({ wasmBinary: await quickjsBytes(url) })
    return mod
  })())

/** The wasm's bytes: fetched in the browser, read from disk under Node (tests). */
async function quickjsBytes(url: string): Promise<ArrayBuffer> {
  if (typeof process !== 'undefined' && process.versions?.node && url.startsWith('/')) {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const path = url.startsWith('/@fs/') ? url.slice(4) : resolve(process.cwd(), '.' + url)
    const b = await readFile(path)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
  return await (await fetch(url)).arrayBuffer()
}

/**
 * Runs `tool` with `input` in a fresh sandbox under its manifest; `types` are
 * the site's types. Never throws for a failed run (`ok: false`); throws when
 * the sandbox refuses a capability (a graph that reaches beyond its manifest).
 */
export async function runTool(
  tool: SiteTool,
  types: Record<string, unknown>,
  input: unknown,
  host: ToolHostFacilities,
  opts: { replay?: Record<string, unknown> } = {},
): Promise<RunResult> {
  const graph = parseToolGraph(JSON.stringify(tool.graph))
  const manifest = tool.manifest as { capabilities?: string[]; origins?: string[] }
  const web: HostWeb = async (raw) => {
    const named = Object.keys(raw.headers).some((k) => k.toLowerCase() === 'x-swarmpress-credential')
    if (named && !host.credentials) throw new Error('this tool signs in with a credential, and this browser holds none')
    const req = named ? signRequest(raw, host.credentials!) : raw
    if (host.webRequest) {
      const r = await host.webRequest({ url: req.url, method: req.method, headers: req.headers, body: req.body })
      return { status: r.status, headers: { ...r.headers, 'content-type': r.contentType }, body: r.body, url: req.url }
    }
    if (req.method !== 'GET' || named) throw new Error(`a tool may only GET here (${req.method} ${req.url})`)
    const r = await host.webFetch(req.url)
    return { status: r.status, headers: { 'content-type': r.contentType }, body: r.text, url: req.url }
  }
  const llm: HostLlm | undefined = host.llm
    ? async (req) => ({ text: await host.llm!(req.tier, req.prompt) })
    : undefined
  const { createSandbox } = await loadSandbox()
  const sb = await createSandbox({
    capabilities: manifest.capabilities ?? [],
    ...(manifest.origins ? { origins: manifest.origins } : {}),
    host: { web, ...(llm ? { llm } : {}) },
    limits: { wallMs: 30_000 },
  })
  try {
    await sb.load(runtimeJs, 'toolgraph-runtime.js')
    return await sb.call<RunResult>('runTool', { tool: 'run', input: { graph, types, input, ...(opts.replay ? { replay: opts.replay } : {}) } })
  } finally {
    sb.dispose()
  }
}

/** First 16 bytes of the SHA-256 of a value's JSON, as the sim's `artifact_sha`. */
export async function artifactSha(value: unknown): Promise<number[]> {
  const bytes = new TextEncoder().encode(JSON.stringify(value ?? null))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest.slice(0, 16))
}
