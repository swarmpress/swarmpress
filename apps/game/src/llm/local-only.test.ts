// No inference over the network (ADR-0057): the fetch guard every adapter in
// the worker gets, and a check of the backend modules' sources for any
// inference endpoint or any host other than the Hugging Face weight download.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allowedModelUrl, isWeightHost, localOnlyFetch, NetworkInferenceBlockedError } from './local-only'

const ORIGIN = 'http://localhost:4176'
const HUB = 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf/resolve/b072e1d3b35a0a630cece372c2127528e0994386/Ternary-Bonsai-2-27B-PTQ1_0.gguf'

describe('localOnlyFetch', () => {
  const seen: string[] = []
  const inner = (async (input: RequestInfo | URL) => {
    seen.push(String(input instanceof Request ? input.url : input))
    return new Response('ok')
  }) as typeof fetch
  const guarded = localOnlyFetch(inner, ORIGIN)

  it('lets the engine, onnxruntime and the weights through: this origin, blob: and the Hub', async () => {
    seen.length = 0
    await guarded('/vendor/bonsai/engine.mjs')
    await guarded(`${ORIGIN}/assets/ort-wasm.wasm`)
    await guarded(HUB, { method: 'HEAD' })
    await guarded(HUB, { headers: { Range: 'bytes=0-1023' } })
    await guarded('https://cas-bridge.xethub.hf.co/xet-bridge/abc')
    await guarded(new Request('https://cdn-lfs-us-1.huggingface.co/repos/x'))
    expect(seen).toHaveLength(6)
    expect(allowedModelUrl('blob:http://localhost:4176/9b1f', ORIGIN)).toBe(true)
  })

  it('refuses every inference endpoint, a local model server included, before the request leaves', async () => {
    seen.length = 0
    const refused = [
      'https://api.openai.com/v1/chat/completions',
      'https://api.anthropic.com/v1/messages',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent',
      'https://api-inference.huggingface.co/models/Qwen/Qwen3-4B',
      'https://router.huggingface.co/v1/chat/completions',
      // A native model server on this machine is not in-browser inference either.
      'http://localhost:11434/api/generate',
      'http://127.0.0.1:8080/v1/chat/completions',
      // Plain http to the Hub is not the pinned download.
      'http://huggingface.co/x',
      'https://evil.example/huggingface.co/x',
    ]
    for (const url of refused) {
      const err = await guarded(url).catch((e) => e)
      expect(err, url).toBeInstanceOf(NetworkInferenceBlockedError)
      expect(err.message).toMatch(/no inference over the network/)
    }
    // A body to the Hub is an inference request, not a download.
    await expect(guarded(HUB, { method: 'POST', body: '{}' })).rejects.toThrow(/not a POST/)
    expect(seen).toEqual([])
    expect(isWeightHost('huggingface.co.evil.example')).toBe(false)
  })
})

// ---------------------------------------------------------------- the backend modules' sources

const SRC = fileURLToPath(new URL('..', import.meta.url))

/** Every module a backend path runs through: src/llm (adapters, worker, client, startup), the Bonsai runtime, the session's model runtime. */
function backendModules(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        // The qualification harness and the test fixtures are not backend paths.
        if (name === 'bench' || name === 'testing') continue
        walk(p)
      } else if (/\.(ts|json)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p)
    }
  }
  walk(join(SRC, 'llm'))
  out.push(join(SRC, 'session', 'model-runtime.ts'))
  return out
}

const INFERENCE_ENDPOINTS = [
  /api\.openai\.com/i,
  /api\.anthropic\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /api-inference\.huggingface/i,
  /router\.huggingface/i,
  /\/v1\/(chat\/)?completions/i,
  /\/v1\/messages\b/i,
  /\/api\/(generate|chat)\b/i,
  /:11434\b/,
  /openrouter\.ai|api\.together|groq\.com|api\.mistral|cohere\.(ai|com)|fireworks\.ai|bedrock|vertexai/i,
]

describe('the backend modules', () => {
  const files = backendModules()

  it('are the ones expected (the scan is not vacuous)', () => {
    const names = files.map((f) => relative(SRC, f).replaceAll('\\', '/'))
    for (const must of ['llm/backend.ts', 'llm/client.ts', 'llm/worker.ts', 'llm/worker-host.ts', 'llm/chrome-prompt-llm.ts', 'llm/transformers-llm.ts', 'llm/startup.ts', 'llm/runtime/bonsai/bonsai-llm.ts', 'session/model-runtime.ts']) {
      expect(names).toContain(must)
    }
  })

  it('name no inference endpoint, and no URL outside the Hugging Face weight download', () => {
    const offending: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const where = relative(SRC, file)
      for (const re of INFERENCE_ENDPOINTS) if (re.test(text)) offending.push(`${where}: ${re}`)
      for (const m of text.matchAll(/\bhttps?:\/\/([^/\s'"`)<>\]]+)/g)) {
        const host = m[1].replace(/:\d+$/, '')
        if (!isWeightHost(host)) offending.push(`${where}: ${m[0]}`)
      }
    }
    expect(offending).toEqual([])
  })

  it('the worker hands every adapter the guarded fetch', () => {
    const worker = readFileSync(join(SRC, 'llm', 'worker.ts'), 'utf8')
    expect(worker).toMatch(/const guardedFetch = localOnlyFetch\(fetch\.bind\(self\)/)
    // The Bonsai adapter and the Transformers.js adapter both take it.
    expect(worker.match(/fetch: guardedFetch/g)).toHaveLength(1)
    expect(worker).toMatch(/: guardedFetch,\n/)
    // No adapter is built without a fetch of its own, which would fall back to the unguarded global.
    expect(worker).not.toMatch(/fetch: undefined/)
  })
})
