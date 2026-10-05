/**
 * The llama.cpp backend (ADR-0066): upstream llama.cpp built for the browser
 * (public/vendor/llama/, `pnpm llama:runtime`), driven through our shim
 * (apps/game/llama/shim.cpp). It runs inside the LLM worker: the weights come
 * from OPFS (weights.ts) and are mounted read-only, the runtime module spawns
 * its own small pthread pool, and every GPU wait suspends through JSPI.
 *
 * One turn at a time, greedy, prompt-and-repair for structured output
 * (structured.ts). The MTP drafter is loaded only when the spec asks for it
 * (`mtp`), and is off by default: in the runtime spike it was slower and its
 * greedy output differed from the target's
 * (docs/qualification/2026-10-05-gemma4-e4b-llama-webgpu-spike.md).
 */
import { applyStop, runStructured, streamFromGenerate } from '../../structured'
import type {
  ChatMessage,
  GenerateOptions,
  GenerateResult,
  JsonSchema,
  LoadProgress,
  LocalLlm,
  RuntimeCapabilities,
  StructuredOptions,
} from '../../types'
import { JsonBalance } from '../bonsai/think'
import { ensureWeight, storedBytes, type WeightFile } from './weights'

export interface LlamaModelSpec {
  repo: string
  revision: string
  target: WeightFile
  draft: WeightFile
  /** Context window, tokens. */
  context: number
  /** Absolute URL of the runtime module (llama.mjs). */
  runtimeUrl: string
  /** Load the MTP drafter and use it for every turn. */
  mtp: boolean
  /** Most tokens the drafter proposes per step. */
  draftMax: number
}

export interface LlamaCppLlmOptions {
  resolve: (modelId: string) => LlamaModelSpec
  /** The worker's guarded fetch (local-only.ts). */
  fetch: typeof fetch
  /** Test seams: the runtime module and the weight store (default: the built llama.mjs and OPFS). */
  openRuntime?: (url: string, moduleArgs: object) => Promise<LlamaModule>
  weights?: { ensure: typeof ensureWeight; stored: typeof storedBytes }
  /** A runtime error the page should know about (the worker forwards it as a `gpu-error` event). */
  onEvent?: (e: { kind: 'gpu-error'; message: string }) => void
}

export interface LlamaModule {
  FS: { mkdir(p: string): void; mount(fs: unknown, opts: unknown, p: string): void; unmount(p: string): void }
  WORKERFS: unknown
  ccall(name: string, ret: string | null, types: string[], args: unknown[], opts?: { async?: boolean }): unknown
  onPiece?: (s: string) => void
  stopRequested?: boolean
}

interface TurnStats {
  ok: boolean
  error?: string
  promptTokens: number
  tokens: number
  targetSteps: number
  drafted: number
  accepted: number
  ttftMs: number
  decodeMs: number
  totalMs: number
  stopped: boolean
  eog: boolean
}

const LABEL = 'Gemma 4 E4B on llama.cpp (in-browser WebGPU)'
const MOUNT = '/models'

export class LlamaCppLlm implements LocalLlm {
  modelId: string | null = null
  private mod: LlamaModule | null = null
  private spec: LlamaModelSpec | null = null
  private nCtx: number | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private mtpTotals = { drafted: 0, accepted: 0 }

  constructor(private o: LlamaCppLlmOptions) {}

