/**
 * The php-wasm backend (ADR-0079): the GPL sandbox artifact's browser entry, embedded as a
 * hidden iframe on its own origin (ADR-0078 §3). The game and WordPress share nothing but one
 * MessagePort:
 *
 *   game → sandbox  {type:'request', id, request}        sandbox → game  {type:'response', id, response}
 *   sandbox → game  {type:'storage', id, payload}        game → sandbox  {type:'storage-reply', id, reply}
 *   sandbox → game  {type:'ready', php, files, ms} | {type:'failed', message}
 *
 * Storage messages are answered by the handler given here (the game's storage API); requests
 * are correlated by id.
 */
import { encodeBody, PhpUnavailableError, toResponse, type BootInfo, type PhpBackend, type PhpRequest, type PhpResponse, type StorageHandler } from './types'

/** Connects the sandbox: hands it the port (tests replace the iframe with a fake sandbox). */
export type SandboxConnector = (port: MessagePort) => { dispose(): void }

interface WireResponse {
  status: number
  headers: Record<string, string[]>
  body: ArrayBuffer
}

type SandboxMessage =
  | { type: 'ready'; php: string; files: number; ms: number }
  | { type: 'failed'; message: string }
  | { type: 'response'; id: number; response: WireResponse }
  | { type: 'storage'; id: number; payload: string }

/** Embeds the sandbox page at `url` (on the sandbox origin) and connects once it has loaded. */
export function iframeConnector(url: string, config: Record<string, unknown> = {}, timeoutMs = 60_000): SandboxConnector {
  return (port) => {
    const frame = document.createElement('iframe')
    frame.src = url
    frame.title = 'WordPress sandbox'
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'
    const origin = new URL(url, location.href).origin
    let connected = false
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.origin !== origin) return
      if ((e.data as { type?: string })?.type === 'swarmpress:sandbox-loaded' && !connected) {
        connected = true
        frame.contentWindow?.postMessage({ type: 'swarmpress:connect', config }, origin, [port])
      }
    }
    window.addEventListener('message', onMessage)
    const timer = setTimeout(() => {
      if (!connected) port.postMessage({ type: 'failed', message: `the sandbox at ${url} did not load within ${timeoutMs} ms` })
    }, timeoutMs)
    document.body.append(frame)
    return {
      dispose() {
        clearTimeout(timer)
        window.removeEventListener('message', onMessage)
        frame.remove()
      },
    }
  }
}

export class PhpWasmSandbox implements PhpBackend {
  readonly id = 'php-wasm'
  private readonly channel = new MessageChannel()
  private readonly port = this.channel.port1
  private readonly waiting = new Map<number, (r: WireResponse) => void>()
  private next = 1
  private ready: Promise<BootInfo> | null = null
  private connection: { dispose(): void } | null = null

  constructor(
    private readonly connect: SandboxConnector,
    private readonly storage: StorageHandler,
  ) {}

  boot(): Promise<BootInfo> {
    this.ready ??= new Promise<BootInfo>((resolve, reject) => {
      this.port.onmessage = (e: MessageEvent<SandboxMessage>) => {
        const m = e.data
        if (m.type === 'ready') resolve({ php: m.php, files: m.files, ms: m.ms })
        else if (m.type === 'failed') reject(new PhpUnavailableError(m.message))
        else if (m.type === 'response') {
          this.waiting.get(m.id)?.(m.response)
          this.waiting.delete(m.id)
        } else if (m.type === 'storage') {
          void this.storage(m.payload)
            .catch((err: unknown) => JSON.stringify({ error: `storage: ${String((err as Error)?.message ?? err)}` }))
            .then((reply) => this.port.postMessage({ type: 'storage-reply', id: m.id, reply }))
        }
      }
      this.port.start()
      this.connection = this.connect(this.channel.port2)
    })
    return this.ready
  }

  async request(request: PhpRequest): Promise<PhpResponse> {
    await this.boot()
    const id = this.next++
    const body = encodeBody(request.body)
    const wire = await new Promise<WireResponse>((resolve) => {
      this.waiting.set(id, resolve)
      this.port.postMessage({ type: 'request', id, request: { method: request.method ?? 'GET', url: request.url, headers: request.headers ?? {}, body } }, body ? [body] : [])
    })
    return toResponse(wire.status, wire.headers, new Uint8Array(wire.body))
  }

  stop(): void {
    this.connection?.dispose()
    this.port.close()
  }
}
