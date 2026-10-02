/**
 * LocalLlm over the upstream Ternary Bonsai 2 WebGPU engine (ADR-0057).
 *
 * Runs inside the LLM worker: the engine owns its own WebGPU device there and
 * never blocks the render thread. The engine module is not part of this
 * repository (see extract.ts); it is fetched from `runtime.url`, verified
 * against the pinned hash and imported.
 *
 * The engine's high-level `generate()` is never used: it throws when a system
 * message is present, has no reasoning budget and no stop conditions. This
 * adapter drives `renderPrompt` → `tokenizer.encode` → `streamTokens` and
 * keeps its own ledger of what the generation cache holds (prefix-ledger.ts).
 *
 * Decoding is greedy: the engine has no sampling, so `temperature` and `topP`
 * are ignored and a repeated prompt gives the same output.
 */
import { sha256Hex } from './extract'
import { PrefixLedger, type LedgerPlan } from './prefix-ledger'
import { IncrementalDecoder, JsonBalance, mergeSystem, systemPrefixIds, templateArgs, thinkCloseIds } from './think'
import type { UpstreamBenchmark, UpstreamCache, UpstreamLoadProgress, UpstreamModule, UpstreamSession } from './upstream'
import { applyStop, runStructured, streamFromGenerate } from '../../structured'
import type {
  ChatMessage,
  FinishReason,
  GenerateOptions,
  GenerateResult,
  JsonSchema,
  LoadProgress,
  LocalLlm,
  RuntimeCapabilities,
  StructuredOptions,
  ThinkingMode,
} from '../../types'

export const BONSAI_BACKEND = 'bonsai-kernels'
export const BONSAI_LABEL = 'Ternary Bonsai 2 (in-browser WebGPU)'

/** What the adapter needs to know about a model (the manifest, resolved by the worker). */
export interface BonsaiModel {
  /** Hub repo, e.g. "prism-ml/Ternary-Bonsai-2-27B-gguf". */
  hfRepo: string
  /** GGUF file inside the repo. */
  file: string
  /** Pinned Hub revision (40-hex commit). */
  revision: string
  /** sha256 of the file; checked against the Hub's metadata before loading. */
  sha256: string
  sizeBytes: number
  /** Context length of the generation cache, tokens. */
  context: number
  runtime: { url: string; sha256: string }
  /** Pins the decode pipeline depth; undefined lets the engine calibrate at load. */
  decodePipelineDepth?: number
}

export interface RuntimeEvent {
  kind: 'device-lost' | 'gpu-error'
  message: string
}

export interface BonsaiLlmOptions {
  resolve: (modelId: string) => BonsaiModel
  /** Load the engine module. Default: fetch `runtime.url`, verify its sha256, import it. */
  importEngine?: (runtime: BonsaiModel['runtime']) => Promise<UpstreamModule>
  /** Used for the Hub metadata check and passed to the engine. Default: global fetch. */
  fetch?: typeof fetch
  /** Skip the Hub metadata check (unit tests; an offline start with verified cached weights). */
  skipRemoteCheck?: boolean
  onEvent?: (e: RuntimeEvent) => void
  /** In-memory system-prefix snapshots kept. Default 3. */
  maxSnapshots?: number
  now?: () => number
}

export interface BonsaiBenchRequest {
  messages?: ChatMessage[]
  /** Prompt token ids; wins over `messages`. */
  ids?: number[]
  maxNewTokens: number
  /** 'upstream' calls the engine's own benchmark; 'adapter' uses this adapter's prefill and stream path. */
  mode: 'upstream' | 'adapter'
}

export interface BonsaiBenchResult {
  mode: 'upstream' | 'adapter'
  promptTokens: number
  ttftMs: number
  decodeTps: number
  tokens: number
  ids: number[]
  depth?: number
}

