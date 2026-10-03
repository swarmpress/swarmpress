/**
 * In-browser LLM runtime (plan section D, ADR-0057). Public API for game code.
 * The game session wires it in src/session/model-runtime.ts: `chooseBackend()`
 * + `openBackend()` over `LlmClient.spawn()` (or `ChromePromptLlm` in the
 * window), the startup of startup.ts, `electResident()` for the one resident
 * model per origin, and `GpuScheduler` with the scene's renderer hooks.
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
export * from './backend'
// (startup.ts has a `formatBytes` of its own, in decimal units; download.ts's is the one exported here.)
export {
  runStartup,
  StartupError,
  STARTUP_STAGES,
  type StartupDeps,
  type StartupEvent,
  type StartupResult,
  type StartupStageId,
  type StartupStageState,
  type StorageReport,
} from './startup'
export * from './local-only'
export { LlmClient, LlmWorkerError, type LlmClientOptions } from './client'
export { ChromePromptLlm, CHROME_BACKEND, CHROME_LABEL, type ChromePromptLlmOptions } from './chrome-prompt-llm'
export { FakeLlm, chunkText, type FakeLlmOptions, type FakeResponse, type FakeCall } from './fake-llm'
export { TINY_MODEL_ENTRY, TINY_MODEL_ID } from './testing/tiny-model'
export { bonsaiManifest, BONSAI_MANIFESTS, type BonsaiManifest } from './runtime/bonsai/manifest'
