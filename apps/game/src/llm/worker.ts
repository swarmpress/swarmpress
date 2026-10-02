/// <reference lib="webworker" />
/**
 * LLM module worker: owns the model and its own WebGPU device, off the
 * render thread. Spawned by LlmClient.spawn():
 *
 *   new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
 *
 * Adapters are imported lazily, one chunk each: the Bonsai worker never loads
 * Transformers.js or onnxruntime-web, and the other way round.
 */
import { FakeLlm } from './fake-llm'
import type { Endpoint, ModelSpec } from './protocol'
import type { LocalLlm } from './types'
import { createWorkerHost, type HostContext } from './worker-host'

const abs = (u: string) => new URL(u, self.location.href).href

const specs = new Map<string, ModelSpec>()

const spec = (id: string): ModelSpec => {
  const s = specs.get(id)
  if (!s) throw new Error(`unknown model spec ${id}`)
  return s
}

async function build(first: ModelSpec, host: HostContext): Promise<LocalLlm> {
  if (first.adapter === 'fake') return new FakeLlm({ script: first.fakeScript, perTokenMs: first.fakePerTokenMs ?? 20 })
  if (first.adapter === 'bonsai-kernels') {
    const { BonsaiLlm } = await import('./runtime/bonsai/bonsai-llm')
    return new BonsaiLlm({
      resolve: (id) => {
        const s = spec(id)
        if (!s.file || !s.revision || !s.sha256 || !s.runtime || !s.context) throw new Error(`model spec ${id} is not a Bonsai manifest`)
        return {
          hfRepo: s.hfRepo,
          file: s.file,
          revision: s.revision,
          sha256: s.sha256,
          sizeBytes: s.sizeBytes ?? 0,
          context: s.context,
          runtime: { url: abs(s.runtime.url), sha256: s.runtime.sha256 },
          decodePipelineDepth: s.decodePipelineDepth,
        }
      },
      onEvent: (e) => host.emit(e.kind, e.message),
    })
  }
  // onnxruntime-web's runtime (.mjs + .wasm) is self-hosted through Vite asset
  // URLs instead of Transformers.js' default jsDelivr CDN.
  const [{ TransformersJsLlm }, ort, { tinyModelFetch }] = await Promise.all([
    import('./transformers-llm'),
    import('./ort-assets'),
    import('./testing/tiny-model'),
  ])
  return new TransformersJsLlm({
    resolve: (id) => {
      const s = spec(id)
      return { hfRepo: s.hfRepo, dtype: s.dtype, device: s.device, sizeBytes: s.sizeBytes }
    },
    wasmPaths: { mjs: abs(ort.ortMjsUrl), wasm: abs(ort.ortWasmUrl) },
    fetch: first.fixture === 'tiny-random-llama' ? tinyModelFetch(fetch.bind(self)) : undefined,
  })
}

// Token deltas are merged into one message per 50 ms so streaming does not flood the main thread.
createWorkerHost(self as unknown as Endpoint, build, (s) => specs.set(s.id, s), { deltaBatchMs: 50 })
