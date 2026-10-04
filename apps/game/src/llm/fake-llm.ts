/**
 * Deterministic scripted LocalLlm for tests and the offline harness.
 * Each generate() consumes the next scripted response (or calls a responder
 * function), streams it in word-ish chunks with configurable latency, and
 * records the call.
 */
import { applyStop, runStructured, streamFromGenerate } from './structured'
import type {
  ChatMessage,
  GenerateOptions,
  GenerateResult,
  JsonSchema,
  LoadProgress,
  LocalLlm,
  StructuredOptions,
} from './types'

export type FakeResponse = string | { text: string; finishReason?: GenerateResult['finishReason'] } | Error

export interface FakeLlmOptions {
  /** Scripted responses, consumed in order. When exhausted, `fallback` is used. */
  script?: FakeResponse[]
  /** Called when the script is exhausted (or instead of a script). */
  responder?: (messages: ChatMessage[], opts: GenerateOptions, call: number) => FakeResponse
  /** Delay before the first delta (prefill), ms. */
  firstTokenMs?: number
  /** Delay between deltas, ms. */
  perTokenMs?: number
  /** Simulated load: steps of progress events. */
  loadSteps?: number
  loadMs?: number
  /** Simulated download size for progress events. */
  sizeBytes?: number
  /** Timer injection (vitest fake timers patch the global setTimeout anyway). */
  sleep?: (ms: number) => Promise<void>
  /** Calls kept in `calls`, the newest (a long-running fake, e.g. `?llm=fake` for a week). Default: all. */
  maxCalls?: number
}

export interface FakeCall {
  messages: ChatMessage[]
  opts: Omit<GenerateOptions, 'onDelta' | 'signal'>
}

const defaultSleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve())

/** Split into chunks that look like token deltas (word + trailing space). */
export function chunkText(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? []
}

export class FakeLlm implements LocalLlm {
  modelId: string | null = null
  readonly calls: FakeCall[] = []
  readonly loads: string[] = []
  disposed = false
  /** Calls made (`calls` may keep only the newest). */
  callCount = 0
  private script: FakeResponse[]
  private sleep: (ms: number) => Promise<void>

  constructor(private opts: FakeLlmOptions = {}) {
    this.script = [...(opts.script ?? [])]
    this.sleep = opts.sleep ?? defaultSleep
  }

  /** Append more scripted responses. */
  push(...responses: FakeResponse[]) {
    this.script.push(...responses)
  }

  async load(modelId: string, onProgress?: (p: LoadProgress) => void): Promise<void> {
    this.loads.push(modelId)
    const steps = this.opts.loadSteps ?? 2
    const total = this.opts.sizeBytes ?? 1000
    const file = 'onnx/model.onnx'
    for (let i = 1; i <= steps; i++) {
      await this.sleep((this.opts.loadMs ?? 0) / steps)
      const loaded = Math.round((total * i) / steps)
      onProgress?.({ modelId, phase: 'download', files: { [file]: { loaded, total } }, loaded, total, fraction: loaded / total })
    }
    onProgress?.({ modelId, phase: 'ready', files: { [file]: { loaded: total, total } }, loaded: total, total, fraction: 1 })
    this.modelId = modelId
  }

  async generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    if (this.disposed) throw new Error('FakeLlm disposed')
    const { onDelta, signal, ...rest } = opts
    const call = this.callCount++
    this.calls.push({ messages: messages.map((m) => ({ ...m })), opts: rest })
    const max = this.opts.maxCalls
    if (max != null && this.calls.length > max) this.calls.splice(0, this.calls.length - max)
    const next: FakeResponse =
      this.script.length > 0
        ? this.script.shift()!
        : this.opts.responder
          ? this.opts.responder(messages, opts, call)
          : 'ok'
    if (next instanceof Error) throw next
    const scripted = typeof next === 'string' ? { text: next } : next
    const started = performance.now()
    const maxTokens = opts.maxTokens ?? 256
    await this.sleep(this.opts.firstTokenMs ?? 0)
    let text = ''
    let n = 0
    let finishReason: GenerateResult['finishReason'] = scripted.finishReason ?? 'stop'
    for (const chunk of chunkText(scripted.text)) {
      if (signal?.aborted) {
        finishReason = 'cancelled'
        break
      }
      if (n >= maxTokens) {
        finishReason = 'length'
        break
      }
      const stopped = applyStop(text + chunk, opts.stop)
      const delta = stopped.text.slice(text.length)
      text = stopped.text
      n++
      if (delta) onDelta?.(delta)
      if (stopped.stopped) break
      await this.sleep(this.opts.perTokenMs ?? 0)
    }
    const durationMs = Math.max(performance.now() - started, 0)
    return {
      text,
      finishReason,
      usage: {
        promptTokens: messages.reduce((a, m) => a + chunkText(m.content).length, 0),
        completionTokens: n,
        durationMs,
        tokensPerSec: durationMs > 0 ? (n * 1000) / durationMs : 0,
      },
    }
  }

  stream(messages: ChatMessage[], opts: Omit<GenerateOptions, 'onDelta'> = {}): AsyncIterable<string> {
    return streamFromGenerate((m, o) => this.generate(m, o), messages, opts)
  }

  async structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    return (await runStructured<T>((m, o) => this.generate(m, o), messages, schema, opts)).value
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.modelId = null
  }
}
