/**
 * Self-hosted onnxruntime-web runtime files (Vite asset URLs). Its own module
 * so only the Transformers.js adapter pulls them in (worker.ts imports it
 * lazily).
 */
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

export { ortMjsUrl, ortWasmUrl }
