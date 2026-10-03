/**
 * Main-thread RPC client for the LLM worker. Implements LocalLlm, so game
 * code can use the worker exactly like an in-process adapter. Structured
 * output runs here, on top of the worker's generate, so the validator (the
 * Rust one from orchestrator-wasm) stays on the main thread.
 *
 *   const llm = LlmClient.spawn({ registry })
 *   await llm.load('ternary-bonsai-2-27b', (p) => bar.set(p.fraction))
 *   for await (const d of llm.stream(messages)) bubble.append(d)
 */
import type { BenchRequest, BenchResult, Endpoint, FromWorker, ModelSpec, RuntimeEventKind, ToWorker, WireGenerateOptions } from './protocol'
import { findModel, type ModelRegistry } from './registry'
import { bonsaiManifest } from './runtime/bonsai/manifest'
import { runStructured, streamFromGenerate } from './structured'
import { TINY_MODEL_ENTRY } from './testing/tiny-model'
import {
  LlmCancelledError,
  type ChatMessage,
  type DeviceKind,
  type GenerateOptions,
  type GenerateResult,
  type JsonSchema,
  type LoadProgress,
  type LocalLlm,
  type RuntimeCapabilities,
  type StructuredOptions,
} from './types'

interface Pending {
  resolve(v: unknown): void
  reject(e: Error): void
  onProgress?: (p: LoadProgress) => void
  onDelta?: (d: string) => void
}

export interface LlmClientOptions {
  registry?: ModelRegistry
  /** Custom id → spec mapping (wins over the registry). */
  resolveSpec?: (modelId: string) => ModelSpec | undefined
  /** Called with every progress event of any load (UI: "installing the newsroom's brains"). */
  onProgress?: (p: LoadProgress) => void
  /** The worker lost its GPU device or hit a GPU error; the model must be loaded again. */
  onEvent?: (e: { kind: RuntimeEventKind; message: string }) => void
  /** Start the worker with its test hooks on (`destroyDevice`). Tests and the qualification harness only. */
  debug?: boolean
}

export class LlmWorkerError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name === 'Error' ? 'LlmWorkerError' : name
  }
}

export class LlmClient implements LocalLlm {
  modelId: string | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private terminate?: () => void
  private closed = false
  /** The spec of the last load, so `capabilities()` can probe before the model is ready. */
  private lastSpec: ModelSpec | undefined

  constructor(
    private ep: Endpoint,
    private o: LlmClientOptions = {},
  ) {
    ep.addEventListener('message', this.onMessage)
    ep.start?.()
  }

