/**
 * Core types for the in-browser LLM runtime (plan section D, "Hybrid inference";
 * ADR-0057: all inference is local, in the browser).
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
  /** Answer tokens only; reasoning tokens are counted in `reasoningTokens`. */
  completionTokens: number
  /** Wall time of the generate call, ms (prefill + decode). */
  durationMs: number
  /** completionTokens / decode seconds; 0 when nothing was generated. */
  tokensPerSec: number
  /** Time spent before the first generated token (prefill), ms. Adapters that can measure it. */
  prefillMs?: number
  /** Time to the first generated token, ms. */
  ttftMs?: number
  /** Tokens generated inside the reasoning block. */
  reasoningTokens?: number
  /** Prompt tokens that were already in the model's cache (not prefilled again). */
  cachedPromptTokens?: number
  /**
   * Time this call spent priming the reusable system prefix (prefilling it on
   * an empty cache before the rest of the prompt), ms; 0 when the prefix was
   * reused. Reported apart from `prefillMs`, which times the rest of the prompt.
   */
  primeMs?: number
  /** Prompt tokens prefilled while priming (they are counted in `cachedPromptTokens`, since the rest of the prompt found them cached). */
  primedTokens?: number
}

export interface GenerateResult {
  text: string
  usage: Usage
  finishReason: FinishReason
}

/**
 * How much the model reasons before it answers. `off` answers directly;
 * `medium` and `xhigh` are the effort settings the model's chat template
 * accepts. Adapters without a reasoning switch ignore it.
 */
export type ThinkingMode = 'off' | 'medium' | 'xhigh'

export interface GenerateOptions {
  /** Max new answer tokens. Default 256. */
  maxTokens?: number
  /** 0 → greedy. Default 0.7. Ignored by greedy-only adapters. */
  temperature?: number
  topP?: number
  /** Stop sequences; the matched sequence is trimmed from `text`. */
  stop?: string[]
  /** Called with each decoded text delta as soon as it is available. */
  onDelta?: (delta: string) => void
  signal?: AbortSignal
  /** Reasoning before the answer. Default 'off'. */
  thinking?: ThinkingMode
  /** Cap on reasoning tokens (on top of `maxTokens`); at the cap the adapter closes the reasoning block itself. */
  reasoningBudget?: number
  /** Text the answer is forced to start with (e.g. "{"); part of `text`. Only applies with thinking off. */
  answerPrefix?: string
  /** Stop as soon as the answer's root JSON value is complete. */
  stopOnJsonEnd?: boolean
  /** Label for the reusable system prefix of this call (diagnostics; reuse is keyed by content). */
  prefixKey?: string
  /**
   * Constrain the answer to this JSON schema while decoding, for adapters that can (the llama.cpp
   * backend turns it into a grammar); the others ignore it. `runStructured` sets it on every attempt.
   */
  jsonSchema?: JsonSchema
  /** The player waits for this answer: a hosted backend uses its faster, dearer tier for it. */
  interactive?: boolean
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
  /** What the runtime is doing ("Streaming weights", "Compiling kernels"), when it says. */
  message?: string
  /** The bytes of this event came from the browser's cache, not the network (when the runtime says). */
  fromCache?: boolean
}

export type JsonSchema = Record<string, unknown>

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

/** Validates a parsed JSON value. The session injects the Rust validator (`validateJson`, orchestrator-wasm). */
export type Validator = (value: unknown, schema: JsonSchema) => ValidationResult

export interface StructuredOptions extends Omit<GenerateOptions, 'stop'> {
  /** Extra validation on top of JSON parsing. Defaults to the built-in JSON-Schema subset validator. */
  validate?: Validator
  /** Repair turns after the first attempt. Default 2. */
  maxRepairs?: number
  /** Cap, in characters, on the previous answer quoted back in a repair turn. Default 6000. */
  maxRepairChars?: number
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

/** What a runtime can do; discovered for the exact build and device, never assumed. */
export interface RuntimeCapabilities {
  /** Backend id, e.g. 'bonsai-kernels', 'chrome-prompt-api', 'transformers', 'fake'. */
  backend: string
  /** Shown to the player; the Chrome backend is labelled as browser-managed. */
  label: string
  /** A usable WebGPU adapter exists (false for browser-managed execution). */
  webgpu: boolean
  /** Grammar/schema-constrained decoding. False means prompt-and-repair. */
  supportsConstrainedOutput: boolean
  /** A stable prompt prefix is prefilled once and reused. */
  supportsPrefixReuse: boolean
  supportsVision: boolean
  reasoningModes: ThinkingMode[]
  /** Usable context, tokens; null until a model is loaded or when the backend does not say. */
  contextTokens: number | null
  /** Why the backend cannot be used on this device, when it cannot. */
  unavailable?: string
  /** Adapter description, features and limits, as the backend reports them. */
  device?: Record<string, unknown>
}

/** The adapter contract. Implementations: BonsaiLlm and TransformersJsLlm (worker), ChromePromptLlm (window), FakeLlm (tests), LlmClient (RPC proxy). */
export interface LocalLlm {
  readonly modelId: string | null
  load(modelId: string, onProgress?: (p: LoadProgress) => void, opts?: Omit<LoadOptions, 'onProgress'>): Promise<void>
  generate(messages: ChatMessage[], opts?: GenerateOptions): Promise<GenerateResult>
  stream(messages: ChatMessage[], opts?: Omit<GenerateOptions, 'onDelta'>): AsyncIterable<string>
  structured<T>(messages: ChatMessage[], jsonSchema: JsonSchema, opts?: StructuredOptions): Promise<T>
  dispose(): Promise<void>
  /** Probe the backend. Works before `load` (device support) and after (context, features). */
  capabilities?(): Promise<RuntimeCapabilities>
  /** Drop every cached prompt state; the next call starts from an empty context. */
  resetSession?(): Promise<void>
  /**
   * A structured answer researched on the web (ADR-0068), with every source URL the
   * searches returned. Only backends that can search have it (the hosted one).
   */
  research?<T>(messages: ChatMessage[], jsonSchema: JsonSchema, opts?: StructuredOptions): Promise<ResearchResult<T>>
}

/** What a research call returns: the value and the sources its claims may cite. */
export interface ResearchResult<T = unknown> {
  value: T
  /** Source URLs the web searches returned (as the server normalized them). */
  sources: string[]
  searches: number
}

export class LlmCancelledError extends Error {
  constructor(message = 'generation cancelled') {
    super(message)
    this.name = 'LlmCancelledError'
  }
}

/**
 * The model is gone (the GPU device was lost, or the model moved to another
 * tab): the call produced nothing that may be used. Its name survives the
 * worker boundary (`LlmWorkerError` keeps it), so both sides test it by name.
 */
export class LlmUnavailableError extends Error {
  constructor(message = 'the model is not available') {
    super(message)
    this.name = 'LlmUnavailableError'
  }
}

export const isUnavailableError = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'LlmUnavailableError'
