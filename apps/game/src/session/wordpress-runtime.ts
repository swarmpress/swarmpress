/**
 * A company's WordPress in the session (ADR-0078 to ADR-0084, plan M1): the engine choice, the
 * storage worker, the sandbox and the startup stages, as one runtime the card and the site engine
 * read. A company is on the WordPress engine once `?site=wordpress` opened it (kept as the
 * company's `site.engine` setting) until it is the default (plan M8).
 *
 * The repository's records go to the company store as the worker hands them back, in order, so
 * they seal, sync and restore with the company's other text (ADR-0075).
 */
import { PHP_BACKENDS, phpBackendKey, resolvePhpBackend, wordpressEngineFromQuery, type PhpBackendId } from '../php/backend'
import { iframeConnector, PhpWasmSandbox } from '../php/sandbox-host'
import { sandboxUrl } from '../php/wordpress'
import { StorageClient, type StorageEndpoint } from '../php/storage-client'
import { startWordPress, WP_STAGES, type StartedWordPress, type WpStageId, type WpStageState, type WpStartupEvent } from '../php/startup'
import { PhpUnavailableError, type PhpBackend, type PhpRequest, type PhpResponse } from '../php/types'

export const SITE_ENGINE_KEY = 'site.engine'
export type SiteEngineId = 'astro' | 'wordpress'

interface Kv {
  getKv(key: string): Promise<string | null>
  setKv(key: string, value: string): Promise<void>
}

/** `?site=wordpress` opts the company in, and the choice is kept; otherwise the stored one, else Astro. */
export async function resolveSiteEngine(search: string, store: Kv): Promise<SiteEngineId> {
  if (wordpressEngineFromQuery(search)) {
    if ((await store.getKv(SITE_ENGINE_KEY)) !== 'wordpress') await store.setKv(SITE_ENGINE_KEY, 'wordpress')
    return 'wordpress'
  }
  return (await store.getKv(SITE_ENGINE_KEY)) === 'wordpress' ? 'wordpress' : 'astro'
}

type WpStorage = StorageEndpoint & { init(records: unknown[]): Promise<{ name: string; head: string }[]>; stop?(): void }

export type WordPressPhase = 'starting' | 'ready' | 'blocked' | 'failed'

export interface WordPressRuntimeInfo {
  phase: WordPressPhase
  backend: PhpBackendId
  label: string
  stages: Record<WpStageId, { state: WpStageState; detail?: string }>
  error: string | null
  /** WordPress's name for the site once qualified. */
  name: string | null
}

export interface WordPressRuntimeOptions {
  companyId: string
  store: Kv & { repoRecords(): Promise<unknown[]>; appendRepoRecords(records: unknown[]): Promise<void> }
  search?: string
  site: { title: string; adminEmail: string }
  /** Tests: makes the storage endpoint, which hands records back to `onRecords` (default: a storage worker). */
  storage?: (onRecords: (records: unknown[]) => void) => WpStorage
  /** Tests: the backend (default: the one `?php=` or the company's setting chooses). */
  backend?: (storage: StorageEndpoint) => PhpBackend
  log?: (line: string) => void
}

export class WordPressRuntime {
  private state: WordPressRuntimeInfo
  private readonly listeners = new Set<(i: WordPressRuntimeInfo) => void>()
  private started: Promise<StartedWordPress> | null = null
  private wp: StartedWordPress | null = null
  private storage: WpStorage | null = null
  private persisting: Promise<void> = Promise.resolve()

  private constructor(
    private readonly opts: WordPressRuntimeOptions,
    readonly backend: PhpBackendId,
  ) {
    this.state = { phase: 'starting', backend, label: PHP_BACKENDS[backend].label, stages: freshStages(), error: null, name: null }
  }

  static async open(opts: WordPressRuntimeOptions): Promise<WordPressRuntime> {
    const backend = resolvePhpBackend(opts.search ?? '', await opts.store.getKv(phpBackendKey(opts.companyId)))
    return new WordPressRuntime(opts, backend)
  }

  info(): WordPressRuntimeInfo {
    return this.state
  }

  onChange(fn: (i: WordPressRuntimeInfo) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Starts once; resolves when the site is qualified, rejects with the failed stage. */
  start(): Promise<StartedWordPress> {
    this.started ??= this.run()
    return this.started
  }

  /** After a failure: a new attempt from the first stage, with a new worker and sandbox. */
  retry(): Promise<StartedWordPress> {
    this.stop()
    this.started = null
    this.update({ phase: 'starting', stages: freshStages(), error: null })
    return this.start()
  }

  async request(req: PhpRequest): Promise<PhpResponse> {
    return (await this.start()).php.request(req)
  }

  /** One governed-API message (branches, sessions, change requests, merges, releases). */
  async repo<T = unknown>(msg: Record<string, unknown>): Promise<T> {
    await this.start()
    return this.storage!.repo<T>(msg)
  }

  /** Resolves once every record handed back so far is in the company store. */
  flushed(): Promise<void> {
    return this.persisting
  }

  stop(): void {
    this.wp?.php.stop()
    this.storage?.stop?.()
    this.wp = null
    this.storage = null
  }

  private async run(): Promise<StartedWordPress> {
    const { store } = this.opts
    const persist = (records: unknown[]) => {
      this.persisting = this.persisting.then(() => store.appendRepoRecords(records)).catch((e: unknown) => this.opts.log?.(`repository records were not stored: ${String(e)}`))
    }
    this.storage = this.opts.storage ? this.opts.storage(persist) : StorageClient.start(persist)
    const storage = this.storage
    try {
      const wp = await startWordPress(
        {
          records: () => store.repoRecords(),
          restore: (records) => storage.init(records),
          storage,
          backend: this.opts.backend ?? ((s) => this.defaultBackend(s)),
          site: this.opts.site,
        },
        (e) => this.event(e),
      )
      this.wp = wp
      this.update({ phase: 'ready', name: wp.name })
      this.opts.log?.(`WordPress ready on ${this.backend}: ${wp.name}${wp.installed ? ' (installed)' : ''}`)
      return wp
    } catch (e) {
      const blocked = (e as { kind?: string }).kind === 'blocked'
      this.update({ phase: blocked ? 'blocked' : 'failed', error: String((e as Error)?.message ?? e) })
      throw e
    }
  }

  private defaultBackend(storage: StorageEndpoint): PhpBackend {
    if (this.backend === 'php-wasm') return new PhpWasmSandbox(iframeConnector(sandboxUrl(), { absoluteUrl: 'http://sandbox.invalid' }), (p) => storage.storage(p))
    throw new PhpUnavailableError(`${PHP_BACKENDS[this.backend].label} is not built for the browser`)
  }

  private event(e: WpStartupEvent) {
    this.update({ stages: { ...this.state.stages, [e.stage]: { state: e.state, detail: e.detail } } })
  }

  private update(patch: Partial<WordPressRuntimeInfo>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn(this.state)
  }
}

function freshStages(): WordPressRuntimeInfo['stages'] {
  return Object.fromEntries(WP_STAGES.map((s) => [s.id, { state: 'pending' as WpStageState }])) as WordPressRuntimeInfo['stages']
}
