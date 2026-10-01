/**
 * Main thread ↔ LLM worker RPC. Plain JSON (structured-clone safe, no
 * transferables). Every request carries an `id`; the worker answers with
 * zero or more `progress`/`delta` messages followed by exactly one
 * `result` or `error` for that id.
 */
import type { FakeResponse } from './fake-llm'
import type { ChatMessage, DeviceKind, GenerateResult, LoadProgress } from './types'

export interface ModelSpec {
  /** Registry id. */
  id: string
  hfRepo: string
  dtype: string
  device: DeviceKind
  sizeBytes?: number
  /** Which adapter the worker builds. Default 'transformers'. */
  adapter?: 'transformers' | 'fake'
  /** Serve the built-in offline fixture model (testing/tiny-model.ts) instead of the Hub. */
  fixture?: 'tiny-random-llama'
  /** Script for adapter 'fake' (Error entries are not cloneable; use strings). */
  fakeScript?: Exclude<FakeResponse, Error>[]
  fakePerTokenMs?: number
}

export interface WireGenerateOptions {
  maxTokens?: number
  temperature?: number
  topP?: number
  stop?: string[]
  /** false → no `delta` messages (saves postMessage traffic). Default true. */
  stream?: boolean
}

export type ToWorker =
  | { type: 'load'; id: number; spec: ModelSpec }
  | { type: 'generate'; id: number; messages: ChatMessage[]; opts: WireGenerateOptions }
  | { type: 'cancel'; id: number; target: number }
  | { type: 'unload'; id: number }

export interface WireError {
  name: string
  message: string
}

export type FromWorker =
  | { type: 'progress'; id: number; progress: LoadProgress }
  | { type: 'delta'; id: number; text: string }
  | { type: 'result'; id: number; value: GenerateResult | { modelId: string | null } | null }
  | { type: 'error'; id: number; error: WireError }

/** Anything with postMessage + message events: Worker, MessagePort, DedicatedWorkerGlobalScope. */
export interface Endpoint {
  postMessage(msg: unknown): void
  addEventListener(type: 'message', fn: (ev: MessageEvent) => void): void
  removeEventListener(type: 'message', fn: (ev: MessageEvent) => void): void
  start?(): void
}
