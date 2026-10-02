/**
 * Main thread ↔ LLM worker RPC. Plain JSON (structured-clone safe, no
 * transferables). Every request carries an `id`; the worker answers with
 * zero or more `progress`/`delta` messages followed by exactly one
 * `result` or `error` for that id. `event` messages are unsolicited (the GPU
 * device was lost) and carry no id.
 */
import type { FakeResponse } from './fake-llm'
import type { ChatMessage, DeviceKind, GenerateResult, LoadProgress, RuntimeCapabilities, ThinkingMode } from './types'

export type AdapterKind = 'transformers' | 'fake' | 'bonsai-kernels'

export interface ModelSpec {
  /** Registry id. */
  id: string
  hfRepo: string
  dtype: string
  device: DeviceKind
  sizeBytes?: number
  /** Which adapter the worker builds. Default 'transformers'. */
  adapter?: AdapterKind
  /** Serve the built-in offline fixture model (testing/tiny-model.ts) instead of the Hub. */
  fixture?: 'tiny-random-llama'
  /** Script for adapter 'fake' (Error entries are not cloneable; use strings). */
  fakeScript?: Exclude<FakeResponse, Error>[]
  fakePerTokenMs?: number
  // --- adapter 'bonsai-kernels' (runtime/bonsai/manifest) ---
  /** GGUF file inside `hfRepo`. */
  file?: string
  /** Pinned Hub revision. */
  revision?: string
  /** sha256 of `file`. */
  sha256?: string
  /** Context length of the generation cache, tokens. */
  context?: number
  /** The engine module: where it is served and the hash it must have. */
  runtime?: { url: string; sha256: string }
  decodePipelineDepth?: number
}

export interface WireGenerateOptions {
  maxTokens?: number
  temperature?: number
  topP?: number
  stop?: string[]
  /** false → no `delta` messages (saves postMessage traffic). Default true. */
  stream?: boolean
  thinking?: ThinkingMode
  reasoningBudget?: number
  answerPrefix?: string
  stopOnJsonEnd?: boolean
  prefixKey?: string
}

/** A fixed-prompt benchmark (adapters that support it; see runtime/bonsai/bonsai-llm.ts). */
export interface BenchRequest {
  messages?: ChatMessage[]
  ids?: number[]
  maxNewTokens: number
  mode: 'upstream' | 'adapter'
}

export interface BenchResult {
  mode: 'upstream' | 'adapter'
  promptTokens: number
  ttftMs: number
  decodeTps: number
  tokens: number
  ids: number[]
  depth?: number
}

export type ToWorker =
  | { type: 'load'; id: number; spec: ModelSpec }
  | { type: 'generate'; id: number; messages: ChatMessage[]; opts: WireGenerateOptions }
  | { type: 'cancel'; id: number; target: number }
  | { type: 'unload'; id: number }
  /** Capabilities of the adapter; `spec` builds the adapter (without loading the model) when none exists yet. */
  | { type: 'probe'; id: number; spec?: ModelSpec }
  | { type: 'bench'; id: number; request: BenchRequest }
  | { type: 'resetSession'; id: number }

export interface WireError {
  name: string
  message: string
}

export type RuntimeEventKind = 'device-lost' | 'gpu-error'

export type WorkerResult = GenerateResult | { modelId: string | null } | RuntimeCapabilities | BenchResult | null

export type FromWorker =
  | { type: 'progress'; id: number; progress: LoadProgress }
  | { type: 'delta'; id: number; text: string }
  | { type: 'result'; id: number; value: WorkerResult }
  | { type: 'error'; id: number; error: WireError }
  | { type: 'event'; kind: RuntimeEventKind; message: string }

/** Anything with postMessage + message events: Worker, MessagePort, DedicatedWorkerGlobalScope. */
export interface Endpoint {
  postMessage(msg: unknown): void
  addEventListener(type: 'message', fn: (ev: MessageEvent) => void): void
  removeEventListener(type: 'message', fn: (ev: MessageEvent) => void): void
  start?(): void
}
