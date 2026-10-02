/**
 * Pinned model manifests of the Bonsai WebGPU runtime, keyed by registry id
 * (config/models.toml). The registry holds what every runtime shares (repo,
 * size, context, tier, roles); the manifest holds what this runtime needs on
 * top: the exact revision and file, their hashes and the engine build. A
 * manifest must agree with runtime.lock.json (manifest.test.ts).
 */
import ptq1 from './ternary-bonsai-2-27b-ptq1_0.json'

export interface BonsaiManifest {
  format: string
  id: string
  adapter: 'bonsai-kernels'
  repo: string
  revision: string
  file: string
  bytes: number
  sha256: string
  packing: string
  context: number
  reasoning: string[]
  runtime: { url: string; sha256: string; space: string; spaceSha: string }
  notices: { model: string; runtime: string }
  /** Pins the decode pipeline depth; absent lets the engine calibrate at load. */
  decodePipelineDepth?: number
}

export const BONSAI_MANIFESTS: Record<string, BonsaiManifest> = {
  [ptq1.id]: ptq1 as BonsaiManifest,
}

export function bonsaiManifest(modelId: string): BonsaiManifest | undefined {
  return BONSAI_MANIFESTS[modelId]
}
