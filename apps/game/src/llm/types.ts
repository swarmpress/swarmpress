/**
 * Core types for the in-browser LLM runtime (plan section D, "Hybrid inference").
 *
 * Everything here is plain JSON-serialisable so it can cross the worker
 * boundary (see protocol.ts) without transferables.
 */

export type Role = 'system' | 'user' | 'assistant'

/** A chat message. Mirrors the OpenAI/Anthropic/HF chat shape. */
export interface ChatMessage {
  role: Role
  content: string
}

export type FinishReason = 'stop' | 'length' | 'cancelled' | 'error'

export interface Usage {
  promptTokens: number
  completionTokens: number
  /** Wall time of the generate call, ms (prefill + decode). */
  durationMs: number
  /** completionTokens / decode seconds; 0 when nothing was generated. */
  tokensPerSec: number
}

export interface GenerateResult {
  text: string
  usage: Usage
  finishReason: FinishReason
}

export interface GenerateOptions {
  /** Max new tokens. Default 256. */
  maxTokens?: number
  /** 0 → greedy. Default 0.7. */
  temperature?: number
  topP?: number
  /** Stop sequences; the matched sequence is trimmed from `text`. */
  stop?: string[]
  /** Called with each decoded text delta as soon as it is available. */
  onDelta?: (delta: string) => void
  signal?: AbortSignal
}

/** Download/initialisation progress, aggregated per model (see download.ts). */
export interface LoadProgress {
  modelId: string
  phase: 'download' | 'init' | 'ready'
  /** Per-file bytes. Keys are repo-relative paths (e.g. "onnx/model_q4f16.onnx"). */
  files: Record<string, { loaded: number; total: number }>
  loaded: number
  total: number
  /** 0..1, NaN-free. */
  fraction: number
}

export type JsonSchema = Record<string, unknown>

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

/** Validates a parsed JSON value; the future implementation is content-model compiled to wasm. */
export type Validator = (value: unknown, schema: JsonSchema) => ValidationResult

export interface StructuredOptions extends Omit<GenerateOptions, 'stop'> {
  /** Extra validation on top of JSON parsing. Defaults to the built-in JSON-Schema subset validator. */
  validate?: Validator
  /** Repair turns after the first attempt. Default 2. */
  maxRepairs?: number
  /** Called after each attempt (attempt 0 = first try). */
  onAttempt?: (info: { attempt: number; text: string; errors: string[] }) => void
}

export interface StructuredResult<T> {
  value: T
  repairs: number
  text: string
  usage: Usage
}

export type DeviceKind = 'webgpu' | 'wasm'

export interface LoadOptions {
  onProgress?: (p: LoadProgress) => void
  /** Overrides the registry device. */
  device?: DeviceKind
  /** Overrides the registry dtype. */
  dtype?: string
}

/** The adapter contract. Implementations: TransformersJsLlm (worker), FakeLlm (tests), LlmClient (RPC proxy). */
export interface LocalLlm {
  readonly modelId: string | null
  load(modelId: string, onProgress?: (p: LoadProgress) => void, opts?: Omit<LoadOptions, 'onProgress'>): Promise<void>
  generate(messages: ChatMessage[], opts?: GenerateOptions): Promise<GenerateResult>
  stream(messages: ChatMessage[], opts?: Omit<GenerateOptions, 'onDelta'>): AsyncIterable<string>
  structured<T>(messages: ChatMessage[], jsonSchema: JsonSchema, opts?: StructuredOptions): Promise<T>
  dispose(): Promise<void>
}

export class LlmCancelledError extends Error {
  constructor(message = 'generation cancelled') {
    super(message)
    this.name = 'LlmCancelledError'
  }
}
