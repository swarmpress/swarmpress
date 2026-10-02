/**
 * In-browser LLM runtime (plan section D, ADR-0057). Public API for game code.
 * The session is not wired yet: `LlmClient.spawn()`, `detectCapabilities()` +
 * `chooseModels()`, `electLeader()` and `GpuScheduler` are the pieces it will use.
 */
export * from './types'
export * from './structured'
export * from './registry'
export { DEFAULT_REGISTRY } from './registry.default'
export * from './capabilities'
export * from './download'
export * from './gpu-scheduler'
export * from './leader'
export * from './protocol'
export { LlmClient, LlmWorkerError, type LlmClientOptions } from './client'
export { FakeLlm, chunkText, type FakeLlmOptions, type FakeResponse, type FakeCall } from './fake-llm'
export { TINY_MODEL_ENTRY, TINY_MODEL_ID } from './testing/tiny-model'
export { bonsaiManifest, BONSAI_MANIFESTS, type BonsaiManifest } from './runtime/bonsai/manifest'
