/**
 * A company's WordPress (ADR-0078 to ADR-0084): the PHP backend serving the GPL sandbox, wired
 * to the game's storage API. The session opens it for a company on the WordPress engine
 * (`?site=wordpress` until it is the default) and talks to it in two ways only: HTTP-shaped
 * requests to WordPress, and the governed API of its repository.
 */
import { PHP_BACKENDS, type PhpBackendId } from './backend'
import { iframeConnector, PhpWasmSandbox } from './sandbox-host'
import type { StorageEndpoint } from './storage-client'
import { PhpUnavailableError, type BootInfo, type PhpBackend } from './types'

/** Where the sandbox artifact's browser entry is served: its own origin (ADR-0078 §3). */
export function sandboxUrl(env: { VITE_WP_SANDBOX_URL?: string } = (import.meta.env ?? {}) as { VITE_WP_SANDBOX_URL?: string }): string {
  return env.VITE_WP_SANDBOX_URL ?? `${location.protocol}//${location.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:5181/index.html`
}

export interface WordPress {
  php: PhpBackend
  storage: StorageEndpoint
  boot: BootInfo
}

export async function openWordPress(opts: { backend: PhpBackendId; storage: StorageEndpoint; sandboxUrl?: string; makeBackend?: (storage: StorageEndpoint) => PhpBackend }): Promise<WordPress> {
  const info = PHP_BACKENDS[opts.backend]
  if (!info.available) throw new PhpUnavailableError(`${info.label} is not built yet`)
  const php =
    opts.makeBackend?.(opts.storage) ??
    (opts.backend === 'php-wasm'
      ? new PhpWasmSandbox(iframeConnector(opts.sandboxUrl ?? sandboxUrl(), { absoluteUrl: 'http://sandbox.invalid' }), (p) => opts.storage.storage(p))
      : (() => {
          throw new PhpUnavailableError(`no ${opts.backend} backend was given`)
        })())
  const boot = await php.boot()
  return { php, storage: opts.storage, boot }
}
