/**
 * A stand-in for the upstream engine session (upstream.d.ts), for unit tests
 * of the adapter. It models what the adapter depends on, as read from the
 * engine's code:
 *
 * - `streamTokens` prefills the suffix, yields the first token without
 *   feeding it back, and feeds each token back before computing the next;
 *   so a stream that ends on `maxNewTokens` or is abandoned leaves the last
 *   yielded token out of the cache, and one that ends on EOS has them all.
 * - the cache can only go back to 0, to its current length, or to its single
 *   rewind point;
 * - the high-level `generate()` throws when a system message is present;
 * - `streamTokens` reads its second argument unguarded.
 *
 * The "model" is scripted: each new assistant turn takes the next scripted
 * response and continues it from whatever the context already holds, so a
 * turn the adapter closes early (the reasoning cap) is answered consistently.
 */
import type {
  UpstreamBenchmark,
  UpstreamCache,
  UpstreamEngine,
  UpstreamLoadOptions,
  UpstreamModule,
  UpstreamPrefixSnapshot,
  UpstreamSession,
  UpstreamStreamRequest,
  UpstreamTokenizer,
} from '../upstream'

export const IM_START = '<|im_start|>'
export const IM_END = '<|im_end|>'
export const THINK_OPEN = '<think>'
export const THINK_CLOSE = '</think>'
const SPECIALS = [IM_START, IM_END, THINK_OPEN, THINK_CLOSE]
const PIECE = /<\|im_start\|>|<\|im_end\|>|<think>|<\/think>|\s+|[^\s<]+|</g
const ASSISTANT = `${IM_START}assistant\n`
const THINK_OFF = `${THINK_OPEN}\n\n${THINK_CLOSE}\n\n`
const THINK_ON = `${THINK_OPEN}\n`

/** Whitespace runs, words and the special tokens are one token each; ids are assigned on first use. */
export class FakeTokenizer implements UpstreamTokenizer {
  private toId = new Map<string, number>()
  private toText: string[] = []

  constructor() {
    for (const s of SPECIALS) this.id(s)
    this.id('') // EOS
  }

  id(piece: string): number {
    let id = this.toId.get(piece)
    if (id === undefined) {
      id = this.toText.length
      this.toId.set(piece, id)
      this.toText.push(piece)
    }
    return id
  }

  get eos(): number {
    return this.id('')
  }

  encode(text: string): { ids: number[] } {
    return { ids: (text.match(PIECE) ?? []).map((p) => this.id(p)) }
  }

  decode(ids: number[], opts: { skip_special_tokens?: boolean } = {}): string {
    return ids
      .map((i) => this.toText[i] ?? '')
      .filter((t) => !(opts.skip_special_tokens && SPECIALS.includes(t)))
      .join('')
  }

  token_to_id(token: string): number | undefined {
    return this.toId.get(token)
  }
}

export interface FakeResponse {
  /** Reasoning text (only produced when the prompt enables thinking). */
  reasoning?: string
  answer: string
}

class FakeCache implements UpstreamCache {
  seq = 0
  rewindPointLength = -1
  /** The ids the cache holds: what a real cache holds as tensors. */
  ids: number[] = []
  private rewindIds: number[] = []
  captures = 0
  imports = 0

  constructor(
    readonly maxLength: number,
    private canRewind: boolean,
  ) {
    if (!canRewind) {
      this.captureRewindPoint = undefined
      this.exportPrefixSnapshot = undefined
      this.importPrefixSnapshot = undefined
    }
  }

  get_seq_length(): number {
    return this.seq
  }

  canTruncateTo(t: number): boolean {
    return t === 0 || t === this.seq || t === this.rewindPointLength
  }

  truncate(t: number): void {
    if (!this.canTruncateTo(t)) throw new Error(`cache with mutable conv/recurrent state cannot rewind from ${this.seq} to ${t}; reset to 0 instead`)
    if (t === 0) this.rewindPointLength = -1
    this.ids.length = t
    this.seq = t
  }

  captureRewindPoint? = async (): Promise<void> => {
    this.captures++
    this.rewindPointLength = this.seq
    this.rewindIds = this.ids.slice()
  }

  exportPrefixSnapshot? = async (): Promise<UpstreamPrefixSnapshot | null> => {
    if (this.rewindPointLength !== this.seq) return null
    return { length: this.seq, layout: `fake|len=${this.seq}`, chunks: [this.ids.slice()] }
  }

  importPrefixSnapshot? = async (s: UpstreamPrefixSnapshot): Promise<boolean> => {
    if (s.layout !== `fake|len=${s.length}`) return false
    this.imports++
    this.ids = (s.chunks[0] as number[]).slice()
    this.seq = s.length
    this.rewindPointLength = s.length
    this.rewindIds = this.ids.slice()
    return true
  }

  /** Present: an abandoned stream is rolled back to the accepted tokens. */
  mutableStateCheckpoint? = async (): Promise<unknown> => ({})
}

