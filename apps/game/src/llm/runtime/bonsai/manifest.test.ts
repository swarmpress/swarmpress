// The manifest, the lock file and the registry describe the same pinned model
// and engine; a drift between them would load something other than what was
// qualified.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { RuntimeLock } from './extract'
import { BONSAI_MANIFESTS, bonsaiManifest } from './manifest'
import { DEFAULT_REGISTRY } from '../../registry.default'
import { findModel } from '../../registry'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const lock = JSON.parse(read('./runtime.lock.json')) as RuntimeLock

describe('Bonsai model manifest', () => {
  const m = bonsaiManifest('ternary-bonsai-2-27b')!

  it('agrees with runtime.lock.json on the model file and the engine build', () => {
    expect(m).toBeDefined()
    expect({ repo: m.repo, revision: m.revision, file: m.file, bytes: m.bytes, sha256: m.sha256 }).toEqual({
      repo: lock.model.repo,
      revision: lock.model.revision,
      file: lock.model.file,
      bytes: lock.model.bytes,
      sha256: lock.model.sha256,
    })
    expect(m.runtime.sha256).toBe(lock.engine.sha256)
    expect(m.runtime.space).toBe(lock.space.id)
    expect(m.runtime.spaceSha).toBe(lock.space.sha)
    expect(m.runtime.url).toBe(`/vendor/bonsai/${lock.engine.output}`)
  })

  it('agrees with the registry entry of the same id', () => {
    const entry = findModel(DEFAULT_REGISTRY, m.id)!
    expect(entry).toBeDefined()
    expect(entry.hfRepo).toBe(m.repo)
    expect(entry.sizeBytes).toBe(m.bytes)
    expect(entry.sha256).toBe(m.sha256)
    expect(entry.dtype).toBe(m.packing)
    expect(entry.context).toBe(m.context)
  })

  it('agrees with config/models.toml', () => {
    const toml = read('../../../../../../config/models.toml')
    const block = toml.split(/^\[\[model\]\]\s*$/m).find((b) => /^id = "ternary-bonsai-2-27b"/m.test(b))!
    expect(block).toContain(`hf_repo = "${m.repo}"`)
    expect(block).toContain(`sha256 = "${m.sha256}"`)
    expect(block).toContain(`dtype = "${m.packing}"`)
    expect(Number(/^size_bytes = ([\d_]+)/m.exec(block)![1].replace(/_/g, ''))).toBe(m.bytes)
    expect(Number(/^context = (\d+)/m.exec(block)![1])).toBe(m.context)
    // The revision is named in the comment above the entry, so a bump touches it too.
    expect(toml).toContain(m.revision)
  })

  it('pins a revision and declares the reasoning modes the adapter offers', () => {
    expect(m.adapter).toBe('bonsai-kernels')
    expect(m.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(m.reasoning).toEqual(['off', 'medium', 'xhigh'])
    expect(Object.keys(BONSAI_MANIFESTS)).toEqual([m.id])
    expect(bonsaiManifest('qwen3-4b-q4f16')).toBeUndefined()
  })
})
