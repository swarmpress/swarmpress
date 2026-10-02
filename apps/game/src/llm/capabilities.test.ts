import { describe, expect, it } from 'vitest'
import { chooseModels, detectCapabilities, estimateVramBudget, modelForSeniority, type Capabilities } from './capabilities'
import { DEFAULT_REGISTRY } from './registry.default'

const GiB = 1024 ** 3

// ---- Fixture capability profiles -----------------------------------------

/** MacBook Pro M4, 32 GB unified memory (player told us 32 GB in settings). */
const M4_MAC_32GB: Capabilities = {
  webgpu: true,
  adapter: { vendor: 'apple', architecture: 'metal-3', device: '', description: '', isFallbackAdapter: false },
  limits: { maxBufferSize: 4 * GiB, maxStorageBufferBindingSize: 4 * GiB - 4 },
  features: ['shader-f16', 'timestamp-query'],
  deviceMemoryGb: 8, // Chrome caps navigator.deviceMemory at 8
  memoryHintGb: 32,
}

/** Desktop with an RTX 4070 (12 GB). */
const RTX_4070_12GB: Capabilities = {
  webgpu: true,
  adapter: { vendor: 'nvidia', architecture: 'lovelace', device: '', description: 'NVIDIA GeForce RTX 4070', isFallbackAdapter: false },
  limits: { maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 2 * GiB - 4 },
  features: ['shader-f16'],
  deviceMemoryGb: 8,
}

/** 8 GB laptop with an Intel iGPU. */
const LAPTOP_IGPU_8GB: Capabilities = {
  webgpu: true,
  adapter: { vendor: 'intel', architecture: 'gen-12lp', device: '', description: '', isFallbackAdapter: false },
  limits: { maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 2 * GiB - 4 },
  features: ['shader-f16'],
  deviceMemoryGb: 8,
}

const NO_WEBGPU: Capabilities = { webgpu: false, deviceMemoryGb: 4 }

/** Headless Chromium with SwiftShader (CI). */
const SWIFTSHADER: Capabilities = {
  webgpu: true,
  adapter: { vendor: 'google', architecture: 'swiftshader', device: '', description: 'SwiftShader', isFallbackAdapter: true },
  limits: { maxBufferSize: 256 * 1024 * 1024, maxStorageBufferBindingSize: 128 * 1024 * 1024 },
  features: [],
}

const ALLOW = { allowEvalPending: true }