export interface FakeSessionOptions {
  script?: FakeResponse[]
  context?: number
  /** false models a cache without rewind points or snapshots. */
  canRewind?: boolean
  /** false models a cache that cannot roll back an abandoned pipelined decode. */
  checkpoints?: boolean
  decodePipelineDepth?: number
  /** Awaited before each generated token (to interleave aborts). */
  perToken?: () => Promise<void>
}

export class FakeSession implements UpstreamSession {
  readonly tokenizer = new FakeTokenizer()
  readonly eosTokenIds: number
  readonly cache: FakeCache
  readonly generationState: { cache: FakeCache }
  chatTemplateArgs: Record<string, unknown> = {}
  readonly thinkOpenTokenId: number
  readonly thinkCloseTokenId: number
  readonly decodePipelineDepth: number
  readonly runtime: {
    host: { device: { lost: Promise<{ reason?: string; message?: string }>; destroy(): void }; memory: { liveBytes: number; peakBytes: number } }
  }
  loseDevice: (message: string, reason?: string) => void = () => undefined
  destroyed = false
  /** `device.destroy()` was called (the device-loss test hook, or a real dispose would). */
  deviceDestroyed = false
  /** Every stream request, in order. */
  readonly streams: { suffix: string; maxNewTokens: number; stopOnEos: boolean; yielded: number }[] = []
  /** Every prompt rendered, in order. */
  readonly rendered: string[] = []
  private script: FakeResponse[]
  private turn = -1
  private generating = false

  constructor(private o: FakeSessionOptions = {}) {
    this.script = [...(o.script ?? [])]
    this.eosTokenIds = this.tokenizer.eos
    this.cache = new FakeCache(o.context ?? 4096, o.canRewind !== false)
    if (o.checkpoints === false) this.cache.mutableStateCheckpoint = undefined
    this.generationState = { cache: this.cache }
    this.thinkOpenTokenId = this.tokenizer.id(THINK_OPEN)
    this.thinkCloseTokenId = this.tokenizer.id(THINK_CLOSE)
    this.decodePipelineDepth = o.decodePipelineDepth ?? 8
    const lost = new Promise<{ reason?: string; message?: string }>((resolve) => {
      this.loseDevice = (message, reason = 'unknown') => resolve({ reason, message })
    })
    // Like WebGPU: destroying the device resolves `lost` with the reason "destroyed".
    const destroy = () => {
      this.deviceDestroyed = true
      this.loseDevice('Device was destroyed.', 'destroyed')
    }
    this.runtime = { host: { device: { lost, destroy }, memory: { liveBytes: 1, peakBytes: 2 } } }
  }

  get contextLength(): number {
    return this.cache.maxLength
  }

  push(...responses: FakeResponse[]): void {
    this.script.push(...responses)
  }

  /** ChatML with a Qwen-style empty think block when thinking is off. */
  renderPrompt(messages: { role: string; content: string }[], addGenerationPrompt = true): string {
    if (!messages.some((m) => m.role === 'user')) throw new Error('No user query found in messages.')
    if (messages.slice(1).some((m) => m.role === 'system')) throw new Error('System message must be at the beginning.')
    const effort = this.chatTemplateArgs.reasoning_effort
    if (effort === 'high') throw new Error('reasoning_effort "high" is not supported')
    let out = ''
    for (const m of messages) {
      // The default effort puts an instruction into the system block; `medium` leaves it out.
      const extra = m.role === 'system' && effort === undefined ? '\nReason as thoroughly as you can.' : ''
      const body = m.role === 'assistant' ? `${THINK_OFF}${m.content}` : `${m.content}${extra}`
      out += `${IM_START}${m.role}\n${body}${IM_END}\n`
    }
    if (addGenerationPrompt) out += ASSISTANT + (this.chatTemplateArgs.enable_thinking === false ? THINK_OFF : THINK_ON)
    this.rendered.push(out)
    return out
  }

  encodePrompt(messages: { role: string; content: string }[]): number[] {
    return this.tokenizer.encode(this.renderPrompt(messages)).ids
  }

  /** The upstream high-level call: unusable with a system message. */
  generate(messages: { role: string; content: string }[]): never {
    if (messages[0]?.role === 'system') throw new Error('No user query found in messages.')
    throw new Error('FakeSession.generate is not modelled; the adapter must not call it')
  }

  acquireGenerationLease(): () => void {
    if (this.destroyed) throw new Error('FakeSession has been disposed')
    if (this.generating) throw new Error('FakeSession is already generating')
    this.generating = true
    let held = true
    return () => {
      if (held) {
        held = false
        this.generating = false
      }
    }
  }

