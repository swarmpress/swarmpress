/**
 * Bundled fallback registry, same shape as `config/models.toml`.
 *
 * VERIFICATION STATUS (2026-10-01): huggingface.co was blocked by the
 * authoring sandbox's egress policy, so none of these repo ids, dtypes or
 * sizes could be checked against the Hub API. They are taken from the
 * Transformers.js v4.3 docs/examples (Qwen3-0.6B, granite-4.0-350m-web) or
 * from well-known onnx-community conversions (Qwen3-4B, gpt-oss-20b), and the
 * byte numbers are estimates for the named dtype. Every entry is therefore
 * `evalPending: true`, which keeps it out of automatic selection
 * (chooseModels → allowEvalPending: false) until the eval harness (plan:
 * "Test suites — Local LLM") measures real sizes and quality.
 *
 * Roles use the kebab-case staff-role vocabulary of config/roles.toml, plus the
 * client-only pseudo-role "chatter" (hallway small talk, not a staff job). Model
 * ids and staff roles must agree with config/models.toml; registry.drift.test.ts
 * enforces that. The granite chatter model is client-only.
 */
import type { ModelRegistry } from './registry'

/** Every staff role in config/roles.toml (kebab-case). */
export const STAFF_ROLES = ['cfo', 'secretary', 'strategist', 'analyst', 'data-scientist', 'editor-in-chief', 'editor', 'writer', 'translator', 'fact-checker', 'photo-editor', 'photographer', 'video-producer', 'art-director', 'web-developer', 'ux-designer', 'it-engineer', 'dev-ops', 'seo-specialist', 'marketing-manager', 'social-media-manager'] as const

const MiB = 1024 * 1024
const GiB = 1024 * MiB

export const DEFAULT_REGISTRY: ModelRegistry = {
  models: [
    {
      id: 'granite-4.0-350m-q4f16',
      description: 'Tiny chatter model for low-end devices (hallway chatter, standup small talk).',
      hfRepo: 'onnx-community/granite-4.0-350m-ONNX-web',
      dtype: 'q4f16',
      sizeBytes: 260 * 1000 * 1000,
      context: 4096,
      minMaxBufferSize: 256 * MiB,
      minStorageBufferBindingSize: 128 * MiB,
      approxVramBytes: 600 * MiB,
      tier: 'tiny',
      roles: ['chatter'],
      evalPending: true,
    },
    {
      id: 'qwen3-0.6b-q4f16',
      description: 'Small model: chatter, meetings, pitches, link and media picks.',
      hfRepo: 'onnx-community/Qwen3-0.6B-ONNX',
      dtype: 'q4f16',
      sizeBytes: 570 * 1000 * 1000,
      context: 8192,
      minMaxBufferSize: 256 * MiB,
      minStorageBufferBindingSize: 128 * MiB,
      approxVramBytes: 900 * MiB,
      tier: 'small',
      roles: ['chatter', ...STAFF_ROLES],
      evalPending: true,
    },
    {
      id: 'qwen3-4b-q4f16',
      description: '~4B Qwen-class laptop tier: briefs, drafts, revisions, reviews, translation.',
      hfRepo: 'onnx-community/Qwen3-4B-ONNX',
      dtype: 'q4f16',
      sizeBytes: 2800 * 1000 * 1000,
      context: 32768,
      // fp16 token embedding (151936 x 2560) is ~778 MB in one buffer.
      minMaxBufferSize: 1 * GiB,
      minStorageBufferBindingSize: 1 * GiB,
      approxVramBytes: 4200 * MiB,
      tier: 'large',
      roles: ['chatter', ...STAFF_ROLES],
      evalPending: true,
    },
    {
      id: 'gpt-oss-20b-q4f16',
      description: 'GPT-OSS-20B (MoE) q4f16, high tier.',
      hfRepo: 'onnx-community/gpt-oss-20b-ONNX',
      dtype: 'q4f16',
      sizeBytes: 12800 * 1000 * 1000,
      context: 32768,
      minMaxBufferSize: 2 * GiB,
      minStorageBufferBindingSize: 1 * GiB,
      approxVramBytes: 14500 * MiB,
      tier: 'xl',
      roles: ['cfo', 'secretary', 'strategist', 'analyst', 'data-scientist', 'editor-in-chief', 'editor', 'writer', 'translator', 'fact-checker', 'photo-editor', 'photographer', 'seo-specialist', 'marketing-manager'],
      evalPending: true,
    },
    {
      // The one resident model of the MVP (ADR-0057). It runs on the custom
      // WebGPU engine (runtime/bonsai), selected by its manifest, not on
      // Transformers.js. Repo, size and sha256 are the pinned PTQ1_0 GGUF; the
      // buffer limits and VRAM are estimates until the qualification benchmark.
      id: 'ternary-bonsai-2-27b',
      description: 'Ternary Bonsai 2 27B, PTQ1_0 packing (1.75 bits/weight), custom WebGPU kernels.',
      hfRepo: 'prism-ml/Ternary-Bonsai-2-27B-gguf',
      dtype: 'PTQ1_0',
      sizeBytes: 5_946_648_928,
      context: 16384,
      minMaxBufferSize: 2 * GiB,
      minStorageBufferBindingSize: 2 * GiB,
      approxVramBytes: 9000 * MiB,
      tier: 'xl',
      // Every staff role: with the Bonsai backend one resident model serves all of them
      // (the backend picks it directly; tier selection below is for the multi-model path).
      roles: [...STAFF_ROLES],
      evalPending: true,
      sha256: '53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3',
    },
    {
      // The one resident model of the MVP since ADR-0066: Gemma 4 E4B (QAT,
      // Unsloth's UD-Q4_K_XL GGUF) on upstream llama.cpp's WebGPU backend,
      // selected by runtime/llama/runtime.lock.json. The VRAM figure is the
      // runtime spike's (2.49 GB of weights, a 207 MB compute buffer, the KV
      // cache at 8K); the buffer limits are estimates until the qualification run.
      id: 'gemma-4-e4b-it-qat',
      description: 'Gemma 4 E4B instruct (QAT), UD-Q4_K_XL GGUF, upstream llama.cpp on WebGPU; optional MTP drafter.',
      hfRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      dtype: 'UD-Q4_K_XL',
      sizeBytes: 4_215_695_776,
      context: 8192,
      minMaxBufferSize: 1 * GiB,
      minStorageBufferBindingSize: 1 * GiB,
      approxVramBytes: 3000 * MiB,
      tier: 'large',
      roles: [...STAFF_ROLES],
      evalPending: true,
      sha256: 'df0fd4ee07072c607c29a0a1cb4f98918426cca12f45a2776bdd6ee6d09a4de3',
    },
  ],
}
