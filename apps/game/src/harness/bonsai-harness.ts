/**
 * bonsai.html: the in-browser WebGPU model runtime, by hand and for the gated
 * e2e (`BONSAI_E2E=1`), through `window.__bonsai`:
 *
 * - `probe()`       what this device and browser offer, without loading anything
 * - `smoke()`       load the model in the LLM worker; stream a turn that has a
 *                   system message; cancel one; one turn with reasoning
 * - `equivalence()` the unmodified upstream engine on the main thread against
 *                   the worker adapter, on the fixed prompts (token ids)
 *
 * Only one copy of the model is resident at a time: `equivalence()` disposes
 * the main-thread session before the worker loads.
 */
import { LlmClient } from '../llm/client'
import { DEFAULT_REGISTRY } from '../llm/registry.default'
import { importVerifiedEngine } from '../llm/runtime/bonsai/bonsai-llm'
import { compareIds, EQUIVALENCE_PROMPTS, EQUIVALENCE_TOKENS, goldenKey, type EquivalenceGolden, type Mismatch } from '../llm/runtime/bonsai/equivalence'
import { bonsaiManifest } from '../llm/runtime/bonsai/manifest'
import { mergeSystem, templateArgs } from '../llm/runtime/bonsai/think'
import type { UpstreamDeviceInfo } from '../llm/runtime/bonsai/upstream'
import type { BenchResult } from '../llm/protocol'
import type { ChatMessage, GenerateResult, LoadProgress, RuntimeCapabilities } from '../llm/types'

const MODEL_ID = 'ternary-bonsai-2-27b'
const $ = (id: string) => document.getElementById(id) as HTMLElement

const status = (text: string) => {
  $('status').textContent = text
}
const log = (line: string) => {
  $('log').textContent += `${line}\n`
}
const onProgress = (where: string) => (p: LoadProgress) =>
  status(`${where}: ${p.phase} ${(p.fraction * 100).toFixed(1)}%${p.message ? ` (${p.message})` : ''}`)

const events: { kind: string; message: string }[] = []

function spawn(): LlmClient {
  return LlmClient.spawn({ registry: DEFAULT_REGISTRY, onEvent: (e) => events.push(e) })
}

export interface SmokeReport {
  loadMs: number
  capabilities: RuntimeCapabilities
  /** A turn with a system message, streamed. */
  turn: GenerateResult
  deltas: number
  /** The same system prompt again: its prefix must come from the cache. */
  second: GenerateResult
  cancelled: GenerateResult
  reasoned: GenerateResult
  events: { kind: string; message: string }[]
}

const SYSTEM = 'You are Giulia, a travel writer at a small newsroom in the Cinque Terre. Write plainly.'

async function probe(): Promise<RuntimeCapabilities> {
  const client = spawn()
  try {
    return await client.capabilities(MODEL_ID)
  } finally {
    await client.dispose()
  }
}

async function smoke(): Promise<SmokeReport> {
  const client = spawn()
  try {
    const t0 = performance.now()
    await client.load(MODEL_ID, onProgress('worker'))
    const loadMs = performance.now() - t0
    const capabilities = await client.capabilities()
    status('generating')
    let deltas = 0
    const ask = (text: string): ChatMessage[] => [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text },
    ]
    const turn = await client.generate(ask('Write one sentence about the morning ferry from Vernazza.'), { maxTokens: 64, onDelta: () => deltas++ })
    const second = await client.generate(ask('Write one sentence about the vineyards above Manarola.'), { maxTokens: 64 })
    const ac = new AbortController()
    const cancelled = await client.generate(ask('Write five paragraphs about the history of Riomaggiore.'), {
      maxTokens: 512,
      signal: ac.signal,
      onDelta: () => ac.abort(),
    })
    const reasoned = await client.generate(ask('Which village has no harbour? Answer in one word.'), { maxTokens: 32, thinking: 'medium', reasoningBudget: 256 })
    status('done')
    return { loadMs, capabilities, turn, deltas, second, cancelled, reasoned, events: events.slice() }
  } finally {
    await client.dispose()
  }
}

