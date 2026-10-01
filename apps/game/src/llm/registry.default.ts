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
 * Roles use the staff-role vocabulary of config/roles.toml plus "chatter".
 */
import type { ModelRegistry } from './registry'

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
      roles: ['chatter', 'editor_in_chief', 'writer', 'editor', 'media', 'qa', 'seo', 'linker'],
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
      roles: ['chatter', 'editor_in_chief', 'writer', 'editor', 'media', 'qa', 'seo', 'linker', 'translator'],
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
      roles: ['editor_in_chief', 'writer', 'editor', 'qa', 'seo', 'linker', 'translator'],
      evalPending: true,
    },
  ],
}
