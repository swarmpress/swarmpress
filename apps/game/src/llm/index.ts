/**
 * In-browser LLM runtime (plan section D). Public API for game code.
 * main.ts is not wired yet: call `LlmClient.spawn()`, `detectCapabilities()`
 * + `chooseModels()`, `electLeader()`, `GpuScheduler` and `JobRunner` from it.
 */
export * from './types'
export * from './structured'
export * from './registry'
export { DEFAULT_REGISTRY } from './registry.default'
export * from './capabilities'
export * from './download'
export * from './gpu-scheduler'
export * from './leader'
export * from './job-runner'
export * from './protocol'
export { LlmClient, LlmWorkerError, type LlmClientOptions } from './client'
export { FakeLlm, chunkText, type FakeLlmOptions, type FakeResponse, type FakeCall } from './fake-llm'
export { TINY_MODEL_ENTRY, TINY_MODEL_ID } from './testing/tiny-model'
