/// <reference lib="webworker" />
// The ADR-0066 runtime spike: one Dedicated Worker that downloads the pinned
// Gemma 4 E4B target and MTP drafter into OPFS, mounts them read-only
// (WORKERFS reads the OPFS files lazily, nothing is copied into wasm memory),
// loads them with the upstream llama.cpp build in public/vendor/llama/, and
// streams one turn with or without MTP.
import lock from './runtime.lock.json'

type In =
  | { type: 'download' }
  | { type: 'load'; withDraft: boolean; nCtx: number; nDraftMax: number }
  | { type: 'generate'; prompt: string; nPredict: number; mtp: boolean; thinking: boolean }
  | { type: 'stop' }

interface LlamaModule {
  FS: { mkdir(p: string): void; mount(fs: unknown, opts: unknown, p: string): void }
  WORKERFS: unknown
  ccall(name: string, ret: string, types: string[], args: unknown[], opts?: { async?: boolean }): Promise<string> | string
  onPiece?: (s: string) => void
  stopRequested?: boolean
}

const post = (m: unknown) => (self as DedicatedWorkerGlobalScope).postMessage(m)
const files = [lock.model.target, lock.model.draft]
let mod: LlamaModule | null = null

async function opfsFile(name: string): Promise<File | null> {
  const dir = await navigator.storage.getDirectory()
  try {
    return await (await dir.getFileHandle(name)).getFile()
  } catch {
    return null
  }
}

async function download() {
  await navigator.storage.persist?.()
  const dir = await navigator.storage.getDirectory()
  for (const f of files) {
    const have = await opfsFile(f.file)
    if (have && have.size === f.size) {
      post({ type: 'log', text: `${f.file}: cached (${(f.size / 1e9).toFixed(2)} GB)` })
      continue
    }
    const url = `https://huggingface.co/${lock.model.repo}/resolve/${lock.model.revision}/${f.file}`
    const handle = await (await dir.getFileHandle(f.file, { create: true })).createSyncAccessHandle()
    // Resumable: a dropped connection continues from the bytes already on disk.
    let at = handle.getSize()
    if (at > f.size) {
      handle.truncate(0)
      at = 0
    }
    let lastPost = 0
    for (let attempt = 1; at < f.size; attempt++) {
      try {
        const res = await fetch(url, at > 0 ? { headers: { Range: `bytes=${at}-` } } : {})
        if (!res.body || (at > 0 ? res.status !== 206 : !res.ok)) throw new Error(`HTTP ${res.status}`)
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          handle.write(value, { at })
          at += value.byteLength
          if (performance.now() - lastPost > 250) {
            lastPost = performance.now()
            post({ type: 'progress', file: f.file, loaded: at, total: f.size })
          }
        }
      } catch (err) {
        handle.flush()
        if (attempt >= 20) throw err
        post({ type: 'log', text: `${f.file}: ${err instanceof Error ? err.message : err} at ${(at / 1e9).toFixed(2)} GB, resuming (attempt ${attempt + 1})` })
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * attempt)))
      }
    }
    handle.flush()
    handle.close()
    if (at !== f.size) throw new Error(`${f.file}: got ${at} bytes, the lock says ${f.size}`)
    post({ type: 'progress', file: f.file, loaded: at, total: f.size })
  }
  post({ type: 'downloaded' })
}

async function load(withDraft: boolean, nCtx: number, nDraftMax: number) {
  const target = await opfsFile(lock.model.target.file)
  const draft = await opfsFile(lock.model.draft.file)
  if (!target || target.size !== lock.model.target.size) throw new Error('the target model is not downloaded')
  if (withDraft && (!draft || draft.size !== lock.model.draft.size)) throw new Error('the MTP drafter is not downloaded')

  const t0 = performance.now()
  const url = new URL('/vendor/llama/llama.mjs', self.location.origin).href
  const factory = (await import(/* @vite-ignore */ url)).default as (o: object) => Promise<LlamaModule>
  mod = await factory({
    print: (t: string) => post({ type: 'log', text: t }),
    printErr: (t: string) => post({ type: 'log', text: t }),
  })
  mod.onPiece = (s) => post({ type: 'piece', text: s })
  mod.FS.mkdir('/models')
  mod.FS.mount(mod.WORKERFS, { files: withDraft ? [target, draft] : [target] }, '/models')
  const status = JSON.parse(
    await mod.ccall(
      'sp_load',
      'string',
      ['string', 'string', 'number', 'number'],
      [`/models/${lock.model.target.file}`, withDraft ? `/models/${lock.model.draft.file}` : '', nCtx, nDraftMax],
      { async: true },
    ),
  )
  post({ type: 'loaded', status, ms: performance.now() - t0 })
}

async function generate(prompt: string, nPredict: number, mtp: boolean, thinking: boolean) {
  if (!mod) throw new Error('no model loaded')
  mod.stopRequested = false
  const stats = JSON.parse(
    (mod.ccall('sp_chat_reset', 'null', [], []), mod.ccall('sp_chat_add', 'null', ['string', 'string'], ['user', prompt]),
    await mod.ccall('sp_generate', 'string', ['number', 'number', 'number', 'string'], [nPredict, mtp ? 1 : 0, thinking ? 1 : 0, ''], { async: true })),
  )
  post({ type: 'done', stats })
}

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data
  if (m.type === 'stop') {
    if (mod) mod.stopRequested = true
    return
  }
  const job = m.type === 'download' ? download() : m.type === 'load' ? load(m.withDraft, m.nCtx, m.nDraftMax) : generate(m.prompt, m.nPredict, m.mtp, m.thinking)
  job.catch((err) => {
    let text = err instanceof Error ? err.message : String(err)
    // A C++ exception that escaped the shim: ask the runtime for its type and message.
    const WasmException = (WebAssembly as unknown as { Exception?: new (...a: never[]) => unknown }).Exception
    if (mod && WasmException && err instanceof WasmException) {
      try {
        text = `C++ exception: ${(mod as unknown as { getExceptionMessage(e: unknown): string[] }).getExceptionMessage(err).join(': ')}`
      } catch {
        /* keep the generic text */
      }
    }
    post({ type: 'error', text })
  })
}
