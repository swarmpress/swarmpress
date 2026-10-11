/**
 * The PHP backend contract (ADR-0079): where a company's WordPress runs. Every backend runs the
 * same GPL sandbox artifact (ADR-0078) and is reached only through two channels: HTTP-shaped
 * requests in, and the storage messages the fork's seams send out (answered by the game's
 * storage API). No backend gives swarm.press code a way into PHP.
 */

/** An HTTP-shaped request to WordPress. */
export interface PhpRequest {
  method?: string
  /** Path and query (`/?rest_route=/wp/v2/posts`). */
  url: string
  headers?: Record<string, string>
  body?: Uint8Array | string
}

export interface PhpResponse {
  status: number
  headers: Record<string, string[]>
  body: Uint8Array
  text(): string
  json<T = unknown>(): T
}

/** What a backend reports once WordPress is ready. */
export interface BootInfo {
  php: string
  files: number
  ms: number
}

/** Answers one storage-channel message (JSON in, JSON out). */
export type StorageHandler = (payload: string) => Promise<string>

export interface PhpBackend {
  readonly id: string
  /** Starts PHP and WordPress; rejects with `PhpUnavailableError` when this backend cannot run here. */
  boot(): Promise<BootInfo>
  request(request: PhpRequest): Promise<PhpResponse>
  stop(): void
}

export class PhpUnavailableError extends Error {
  constructor(message = 'the PHP backend is not available') {
    super(message)
    this.name = 'PhpUnavailableError'
  }
}

export const isPhpUnavailable = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'PhpUnavailableError'

export function toResponse(status: number, headers: Record<string, string[]>, body: Uint8Array): PhpResponse {
  return {
    status,
    headers,
    body,
    text: () => new TextDecoder().decode(body),
    json: <T>() => JSON.parse(new TextDecoder().decode(body)) as T,
  }
}

export function encodeBody(body: PhpRequest['body']): ArrayBuffer | undefined {
  if (body === undefined) return undefined
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  return bytes.slice().buffer
}
