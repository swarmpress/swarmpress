// importVerifiedEngine: the engine is fetched, hashed and handed to the module
// loader as a blob URL, so what is imported is exactly what was hashed. The
// test runner rewrites `import()`, so the loader is injected here and reads the
// blob back; the real import runs in the gated e2e (e2e/bonsai.spec.ts).
import { describe, expect, it } from 'vitest'
import { importVerifiedEngine } from './bonsai-llm'
import { sha256Hex } from './extract'

const CODE = 'const zl={load:async()=>({ok:true})};export{zl as TernaryBonsai2};'

describe('importVerifiedEngine', () => {
  it('hands the loader a blob of exactly the verified code, then revokes it', async () => {
    const sha256 = await sha256Hex(CODE)
    const f = (async () => new Response(CODE, { headers: { 'content-type': 'text/javascript' } })) as unknown as typeof fetch
    const seen: { url: string; code: string; type: string }[] = []
    const marker = { TernaryBonsai2: {}, DEFAULT_MODEL_ID: 'x', DEFAULT_GGUF_FILE: 'y' }
    const engine = await importVerifiedEngine({ url: 'https://game.test/vendor/bonsai/engine.mjs', sha256 }, f, async (url) => {
      const res = await fetch(url)
      seen.push({ url, code: await res.text(), type: res.headers.get('content-type') ?? '' })
      return marker
    })
    expect(engine).toBe(marker)
    expect(seen).toHaveLength(1)
    expect(seen[0].url.startsWith('blob:')).toBe(true)
    expect(seen[0].code).toBe(CODE)
    expect(seen[0].type).toBe('text/javascript')
    // The blob URL does not outlive the import.
    await expect(fetch(seen[0].url)).rejects.toThrow()
    // The worker-scope shims are in place before the engine evaluates.
    expect(typeof (globalThis as { process?: { env?: unknown } }).process?.env).toBe('object')
  })

  it('does not reach the loader when the hash is wrong', async () => {
    const f = (async () => new Response(CODE)) as unknown as typeof fetch
    let loaded = false
    await expect(
      importVerifiedEngine({ url: 'https://game.test/vendor/bonsai/engine.mjs', sha256: 'f'.repeat(64) }, f, async () => {
        loaded = true
        return {}
      }),
    ).rejects.toThrow(/not the pinned build/)
    expect(loaded).toBe(false)
  })
})
