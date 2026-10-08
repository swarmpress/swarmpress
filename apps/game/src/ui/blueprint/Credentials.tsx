/**
 * The player's credentials for the site's tools (ADR-0076, ADR-0054). The
 * panel lists every credential a tool names, set or missing, and sets one
 * up: how it signs a request (a header, a query parameter, basic or bearer)
 * and its secret. Secrets stay in this browser (`tools/credentials.ts`); the
 * list never shows them again.
 */
import { useState } from 'preact/hooks'
import type { SiteModels } from '../../blueprint/types'
import { toolCredentials, type CredentialKind, type CredentialStore } from '../../tools/credentials'
import { Badge } from '../components/common'

/** Credential names the site's tools sign in with, by tool. */
export function credentialsNeeded(models: SiteModels): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const t of models.tools)
    for (const n of t.graph.nodes) {
      const c = (n as { credential?: unknown }).credential
      if (typeof c === 'string') out.set(c, [...(out.get(c) ?? []), t.id])
    }
  return out
}

const KINDS: Array<{ kind: CredentialKind; label: string }> = [
  { kind: 'header', label: 'Header (n8n Header Auth)' },
  { kind: 'query', label: 'Query parameter (n8n Query Auth)' },
  { kind: 'bearer', label: 'Bearer token' },
  { kind: 'basic', label: 'User and password (n8n Basic Auth)' },
]

export function CredentialsPanel({ models, store = toolCredentials }: { models: SiteModels; store?: CredentialStore }) {
  const [, bump] = useState(0)
  const needed = credentialsNeeded(models)
  const names = [...new Set([...needed.keys(), ...store.names()])].sort()
  const [editing, setEditing] = useState<string | null>(null)
  const [kind, setKind] = useState<CredentialKind>('header')
  const [field, setField] = useState('')
  const [user, setUser] = useState('')
  const [value, setValue] = useState('')
  if (!names.length) return null
  const save = () => {
    if (!editing || !value) return
    store.set(editing, { kind, value, ...(field ? { name: field } : {}), ...(kind === 'basic' ? { user } : {}) })
    setEditing(null)
    setValue('')
    bump((x) => x + 1)
  }
  return (
    <details class="card bp-credentials" open={names.some((n) => !store.get(n))}>
      <summary>Credentials</summary>
      <p class="small">The keys your tools' requests sign in with. They stay in this browser: not in the site, not synced. The central proxy forwards them and keeps nothing.</p>
      <ul class="bp-cred-list">
        {names.map((n) => (
          <li key={n} data-credential={n}>
            <code>{n}</code> {store.get(n) ? <Badge tone="good">set</Badge> : <Badge tone="bad">missing</Badge>}{' '}
            <span class="muted small">{needed.get(n)?.join(', ') ?? 'no tool uses it'}</span>{' '}
            <button type="button" class="btn btn-quiet" onClick={() => setEditing(n)}>
              {store.get(n) ? 'Change' : 'Set up'}
            </button>
            {store.get(n) && (
              <button
                type="button"
                class="btn btn-quiet"
                onClick={() => {
                  store.remove(n)
                  bump((x) => x + 1)
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <form
          class="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <strong>{editing}</strong>
          <select value={kind} onChange={(e) => setKind(e.currentTarget.value as CredentialKind)} aria-label="How it signs a request">
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          {(kind === 'header' || kind === 'query') && <input placeholder={kind === 'header' ? 'Header name (X-Api-Key)' : 'Parameter name (api_key)'} value={field} onInput={(e) => setField(e.currentTarget.value)} />}
          {kind === 'basic' && <input placeholder="User" value={user} onInput={(e) => setUser(e.currentTarget.value)} />}
          <input type="password" placeholder={kind === 'basic' ? 'Password' : 'Secret'} value={value} onInput={(e) => setValue(e.currentTarget.value)} autocomplete="off" />
          <button type="submit" class="btn" disabled={!value}>
            Save in this browser
          </button>
          <button type="button" class="btn btn-quiet" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      )}
    </details>
  )
}
