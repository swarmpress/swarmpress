/**
 * Dev harness for llm.html: try models manually, and the hook the Playwright
 * e2e (e2e/llm.spec.ts) drives through `window.__llmHarness`.
 */
import { chooseModels, detectCapabilities, type Capabilities } from './capabilities'
import { LlmClient } from './client'
import { estimateDownload, formatBytes } from './download'
import { electLeader } from './leader'
import { DEFAULT_REGISTRY } from './registry.default'
import { TINY_MODEL_ENTRY } from './testing/tiny-model'
import type { DeviceKind, GenerateResult, LoadProgress } from './types'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const client = LlmClient.spawn({ registry: DEFAULT_REGISTRY })
let caps: Capabilities | null = null

export interface SmokeOptions {
  modelId?: string
  device?: DeviceKind
  prompt?: string
  maxTokens?: number
  temperature?: number
}

export interface SmokeReport {
  modelId: string
  device: DeviceKind
  loadMs: number
  progressEvents: number
  lastProgress: LoadProgress | null
  deltas: string[]
  result: GenerateResult
  webgpuAdapter: boolean
}

/** Load + stream one completion through the real worker. Used by the e2e test. */
async function runSmoke(o: SmokeOptions = {}): Promise<SmokeReport> {
  const modelId = o.modelId ?? TINY_MODEL_ENTRY.id
  const device = o.device ?? 'wasm'
  const progress: LoadProgress[] = []
  const t0 = performance.now()
  await client.load(modelId, (p) => progress.push(p), { device })
  const loadMs = performance.now() - t0
  const deltas: string[] = []
  const result = await client.generate([{ role: 'user', content: o.prompt ?? 'Good morning, newsroom! What is on the board today?' }], {
    maxTokens: o.maxTokens ?? 16,
    temperature: o.temperature ?? 0,
    onDelta: (d) => deltas.push(d),
  })
  caps ??= await detectCapabilities()
  return { modelId, device, loadMs, progressEvents: progress.length, lastProgress: progress.at(-1) ?? null, deltas, result, webgpuAdapter: caps.webgpu }
}

declare global {
  interface Window {
    __llmHarness?: { client: LlmClient; runSmoke: typeof runSmoke; electLeader: typeof electLeader; ready: Promise<void> }
  }
}

async function init() {
  const modelSel = $<HTMLSelectElement>('model')
  for (const m of [TINY_MODEL_ENTRY, ...DEFAULT_REGISTRY.models]) {
    const opt = document.createElement('option')
    opt.value = m.id
    const size = m.id === TINY_MODEL_ENTRY.id ? 'offline fixture' : estimateDownload(m.id, DEFAULT_REGISTRY).label.replace(`${m.id}: `, '')
    opt.textContent = `${m.id} (${m.tier}, ${size}${m.evalPending ? ', eval pending' : ''})`
    modelSel.append(opt)
  }

  caps = await detectCapabilities()
  const sel = chooseModels(caps, DEFAULT_REGISTRY, { allowEvalPending: true })
  $('caps').textContent = JSON.stringify(
    { capabilities: caps, selection: { tier: sel.tier, budget: formatBytes(sel.budgetBytes), byRole: sel.byRole, excluded: sel.excluded } },
    null,
    2,
  )
  if (!caps.webgpu) $<HTMLSelectElement>('device').value = 'wasm'

  let ac: AbortController | null = null
  $('load').addEventListener('click', async () => {
    $<HTMLButtonElement>('load').disabled = true
    $<HTMLButtonElement>('run').disabled = true
    const bar = $<HTMLProgressElement>('progress')
    try {
      await client.load(modelSel.value, (p) => {
        bar.value = p.fraction
        $('progress-label').textContent = `${p.phase} ${formatBytes(p.loaded)} / ${formatBytes(p.total)}`
      }, { device: $<HTMLSelectElement>('device').value as DeviceKind })
      $('progress-label').textContent = `ready: ${client.modelId}`
      $<HTMLButtonElement>('run').disabled = false
    } catch (e) {
      $('progress-label').textContent = `load failed: ${(e as Error).message}`
    } finally {
      $<HTMLButtonElement>('load').disabled = false
    }
  })

  $('run').addEventListener('click', async () => {
    const out = $('out')
    out.textContent = ''
    ac = new AbortController()
    $<HTMLButtonElement>('stop').disabled = false
    try {
      const res = await client.generate([{ role: 'user', content: $<HTMLTextAreaElement>('prompt').value }], {
        maxTokens: Number($<HTMLInputElement>('max').value),
        temperature: Number($<HTMLInputElement>('temp').value),
        signal: ac.signal,
        onDelta: (d) => (out.textContent += d),
      })
      const u = res.usage
      $('stats').textContent = `${res.finishReason} · ${u.promptTokens}+${u.completionTokens} tok · ${u.tokensPerSec.toFixed(1)} tok/s · ${u.durationMs.toFixed(0)} ms`
    } catch (e) {
      $('stats').textContent = `error: ${(e as Error).message}`
    } finally {
      $<HTMLButtonElement>('stop').disabled = true
    }
  })
  $('stop').addEventListener('click', () => ac?.abort())
}

const ready = init()
window.__llmHarness = { client, runSmoke, electLeader, ready }