  /** Spawn the module worker (Vite bundles worker.ts as its own chunk). */
  static spawn(o: LlmClientOptions = {}): LlmClient {
    // The name carries the debug flag: the worker reads it before the first message (worker.ts).
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: o.debug ? 'swarmpress-llm:debug' : 'swarmpress-llm' })
    const client = new LlmClient(worker as unknown as Endpoint, o)
    client.terminate = () => worker.terminate()
    worker.addEventListener('error', (e) => client.failAll(new Error(`LLM worker crashed: ${e.message}`)))
    return client
  }

  private onMessage = (ev: MessageEvent) => {
    const msg = ev.data as FromWorker
    if (msg.type === 'event') {
      // A lost device takes the model with it.
      if (msg.kind === 'device-lost') this.modelId = null
      this.o.onEvent?.({ kind: msg.kind, message: msg.message })
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    switch (msg.type) {
      case 'progress':
        p.onProgress?.(msg.progress)
        this.o.onProgress?.(msg.progress)
        break
      case 'delta':
        p.onDelta?.(msg.text)
        break
      case 'result':
        this.pending.delete(msg.id)
        p.resolve(msg.value)
        break
      case 'error':
        this.pending.delete(msg.id)
        p.reject(new LlmWorkerError(msg.error.name, msg.error.message))
        break
    }
  }

  private call<T>(msg: ToWorker, extra: Omit<Pending, 'resolve' | 'reject'> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('LlmClient disposed'))
    return new Promise<T>((resolve, reject) => {
      this.pending.set(msg.id, { resolve: resolve as (v: unknown) => void, reject, ...extra })
      this.ep.postMessage(msg)
    })
  }

  private failAll(e: Error) {
    for (const p of this.pending.values()) p.reject(e)
    this.pending.clear()
  }

  resolveSpec(modelId: string, opts: { device?: DeviceKind; dtype?: string } = {}): ModelSpec {
    const custom = this.o.resolveSpec?.(modelId)
    if (custom) return { ...custom, ...(opts.device ? { device: opts.device } : {}), ...(opts.dtype ? { dtype: opts.dtype } : {}) }
    if (modelId === TINY_MODEL_ENTRY.id) {
      return {
        id: modelId,
        hfRepo: TINY_MODEL_ENTRY.hfRepo,
        dtype: 'fp32',
        device: opts.device ?? 'wasm',
        sizeBytes: TINY_MODEL_ENTRY.sizeBytes,
        fixture: 'tiny-random-llama',
      }
    }
    const m = this.o.registry ? findModel(this.o.registry, modelId) : undefined
    if (!m) throw new Error(`unknown model "${modelId}" (not in registry)`)
    // A pinned manifest selects the Bonsai WebGPU runtime; it must describe the same file as the registry.
    const manifest = bonsaiManifest(modelId)
    if (manifest) {
      if (manifest.repo !== m.hfRepo) throw new Error(`model "${modelId}": the manifest (${manifest.repo}) and the registry (${m.hfRepo}) name different repos`)
      return {
        id: m.id,
        hfRepo: manifest.repo,
        dtype: manifest.packing,
        device: 'webgpu',
        sizeBytes: manifest.bytes,
        adapter: 'bonsai-kernels',
        file: manifest.file,
        revision: manifest.revision,
        sha256: manifest.sha256,
        context: Math.min(manifest.context, m.context),
        runtime: { url: manifest.runtime.url, sha256: manifest.runtime.sha256 },
        ...(manifest.decodePipelineDepth !== undefined ? { decodePipelineDepth: manifest.decodePipelineDepth } : {}),
      }
    }
    return { id: m.id, hfRepo: m.hfRepo, dtype: opts.dtype ?? m.dtype, device: opts.device ?? m.device ?? 'webgpu', sizeBytes: m.sizeBytes }
  }

  async load(modelId: string, onProgress?: (p: LoadProgress) => void, opts: { device?: DeviceKind; dtype?: string } = {}): Promise<void> {
    const spec = this.resolveSpec(modelId, opts)
    await this.loadSpec(spec, onProgress)
  }

  async loadSpec(spec: ModelSpec, onProgress?: (p: LoadProgress) => void): Promise<void> {
    this.lastSpec = spec
    const res = await this.call<{ modelId: string | null }>({ type: 'load', id: this.nextId++, spec }, { onProgress })
    this.modelId = res.modelId
  }

  async generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    const id = this.nextId++
    const wire: WireGenerateOptions = {
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      topP: opts.topP,
      stop: opts.stop,
      stream: Boolean(opts.onDelta),
      thinking: opts.thinking,
      reasoningBudget: opts.reasoningBudget,
      answerPrefix: opts.answerPrefix,
      stopOnJsonEnd: opts.stopOnJsonEnd,
      prefixKey: opts.prefixKey,
    }
    if (opts.signal?.aborted) throw new LlmCancelledError()
    const onAbort = () => this.ep.postMessage({ type: 'cancel', id: this.nextId++, target: id } satisfies ToWorker)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await this.call<GenerateResult>({ type: 'generate', id, messages, opts: wire }, { onDelta: opts.onDelta })
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }

  stream(messages: ChatMessage[], opts: Omit<GenerateOptions, 'onDelta'> = {}): AsyncIterable<string> {
    return streamFromGenerate((m, o) => this.generate(m, o), messages, opts)
  }

  /** Structured calls stop as soon as the answer's JSON value is complete, unless `stopOnJsonEnd: false` (as `BonsaiLlm.structured`). */
  async structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    return (await runStructured<T>((m, o) => this.generate(m, o), messages, schema, { ...opts, stopOnJsonEnd: opts.stopOnJsonEnd ?? true })).value
  }

  /**
   * Capabilities of the worker's adapter. Before the first load, pass the
   * model id whose adapter should be probed (the model itself is not loaded).
   */
  capabilities(modelId?: string): Promise<RuntimeCapabilities> {
    const spec = modelId ? this.resolveSpec(modelId) : this.lastSpec
    return this.call<RuntimeCapabilities>({ type: 'probe', id: this.nextId++, ...(spec ? { spec } : {}) })
  }

  /** Fixed-prompt benchmark of the loaded model (adapters that support it). */
  bench(request: BenchRequest): Promise<BenchResult> {
    return this.call<BenchResult>({ type: 'bench', id: this.nextId++, request })
  }

  /** Drop the worker's cached prompt state. */
  async resetSession(): Promise<void> {
    await this.call({ type: 'resetSession', id: this.nextId++ })
  }

  /** Test hook: the worker destroys its GPU device as a loss would. Refused unless spawned with `debug: true`. */
  async destroyDevice(): Promise<void> {
    await this.call({ type: 'destroyDevice', id: this.nextId++ })
  }

  /** Unload the model (frees GPU memory) but keep the worker. */
  async unload(): Promise<void> {
    await this.call({ type: 'unload', id: this.nextId++ })
    this.modelId = null
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    try {
      await Promise.race([this.unload(), new Promise((r) => setTimeout(r, 2000))])
    } catch {
      /* worker may already be gone */
    }
    this.closed = true
    this.failAll(new Error('LlmClient disposed'))
    this.ep.removeEventListener('message', this.onMessage)
    this.terminate?.()
  }
}
