/**
 * LocalLlm over Chrome's built-in Prompt API (`LanguageModel`, Gemini Nano):
 * the second, separately labelled local backend (ADR-0057).
 *
 * Chrome manages this model: it picks the weights, the execution path (GPU or
 * CPU) and updates them. The application cannot pin a version or choose
 * kernels, so this backend satisfies "inference stays on the device" but not
 * "inference runs on application-controlled WebGPU". It is always shown as
 * "Chrome built-in AI (browser-managed)" and never substituted for another
 * backend (see backend.ts).
 *
 * The Prompt API is not available in workers, so this adapter runs in the
 * window. Structured calls use `responseConstraint` (JSON Schema) and are
 * still validated: a constraint shapes the output, it does not make it right.
 */
import { applyStop, extractJson, runStructured, streamFromGenerate, validateJsonSchema, ZERO_USAGE } from './structured'
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
} from './types'

export const CHROME_BACKEND = 'chrome-prompt-api'
export const CHROME_LABEL = 'Chrome built-in AI (browser-managed)'
/** The model id this backend loads; there is exactly one and Chrome chooses what is behind it. */
export const CHROME_MODEL_ID = 'chrome-built-in'

// ---------------------------------------------------------------- the API, as far as we use it

export type PromptAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface PromptOptions {
  responseConstraint?: JsonSchema
  signal?: AbortSignal
}

export interface PromptSession {
  prompt(input: string | PromptMessage[], opts?: PromptOptions): Promise<string>
  promptStreaming?(input: string | PromptMessage[], opts?: PromptOptions): AsyncIterable<string>
  clone(opts?: { signal?: AbortSignal }): Promise<PromptSession>
  destroy(): void
  // Context accounting; Chrome renamed these, so both spellings are probed.
  inputQuota?: number
  inputUsage?: number
  measureInputUsage?(input: string | PromptMessage[], opts?: PromptOptions): Promise<number>
  contextWindow?: number
  contextUsage?: number
  measureContextUsage?(input: string | PromptMessage[], opts?: PromptOptions): Promise<number>
}

export interface PromptCreateOptions {
  initialPrompts?: PromptMessage[]
  expectedInputs?: { type: 'text'; languages: string[] }[]
  expectedOutputs?: { type: 'text'; languages: string[] }[]
  signal?: AbortSignal
  monitor?(m: { addEventListener(type: 'downloadprogress', fn: (e: { loaded: number; total?: number }) => void): void }): void
}

export interface LanguageModelApi {
  availability(opts?: PromptCreateOptions): Promise<PromptAvailability>
  create(opts?: PromptCreateOptions): Promise<PromptSession>
}

// ---------------------------------------------------------------- adapter

export interface ChromePromptLlmOptions {
  /** The API object. Default `globalThis.LanguageModel`. */
  languageModel?: LanguageModelApi
  /** Languages declared to the API. Default ['en']. */
  languages?: string[]
  /** Base sessions (one per system prompt) kept alive. Default 3. */
  maxBaseSessions?: number
  /** Characters per token used to enforce `maxTokens` (the API has no output cap). Default 4. */
  charsPerToken?: number
  userAgent?: string
  now?: () => number
}

