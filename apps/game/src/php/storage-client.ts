/** The session's handle on its storage worker: storage messages, the governed API, records. */
import type { PlatformCall, StorageRequest, StorageResponse } from './storage-protocol'

/**
 * What the worker asks the session for (ADR-0050, ADR-0084 §2): asset bytes in object storage and
 * WordPress's outgoing HTTP through the fetch proxy, both under the company lease.
 */
export interface StoragePlatform {
  putAsset(sha256: string, bytes: Uint8Array, mime: string): Promise<void>
  getAsset(sha256: string): Promise<Uint8Array | null>
  http(request: { method: string; url: string; headers: Record<string, string>; body: string; timeout: number }): Promise<{ status: number; headers: Record<string, string>; body?: string; body_b64?: string }>
}

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
    private readonly platform: StoragePlatform | null = null,
  ) {
    worker.addEventListener('message', (e: Event) => {
      const m = (e as MessageEvent<StorageResponse>).data
      if ('kind' in m && m.kind === 'platform') {
        void this.answer(m.id, m.call)
        return
      }
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

  static start(onRecords?: (records: unknown[]) => void, platform?: StoragePlatform | null): StorageClient {
    return new StorageClient(new Worker(new URL('./storage-worker.ts', import.meta.url), { type: 'module' }), onRecords, platform ?? null)
  }

  private async answer(id: number, call: PlatformCall) {
    try {
      if (!this.platform) throw new Error(`${call.op} needs the platform, which this session does not have`)
      const value =
        call.op === 'asset.put'
          ? await this.platform.putAsset(call.sha256, call.bytes, call.mime)
          : call.op === 'asset.get'
            ? await this.platform.getAsset(call.sha256)
            : await this.platform.http(call.request)
      this.worker.postMessage({ id, kind: 'platform-reply', ok: true, value: value ?? null })
    } catch (e) {
      this.worker.postMessage({ id, kind: 'platform-reply', ok: false, error: String((e as Error)?.message ?? e) })
    }
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
    return this.call({ kind: 'init', records, platform: !!this.platform })
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