  /** The scripted model: the next token given everything in the cache. */
  private next(): number {
    const text = this.tokenizer.decode(this.cache.ids)
    const at = text.lastIndexOf(ASSISTANT)
    // No assistant turn open (a system prefix being primed): any token will do.
    if (at < 0) return this.tokenizer.id('.')
    const tail = text.slice(at + ASSISTANT.length)
    const r = this.script[this.turn] ?? { answer: '' }
    let remaining: string
    if (tail.startsWith(THINK_OFF)) {
      const produced = tail.slice(THINK_OFF.length)
      remaining = r.answer.startsWith(produced) ? r.answer.slice(produced.length) : ''
    } else {
      const produced = tail.slice(THINK_ON.length)
      const close = produced.indexOf(THINK_CLOSE)
      if (close >= 0) {
        const answered = produced.slice(close + THINK_CLOSE.length).replace(/^\n\n/, '')
        remaining = r.answer.startsWith(answered) ? r.answer.slice(answered.length) : ''
        // The blank line after the block is the model's own when it closed the block itself.
        if (produced.slice(close + THINK_CLOSE.length) === '') remaining = `\n\n${r.answer}`
      } else {
        const full = `${r.reasoning ?? ''}${THINK_CLOSE}\n\n${r.answer}`
        remaining = full.startsWith(produced) ? full.slice(produced.length) : ''
      }
    }
    const first = this.tokenizer.encode(remaining).ids[0]
    return first === undefined ? this.tokenizer.eos : first
  }

  async *streamTokens(req: UpstreamStreamRequest, opts: { decodePipelineDepth?: number }): AsyncGenerator<number> {
    // Upstream reads this unguarded; a missing second argument is a TypeError there too.
    void opts.decodePipelineDepth
    if (req.suffixIds.length === 0) throw new Error('generation requires at least one input token')
    const suffixText = this.tokenizer.decode(req.suffixIds)
    if (suffixText.includes(ASSISTANT)) this.turn++
    const record = { suffix: suffixText, maxNewTokens: req.maxNewTokens, stopOnEos: req.stopOnEos, yielded: 0 }
    this.streams.push(record)
    this.cache.ids.push(...req.suffixIds)
    this.cache.seq += req.suffixIds.length
    if (this.cache.seq > this.cache.maxLength) throw new Error('context window overflow')
    const isEos = (t: number) => req.stopOnEos && t === this.eosTokenIds
    let prev: number | null = null
    while (record.yielded < req.maxNewTokens && this.cache.seq < this.cache.maxLength) {
      if (prev !== null) {
        this.cache.ids.push(prev)
        this.cache.seq++
      }
      await this.o.perToken?.()
      const tok = this.next()
      if (isEos(tok)) return
      record.yielded++
      yield tok
      prev = tok
    }
  }

  async benchmarkFixedTokenIds(ids: number[], maxNewTokens: number, opts: { decodePipelineDepth?: number }): Promise<UpstreamBenchmark> {
    const release = this.acquireGenerationLease()
    try {
      this.resetCache()
      const out: number[] = []
      for await (const t of this.streamTokens({ suffixIds: [...ids], maxNewTokens, eosTokenId: this.eosTokenIds, stopOnEos: false }, opts)) out.push(t)
      this.resetCache()
      return { ttftMs: 1, decodeTps: 10, tokens: out.length, ids: out }
    } finally {
      release()
    }
  }

  deviceInfo() {
    return {
      vendor: 'fake',
      architecture: 'test',
      device: 'fake-gpu',
      description: 'FakeSession',
      isFallbackAdapter: false,
      features: { shaderF16: true, subgroups: false, subgroupMatrix: false, timestampQuery: false },
    }
  }

  resetCache(): void {
    this.cache.truncate(0)
  }

  dispose(): void {
    this.destroyed = true
  }
}

/**
 * An engine module whose `load` hands out `session` (or the next of several
 * sessions, one per load) and records the options. `fromCache` is what its
 * byte events say about where the bytes came from.
 */
export function fakeEngine(
  session: FakeSession | (() => FakeSession),
  o: { fromCache?: boolean } = {},
): UpstreamModule & { loads: { modelId: string | null; opts: UpstreamLoadOptions }[] } {
  const loads: { modelId: string | null; opts: UpstreamLoadOptions }[] = []
  const next = typeof session === 'function' ? session : () => session
  const TernaryBonsai2: UpstreamEngine = {
    async checkAvailability() {
      return { ok: true }
    },
    async load(modelId = null, opts = {}) {
      loads.push({ modelId, opts })
      const session = next()
      opts.onProgress?.({ status: 'init', message: 'Requesting WebGPU device' })
      opts.onProgress?.({ status: 'weights', kind: 'bytes', loaded: 50, total: 100, message: 'Streaming weights', fromCache: o.fromCache ?? false })
      opts.onProgress?.({ status: 'weights', kind: 'tensors', loaded: 1, total: 2, message: 'Uploading to GPU' })
      opts.onProgress?.({ status: 'ready', message: 'Ready', fraction: 1 })
      if (opts.chatTemplateArgs) session.chatTemplateArgs = { ...opts.chatTemplateArgs }
      return session
    },
  }
  return { TernaryBonsai2, DEFAULT_MODEL_ID: 'fake/model', DEFAULT_GGUF_FILE: 'fake.gguf', loads }
}
