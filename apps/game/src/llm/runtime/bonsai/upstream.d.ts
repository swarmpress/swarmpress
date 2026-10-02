/**
 * Hand-written types for the part of the upstream engine we use
 * (webml-community/ternary-bonsai-2-webgpu-kernels at the pinned Space sha, see
 * runtime.lock.json). Read from the engine's code, not from documentation:
 * upstream publishes none. Anything not listed here is not relied on.
 *
 * We drive the low-level surface (`renderPrompt` → `tokenizer.encode` →
 * `streamTokens`) and never the high-level `generate()`, which throws
 * `No user query found in messages.` whenever a system message is present.
 */

export interface UpstreamLoadProgress {
  status: 'init' | 'tokenizer' | 'weights' | 'ready'
  kind?: 'bytes' | 'tensors'
  loaded?: number
  total?: number | null
  fraction?: number
  message?: string
}

export interface UpstreamLoadOptions {
  /** GGUF file inside the repo. */
  file?: string
  /** Hub revision; a 40-hex commit pins the bytes. Default "main". */
  revision?: string
  fetch?: typeof fetch
  signal?: AbortSignal
  /** false disables the engine's IndexedDB chunk cache. */
  cache?: boolean
  force?: boolean
  cacheName?: string
  /** Context length of the generation cache (default 16384, capped by the model). */
  maxLength?: number
  chatTemplateArgs?: Record<string, unknown>
  /** `null` turns the engine's own persistent prefix snapshots off (we keep ours in memory). */
  prefixSnapshotStore?: unknown | null
  /** Pins the decode pipeline depth; undefined lets the engine calibrate at load. */
  decodePipelineDepth?: number
  runtimeOptions?: { diagnosticSink?: (event: unknown) => void; [k: string]: unknown }
  onProgress?: (p: UpstreamLoadProgress) => void
}

export interface UpstreamTokenizer {
  encode(text: string, opts?: { add_special_tokens?: boolean }): { ids: number[] }
  decode(ids: number[], opts?: { skip_special_tokens?: boolean }): string
  token_to_id?(token: string): number | undefined
}

export interface UpstreamPrefixSnapshot {
  /** Tokens the snapshot covers. */
  length: number
  layout: string
  chunks: unknown[]
}

/**
 * The generation cache. The model mixes attention layers (a KV cache that can
 * be cut anywhere) with linear layers that carry recurrent state, so the cache
 * can only go back to 0, to its current length, or to one captured rewind point.
 */
export interface UpstreamCache {
  readonly maxLength: number
  get_seq_length(): number
  /** Throws unless `t` is 0, the current length or the rewind point. */
  truncate(t: number): void
  canTruncateTo?(t: number): boolean
  /** Captures the current length as the (single) rewind point. */
  captureRewindPoint?(): Promise<void>
  rewindPointLength?: number
  /** Null unless the cache sits exactly at its rewind point. */
  exportPrefixSnapshot?(): Promise<UpstreamPrefixSnapshot | null>
  /** Restores a snapshot and makes it the rewind point; false when the layout does not fit. */
  importPrefixSnapshot?(snapshot: UpstreamPrefixSnapshot): Promise<boolean>
  /** Present when an interrupted pipelined decode can be rolled back to the accepted tokens. */
  mutableStateCheckpoint?(): Promise<unknown>
}

export interface UpstreamStreamRequest {
  /** Tokens to prefill after what the cache already holds. At least one. */
  suffixIds: number[]
  maxNewTokens: number
  eosTokenId: number | number[]
  stopOnEos: boolean
}

export interface UpstreamBenchmark {
  ttftMs: number
  decodeTps: number
  tokens: number
  ids: number[]
}

export interface UpstreamDeviceInfo {
  vendor: string
  architecture: string
  device: string
  description: string
  isFallbackAdapter: boolean
  features: { shaderF16: boolean; subgroups: boolean; subgroupMatrix: boolean; timestampQuery: boolean }
}

export interface UpstreamSession {
  readonly tokenizer: UpstreamTokenizer
  readonly eosTokenIds: number | number[]
  readonly generationState: { cache: UpstreamCache }
  /** Spread into every chat-template render (`enable_thinking`, `reasoning_effort`). */
  chatTemplateArgs: Record<string, unknown>
  readonly thinkOpenTokenId: number | null
  readonly thinkCloseTokenId: number | null
  readonly contextLength: number
  readonly decodePipelineDepth?: number
  readonly runtime?: {
    host?: { device?: GPUDeviceLike; memory?: { liveBytes?: number; peakBytes?: number } }
    device?: unknown
  }
  /** The chat template applied to `messages`; `tools` is always null upstream. */
  renderPrompt(messages: { role: string; content: string }[], addGenerationPrompt?: boolean): string
  encodePrompt(messages: { role: string; content: string }[]): number[]
  /**
   * Prefills `suffixIds`, then yields generated token ids. The second argument
   * is required (upstream reads `opts.decodePipelineDepth` unguarded).
   *
   * Cache after the stream: the suffix, plus every yielded token except the
   * last when the stream ended on `maxNewTokens` or was abandoned, and plus
   * every yielded token when it ended on EOS (the EOS itself is not yielded).
   */
  streamTokens(request: UpstreamStreamRequest, opts: { decodePipelineDepth?: number }): AsyncIterable<number>
  /** Resets the cache, prefills `ids`, generates `maxNewTokens` greedily ignoring EOS, resets again. */
  benchmarkFixedTokenIds(ids: number[], maxNewTokens: number, opts: { decodePipelineDepth?: number }): Promise<UpstreamBenchmark>
  /** Throws when a generation is already running; returns the release function. */
  acquireGenerationLease(): () => void
  deviceInfo(): UpstreamDeviceInfo
  resetCache(): void
  dispose(): void
}

/** The minimum of GPUDevice we touch (the worker has no DOM lib types for it). */
export interface GPUDeviceLike {
  lost?: Promise<{ reason?: string; message?: string }>
  destroy?(): void
}

export interface UpstreamAvailability {
  ok: boolean
  reason?: string
}

/** The engine module's `TernaryBonsai2` export. */
export interface UpstreamEngine {
  checkAvailability(modelId?: string | null, opts?: UpstreamLoadOptions): Promise<UpstreamAvailability>
  load(modelId?: string | null, opts?: UpstreamLoadOptions): Promise<UpstreamSession>
}

export interface UpstreamModule {
  TernaryBonsai2: UpstreamEngine
  DEFAULT_MODEL_ID: string
  DEFAULT_GGUF_FILE: string
}
