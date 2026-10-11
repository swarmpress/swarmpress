/**
 * Starting a company's WordPress (ADR-0079, plan M1): what happens between "the company opens on
 * the WordPress engine" and "its site can take work".
 *
 *   storage   the storage worker restores the repository from the company store's records
 *   boot      the sandbox (php-wasm and the fork) starts on its own origin
 *   install   a new company only: WordPress's installer runs and its state is imported onto live
 *   qualify   one REST request must answer with the site's index
 *
 * Any failure stops the startup with the stage and the reason (rule 11); nothing is retried behind
 * the player's back and no other backend is tried. Pure orchestration: the storage endpoint and
 * the backend come in through `WordPressStartupDeps`, so the sequence is unit-tested with fakes.
 */
import type { StorageEndpoint } from './storage-client'
import { isPhpUnavailable, type BootInfo, type PhpBackend } from './types'

export type WpStageId = 'storage' | 'boot' | 'install' | 'qualify'
export type WpStageState = 'pending' | 'active' | 'done' | 'skipped' | 'failed'

export const WP_STAGES: readonly { id: WpStageId; label: string }[] = [
  { id: 'storage', label: 'Restore the content repository' },
  { id: 'boot', label: 'Start WordPress' },
  { id: 'install', label: 'Install the site' },
  { id: 'qualify', label: 'Qualification request' },
]

export interface WpStartupEvent {
  stage: WpStageId
  state: WpStageState
  detail?: string
}

export class WpStartupError extends Error {
  constructor(
    readonly stage: WpStageId,
    /** `blocked`: this backend cannot run here; `failed`: a stage failed. */
    readonly kind: 'blocked' | 'failed',
    message: string,
  ) {
    super(message)
    this.name = 'WpStartupError'
  }
}

/** What a new company's installer is given (the governed layer owns the admin's sign-in, ADR-0084). */
export interface SiteIdentity {
  title: string
  adminEmail: string
}

export interface WordPressStartupDeps {
  /** Restores the repository from `records`; resolves with its branches. */
  restore(records: unknown[]): Promise<{ name: string; head: string }[]>
  records(): Promise<unknown[]>
  storage: StorageEndpoint
  /** Makes the backend once the storage endpoint is up. */
  backend(storage: StorageEndpoint): PhpBackend
  site: SiteIdentity
  /** A random password for the installer's admin account (never shown; sign-in comes from the governed layer). */
  password?: () => string
}

export interface StartedWordPress {
  php: PhpBackend
  boot: BootInfo
  installed: boolean
  /** WordPress's own name for the site, from the qualification request. */
  name: string
}

const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

function randomPassword(): string {
  const b = new Uint8Array(18)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, 'x')
}

export async function startWordPress(deps: WordPressStartupDeps, onEvent: (e: WpStartupEvent) => void = () => {}): Promise<StartedWordPress> {
  let current: WpStageId = 'storage'
  const enter = (stage: WpStageId, detail?: string) => {
    current = stage
    onEvent({ stage, state: 'active', detail })
  }
  const done = (stage: WpStageId, detail?: string) => onEvent({ stage, state: 'done', detail })
  try {
    enter('storage')
    const records = await deps.records()
    const branches = await deps.restore(records)
    const live = branches.find((b) => b.name === 'live')
    const isNew = !live || !live.head
    done('storage', isNew ? 'a new site' : `${records.length} records, ${branches.length} branch${branches.length === 1 ? '' : 'es'}`)

    enter('boot')
    const php = deps.backend(deps.storage)
    let boot: BootInfo
    try {
      boot = await php.boot()
    } catch (e) {
      throw new WpStartupError('boot', isPhpUnavailable(e) ? 'blocked' : 'failed', String((e as Error)?.message ?? e))
    }
    done('boot', `PHP ${boot.php}, ${boot.files} files, ${Math.round(boot.ms)} ms`)

    if (isNew) {
      enter('install')
      const password = (deps.password ?? randomPassword)()
      const r = await php.request({
        method: 'POST',
        url: '/wp-admin/install.php?step=2',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({
          weblog_title: deps.site.title,
          user_name: 'admin',
          admin_password: password,
          admin_password2: password,
          pw_weak: 'on',
          admin_email: deps.site.adminEmail,
          blog_public: '0',
          Submit: 'Install',
        }),
      })
      if (r.status !== 200 || !r.text().includes('Success')) throw new WpStartupError('install', 'failed', `the installer answered ${r.status}`)
      await deps.storage.repo({ op: 'import.finish' })
      done('install', 'installed onto live')
    } else {
      onEvent({ stage: 'install', state: 'skipped', detail: 'installed before' })
    }

    enter('qualify')
    const q = await php.request({ url: '/?rest_route=/' })
    let name = ''
    try {
      name = String((q.json() as { name?: unknown }).name ?? '')
    } catch {
      /* not JSON: fails below */
    }
    if (q.status !== 200 || !name) throw new WpStartupError('qualify', 'failed', `the REST index answered ${q.status}${name ? '' : ' without a site name'}`)
    done('qualify', name)
    return { php, boot, installed: isNew, name }
  } catch (e) {
    const err = e instanceof WpStartupError ? e : new WpStartupError(current, 'failed', String((e as Error)?.message ?? e))
    onEvent({ stage: err.stage, state: 'failed', detail: err.message })
    throw err
  }
}