describe('chooseModels with fixture profiles', () => {
  it('M4 Mac 32 GB → xl (gpt-oss-20b for writers, Qwen3-4B for chatter)', () => {
    const s = chooseModels(M4_MAC_32GB, DEFAULT_REGISTRY, ALLOW)
    expect(s.tier).toBe('xl')
    expect(s.byRole.writer).toBe('gpt-oss-20b-q4f16')
    expect(s.byRole.chatter).toBe('qwen3-4b-q4f16')
    expect(s.budgetBytes).toBeGreaterThan(14 * GiB)
  })

  it('M4 Mac without a memory hint is conservative (deviceMemory caps at 8) → large', () => {
    const { memoryHintGb: _ignored, ...caps } = M4_MAC_32GB
    expect(chooseModels(caps, DEFAULT_REGISTRY, ALLOW).tier).toBe('large')
  })

  it('RTX 4070 12 GB → large (gpt-oss does not fit in VRAM)', () => {
    const s = chooseModels(RTX_4070_12GB, DEFAULT_REGISTRY, ALLOW)
    expect(s.tier).toBe('large')
    expect(s.byRole.writer).toBe('qwen3-4b-q4f16')
    expect(s.excluded['gpt-oss-20b-q4f16']).toBe('exceeds VRAM budget')
  })

  it('8 GB laptop iGPU → small', () => {
    const s = chooseModels(LAPTOP_IGPU_8GB, DEFAULT_REGISTRY, ALLOW)
    expect(s.tier).toBe('small')
    expect(s.byRole.writer).toBe('qwen3-0.6b-q4f16')
    // config/models.toml lets the small model serve every staff role (translator included).
    expect(s.byRole.translator).toBe('qwen3-0.6b-q4f16')
    expect(s.excluded['qwen3-4b-q4f16']).toBe('exceeds VRAM budget')
  })

  it('no WebGPU → agency-only', () => {
    const s = chooseModels(NO_WEBGPU, DEFAULT_REGISTRY, ALLOW)
    expect(s.tier).toBe('agency-only')
    expect(s.eligible).toEqual([])
    expect(Object.values(s.byRole).every((v) => v === null)).toBe(true)
    expect(estimateVramBudget(NO_WEBGPU)).toBe(0)
  })

  it('SwiftShader (fallback adapter, no f16) → agency-only for the real registry', () => {
    const s = chooseModels(SWIFTSHADER, DEFAULT_REGISTRY, ALLOW)
    expect(s.tier).toBe('agency-only')
    expect(s.excluded['granite-4.0-350m-q4f16']).toBe('no shader-f16')
  })

  it('eval-pending models are not auto-selected by default', () => {
    const s = chooseModels(M4_MAC_32GB, DEFAULT_REGISTRY)
    expect(s.tier).toBe('agency-only')
    expect(new Set(Object.values(s.excluded))).toEqual(new Set(['eval pending']))
  })

  it('a slow tokens/sec probe vetoes that tier and above', () => {
    const s = chooseModels({ ...M4_MAC_32GB, probes: { 'qwen3-4b-q4f16': 2.5 } }, DEFAULT_REGISTRY, ALLOW)
    expect(s.tier).toBe('small')
    expect(s.excluded['qwen3-4b-q4f16']).toMatch(/too slow/)
    expect(s.excluded['gpt-oss-20b-q4f16']).toBe('tier vetoed by tokens/sec probe')
  })

  it('settings overrides: forced tier, VRAM budget, pinned role model', () => {
    expect(chooseModels(M4_MAC_32GB, DEFAULT_REGISTRY, { ...ALLOW, tier: 'small' }).tier).toBe('small')
    expect(chooseModels(LAPTOP_IGPU_8GB, DEFAULT_REGISTRY, { ...ALLOW, vramBudgetBytes: 6 * GiB }).tier).toBe('large')
    const pinned = chooseModels(RTX_4070_12GB, DEFAULT_REGISTRY, { ...ALLOW, modelByRole: { chatter: 'granite-4.0-350m-q4f16' } })
    expect(pinned.byRole.chatter).toBe('granite-4.0-350m-q4f16')
  })

  it('buffer limits exclude models even with enough VRAM', () => {
    const caps = { ...M4_MAC_32GB, limits: { maxBufferSize: 1 * GiB, maxStorageBufferBindingSize: 1 * GiB } }
    const s = chooseModels(caps, DEFAULT_REGISTRY, ALLOW)
    expect(s.excluded['gpt-oss-20b-q4f16']).toBe('maxBufferSize too small')
    expect(s.tier).toBe('large')
  })
})

describe('seniority picks within the device tier', () => {
  const sel = chooseModels(M4_MAC_32GB, DEFAULT_REGISTRY, ALLOW)
  it('junior → smallest, mid → middle, senior/star → largest', () => {
    expect(modelForSeniority(sel, 'writer', 'junior')).toBe('qwen3-0.6b-q4f16')
    expect(modelForSeniority(sel, 'writer', 'mid')).toBe('qwen3-4b-q4f16')
    expect(modelForSeniority(sel, 'writer', 'senior')).toBe('gpt-oss-20b-q4f16')
    expect(modelForSeniority(sel, 'writer', 'star')).toBe('gpt-oss-20b-q4f16')
    expect(modelForSeniority(sel, 'nobody', 'star')).toBeNull()
  })
})

describe('detectCapabilities', () => {
  it('reads adapter info, limits and features from navigator.gpu', async () => {
    const nav = {
      deviceMemory: 8,
      gpu: {
        requestAdapter: async () => ({
          info: { vendor: 'nvidia', architecture: 'lovelace', device: '', description: 'NVIDIA GeForce RTX 4070', isFallbackAdapter: false },
          limits: { maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 2 * GiB - 4 },
          features: new Set(['shader-f16']),
        }),
      },
    } as unknown as Navigator
    const caps = await detectCapabilities({ memoryHintGb: 32 }, nav)
    expect(caps).toMatchObject({ webgpu: true, deviceMemoryGb: 8, memoryHintGb: 32, features: ['shader-f16'] })
    expect(caps.adapter?.description).toBe('NVIDIA GeForce RTX 4070')
    expect(chooseModels(caps, DEFAULT_REGISTRY, ALLOW).tier).toBe('large')
  })

  it('no navigator.gpu or no adapter → webgpu false', async () => {
    expect((await detectCapabilities({}, {} as Navigator)).webgpu).toBe(false)
    const nav = { gpu: { requestAdapter: async () => null } } as unknown as Navigator
    expect((await detectCapabilities({}, nav)).webgpu).toBe(false)
  })
})
