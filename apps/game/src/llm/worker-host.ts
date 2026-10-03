/**
 * Worker-side RPC host. Separated from worker.ts so it can be unit-tested
 * over a MessageChannel with FakeLlm.
 */
import type { AdapterKind, BenchRequest, BenchResult, Endpoint, FromWorker, ModelSpec, RuntimeEventKind, ToWorker } from './protocol'
import type { LocalLlm, RuntimeCapabilities } from './types'

/** What the host gives an adapter: a way to report events nobody asked for. */
export interface HostContext {
  emit(kind: RuntimeEventKind, message: string): void
}

export type AdapterFactory = (spec: ModelSpec, host: HostContext) => LocalLlm | Promise<LocalLlm>

export interface WorkerHostOptions {
  /**
   * Minimum time between `delta` messages of one generation, ms. Deltas that
   * arrive sooner are merged, so token streaming does not flood the main
   * thread. 0 (the default) sends every delta as it comes.
   */
  deltaBatchMs?: number
  now?: () => number
  /** Honour the test hooks (`destroyDevice`). Off unless the page started the worker in debug mode. */
  debug?: boolean
}

type Benchable = LocalLlm & { bench?: (req: BenchRequest) => Promise<BenchResult> }
type Destroyable = LocalLlm & { destroyDevice?: () => Promise<void> }

const adapterKind = (spec: ModelSpec): AdapterKind => spec.adapter ?? 'transformers'

export function createWorkerHost(
  ep: Endpoint,
  factory: AdapterFactory,
  /** Called with every load spec before the adapter loads it (e.g. to register registry data). */
  beforeLoad?: (spec: ModelSpec) => void,
  options: WorkerHostOptions = {},
): { close(): void } {
  let llm: LocalLlm | null = null
  let llmSpecKey = ''
  const aborts = new Map<number, AbortController>()
  const now = options.now ?? (() => performance.now())
  const batchMs = options.deltaBatchMs ?? 0
  const send = (m: FromWorker) => ep.postMessage(m)
  const fail = (id: number, e: unknown) =>
    send({ type: 'error', id, error: { name: (e as Error)?.name ?? 'Error', message: (e as Error)?.message ?? String(e) } })
  const host: HostContext = { emit: (kind, message) => send({ type: 'event', kind, message }) }

  const adapterFor = async (spec: ModelSpec): Promise<LocalLlm> => {
    const key = `${adapterKind(spec)}:${spec.fixture ?? ''}`
    if (!llm || key !== llmSpecKey) {
      await llm?.dispose()
      llm = await factory(spec, host)
      llmSpecKey = key
    }
    return llm
  }

  const onMessage = async (ev: MessageEvent) => {
    const msg = ev.data as ToWorker
    switch (msg.type) {
      case 'load': {
        try {
          beforeLoad?.(msg.spec)
          const adapter = await adapterFor(msg.spec)
          await adapter.load(msg.spec.id, (progress) => send({ type: 'progress', id: msg.id, progress }), {
            device: msg.spec.device,
            dtype: msg.spec.dtype,
          })
          send({ type: 'result', id: msg.id, value: { modelId: adapter.modelId } })
        } catch (e) {
          fail(msg.id, e)
        }
        break
      }
      case 'generate': {
        if (!llm) {
          fail(msg.id, new Error('no model loaded'))
          break
        }
        const ac = new AbortController()
        aborts.set(msg.id, ac)
        // Batched deltas: merge what arrives within `batchMs` of the last message.
        let pending = ''
        let lastSent = -Infinity
        const flush = () => {
          if (!pending) return
          send({ type: 'delta', id: msg.id, text: pending })
          pending = ''
          lastSent = now()
        }
        const onDelta = (text: string) => {
          pending += text
          if (batchMs <= 0 || now() - lastSent >= batchMs) flush()
        }
        try {
          const stream = msg.opts.stream !== false
          const { stream: _stream, ...wire } = msg.opts
          const res = await llm.generate(msg.messages, { ...wire, signal: ac.signal, onDelta: stream ? onDelta : undefined })
          flush()
          send({ type: 'result', id: msg.id, value: res })
        } catch (e) {
          flush()
          fail(msg.id, e)
        } finally {
          aborts.delete(msg.id)
        }
        break
      }
      case 'cancel':
        aborts.get(msg.target)?.abort()
        send({ type: 'result', id: msg.id, value: null })
        break
      case 'unload':
        try {
          for (const a of aborts.values()) a.abort()
          await llm?.dispose()
          llm = null
          llmSpecKey = ''
          send({ type: 'result', id: msg.id, value: null })
        } catch (e) {
          fail(msg.id, e)
        }
        break
      case 'probe': {
        try {
          if (msg.spec) {
            beforeLoad?.(msg.spec)
            await adapterFor(msg.spec)
          }
          if (!llm) throw new Error('probe needs a model spec before the first load')
          const caps: RuntimeCapabilities = llm.capabilities
            ? await llm.capabilities()
            : {
                // Adapters without a probe of their own report the minimum.
                backend: llmSpecKey.split(':')[0],
                label: llmSpecKey.split(':')[0],
                webgpu: false,
                supportsConstrainedOutput: false,
                supportsPrefixReuse: false,
                supportsVision: false,
                reasoningModes: ['off'],
                contextTokens: null,
              }
          send({ type: 'result', id: msg.id, value: caps })
        } catch (e) {
          fail(msg.id, e)
        }
        break
      }
      case 'bench': {
        try {
          const bench = (llm as Benchable | null)?.bench
          if (!llm || !bench) throw new Error('this adapter has no benchmark')
          send({ type: 'result', id: msg.id, value: await bench.call(llm, msg.request) })
        } catch (e) {
          fail(msg.id, e)
        }
        break
      }
      case 'resetSession':
        try {
          await llm?.resetSession?.()
          send({ type: 'result', id: msg.id, value: null })
        } catch (e) {
          fail(msg.id, e)
        }
        break
      case 'destroyDevice':
        try {
          if (!options.debug) throw new Error('destroyDevice is a test hook; this worker was not started in debug mode')
          const destroy = (llm as Destroyable | null)?.destroyDevice
          if (!llm || !destroy) throw new Error('this adapter has no GPU device to destroy')
          await destroy.call(llm)
          send({ type: 'result', id: msg.id, value: null })
        } catch (e) {
          fail(msg.id, e)
        }
        break
    }
  }
  const handler = (ev: MessageEvent) => void onMessage(ev)
  ep.addEventListener('message', handler)
  ep.start?.()
  return { close: () => ep.removeEventListener('message', handler) }
}
