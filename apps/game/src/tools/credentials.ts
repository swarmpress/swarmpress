/**
 * The player's credentials for the site's tools (ADR-0076, ADR-0054: a
 * player may hold their own keys on their own device).
 *
 * An imported n8n request names its credential (`credential` on the node,
 * e.g. `crm-api`); the sandbox only ever sees that name, in the
 * `X-SwarmPress-Credential` header. Outside the sandbox the browser's tool
 * runner swaps the name for the secret before the request leaves for the
 * central proxy, which forwards it and keeps nothing. Secrets live in this
 * browser's storage only: they are not synced, not in the site repo, not in
 * the command log. A credential that is not set up fails the request loudly.
 */

/** How a credential signs a request (n8n's generic credential types). */
export type CredentialKind = 'header' | 'query' | 'basic' | 'bearer'

export interface Credential {
  kind: CredentialKind
  /** The header (`header`) or query parameter (`query`) name. */
  name?: string
  /** The secret (`header`, `query`, `bearer`), or the password (`basic`). */
  value: string
  /** `basic`: the user. */
  user?: string
}

export const CREDENTIAL_HEADER = 'x-swarmpress-credential'
const KEY = 'swarmpress.tool-credentials.v1'

export interface CredentialStore {
  get(name: string): Credential | undefined
  names(): string[]
  set(name: string, c: Credential): void
  remove(name: string): void
}

/** Credentials in `localStorage` (a memory map where storage is unavailable). */
export function browserCredentials(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): CredentialStore {
  let mem: Record<string, Credential> = {}
  const read = (): Record<string, Credential> => {
    try {
      const raw = storage?.getItem(KEY)
      return raw ? (JSON.parse(raw) as Record<string, Credential>) : mem
    } catch {
      return mem
    }
  }
  const write = (all: Record<string, Credential>) => {
    mem = all
    try {
      storage?.setItem(KEY, JSON.stringify(all))
    } catch {
      // storage refused: the memory copy holds for this session
    }
  }
  return {
    get: (name) => read()[name],
    names: () => Object.keys(read()).sort(),
    set: (name, c) => write({ ...read(), [name]: c }),
    remove: (name) => {
      const all = { ...read() }
      delete all[name]
      write(all)
    },
  }
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

/**
 * The request signed with the credential its header names, the header
 * removed. Throws when the credential is not set up.
 */
export function signRequest<R extends { url: string; headers: Record<string, string> }>(req: R, store: CredentialStore): R {
  const entry = Object.entries(req.headers).find(([k]) => k.toLowerCase() === CREDENTIAL_HEADER)
  if (!entry) return req
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.toLowerCase() !== CREDENTIAL_HEADER))
  const name = entry[1]
  const c = store.get(name)
  if (!c) throw new Error(`the credential "${name}" is not set up: add it on the Tools tab (Credentials)`)
  switch (c.kind) {
    case 'header':
      return { ...req, headers: { ...headers, [c.name || 'Authorization']: c.value } }
    case 'bearer':
      return { ...req, headers: { ...headers, Authorization: `Bearer ${c.value}` } }
    case 'basic':
      return { ...req, headers: { ...headers, Authorization: `Basic ${b64(`${c.user ?? ''}:${c.value}`)}` } }
    case 'query': {
      const sep = req.url.includes('?') ? '&' : '?'
      return { ...req, headers, url: `${req.url}${sep}${encodeURIComponent(c.name || 'key')}=${encodeURIComponent(c.value)}` }
    }
  }
}

/** This browser's tool credentials (one store for the runner and the Tools tab). */
export const toolCredentials = browserCredentials()
