/**
 * LocalLlm on Transformers.js v4 (onnxruntime-web, WebGPU by default).
 * Normally constructed inside the LLM worker (worker.ts) so the model owns
 * its own WebGPU device and never blocks the render thread.
 *
 * API used (from @huggingface/transformers 4.3 types):
 *   pipeline('text-generation', repo, { device, dtype, progress_callback })
 *   tokenizer.apply_chat_template(messages, { add_generation_prompt, return_dict })
 *   model.generate({ ...inputs, max_new_tokens, do_sample, temperature, top_p, streamer, stopping_criteria })
 *   TextStreamer(tokenizer, { skip_prompt, skip_special_tokens, callback_function, token_callback_function })
 *   InterruptableStoppingCriteria.interrupt() for cancellation and stop sequences
 */
import {
  env,
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
  type DataType,
  type DeviceType,
  type ProgressInfo,
  type Tensor,
  type TextGenerationPipeline,
} from '@huggingface/transformers'
import { ProgressAggregator, type TjsProgressInfo } from './download'
import { applyStop, runStructured, streamFromGenerate } from './structured'
import type { ChatMessage, DeviceKind, GenerateOptions, GenerateResult, JsonSchema, LoadProgress, LocalLlm, StructuredOptions } from './types'

export interface ResolvedModel {
  hfRepo: string
  dtype: string
  device: DeviceKind
  /** Expected download bytes (for a stable progress bar). */
  sizeBytes?: number
}

export interface TransformersJsLlmOptions {
  /** registry id → repo/dtype/device. */
  resolve: (modelId: string) => ResolvedModel
  /** Self-hosted onnxruntime-web runtime files (default would be jsDelivr). */
  wasmPaths?: { mjs: string; wasm: string }
  /** Replace Transformers.js' fetch (used to serve the offline test fixture). */
  fetch?: typeof fetch
}

export class TransformersJsLlm implements LocalLlm {
  modelId: string | null = null
  private gen: TextGenerationPipeline | null = null
  /** Serialises generate calls (one decode at a time per model). */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private o: TransformersJsLlmOptions) {
    if (o.wasmPaths) {
      const wasm = env.backends.onnx.wasm
      if (wasm) wasm.wasmPaths = { ...o.wasmPaths }
    }
    if (o.fetch) env.fetch = o.fetch
  }

  async load(modelId: string, onProgress?: (p: LoadProgress) => void, opts: { device?: DeviceKind; dtype?: string } = {}): Promise<void> {
    if (this.modelId === modelId && this.gen) return
    await this.dispose()
    const spec = this.o.resolve(modelId)
    const agg = new ProgressAggregator(modelId, spec.sizeBytes ?? 0)
    const gen = (await pipeline('text-generation', spec.hfRepo, {
      device: (opts.device ?? spec.device) as DeviceType,
      dtype: (opts.dtype ?? spec.dtype) as DataType,
      progress_callback: (info: ProgressInfo) => onProgress?.(agg.update(info as TjsProgressInfo)),
    })) as TextGenerationPipeline
    this.gen = gen
    this.modelId = modelId
    onProgress?.(agg.markReady())
  }

  generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    const run = this.chain.then(() => this.generateNow(messages, opts))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async generateNow(messages: ChatMessage[], opts: GenerateOptions): Promise<GenerateResult> {
    const gen = this.gen
    if (!gen) throw new Error('no model loaded')
    const started = performance.now()
    const maxTokens = opts.maxTokens ?? 256
    const temperature = opts.temperature ?? 0.7
    const tok = gen.tokenizer
    const inputs = tok.apply_chat_template(messages, {
      add_generation_prompt: true,
      return_dict: true,
      // Qwen3-style templates: answer directly instead of emitting <think> blocks.
      ...({ enable_thinking: false } as object),
    }) as unknown as { input_ids: Tensor; attention_mask: Tensor }
    const promptTokens = Number(inputs.input_ids.dims.at(-1) ?? 0)

    const stopping = new InterruptableStoppingCriteria()
    let cancelled = false
    let stoppedBySequence = false
    const onAbort = () => {
      cancelled = true
      stopping.interrupt()
    }
    if (opts.signal?.aborted) onAbort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    let streamed = ''
    let emitted = 0
    let tokens = 0
    let firstTokenAt = 0
    const streamer = new TextStreamer(tok, {
      skip_prompt: true,
      skip_special_tokens: true,
      token_callback_function: () => {
        tokens++
        if (!firstTokenAt) firstTokenAt = performance.now()
      },
      callback_function: (text: string) => {
        if (stoppedBySequence) return
        streamed += text
        const s = applyStop(streamed, opts.stop)
        if (s.stopped) {
          stoppedBySequence = true
          stopping.interrupt()
        }
        // Hold back a possible partial stop sequence at the end of the buffer.
        const hold = s.stopped ? 0 : Math.max(0, ...(opts.stop ?? []).map((st) => partialSuffix(s.text, st)))
        const safe = s.text.length - hold
        if (safe > emitted) {
          opts.onDelta?.(s.text.slice(emitted, safe))
          emitted = safe
        }
      },
    })

    try {
      const out = (await gen.model.generate({
        ...inputs,
        max_new_tokens: maxTokens,
        do_sample: temperature > 0,
        ...(temperature > 0 ? { temperature, top_p: opts.topP ?? 0.95 } : {}),
        streamer,
        stopping_criteria: stopping,
      } as Parameters<typeof gen.model.generate>[0])) as Tensor
      const ended = performance.now()
      const total = Number(out.dims.at(-1) ?? 0)
      const completionTokens = Math.max(total - promptTokens, 0)
      const decoded = tok.batch_decode(out.slice(null, [promptTokens, total]), { skip_special_tokens: true })[0] ?? ''
      const final = applyStop(decoded, opts.stop)
      if (final.text.length > emitted && !cancelled) opts.onDelta?.(final.text.slice(emitted))
      const decodeMs = firstTokenAt ? ended - firstTokenAt : ended - started
      const n = Math.max(tokens, completionTokens)
      return {
        text: final.text,
        finishReason: cancelled && !stoppedBySequence ? 'cancelled' : final.stopped || stoppedBySequence ? 'stop' : completionTokens >= maxTokens ? 'length' : 'stop',
        usage: {
          promptTokens,
          completionTokens,
          durationMs: ended - started,
          tokensPerSec: n > 1 && decodeMs > 0 ? ((n - 1) * 1000) / decodeMs : 0,
        },
      }
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }

  stream(messages: ChatMessage[], opts: Omit<GenerateOptions, 'onDelta'> = {}): AsyncIterable<string> {
    return streamFromGenerate((m, o) => this.generate(m, o), messages, opts)
  }

  async structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    return (await runStructured<T>((m, o) => this.generate(m, o), messages, schema, opts)).value
  }

  async dispose(): Promise<void> {
    const gen = this.gen
    this.gen = null
    this.modelId = null
    if (gen) await gen.dispose()
  }
}

/** Length of the longest prefix of `stop` that `text` ends with. */
function partialSuffix(text: string, stop: string): number {
  for (let k = Math.min(stop.length - 1, text.length); k > 0; k--) {
    if (text.endsWith(stop.slice(0, k))) return k
  }
  return 0
}