/** `process.env` and `requestAnimationFrame` as the engine expects them inside a worker. */
export function shimEngineGlobals(scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  // The engine yields with requestAnimationFrame when it exists; it does not
  // fire reliably in a worker of a hidden tab. Undefined selects its timer path.
  if (typeof scope.requestAnimationFrame === 'function' && typeof scope.document === 'undefined') {
    scope.requestAnimationFrame = undefined
  }
  // Tuning flags are read from process.env, some at module evaluation.
  if (typeof scope.process === 'undefined') scope.process = { env: {} }
}

/**
 * Fetch the engine, check it is the pinned one, import it. The code is
 * imported from a blob URL so that what runs is exactly what was hashed.
 */
export async function importVerifiedEngine(
  runtime: BonsaiModel['runtime'],
  f: typeof fetch = fetch,
  /** The module loader; only tests replace it (their runner intercepts `import()`). */
  importModule: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
): Promise<UpstreamModule> {
  const install = 'run `pnpm --filter @swarm-press/game bonsai:runtime` to fetch it'
  const res = await f(runtime.url)
  if (!res.ok) throw new Error(`the Bonsai engine is not installed (${runtime.url}: HTTP ${res.status}); ${install}`)
  const code = await res.text()
  const sha = await sha256Hex(code)
  if (sha !== runtime.sha256) {
    throw new Error(`the Bonsai engine at ${runtime.url} is missing or is not the pinned build (sha256 ${sha}, expected ${runtime.sha256}); ${install}`)
  }
  shimEngineGlobals()
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    return (await importModule(url)) as UpstreamModule
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * One HEAD request against the pinned revision: the Hub reports the file's
 * sha256 (`x-linked-etag`) and size (`x-linked-size`). The engine itself only
 * checks that cached chunks belong to the same revision.
 */
export async function verifyRemoteFile(model: BonsaiModel, f: typeof fetch = fetch): Promise<void> {
  const url = `https://huggingface.co/${model.hfRepo}/resolve/${model.revision}/${model.file}`
  const res = await f(url, { method: 'HEAD' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const etag = (res.headers.get('x-linked-etag') ?? '').replace(/^W\//, '').replace(/"/g, '')
  const size = res.headers.get('x-linked-size')
  if (!etag || size === null) throw new Error(`${url}: the Hub did not report the file's hash and size; refusing to load unverified weights`)
  if (etag !== model.sha256 || Number(size) !== model.sizeBytes) {
    throw new Error(`${url}: sha256 ${etag} (${size} bytes) does not match the manifest (${model.sha256}, ${model.sizeBytes} bytes)`)
  }
}

function mapProgress(modelId: string, total: number, p: UpstreamLoadProgress, last: LoadProgress | null): LoadProgress {
  const file = 'weights'
  if (p.status === 'ready') {
    return { modelId, phase: 'ready', files: { [file]: { loaded: total, total } }, loaded: total, total, fraction: 1, message: p.message }
  }
  if (p.status === 'weights' && p.kind === 'bytes' && typeof p.loaded === 'number') {
    const t = typeof p.total === 'number' && p.total > 0 ? p.total : total
    const loaded = Math.min(p.loaded, t)
    return { modelId, phase: 'download', files: { [file]: { loaded, total: t } }, loaded, total: t, fraction: t > 0 ? loaded / t : 0, message: p.message }
  }
  if (p.status === 'weights') {
    // Uploading tensors, compiling kernels, tuning: the bytes are there, the GPU is not ready.
    const t = last?.total || total
    return { modelId, phase: 'init', files: { [file]: { loaded: t, total: t } }, loaded: t, total: t, fraction: 1, message: p.message }
  }
  return { modelId, phase: 'download', files: { [file]: { loaded: 0, total } }, loaded: 0, total, fraction: 0, message: p.message }
}

interface StreamEnd {
  /** Tokens the stream yielded. */
  tokens: number[]
  /** True when we left the stream before the engine ended it. */
  abandoned: boolean
}

/** State of one generate call, mutated from the per-token callback. */
interface Turn {
  reasoning: number
  answer: number
  inReasoning: boolean
  capHit: boolean
  ended: FinishReason | null
  firstTokenAt: number
  lastTokenAt: number
  /** The answer so far (starts with the forced answer prefix, if any). */
  text: string
  /** How much of `text` went out as deltas. */
  sent: number
  lead: boolean
  /** The answer cut at a stop sequence, once one matched. */
  stopped: string | null
}

/** Length of the longest tail of `text` that is a proper prefix of a stop sequence. */
export function partialStop(text: string, stop: string[] | undefined): number {
  let hold = 0
  for (const s of stop ?? []) {
    for (let n = Math.min(s.length - 1, text.length); n > hold; n--) {
      if (text.endsWith(s.slice(0, n))) {
        hold = n
        break
      }
    }
  }
  return hold
}

export class BonsaiLlm implements LocalLlm {
  modelId: string | null = null
  private session: UpstreamSession | null = null
  private model: BonsaiModel | null = null
  private ledger: PrefixLedger
  /** Serialises calls: one resident model, one turn at a time. */
  private chain: Promise<unknown> = Promise.resolve()
  private lost: string | null = null
  private readonly now: () => number

  constructor(private o: BonsaiLlmOptions) {
    this.ledger = new PrefixLedger({ maxSnapshots: o.maxSnapshots })
    this.now = o.now ?? (() => performance.now())
  }

  async load(modelId: string, onProgress?: (p: LoadProgress) => void): Promise<void> {
    if (this.modelId === modelId && this.session && !this.lost) return
    await this.dispose()
    const model = this.o.resolve(modelId)
    const f = this.o.fetch
    const engine = await (this.o.importEngine ?? ((rt) => importVerifiedEngine(rt, f)))(model.runtime)
    if (!this.o.skipRemoteCheck) await verifyRemoteFile(model, f)
    let last: LoadProgress | null = null
    const session = await engine.TernaryBonsai2.load(model.hfRepo, {
      file: model.file,
      revision: model.revision,
      maxLength: model.context,
      // Our own prefix snapshots live in this worker's memory, keyed by content.
      prefixSnapshotStore: null,
      decodePipelineDepth: model.decodePipelineDepth,
      chatTemplateArgs: templateArgs('off'),
      fetch: f,
      // Uncaptured WebGPU errors (validation, out of memory) reach the session as events.
      runtimeOptions: {
        diagnosticSink: (event) => {
          const message = (event as { message?: unknown })?.message
          this.o.onEvent?.({ kind: 'gpu-error', message: typeof message === 'string' ? message : String(event) })
        },
      },
      onProgress: (p) => {
        last = mapProgress(modelId, model.sizeBytes, p, last)
        onProgress?.(last)
      },
    })
    this.session = session
    this.model = model
    this.modelId = modelId
    this.lost = null
    const cache = session.generationState.cache
    this.ledger = new PrefixLedger({ maxSnapshots: this.o.maxSnapshots, canRewind: typeof cache.captureRewindPoint === 'function' })
    this.watchDevice(session)
  }

  private watchDevice(session: UpstreamSession): void {
    const lost = session.runtime?.host?.device?.lost
    if (!lost || typeof lost.then !== 'function') return
    void lost.then((info) => {
      // Our own dispose destroys the device; that is not a loss.
      if (this.session !== session || info?.reason === 'destroyed') return
      this.lost = info?.message || info?.reason || 'the GPU device was lost'
      this.o.onEvent?.({ kind: 'device-lost', message: this.lost })
    })
  }

  private need(): { session: UpstreamSession; model: BonsaiModel } {
    if (this.lost) throw new Error(`the GPU device was lost (${this.lost}); reload the model`)
    if (!this.session || !this.model) throw new Error('no model loaded')
    return { session: this.session, model: this.model }
  }

  generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    const run = this.chain.then(() => this.generateNow(messages, opts))
    this.chain = run.catch(() => undefined)
    return run
  }

  /** Bring the cache to hold as much of `promptIds` as can be reused; returns how many tokens that is. */
  private async applyPlan(session: UpstreamSession, promptIds: number[], prefixLength: number): Promise<number> {
    const cache = session.generationState.cache
    const plan: LedgerPlan = this.ledger.plan(promptIds, prefixLength, cache.get_seq_length())
    switch (plan.kind) {
      case 'continue':
        break
      case 'rewind':
        cache.truncate(plan.cached)
        this.ledger.rewound()
        break
      case 'import': {
        this.resetCache(session)
        const ok = (await cache.importPrefixSnapshot?.(plan.snapshot)) === true && cache.get_seq_length() === plan.cached
        if (ok) {
          this.ledger.primed(promptIds.slice(0, plan.cached))
          break
        }
        // The snapshot no longer fits this cache: prefill the prefix instead.
        this.resetCache(session)
        this.ledger.count('prime')
        return this.prime(session, promptIds.slice(0, plan.cached))
      }
      case 'prime':
        this.resetCache(session)
        this.ledger.count('prime')
        return this.prime(session, promptIds.slice(0, plan.cached))
      case 'reset':
        this.resetCache(session)
        break
    }
    this.ledger.count(plan.kind)
    return plan.cached
  }

  /** Prefill a system prefix on an empty cache, make it the rewind point, snapshot it. */
  private async prime(session: UpstreamSession, prefix: number[]): Promise<number> {
    const cache = session.generationState.cache
    // One generated token is the engine's minimum; it is not fed back, so the cache ends at the prefix.
    for await (const _ of session.streamTokens({ suffixIds: prefix.slice(), maxNewTokens: 1, eosTokenId: session.eosTokenIds, stopOnEos: false }, {})) {
      /* drained */
    }
    if (cache.get_seq_length() !== prefix.length || !cache.captureRewindPoint) {
      this.resetCache(session)
      return 0
    }
    await cache.captureRewindPoint()
    const snapshot = (await cache.exportPrefixSnapshot?.()) ?? null
    this.ledger.primed(prefix, snapshot && snapshot.length === prefix.length ? snapshot : null)
    return prefix.length
  }

  private resetCache(session: UpstreamSession): void {
    session.resetCache()
    this.ledger.cleared()
  }

  /** One stream call; counts cache state afterwards through the ledger. */
  private async streamOnce(
    session: UpstreamSession,
    suffixIds: number[],
    maxNewTokens: number,
    stopOnEos: boolean,
    onToken: (id: number) => boolean,
  ): Promise<StreamEnd> {
    const tokens: number[] = []
    let abandoned = false
    for await (const id of session.streamTokens({ suffixIds, maxNewTokens, eosTokenId: session.eosTokenIds, stopOnEos }, {})) {
      tokens.push(id)
      if (!onToken(id)) {
        abandoned = true
        break
      }
    }
    return { tokens, abandoned }
  }

  /**
   * Record what the cache holds after a stream. `sequence` is every token
   * prefilled or generated so far. When the stream was abandoned on a cache
   * that cannot roll an interrupted pipelined decode back, or the length is
   * not plausible, the cache goes back to the rewind point (or to empty).
   */
  private settle(session: UpstreamSession, sequence: number[], abandoned: boolean): number {
    const cache = session.generationState.cache
    const safe = !abandoned || typeof cache.mutableStateCheckpoint === 'function' || (session.decodePipelineDepth ?? 2) <= 1
    if (safe && this.ledger.commit(sequence, cache.get_seq_length())) return cache.get_seq_length()
    return this.fallBack(session, cache)
  }

  private fallBack(session: UpstreamSession, cache: UpstreamCache): number {
    const r = this.ledger.rewindLength
    if (r > 0 && (cache.canTruncateTo?.(r) ?? false)) {
      cache.truncate(r)
      this.ledger.rewound()
      return r
    }
    this.resetCache(session)
    return 0
  }

  private async generateNow(messages: ChatMessage[], opts: GenerateOptions): Promise<GenerateResult> {
    const { session } = this.need()
    if (opts.signal?.aborted) return this.cancelled()
    const started = this.now()
    const release = session.acquireGenerationLease()
    const cache = session.generationState.cache
    try {
      const thinking: ThinkingMode = opts.thinking ?? 'off'
      const closeId = session.thinkCloseTokenId
      const reasons = thinking !== 'off' && closeId !== null
      session.chatTemplateArgs = templateArgs(reasons ? thinking : 'off')
      const answerBudget = Math.max(1, opts.maxTokens ?? 256)
      const reasoningBudget = reasons ? Math.max(1, opts.reasoningBudget ?? 1024) : 0
      const prefixText = !reasons && opts.answerPrefix ? opts.answerPrefix : ''

      const prompt = session.renderPrompt(mergeSystem(messages), true)
      const encode = (text: string) => session.tokenizer.encode(text, { add_special_tokens: false }).ids
      let promptIds = encode(prompt)
      const sysIds = systemPrefixIds(session.tokenizer, prompt, promptIds)
      if (prefixText) promptIds = promptIds.concat(encode(prefixText))
      if (promptIds.length + 1 >= cache.maxLength) {
        throw new Error(`the prompt is too long for the context window (${promptIds.length} tokens; the window is ${cache.maxLength})`)
      }

      const cached = await this.applyPlan(session, promptIds, sysIds.length)
      const prefillStarted = this.now()

      /** Every token prefilled or generated, in order. */
      let sequence = promptIds.slice()
      let held = cached
      const decoder = new IncrementalDecoder(session.tokenizer)
      const balance = opts.stopOnJsonEnd ? new JsonBalance() : null
      if (balance && prefixText) balance.push(prefixText)
      if (prefixText) opts.onDelta?.(prefixText)
      // Mutated from the per-token callback.
      const turn: Turn = {
        reasoning: 0,
        answer: 0,
        inReasoning: reasons,
        capHit: false,
        ended: null,
        firstTokenAt: 0,
        lastTokenAt: 0,
        text: prefixText,
        sent: prefixText.length,
        // The model separates its answer from the reasoning block with a blank line.
        lead: reasons,
        stopped: null,
      }

      const onAnswerText = (raw: string): boolean => {
        let delta = raw
        if (turn.lead) {
          delta = delta.replace(/^\s+/, '')
          if (!delta) return true
          turn.lead = false
        }
        turn.text += delta
        const cut = applyStop(turn.text, opts.stop)
        if (cut.stopped) {
          turn.stopped = cut.text
          flush(cut.text.length)
          return false
        }
        // Hold back a tail that may be the start of a stop sequence.
        flush(turn.text.length - partialStop(turn.text, opts.stop))
        return !(balance && balance.push(delta))
      }
      const flush = (upTo: number) => {
        if (upTo > turn.sent) {
          opts.onDelta?.(turn.text.slice(turn.sent, upTo))
          turn.sent = upTo
        }
      }

      let finish: FinishReason = 'length'
      for (;;) {
        const suffix = sequence.slice(held)
        const room = cache.maxLength - held - suffix.length
        if (room < 1) break
        const want = turn.inReasoning ? reasoningBudget - turn.reasoning + 1 + answerBudget : answerBudget - turn.answer
        const allowed = Math.min(room, Math.max(1, want))
        turn.capHit = false
        turn.ended = null
        const end = await this.streamOnce(session, suffix, allowed, true, (id) => {
          turn.lastTokenAt = this.now()
          if (!turn.firstTokenAt) turn.firstTokenAt = turn.lastTokenAt
          if (opts.signal?.aborted) {
            turn.ended = 'cancelled'
            return false
          }
          if (turn.inReasoning) {
            if (id === closeId) {
              turn.inReasoning = false
              return true
            }
            turn.reasoning++
            if (turn.reasoning >= reasoningBudget) {
              turn.capHit = true
              return false
            }
            return true
          }
          turn.answer++
          const delta = decoder.push(id)
          if (delta && !onAnswerText(delta)) {
            turn.ended = 'stop'
            return false
          }
          if (turn.answer >= answerBudget) {
            turn.ended = 'length'
            return false
          }
          return true
        })
        sequence = sequence.concat(end.tokens)
        held = this.settle(session, sequence, end.abandoned)
        if (turn.capHit) {
          // Close the reasoning block ourselves and let the model answer.
          sequence = sequence.concat(thinkCloseIds(session.tokenizer, closeId as number))
          turn.inReasoning = false
          continue
        }
        // When the engine ended the stream itself, it stopped on EOS if it used less than it was allowed.
        finish = turn.ended ?? (end.tokens.length < allowed ? 'stop' : 'length')
        break
      }

      if (turn.stopped === null) flush(turn.text.length)
      const finished = this.now()
      const generated = turn.reasoning + turn.answer
      const decodeSeconds = turn.firstTokenAt && turn.lastTokenAt > turn.firstTokenAt ? (turn.lastTokenAt - turn.firstTokenAt) / 1000 : 0
      return {
        text: turn.stopped ?? turn.text,
        finishReason: finish,
        usage: {
          promptTokens: promptIds.length,
          completionTokens: turn.answer,
          durationMs: finished - started,
          // Decode rate over reasoning and answer tokens alike.
          tokensPerSec: decodeSeconds > 0 ? (generated - 1) / decodeSeconds : 0,
          prefillMs: turn.firstTokenAt ? turn.firstTokenAt - prefillStarted : 0,
          ttftMs: turn.firstTokenAt ? turn.firstTokenAt - started : 0,
          reasoningTokens: turn.reasoning,
          cachedPromptTokens: cached,
        },
      }
    } catch (e) {
      // The cache state is unknown after a failed stream: start clean next time.
      try {
        this.resetCache(session)
      } catch {
        this.ledger.cleared()
      }
      const message = e instanceof Error ? e.message : String(e)
      if (/device.*lost|GPUDevice/i.test(message)) this.o.onEvent?.({ kind: 'gpu-error', message })
      throw e
    } finally {
      release()
    }
  }

  private cancelled(): GenerateResult {
    return { text: '', finishReason: 'cancelled', usage: { promptTokens: 0, completionTokens: 0, durationMs: 0, tokensPerSec: 0 } }
  }

  stream(messages: ChatMessage[], opts: Omit<GenerateOptions, 'onDelta'> = {}): AsyncIterable<string> {
    return streamFromGenerate((m, o) => this.generate(m, o), messages, opts)
  }

  async structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    return (await runStructured<T>((m, o) => this.generate(m, o), messages, schema, { stopOnJsonEnd: true, ...opts })).value
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    const base: RuntimeCapabilities = {
      backend: BONSAI_BACKEND,
      label: BONSAI_LABEL,
      webgpu: false,
      supportsConstrainedOutput: false,
      supportsPrefixReuse: true,
      supportsVision: false,
      reasoningModes: ['off', 'medium', 'xhigh'],
      contextTokens: null,
    }
    if (this.session && !this.lost) {
      const cache = this.session.generationState.cache
      return {
        ...base,
        webgpu: true,
        supportsPrefixReuse: typeof cache.captureRewindPoint === 'function',
        contextTokens: this.session.contextLength,
        device: {
          ...this.session.deviceInfo(),
          decodePipelineDepth: this.session.decodePipelineDepth ?? null,
          // Copied as plain numbers: the engine's object has getters and a method, which cannot cross postMessage.
          gpuBytes: this.gpuBytes(this.session),
        },
      }
    }
    type AdapterLike = { features?: Iterable<string>; limits?: Record<string, unknown> }
    const gpu = (globalThis as { navigator?: { gpu?: { requestAdapter(o?: unknown): Promise<unknown> } } }).navigator?.gpu
    if (!gpu) return { ...base, unavailable: 'WebGPU is not available in this browser' }
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).then(
      (a) => (a as AdapterLike | null) ?? null,
      () => null,
    )
    if (!adapter) return { ...base, unavailable: 'no WebGPU adapter is available on this device' }
    const features = [...(adapter.features ?? [])]
    return {
      ...base,
      webgpu: true,
      ...(this.lost ? { unavailable: `the GPU device was lost (${this.lost})` } : {}),
      device: {
        features,
        maxBufferSize: adapter.limits?.maxBufferSize ?? null,
        maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize ?? null,
      },
    }
  }

  /** GPU buffer bytes the engine allocated (live and peak), when it tracks them. */
  private gpuBytes(session: UpstreamSession): { live: number; peak: number } | null {
    const m = session.runtime?.host?.memory
    return m && typeof m.liveBytes === 'number' && typeof m.peakBytes === 'number' ? { live: m.liveBytes, peak: m.peakBytes } : null
  }

  async resetSession(): Promise<void> {
    await this.chain.catch(() => undefined)
    if (this.session && !this.lost) this.resetCache(this.session)
    this.ledger.dropSnapshots()
  }

  /** Fixed-prompt benchmark; `ids` are the raw generated tokens (EOS is not a stop here). */
  bench(req: BonsaiBenchRequest): Promise<BonsaiBenchResult> {
    const run = this.chain.then(() => this.benchNow(req))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async benchNow(req: BonsaiBenchRequest): Promise<BonsaiBenchResult> {
    const { session } = this.need()
    session.chatTemplateArgs = templateArgs('off')
    const ids = req.ids ?? (req.messages ? session.tokenizer.encode(session.renderPrompt(mergeSystem(req.messages), true), { add_special_tokens: false }).ids : [])
    if (ids.length === 0) throw new Error('bench needs messages or ids')
    const depth = session.decodePipelineDepth
    if (req.mode === 'upstream') {
      this.ledger.cleared()
      const r: UpstreamBenchmark = await session.benchmarkFixedTokenIds(ids, req.maxNewTokens, {})
      // benchmarkFixedTokenIds leaves an empty cache.
      this.ledger.cleared()
      return { mode: 'upstream', promptTokens: ids.length, ttftMs: r.ttftMs, decodeTps: r.decodeTps, tokens: r.tokens, ids: r.ids, depth }
    }
    const release = session.acquireGenerationLease()
    try {
      this.resetCache(session)
      const started = this.now()
      let first = 0
      let last = 0
      const end = await this.streamOnce(session, ids.slice(), req.maxNewTokens, false, () => {
        last = this.now()
        if (!first) first = last
        return true
      })
      this.resetCache(session)
      const n = end.tokens.length
      return {
        mode: 'adapter',
        promptTokens: ids.length,
        ttftMs: n > 0 ? first - started : NaN,
        decodeTps: n > 1 && last > first ? (n - 1) / ((last - first) / 1000) : 0,
        tokens: n,
        ids: end.tokens,
        depth,
      }
    } finally {
      release()
    }
  }

  /** Reuse counters of the prefix ledger (diagnostics, benchmark report). */
  ledgerStats() {
    return { ...this.ledger.stats, snapshots: this.ledger.snapshotCount(), held: this.ledger.length, rewind: this.ledger.rewindLength }
  }

  async dispose(): Promise<void> {
    await this.chain.catch(() => undefined)
    const s = this.session
    this.session = null
    this.model = null
    this.modelId = null
    this.lost = null
    this.ledger.cleared()
    this.ledger.dropSnapshots()
    try {
      s?.dispose()
    } catch {
      /* the device may already be gone */
    }
  }
}
