/**
 * Worker-side RPC host. Separated from worker.ts so it can be unit-tested
 * over a MessageChannel with FakeLlm.
 */
import type { Endpoint, FromWorker, ModelSpec, ToWorker } from './protocol'
import type { LocalLlm } from './types'

export type AdapterFactory = (spec: ModelSpec) => LocalLlm | Promise<LocalLlm>

export function createWorkerHost(
  ep: Endpoint,
  factory: AdapterFactory,
  /** Called with every load spec before the adapter loads it (e.g. to register registry data). */
  beforeLoad?: (spec: ModelSpec) => void,
): { close(): void } {
  let llm: LocalLlm | null = null
  let llmSpecKey = ''
  const aborts = new Map<number, AbortController>()
  const send = (m: FromWorker) => ep.postMessage(m)
  const fail = (id: number, e: unknown) =>
    send({ type: 'error', id, error: { name: (e as Error)?.name ?? 'Error', message: (e as Error)?.message ?? String(e) } })

  const onMessage = async (ev: MessageEvent) => {
    const msg = ev.data as ToWorker
    switch (msg.type) {
      case 'load': {
        try {
          beforeLoad?.(msg.spec)
          const key = `${msg.spec.adapter ?? 'transformers'}:${msg.spec.fixture ?? ''}`
          if (!llm || key !== llmSpecKey) {
            await llm?.dispose()
            llm = await factory(msg.spec)
            llmSpecKey = key
          }
          await llm.load(msg.spec.id, (progress) => send({ type: 'progress', id: msg.id, progress }), {
            device: msg.spec.device,
            dtype: msg.spec.dtype,
          })
          send({ type: 'result', id: msg.id, value: { modelId: llm.modelId } })
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
        try {
          const stream = msg.opts.stream !== false
          const res = await llm.generate(msg.messages, {
            maxTokens: msg.opts.maxTokens,
            temperature: msg.opts.temperature,
            topP: msg.opts.topP,
            stop: msg.opts.stop,
            signal: ac.signal,
            onDelta: stream ? (text) => send({ type: 'delta', id: msg.id, text }) : undefined,
          })
          send({ type: 'result', id: msg.id, value: res })
        } catch (e) {
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
    }
  }
  const handler = (ev: MessageEvent) => void onMessage(ev)
  ep.addEventListener('message', handler)
  ep.start?.()
  return { close: () => ep.removeEventListener('message', handler) }
}
