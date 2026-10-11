/** The session's handle on its storage worker: storage messages, the governed API, records. */
import type { StorageRequest, StorageResponse } from './storage-protocol'

export interface StorageEndpoint {
  /** Answers one storage-channel message from the sandbox. */
  storage(payload: string): Promise<string>
  /** One governed-API message (sessions, branches, change requests, merges, releases). */
  repo<T = unknown>(msg: Record<string, unknown>): Promise<T>
}

type Distributive<T> = T extends unknown ? Omit<T, 'id'> : never

export class StorageClient implements StorageEndpoint {
  private next = 1
  private readonly waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()

  constructor(
    private readonly worker: Pick<Worker, 'postMessage' | 'addEventListener' | 'terminate'>,
    private readonly onRecords: (records: unknown[]) => void = () => {},
  ) {
    worker.addEventListener('message', (e: Event) => {
      const m = (e as MessageEvent<StorageResponse>).data
      if ('kind' in m) {
        this.onRecords(m.records)
        return
      }
      const w = this.waiting.get(m.id)
      this.waiting.delete(m.id)
      if (m.ok) w?.resolve(m.value)
      else w?.reject(new Error(m.error))
    })
  }

  static start(onRecords?: (records: unknown[]) => void): StorageClient {
    return new StorageClient(new Worker(new URL('./storage-worker.ts', import.meta.url), { type: 'module' }), onRecords)
  }

  private call<T>(req: Distributive<StorageRequest>): Promise<T> {
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage({ ...req, id })
    })
  }

  /** Restores the repository from the company store's records; resolves with its branches. */
  init(records: unknown[]): Promise<{ name: string; head: string }[]> {
    return this.call({ kind: 'init', records })
  }

  storage(payload: string): Promise<string> {
    return this.call({ kind: 'storage', payload })
  }

  repo<T = unknown>(msg: Record<string, unknown>): Promise<T> {
    return this.call({ kind: 'repo', msg })
  }

  stop() {
    this.worker.terminate()
  }
}