function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${text.length}:${(h >>> 0).toString(16)}`
}

function quotaOf(s: PromptSession): number | null {
  if (typeof s.contextWindow === 'number') return s.contextWindow
  if (typeof s.inputQuota === 'number') return s.inputQuota
  return null
}

function usageOf(s: PromptSession): number {
  if (typeof s.contextUsage === 'number') return s.contextUsage
  if (typeof s.inputUsage === 'number') return s.inputUsage
  return 0
}

async function measure(s: PromptSession, input: PromptMessage[], opts?: PromptOptions): Promise<number | null> {
  if (typeof s.measureContextUsage === 'function') return s.measureContextUsage(input, opts)
  if (typeof s.measureInputUsage === 'function') return s.measureInputUsage(input, opts)
  return null
}

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError'

export class ChromePromptLlm implements LocalLlm {
  modelId: string | null = null
  private api: LanguageModelApi | undefined
  /** Base sessions by system-prompt hash, least recently used first. */
  private bases = new Map<string, PromptSession>()
  private chain: Promise<unknown> = Promise.resolve()
  private readonly now: () => number

  constructor(private o: ChromePromptLlmOptions = {}) {
    this.api = o.languageModel ?? (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel
    this.now = o.now ?? (() => performance.now())
  }

  private createOptions(system: string, monitor?: PromptCreateOptions['monitor']): PromptCreateOptions {
    const languages = this.o.languages ?? ['en']
    return {
      expectedInputs: [{ type: 'text', languages }],
      expectedOutputs: [{ type: 'text', languages }],
      ...(system ? { initialPrompts: [{ role: 'system', content: system }] } : {}),
      ...(monitor ? { monitor } : {}),
    }
  }

  /**
   * Checks availability and creates the first session, which downloads the
   * model when Chrome has not got it yet. Chrome requires a user gesture for
   * that download, so call this from a player-triggered setup step.
   */
  async load(modelId: string, onProgress?: (p: LoadProgress) => void): Promise<void> {
    if (!this.api) throw new Error('Chrome built-in AI is not available in this browser (no LanguageModel API)')
    const availability = await this.api.availability(this.createOptions(''))
    if (availability === 'unavailable') throw new Error('Chrome built-in AI cannot run on this device')
    const progress = (loaded: number, phase: LoadProgress['phase']): LoadProgress => ({
      modelId,
      phase,
      // Chrome reports a fraction, not bytes: the model is its own, not ours to size.
      files: { model: { loaded, total: 1 } },
      loaded,
      total: 1,
      fraction: loaded,
      message: phase === 'ready' ? 'Ready' : 'Chrome is downloading its built-in model',
    })
    if (availability !== 'available') onProgress?.(progress(0, 'download'))
    const base = await this.api.create(
      this.createOptions('', (m) =>
        m.addEventListener('downloadprogress', (e) => onProgress?.(progress(Math.max(0, Math.min(1, e.total ? e.loaded / e.total : e.loaded)), 'download'))),
      ),
    )
    this.dropBases()
    this.bases.set(hash(''), base)
    this.modelId = modelId
    onProgress?.(progress(1, 'ready'))
  }

  private dropBases(): void {
    for (const s of this.bases.values()) {
      try {
        s.destroy()
      } catch {
        /* already gone */
      }
    }
    this.bases.clear()
  }

  /** The base session for a system prompt; created once, cloned per call. */
  private async baseFor(system: string): Promise<PromptSession> {
    if (!this.api) throw new Error('Chrome built-in AI is not available in this browser (no LanguageModel API)')
    if (!this.modelId) throw new Error('no model loaded')
    const key = hash(system)
    const hit = this.bases.get(key)
    if (hit) {
      this.bases.delete(key)
      this.bases.set(key, hit)
      return hit
    }
    const base = await this.api.create(this.createOptions(system))
    this.bases.set(key, base)
    const max = Math.max(1, this.o.maxBaseSessions ?? 3)
    while (this.bases.size > max) {
      const oldest = this.bases.keys().next().value
      if (oldest === undefined) break
      this.bases.get(oldest)?.destroy()
      this.bases.delete(oldest)
    }
    return base
  }

  private split(messages: ChatMessage[]): { system: string; turns: PromptMessage[] } {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const turns = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }))
    if (!turns.some((t) => t.role === 'user')) throw new Error('the conversation needs at least one user message')
    return { system, turns }
  }

  /** A clone of the base session with the context checked; the caller destroys it. */
  private async sessionFor(messages: ChatMessage[], constraint?: JsonSchema, signal?: AbortSignal) {
    const { system, turns } = this.split(messages)
    const base = await this.baseFor(system)
    const session = await base.clone(signal ? { signal } : undefined)
    try {
      const quota = quotaOf(session)
      const need = await measure(session, turns, constraint ? { responseConstraint: constraint } : undefined)
      if (quota !== null && need !== null && usageOf(session) + need > quota) {
        // Fail loudly: the API would otherwise drop earlier context without telling anyone.
        throw new Error(`context window exceeded: the prompt needs ${usageOf(session) + need} tokens, ${CHROME_LABEL} allows ${quota}`)
      }
      return { session, turns, promptTokens: need ?? 0 }
    } catch (e) {
      session.destroy()
      throw e
    }
  }

  generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    const run = this.chain.then(() => this.generateNow(messages, opts))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async generateNow(messages: ChatMessage[], opts: GenerateOptions): Promise<GenerateResult> {
    if (opts.signal?.aborted) return { text: '', finishReason: 'cancelled', usage: ZERO_USAGE }
    const started = this.now()
    const ac = new AbortController()
    const onAbort = () => ac.abort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const charsPerToken = this.o.charsPerToken ?? 4
    const maxChars = (opts.maxTokens ?? 256) * charsPerToken
    let text = ''
    let finishReason: FinishReason = 'stop'
    let promptTokens = 0
    let firstAt = 0
    let session: PromptSession | null = null
    try {
      const s = await this.sessionFor(messages, undefined, ac.signal)
      session = s.session
      promptTokens = s.promptTokens
      const accept = (chunk: string): boolean => {
        if (!firstAt) firstAt = this.now()
        const cut = applyStop(text + chunk, opts.stop)
        const delta = cut.text.slice(text.length)
        text = cut.text
        if (delta) opts.onDelta?.(delta)
        if (cut.stopped) return false
        if (text.length >= maxChars) {
          // The API has no output-token option: the cap is enforced by aborting.
          finishReason = 'length'
          return false
        }
        return true
      }
      if (session.promptStreaming) {
        for await (const chunk of session.promptStreaming(s.turns, { signal: ac.signal })) {
          if (!accept(chunk)) {
            ac.abort()
            break
          }
        }
      } else {
        accept(await session.prompt(s.turns, { signal: ac.signal }))
      }
    } catch (e) {
      if (!isAbort(e)) throw e
      if (opts.signal?.aborted) finishReason = 'cancelled'
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
      session?.destroy()
    }
    if (opts.signal?.aborted && finishReason === 'stop') finishReason = 'cancelled'
    const durationMs = this.now() - started
    const completionTokens = Math.ceil(text.length / charsPerToken)
    return {
      text,
      finishReason,
      usage: {
        promptTokens,
        // Estimated from characters: the API does not report output tokens.
        completionTokens,
        durationMs,
        tokensPerSec: durationMs > 0 ? (completionTokens * 1000) / durationMs : 0,
        ttftMs: firstAt ? firstAt - started : 0,
      },
    }
  }

  stream(messages: ChatMessage[], opts: Omit<GenerateOptions, 'onDelta'> = {}): AsyncIterable<string> {
    return streamFromGenerate((m, o) => this.generate(m, o), messages, opts)
  }

  /**
   * One constrained call (`responseConstraint`), validated like any other
   * answer. When the API refuses the schema, or the constrained answer does
   * not validate, the prompt-and-repair loop takes over.
   */
  async structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    const validate = opts.validate ?? validateJsonSchema
    const run = this.chain.then(() => this.constrainedOnce(messages, schema, opts.signal))
    this.chain = run.catch(() => undefined)
    const constrained = await run
    if (constrained !== null) {
      const ex = extractJson(constrained)
      if (ex.ok && validate(ex.value, schema).ok) {
        opts.onAttempt?.({ attempt: 0, text: constrained, errors: [] })
        return ex.value as T
      }
    }
    return (await runStructured<T>((m, o) => this.generate(m, o), messages, schema, opts)).value
  }

  /** The constrained answer, or null when the API does not accept this schema. Context and abort errors propagate. */
  private async constrainedOnce(messages: ChatMessage[], schema: JsonSchema, signal?: AbortSignal): Promise<string | null> {
    let session: PromptSession | null = null
    try {
      const s = await this.sessionFor(messages, schema, signal)
      session = s.session
      return await session.prompt(s.turns, { responseConstraint: schema, signal })
    } catch (e) {
      const name = (e as { name?: string })?.name
      if (name === 'NotSupportedError' || name === 'TypeError' || name === 'SyntaxError') return null
      throw e
    } finally {
      session?.destroy()
    }
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    const base: RuntimeCapabilities = {
      backend: CHROME_BACKEND,
      label: CHROME_LABEL,
      // Chrome chooses the execution path; it is not application-controlled WebGPU.
      webgpu: false,
      supportsConstrainedOutput: true,
      supportsPrefixReuse: true,
      supportsVision: false,
      reasoningModes: ['off'],
      contextTokens: null,
      device: { browser: /Chrom(?:e|ium)\/([\d.]+)/.exec(this.o.userAgent ?? globalThis.navigator?.userAgent ?? '')?.[1] ?? null },
    }
    if (!this.api) return { ...base, unavailable: 'Chrome built-in AI is not available in this browser (no LanguageModel API)' }
    const any = this.bases.values().next().value
    if (any) return { ...base, contextTokens: quotaOf(any) }
    let availability: PromptAvailability
    try {
      availability = await this.api.availability(this.createOptions(''))
    } catch (e) {
      return { ...base, unavailable: e instanceof Error ? e.message : String(e) }
    }
    if (availability === 'unavailable') return { ...base, unavailable: 'Chrome built-in AI cannot run on this device' }
    return { ...base, device: { ...base.device, availability } }
  }

  async resetSession(): Promise<void> {
    await this.chain.catch(() => undefined)
    // Keep the system-less base (the loaded model); drop the per-prompt ones.
    const keep = this.bases.get(hash(''))
    for (const [key, s] of [...this.bases]) {
      if (s === keep) continue
      s.destroy()
      this.bases.delete(key)
    }
  }

  async dispose(): Promise<void> {
    await this.chain.catch(() => undefined)
    this.dropBases()
    this.modelId = null
  }
}
