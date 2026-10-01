import { describe, expect, it, vi } from 'vitest'
import { loadRegistry, normalizeEntry, parseRegistryJson, parseRegistryToml, tierRank } from './registry'
import { DEFAULT_REGISTRY } from './registry.default'

// Same shape the server-side config/models.toml uses (snake_case, low|mid|high tiers, approx_vram_mb).
const SERVER_TOML = `
[[model]]
id = "qwen3-0.6b-q4f16"
hf_repo = "onnx-community/Qwen3-0.6B-ONNX"
dtype = "q4f16"
size_bytes = 570_000_000
sha256 = "TODO-UNVERIFIED"
context = 8192
min_max_buffer_size = 268_435_456
min_max_storage_buffer_binding_size = 134_217_728
approx_vram_mb = 900
tier = "low"
roles = ["chatter", "writer"]
eval_pending = false

[[model]]
id = "gpt-oss-20b-q4f16"
hf_repo = "onnx-community/gpt-oss-20b-ONNX"
dtype = "q4f16"
size_bytes = 12_800_000_000
context = 32768
min_max_buffer_size = 2_147_483_648
min_storage_buffer_binding_size = 1_073_741_824
approx_vram_bytes = 15_204_352_000
tier = "xl"
roles = ["writer"]
eval_pending = true
`

describe('registry parsing', () => {
  it('parses the server TOML shape and maps legacy tiers', () => {
    const r = parseRegistryToml(SERVER_TOML)
    expect(r.models).toHaveLength(2)
    const [small, xl] = r.models
    expect(small).toMatchObject({
      id: 'qwen3-0.6b-q4f16',
      hfRepo: 'onnx-community/Qwen3-0.6B-ONNX',
      tier: 'small',
      approxVramBytes: 900 * 1024 * 1024,
      minStorageBufferBindingSize: 134_217_728,
      sha256: 'TODO-UNVERIFIED',
      evalPending: false,
    })
    expect(xl).toMatchObject({ tier: 'xl', approxVramBytes: 15_204_352_000, minStorageBufferBindingSize: 1_073_741_824, evalPending: true })
  })

  it('accepts camelCase JSON (the bundled default round-trips)', () => {
    const r = parseRegistryJson(JSON.parse(JSON.stringify(DEFAULT_REGISTRY)))
    expect(r).toEqual(DEFAULT_REGISTRY)
  })

  it('rejects invalid entries with a useful message', () => {
    const good = { ...DEFAULT_REGISTRY.models[0], id: 'x' } as unknown as Record<string, unknown>
    expect(() => normalizeEntry({ ...good, sizeBytes: -1 })).toThrow(/model x: sizeBytes must be a non-negative number/)
    expect(() => normalizeEntry({ ...good, roles: 'writer' })).toThrow(/model x: roles must be a string array/)
    expect(() => normalizeEntry({ ...good, hfRepo: '' })).toThrow(/model x: hfRepo/)
    expect(() => parseRegistryToml(SERVER_TOML.replace('tier = "low"', 'tier = "ultra"'))).toThrow(/unknown tier "ultra"/)
    expect(() => parseRegistryToml(SERVER_TOML.replace('gpt-oss-20b-q4f16', 'qwen3-0.6b-q4f16'))).toThrow(/duplicate/)
    expect(() => parseRegistryToml('x = 1')).toThrow(/\[\[model\]\]/)
  })

  it('default registry: unique ids, every tier present, all eval-pending until verified', () => {
    const ids = DEFAULT_REGISTRY.models.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(DEFAULT_REGISTRY.models.map((m) => m.tier))).toEqual(new Set(['tiny', 'small', 'large', 'xl']))
    expect(DEFAULT_REGISTRY.models.every((m) => m.evalPending)).toBe(true)
    expect(tierRank('agency-only')).toBeLessThan(tierRank('tiny'))
  })
})

describe('loadRegistry', () => {
  it('uses the served TOML when available', async () => {
    const fetchImpl = vi.fn(async () => new Response(SERVER_TOML, { status: 200 }))
    const r = await loadRegistry({ url: '/config/models.toml', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.source).toBe('remote')
    expect(r.registry.models[0].id).toBe('qwen3-0.6b-q4f16')
  })

  it('falls back to the bundled default with a warning', async () => {
    const warn = vi.fn()
    const r = await loadRegistry({ fetchImpl: (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch, onWarning: warn })
    expect(r.source).toBe('default')
    expect(r.registry).toBe(DEFAULT_REGISTRY)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/HTTP 404/))
  })

  it('falls back on invalid TOML', async () => {
    const r = await loadRegistry({ fetchImpl: (async () => new Response('[[model]]\nid = ', { status: 200 })) as unknown as typeof fetch })
    expect(r.source).toBe('default')
  })
})
