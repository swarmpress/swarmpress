/**
 * The hosted backend (ADR-0067): every turn runs on GPT-6-Luna through the
 * central server (`POST /api/llm/generate`, FEAT-086), which holds the key,
 * fences the spend by the company lease and keeps the daily budget. Nothing is
 * downloaded and nothing runs on this GPU.
 *
 * The contract is `LocalLlm`, so the orchestrator, the repair loop, the Rust
 * validator and the publish gate stay as they are: the answer is a proposal.
 *
 * - `thinking` maps to the provider's reasoning effort (`off` → `none`); the
 *   output limit is the answer budget plus the reasoning budget, since the
 *   provider counts both.
 * - `jsonSchema` (set by the repair loop on structured calls) asks for
 *   JSON-schema output; the answer prefix is not sent (the provider cannot be
 *   made to start with it) and is not needed with a schema.
 * - `interactive` turns use the Standard tier, the others Flex.
 * - The answer arrives whole: `onDelta` gets it in one piece.
 * - The server's 503 (no key, no credits, provider busy) is `LlmUnavailableError`:
 *   the session holds the clock instead of failing the job.
 */
import { applyStop, runStructured, streamFromGenerate } from './structured'
import {
  LlmUnavailableError,
  type ChatMessage,
  type GenerateOptions,
  type GenerateResult,
  type JsonSchema,
  type LoadProgress,
  type LocalLlm,
  type RuntimeCapabilities,
  type StructuredOptions,
  type ThinkingMode,
} from './types'
import type { LlmGenerateReply, LlmGenerateRequest } from '../net/central'

export const HOSTED_MODEL_ID = 'gpt-6-luna'
export const HOSTED_LABEL = 'GPT-6-Luna (hosted by OpenAI, through the game server)'
/** GPT-6-Luna's context window, tokens. */
const CONTEXT_TOKENS = 1_050_000
const DEFAULT_REASONING_BUDGET = 1024
const MIN_OUTPUT_TOKENS = 16

export interface HostedLlmOptions {
  /** Sends one turn to the server with the current lease (the session's `CentralClient.llmGenerate`). */
  send: (body: LlmGenerateRequest, signal?: AbortSignal) => Promise<LlmGenerateReply>
  /** The job kind the server records (default `generate`). */
  kind?: string
}

const EFFORT: Record<ThinkingMode, LlmGenerateRequest['reasoning_effort']> = { off: 'none', medium: 'medium', xhigh: 'xhigh' }

/** The status of a failed server call, when it carries one (`CentralError`). */
const statusOf = (e: unknown): number | null => {
  const s = (e as { status?: unknown } | null)?.status
  return typeof s === 'number' ? s : null
}

export class HostedLlm implements LocalLlm {
  modelId: string | null = null
  private spent = { calls: 0, costMicros: 0 }

  constructor(private o: HostedLlmOptions) {}

  async load(modelId: string, onProgress?: (p: LoadProgress) => void): Promise<void> {
    // Nothing to download or compile: the model is the server's.
    this.modelId = modelId
    onProgress?.({ modelId, phase: 'ready', files: {}, loaded: 0, total: 0, fraction: 1, message: 'Ready' })
  }

  async generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    if (!this.modelId) throw new Error('no model loaded')
    const started = performance.now()
    const thinking = opts.thinking ?? 'off'
    const maxTokens = Math.max(1, opts.maxTokens ?? 256)
    const reasoning = thinking === 'off' ? 0 : Math.max(1, opts.reasoningBudget ?? DEFAULT_REASONING_BUDGET)
    const body: LlmGenerateRequest = {
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      kind: this.o.kind ?? 'generate',
      // The provider takes no fewer than 16 output tokens.
      max_output_tokens: Math.max(MIN_OUTPUT_TOKENS, maxTokens + reasoning),
      reasoning_effort: EFFORT[thinking],
      service_tier: opts.interactive ? 'default' : 'flex',
      ...(opts.jsonSchema ? { json_schema: opts.jsonSchema } : {}),
    }
    if (opts.signal?.aborted) return this.cancelled(started)
    let reply: LlmGenerateReply
    try {
      reply = await this.o.send(body, opts.signal)
    } catch (e) {
      if (opts.signal?.aborted || (e as { name?: string } | null)?.name === 'AbortError') return this.cancelled(started)
      const status = statusOf(e)
      const message = e instanceof Error ? e.message : String(e)
      // No key, no credits, a busy provider: the model is not available, nothing was produced.
      if (status === 503) throw new LlmUnavailableError(message)
      throw e
    }
    this.spent.calls++
    this.spent.costMicros += reply.cost_micros
    const cut = applyStop(reply.text, opts.stop)
    if (cut.text) opts.onDelta?.(cut.text)
    const u = reply.usage
    const completionTokens = Math.max(0, u.output_tokens - u.reasoning_tokens)
    const durationMs = performance.now() - started
    return {
      text: cut.text,
      finishReason: cut.stopped ? 'stop' : reply.finish === 'length' ? 'length' : 'stop',
      usage: {
        promptTokens: u.input_tokens,
        completionTokens,
        durationMs,
        tokensPerSec: reply.duration_ms > 0 ? (u.output_tokens * 1000) / reply.duration_ms : 0,
        cachedPromptTokens: u.cached_input_tokens,
        ...(thinking !== 'off' ? { reasoningTokens: u.reasoning_tokens } : {}),
      },
    }
  }

  private cancelled(started: number): GenerateResult {
    return { text: '', finishReason: 'cancelled', usage: { promptTokens: 0, completionTokens: 0, durationMs: performance.now() - started, tokensPerSec: 0 } }
  }

  stream(messages: ChatMessage[], opts: Omit<GenerateOptions, 'onDelta'> = {}): AsyncIterable<string> {
    return streamFromGenerate((m, o) => this.generate(m, o), messages, opts)
  }

  async structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    return (await runStructured<T>((m, o) => this.generate(m, o), messages, schema, opts)).value
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return {
      backend: 'openai-responses',
      label: HOSTED_LABEL,
      webgpu: false,
      // The schema shapes every attempt, but structured calls still run the repair loop (the Rust checks go beyond it).
      supportsConstrainedOutput: false,
      supportsPrefixReuse: false,
      supportsVision: false,
      reasoningModes: ['off', 'medium', 'xhigh'],
      contextTokens: CONTEXT_TOKENS,
      device: { model: HOSTED_MODEL_ID, via: 'POST /api/llm/generate', calls: this.spent.calls, costMicros: this.spent.costMicros },
    }
  }

  async resetSession(): Promise<void> {
    // The server keeps no conversation state (`store: false`).
  }

  async dispose(): Promise<void> {
    this.modelId = null
  }
}
