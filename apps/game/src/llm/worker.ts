/// <reference lib="webworker" />
/**
 * LLM module worker: owns the model and its own WebGPU device, off the
 * render thread. Spawned by LlmClient.spawn():
 *
 *   new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
 *
 * onnxruntime-web's runtime (.mjs + .wasm) is self-hosted through Vite asset
 * URLs instead of Transformers.js' default jsDelivr CDN.
 */
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { FakeLlm } from './fake-llm'
import type { Endpoint, ModelSpec } from './protocol'
import { tinyModelFetch } from './testing/tiny-model'
import { TransformersJsLlm } from './transformers-llm'
import { createWorkerHost } from './worker-host'

const abs = (u: string) => new URL(u, self.location.href).href

const specs = new Map<string, ModelSpec>()

function build(spec: ModelSpec) {
  if (spec.adapter === 'fake') return new FakeLlm({ script: spec.fakeScript, perTokenMs: spec.fakePerTokenMs ?? 20 })
  return new TransformersJsLlm({
    resolve: (id) => {
      const s = specs.get(id)
      if (!s) throw new Error(`unknown model spec ${id}`)
      return { hfRepo: s.hfRepo, dtype: s.dtype, device: s.device, sizeBytes: s.sizeBytes }
    },
    wasmPaths: { mjs: abs(ortMjsUrl), wasm: abs(ortWasmUrl) },
    fetch: spec.fixture === 'tiny-random-llama' ? tinyModelFetch(fetch.bind(self)) : undefined,
  })
}

createWorkerHost(self as unknown as Endpoint, build, (spec) => specs.set(spec.id, spec))
