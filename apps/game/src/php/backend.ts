/**
 * Which PHP backend a company's WordPress runs on (ADR-0079): `?php=` on the URL, else the
 * company's stored choice, else the default. Like the model backend, the choice is explicit and
 * never falls through to another backend: one that cannot run here fails with
 * `PhpUnavailableError`.
 */
export const PHP_BACKEND_IDS = ['php-wasm', 'fake', 'frankenphp'] as const
export type PhpBackendId = (typeof PHP_BACKEND_IDS)[number]

export interface PhpBackendInfo {
  id: PhpBackendId
  label: string
  /** Where PHP runs. */
  runsIn: 'browser' | 'server' | 'memory'
  available: boolean
  description: string
}

export const PHP_BACKENDS: Record<PhpBackendId, PhpBackendInfo> = {
  'php-wasm': {
    id: 'php-wasm',
    label: 'php-wasm (in the browser)',
    runsIn: 'browser',
    available: true,
    description: 'PHP 8.4 compiled to WebAssembly, in a worker of the sandbox page on its own origin. Downloaded once (about 90 MB).',
  },
  frankenphp: {
    id: 'frankenphp',
    label: 'FrankenPHP (native, server side)',
    runsIn: 'server',
    available: false,
    description: 'Native PHP for the runner and hosted executors. Registered for the contract; not built yet.',
  },
  fake: {
    id: 'fake',
    label: 'Scripted WordPress (tests)',
    runsIn: 'memory',
    available: true,
    description: 'Answers requests from a script; no PHP runs.',
  },
}

export const DEFAULT_PHP_BACKEND: PhpBackendId = 'php-wasm'

export function isPhpBackendId(v: unknown): v is PhpBackendId {
  return typeof v === 'string' && (PHP_BACKEND_IDS as readonly string[]).includes(v)
}

/** `?php=php-wasm|fake|frankenphp`; null when absent. An unknown value is an error, not a default. */
export function phpBackendFromQuery(search: string): PhpBackendId | null {
  const v = new URLSearchParams(search).get('php')
  if (v === null) return null
  if (!isPhpBackendId(v)) throw new Error(`unknown PHP backend ?php=${v} (one of ${PHP_BACKEND_IDS.join(', ')})`)
  return v
}

/** The kv key holding a company's choice. */
export const phpBackendKey = (company: string) => `php.backend.${company}`

export function resolvePhpBackend(search: string, stored: string | null): PhpBackendId {
  return phpBackendFromQuery(search) ?? (isPhpBackendId(stored) ? stored : DEFAULT_PHP_BACKEND)
}

/** `?site=wordpress`: a company opts into the WordPress engine until it is the default (plan M8). */
export function wordpressEngineFromQuery(search: string): boolean {
  return new URLSearchParams(search).get('site') === 'wordpress'
}