export interface EquivalenceReport {
  key: string
  device: UpstreamDeviceInfo
  current: EquivalenceGolden
  /** Upstream on the main thread vs the adapter's path in the worker. */
  adapterMismatches: Mismatch[]
  /** Upstream on the main thread vs upstream's own benchmark in the worker (the Worker and the shims change nothing). */
  workerMismatches: Mismatch[]
  reference: { promptTokens: number; ttftMs: number; decodeTps: number }[]
  adapter: BenchResult[]
}

async function equivalence(maxNewTokens = EQUIVALENCE_TOKENS): Promise<EquivalenceReport> {
  const m = bonsaiManifest(MODEL_ID)
  if (!m) throw new Error(`no manifest for ${MODEL_ID}`)
  status('main thread: importing the engine')
  const engine = await importVerifiedEngine({ url: new URL(m.runtime.url, location.origin).href, sha256: m.runtime.sha256 })
  const session = await engine.TernaryBonsai2.load(m.repo, {
    file: m.file,
    revision: m.revision,
    maxLength: m.context,
    prefixSnapshotStore: null,
    chatTemplateArgs: templateArgs('off'),
    onProgress: (p) => status(`main thread: ${p.status} ${p.message ?? ''}`),
  })
  const expected: number[][] = []
  const reference: EquivalenceReport['reference'] = []
  const device: UpstreamDeviceInfo = session.deviceInfo()
  try {
    for (const [i, messages] of EQUIVALENCE_PROMPTS.entries()) {
      status(`main thread: prompt ${i + 1} of ${EQUIVALENCE_PROMPTS.length}`)
      session.chatTemplateArgs = templateArgs('off')
      const ids = session.encodePrompt(mergeSystem(messages))
      const r = await session.benchmarkFixedTokenIds(ids, maxNewTokens, {})
      expected.push(r.ids)
      reference.push({ promptTokens: ids.length, ttftMs: r.ttftMs, decodeTps: r.decodeTps })
    }
  } finally {
    session.dispose()
  }

  const client = spawn()
  const adapter: BenchResult[] = []
  const worker: number[][] = []
  try {
    await client.load(MODEL_ID, onProgress('worker'))
    for (const [i, messages] of EQUIVALENCE_PROMPTS.entries()) {
      status(`worker: prompt ${i + 1} of ${EQUIVALENCE_PROMPTS.length}`)
      adapter.push(await client.bench({ messages, maxNewTokens, mode: 'adapter' }))
      worker.push((await client.bench({ messages, maxNewTokens, mode: 'upstream' })).ids)
    }
  } finally {
    await client.dispose()
  }
  status('done')
  return {
    key: goldenKey(device),
    device,
    current: { engineSha256: m.runtime.sha256, modelRevision: m.revision, maxNewTokens, ids: expected },
    adapterMismatches: compareIds(
      expected,
      adapter.map((a) => a.ids),
    ),
    workerMismatches: compareIds(expected, worker),
    reference,
    adapter,
  }
}

declare global {
  interface Window {
    __bonsai?: { probe: typeof probe; smoke: typeof smoke; equivalence: typeof equivalence; crossOriginIsolated: boolean }
  }
}

window.__bonsai = { probe, smoke, equivalence, crossOriginIsolated: globalThis.crossOriginIsolated }

const run = (name: string, fn: () => Promise<unknown>) => async () => {
  log(`> ${name}`)
  try {
    log(JSON.stringify(await fn(), null, 2))
  } catch (e) {
    status(`${name} failed`)
    log(`error: ${(e as Error).message}`)
  }
}
$('probe').addEventListener('click', run('probe', probe))
$('smoke').addEventListener('click', run('smoke', smoke))
$('equivalence').addEventListener('click', run('equivalence', () => equivalence()))
status(`ready (cross-origin isolated: ${globalThis.crossOriginIsolated})`)