  async load(modelId: string, onProgress?: (p: LoadProgress) => void): Promise<void> {
    if (this.modelId === modelId && this.mod) return
    if (this.modelId) await this.dispose()
    const spec = this.o.resolve(modelId)
    const files = spec.mtp ? [spec.target, spec.draft] : [spec.target]
    const total = files.reduce((a, f) => a + f.size, 0)
    const loaded: Record<string, { loaded: number; total: number }> = {}
    const weights = this.o.weights ?? { ensure: ensureWeight, stored: storedBytes }
    for (const f of files) loaded[f.file] = { loaded: await weights.stored(f), total: f.size }
    const progress = (phase: LoadProgress['phase'], message: string, fromCache?: boolean): LoadProgress => {
      const sum = Object.values(loaded).reduce((a, x) => a + Math.min(x.loaded, x.total), 0)
      return { modelId, phase, files: { ...loaded }, loaded: sum, total, fraction: total ? Math.min(1, sum / total) : 0, message, ...(fromCache !== undefined ? { fromCache } : {}) }
    }

    const mounted: File[] = []
    for (const f of files) {
      const url = `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${f.file}`
      mounted.push(
        await weights.ensure(
          f,
          url,
          this.o.fetch,
          (p) => {
            loaded[p.file] = { loaded: p.loaded, total: p.total }
            onProgress?.(progress('download', p.cached ? 'Reading the browser cache' : 'Downloading the model', p.cached))
          },
          (message) => console.warn(`[llama] ${message}`),
        ),
      )
    }

    onProgress?.(progress('init', 'Loading onto the GPU'))
    if (!this.mod) {
      const moduleArgs = {
        print: () => undefined,
        printErr: (t: string) => {
          if (/error|failed|abort/i.test(t)) this.o.onEvent?.({ kind: 'gpu-error', message: t })
        },
      }
      this.mod = this.o.openRuntime
        ? await this.o.openRuntime(spec.runtimeUrl, moduleArgs)
        : await ((await import(/* @vite-ignore */ spec.runtimeUrl)).default as (o: object) => Promise<LlamaModule>)(moduleArgs)
      this.mod.FS.mkdir(MOUNT)
    } else {
      this.mod.FS.unmount(MOUNT)
    }
    this.mod.FS.mount(this.mod.WORKERFS, { files: mounted }, MOUNT)
    const status = JSON.parse(
      (await this.mod.ccall(
        'sp_load',
        'string',
        ['string', 'string', 'number', 'number'],
        [`${MOUNT}/${spec.target.file}`, spec.mtp ? `${MOUNT}/${spec.draft.file}` : '', spec.context, spec.draftMax],
        { async: true },
      )) as string,
    ) as { ok: boolean; error?: string; n_ctx?: number }
    if (!status.ok) throw new Error(`llama.cpp could not load ${modelId}: ${status.error}`)
    this.spec = spec
    this.nCtx = status.n_ctx ?? spec.context
    this.modelId = modelId
    onProgress?.(progress('ready', 'Ready'))
  }

  generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    const run = this.chain.then(() => this.generateNow(messages, opts))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async generateNow(messages: ChatMessage[], opts: GenerateOptions): Promise<GenerateResult> {
    const mod = this.mod
    const spec = this.spec
    if (!mod || !spec || !this.modelId) throw new Error('no model loaded')
    const maxTokens = Math.max(1, opts.maxTokens ?? 256)
    // Reasoning is not wired for this backend yet (capabilities say 'off'), so the answer prefix always applies.
    const prefix = opts.answerPrefix ?? ''

    mod.ccall('sp_chat_reset', null, [], [])
    for (const m of messages) mod.ccall('sp_chat_add', null, ['string', 'string'], [m.role, m.content])

    let text = prefix
    let sent = 0
    let stoppedBy: 'sequence' | 'json' | null = null
    let cancelled = false
    const balance = opts.stopOnJsonEnd ? new JsonBalance() : null
    if (balance && prefix) balance.push(prefix)
    const flush = (upTo: number) => {
      if (upTo > sent) {
        opts.onDelta?.(text.slice(sent, upTo))
        sent = upTo
      }
    }
    if (prefix) flush(prefix.length)

    mod.stopRequested = false
    mod.onPiece = (piece) => {
      if (stoppedBy || cancelled) return
      text += piece
      const cut = applyStop(text, opts.stop)
      if (cut.stopped) {
        text = cut.text
        stoppedBy = 'sequence'
        mod.stopRequested = true
        flush(text.length)
        return
      }
      flush(text.length - partialStop(text, opts.stop))
      if (balance?.push(piece)) {
        stoppedBy = 'json'
        mod.stopRequested = true
        flush(text.length)
      }
    }
    const onAbort = () => {
      cancelled = true
      mod.stopRequested = true
    }
    if (opts.signal?.aborted) onAbort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const stats = JSON.parse(
        (await mod.ccall('sp_generate', 'string', ['number', 'number', 'number', 'string'], [maxTokens, spec.mtp ? 1 : 0, 0, prefix], { async: true })) as string,
      ) as TurnStats
      if (!stats.ok) throw new Error(`llama.cpp: ${stats.error}`)
      if (!stoppedBy && !cancelled) flush(text.length)
      this.mtpTotals.drafted += stats.drafted
      this.mtpTotals.accepted += stats.accepted
      const completionTokens = stats.tokens
      return {
        text,
        finishReason: cancelled && !stoppedBy ? 'cancelled' : stoppedBy || stats.eog ? 'stop' : completionTokens >= maxTokens ? 'length' : 'stop',
        usage: {
          promptTokens: stats.promptTokens,
          completionTokens,
          durationMs: stats.totalMs,
          tokensPerSec: completionTokens > 1 && stats.decodeMs > 0 ? ((completionTokens - 1) * 1000) / stats.decodeMs : 0,
          prefillMs: stats.ttftMs,
          ttftMs: stats.ttftMs,
          cachedPromptTokens: 0,
        },
      }
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
      mod.onPiece = undefined
    }
  }

  stream(messages: ChatMessage[], opts: Omit<GenerateOptions, 'onDelta'> = {}): AsyncIterable<string> {
    return streamFromGenerate((m, o) => this.generate(m, o), messages, opts)
  }

  async structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    return (await runStructured<T>((m, o) => this.generate(m, o), messages, schema, { ...opts, stopOnJsonEnd: opts.stopOnJsonEnd ?? true })).value
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    const base: RuntimeCapabilities = {
      backend: 'llama-cpp',
      label: LABEL,
      webgpu: false,
      supportsConstrainedOutput: false,
      supportsPrefixReuse: false,
      supportsVision: false,
      reasoningModes: ['off'],
      contextTokens: this.nCtx,
    }
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<{ info?: Record<string, unknown>; features?: Iterable<string> } | null> } }).gpu
    if (!gpu) return { ...base, unavailable: 'this browser has no WebGPU' }
    if (!globalThis.crossOriginIsolated) return { ...base, unavailable: 'the page is not cross-origin isolated (the runtime needs shared memory for its threads)' }
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null)
    if (!adapter) return { ...base, unavailable: 'no WebGPU adapter' }
    const info = adapter.info ?? {}
    return {
      ...base,
      webgpu: true,
      device: {
        vendor: info.vendor,
        architecture: info.architecture,
        description: info.description,
        features: [...(adapter.features ?? [])],
        runtime: 'llama.cpp (ggml WebGPU, wasm64, JSPI)',
        mtp: this.spec?.mtp ?? null,
        draftMax: this.spec?.mtp ? this.spec.draftMax : null,
        mtpDrafted: this.mtpTotals.drafted,
        mtpAccepted: this.mtpTotals.accepted,
      },
    }
  }

  async resetSession(): Promise<void> {
    // Every turn starts from an empty cache; there is no prompt state to drop.
  }

  async dispose(): Promise<void> {
    await this.chain.catch(() => undefined)
    if (this.mod && this.modelId) await this.mod.ccall('sp_free', null, [], [], { async: true })
    this.modelId = null
    this.spec = null
    this.nCtx = null
  }
}

/** Length of the longest prefix of a stop sequence that `text` ends with. */
function partialStop(text: string, stop: string[] | undefined): number {
  let best = 0
  for (const s of stop ?? []) {
    for (let k = Math.min(s.length - 1, text.length); k > best; k--) {
      if (text.endsWith(s.slice(0, k))) {
        best = k
        break
      }
    }
  }
  return best
}
