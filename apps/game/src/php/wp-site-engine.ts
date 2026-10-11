/**
 * A company's site capabilities on WordPress (ADR-0082, plan M4): the `OrchestratorSiteEngine`
 * orchestrator-wasm calls, made of REST requests into the sandbox and messages to the governed
 * API. Each capability runs with the sandbox's session bound to its branch and its author, so its
 * writes become one attributed commit on that branch; one lock keeps capabilities from
 * interleaving on the one sandbox. No capability can merge except `merge`, which only the Publish
 * job calls (rule 3).
 *
 * Also here: the knowledge client of a WordPress site (its registries read from `live`, shaped by
 * `wordpress_pack`), and the export and deploy that follow a merge (ADR-0083).
 */
import type { KnowledgeFetch } from '../net/central'
import type { PhpRequest, PhpResponse } from './types'

/** What orchestrator-wasm calls for a company on WordPress (its `OrchestratorSiteEngine`). */
export interface OrchestratorSiteEngine {
  branchFor(name: string): Promise<string>
  findPost(branch: string, postType: string, slug: string): Promise<object | null>
  savePost(branch: string, id: number | null, postJson: string, attributionJson: string): Promise<object>
  openChangeRequest(branch: string, title: string, attributionJson: string): Promise<object>
  merge(id: number, head: string, attributionJson: string): Promise<string>
  releaseStatus(id: number): Promise<string | null>
  redeploy(id: number): Promise<object>
}

/** What the engine needs: both channels of the company's WordPress. */
export interface WpChannels {
  request(req: PhpRequest): Promise<PhpResponse>
  repo<T = unknown>(msg: Record<string, unknown>): Promise<T>
}

export interface WpPost {
  post_type: string
  slug: string
  title: string
  excerpt: string
  content: string
  status: string
  featured_media?: number | null
  categories?: string[]
}

interface Attribution {
  staff_id?: string
  name?: string
  job_id?: number
  job_kind?: string
  work_item?: string
  model?: string
  approved_by?: string
}

export type ReleaseState = 'pending' | 'landed' | 'failed'

/** A merged change request to export and deploy. */
export interface Merged {
  id: number
  head: string
  workItem: string | null
  /** URL paths the change touched (the posts its capabilities saved). */
  touched: string[]
}

export interface WpSiteEngineOptions {
  /** After a merge into live: export and deploy; resolves when landed, rejects when it failed. */
  publish?(merged: Merged): Promise<void>
  log?(line: string): void
}

const LIVE = 'live'

/** The governed author of a capability's commit (ADR-0080): the staff member, or the approver of a merge. */
export function authorOf(attributionJson: string | null | undefined, merging = false): { kind: string; id: string; job?: string; model?: string } {
  const a = (attributionJson ? JSON.parse(attributionJson) : {}) as Attribution
  const job = a.job_id != null ? `${a.job_kind ?? 'job'}-${a.job_id}` : undefined
  if (merging && a.approved_by) return { kind: 'human', id: a.approved_by, ...(job ? { job } : {}) }
  return { kind: a.staff_id ? 'agent' : 'system', id: a.staff_id || 'orchestrator', ...(job ? { job } : {}), ...(a.model ? { model: a.model } : {}) }
}

const typePath = (postType: string) => (postType === 'page' ? 'pages' : 'posts')

/** HTML entities WordPress's REST API returns in names and rendered fields. */
function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

const text = (html: string) => decode(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())

async function json<T>(r: PhpResponse, what: string): Promise<T> {
  if (r.status >= 400) throw new Error(`${what}: WordPress answered ${r.status} ${r.text().slice(0, 200)}`)
  return r.json<T>()
}

function check<T>(v: T, what: string): T {
  const e = (v as { error?: unknown } | null)?.error
  if (e) throw new Error(`${what}: ${typeof e === 'string' ? e : JSON.stringify(v)}`)
  return v
}

/** A path under the site's URL (`http://sandbox.invalid/x/` → `/x/`). */
export function pathOf(link: string): string {
  try {
    return new URL(link).pathname
  } catch {
    return link
  }
}

export class WpSiteEngine {
  private lock: Promise<unknown> = Promise.resolve()
  /** Release state by change request (ADR-0083). */
  readonly releases = new Map<number, ReleaseState>()
  /** URL paths saved per branch, for the incremental export of its merge. */
  private readonly touched = new Map<string, Set<string>>()
  private readonly merged = new Map<number, Merged>()

  constructor(
    private readonly wp: WpChannels,
    private readonly opts: WpSiteEngineOptions = {},
  ) {}

  /** Runs `fn` alone on the sandbox (its session is one binding for every request). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn)
    this.lock = run.catch(() => undefined)
    return run
  }

  private session(branch: string, author: object, userId = 1) {
    return this.wp.repo({ op: 'session.set', branch, user_id: userId, author })
  }

  private async head(branch: string): Promise<string> {
    const log = check(await this.wp.repo<{ id: string }[]>({ op: 'log', branch, limit: 1 }), `log of ${branch}`)
    return log[0]?.id ?? ''
  }

  async branchFor(name: string): Promise<string> {
    const branches = await this.wp.repo<{ name: string }[]>({ op: 'branches' })
    if (!branches.some((b) => b.name === name)) check(await this.wp.repo({ op: 'branch.create', name, from: LIVE }), `branch ${name}`)
    return name
  }

  findPost(branch: string, postType: string, slug: string) {
    return this.exclusive(async () => {
      await this.session(branch, { kind: 'system', id: 'reader' })
      const found = await json<Record<string, any>[]>(
        await this.wp.request({ url: `/?rest_route=/wp/v2/${typePath(postType)}&slug=${encodeURIComponent(slug)}&status=any&context=edit&_fields=id,slug,title,excerpt,content,status,featured_media,categories,modified_gmt` }),
        `find ${slug}`,
      )
      const p = found[0]
      if (!p) return null
      const categories = p.categories?.length
        ? (await json<{ name: string }[]>(await this.wp.request({ url: `/?rest_route=/wp/v2/categories&include=${p.categories.join(',')}&_fields=id,name` }), 'categories')).map((c) => decode(c.name))
        : []
      const featured = p.featured_media
        ? await json<{ source_url: string }>(await this.wp.request({ url: `/?rest_route=/wp/v2/media/${p.featured_media}&_fields=source_url` }), 'featured media').then((m) => m.source_url).catch(() => null)
        : null
      const post: WpPost = { post_type: postType, slug: p.slug, title: p.title?.raw ?? '', excerpt: p.excerpt?.raw ?? '', content: p.content?.raw ?? '', status: p.status, featured_media: p.featured_media || null, categories }
      return { id: p.id, post, version: String(p.modified_gmt), featured_url: featured }
    })
  }

  private async termIds(names: string[]): Promise<number[]> {
    const ids: number[] = []
    for (const name of names) {
      const hits = await json<{ id: number; name: string }[]>(await this.wp.request({ url: `/?rest_route=/wp/v2/categories&search=${encodeURIComponent(name)}&_fields=id,name` }), `category ${name}`)
      const hit = hits.find((h) => decode(h.name) === name)
      // "Add a term" (ADR-0082 §1): a category the blog index names but WordPress lacks.
      const id = hit?.id ?? (await json<{ id: number }>(await this.wp.request({ method: 'POST', url: '/?rest_route=/wp/v2/categories', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }), `add category ${name}`)).id
      ids.push(id)
    }
    return ids
  }

  savePost(branch: string, id: number | null, postJson: string, attributionJson: string) {
    if (branch === LIVE) return Promise.reject(new Error('live refuses governed writes'))
    return this.exclusive(async () => {
      const post = JSON.parse(postJson) as WpPost
      await this.session(branch, authorOf(attributionJson))
      const categories = await this.termIds(post.categories ?? [])
      const body = { title: post.title, slug: post.slug, excerpt: post.excerpt, content: post.content, status: post.status, featured_media: post.featured_media ?? 0, categories }
      const saved = await json<{ id: number; link: string }>(
        await this.wp.request({ method: 'POST', url: `/?rest_route=/wp/v2/${typePath(post.post_type)}${id ? `/${id}` : ''}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        `save ${post.slug}`,
      )
      const set = this.touched.get(branch) ?? new Set<string>()
      set.add(pathOf(saved.link))
      this.touched.set(branch, set)
      return { id: saved.id, link: saved.link }
    })
  }

  async openChangeRequest(branch: string, title: string, attributionJson: string) {
    const open = check(await this.wp.repo<{ id: number; source: string }[]>({ op: 'cr.list', open: true }), 'change requests')
    let id = open.find((c) => c.source === branch)?.id
    if (id == null) {
      const workItem = (JSON.parse(attributionJson || '{}') as Attribution).work_item
      const n = Number(workItem?.match(/(\d+)$/)?.[1])
      id = check(await this.wp.repo<{ id: number }>({ op: 'cr.open', source: branch, title, author: authorOf(attributionJson), ...(Number.isFinite(n) ? { work_item: n } : {}) }), `open ${branch}`).id
    }
    return { id, branch, head: await this.head(branch) }
  }

  async merge(id: number, head: string, attributionJson: string): Promise<string> {
    const { change_request: cr } = check(await this.wp.repo<{ change_request: { source: string; status: string; merged?: string; work_item?: number } }>({ op: 'cr.get', id }), `change request ${id}`)
    if (cr.merged) return cr.merged
    const now = await this.head(cr.source)
    if (now !== head) throw new Error(`change request ${id} moved since it was approved (${head.slice(0, 7)} → ${now.slice(0, 7)})`)
    const r = check(await this.wp.repo<{ head: string }>({ op: 'cr.merge', id, author: authorOf(attributionJson, true) }), `merge ${id}`)
    const workItem = (JSON.parse(attributionJson || '{}') as Attribution).work_item ?? (cr.work_item != null ? `work-item-${cr.work_item}` : null)
    const merged: Merged = { id, head: r.head, workItem, touched: [...(this.touched.get(cr.source) ?? [])] }
    this.merged.set(id, merged)
    this.deploy(merged)
    return r.head
  }

  private deploy(m: Merged) {
    if (!this.opts.publish) return
    this.releases.set(m.id, 'pending')
    this.opts
      .publish(m)
      .then(() => this.releases.set(m.id, 'landed'))
      .catch((e: unknown) => {
        this.releases.set(m.id, 'failed')
        this.opts.log?.(`the export of change request ${m.id} failed: ${String((e as Error)?.message ?? e)}`)
      })
  }

  async releaseStatus(id: number): Promise<string | null> {
    return this.releases.get(id) ?? null
  }

  async redeploy(id: number) {
    const m = this.merged.get(id)
    if (!m) throw new Error(`change request ${id} was not merged in this session`)
    if (this.releases.get(id) !== 'failed') return { state: this.releases.get(id) ?? 'pending', requested: false, attempt: 0 }
    this.deploy(m)
    return { state: 'pending', requested: true, attempt: 1 }
  }

  // ---------------------------------------------------------------- knowledge (ADR-0082 §1)

  /** WordPress's registries on `live`, through REST, every page of each list. */
  readRegistries() {
    return this.exclusive(async () => {
      await this.session(LIVE, { kind: 'system', id: 'reader' })
      const all = async <T>(route: string, fields: string): Promise<T[]> => {
        const out: T[] = []
        for (let page = 1; ; page++) {
          const r = await this.wp.request({ url: `/?rest_route=${route}&per_page=100&page=${page}&_fields=${fields}` })
          if (r.status === 400 && page > 1) break
          out.push(...(await json<T[]>(r, route)))
          const total = Number(r.headers['x-wp-totalpages']?.[0] ?? 1)
          if (page >= total) break
        }
        return out
      }
      const index = await json<{ name: string; description: string; home: string }>(await this.wp.request({ url: '/?rest_route=/&_fields=name,description,home' }), 'site')
      const postFields = 'id,type,slug,link,title,status,excerpt,date,categories,featured_media'
      const toInfo = (p: Record<string, any>) => ({ id: p.id, type: p.type, slug: p.slug, link: p.link, title: text(p.title?.rendered ?? ''), status: p.status, excerpt: text(p.excerpt?.rendered ?? ''), date: p.date ?? '', categories: p.categories ?? [], featured_media: p.featured_media ?? 0 })
      const posts = (await all<Record<string, any>>('/wp/v2/posts', postFields)).map(toInfo)
      const pages = (await all<Record<string, any>>('/wp/v2/pages', postFields.replace(',categories', ''))).map(toInfo)
      const terms = [
        ...(await all<Record<string, any>>('/wp/v2/categories', 'id,slug,name,link,description')).map((t) => ({ ...t, name: decode(t.name), taxonomy: 'category' })),
        ...(await all<Record<string, any>>('/wp/v2/tags', 'id,slug,name,link,description')).map((t) => ({ ...t, name: decode(t.name), taxonomy: 'post_tag' })),
      ]
      const media = (await all<Record<string, any>>('/wp/v2/media', 'id,source_url,alt_text,caption,mime_type,media_details')).map((m) => ({
        id: m.id,
        source_url: m.source_url,
        alt_text: m.alt_text ?? '',
        caption: text(m.caption?.rendered ?? ''),
        mime_type: m.mime_type ?? '',
        width: m.media_details?.width ?? null,
        height: m.media_details?.height ?? null,
      }))
      const blockTypes = (await json<{ name: string }[]>(await this.wp.request({ url: '/?rest_route=/wp/v2/block-types&_fields=name' }), 'block types')).map((b) => b.name)
      return { site: { name: decode(index.name), url: index.home, description: decode(index.description ?? '') }, posts, pages, terms, media, block_types: blockTypes }
    })
  }
}

/**
 * The knowledge client of a WordPress site: the pack of `live`'s head, rebuilt when the head
 * moved (`not-modified` otherwise, as the server's ETag does). `buildPack` is orchestrator-wasm's
 * `wordpress_pack`.
 */
export function wpKnowledgeClient(engine: WpSiteEngine, wp: WpChannels, buildPack: (registriesJson: string, commit: string) => string) {
  return {
    async knowledge(etag?: string | null): Promise<KnowledgeFetch | 'not-modified'> {
      const branches = await wp.repo<{ name: string; head: string }[]>({ op: 'branches' })
      const head = branches.find((b) => b.name === LIVE)?.head
      if (!head) throw new Error('the site has no live branch yet')
      const tag = `"${head}"`
      if (etag === tag) return 'not-modified'
      const reg = await engine.readRegistries()
      return { pack: buildPack(JSON.stringify(reg), head), etag: tag, commit: head }
    },
  }
}

// ---------------------------------------------------------------- export and deploy (ADR-0083)

/** orchestrator-wasm's `ExportCrawler`. */
export interface ExportCrawlerLike {
  nextPath(): string | undefined
  feed(status: number, contentType: string, location: string | undefined, body: Uint8Array): void
  finish(): { release: Release; report: unknown; blobs: { sha256: string; bytes: Uint8Array }[] }
  free?(): void
}

export interface Release {
  id: string
  files: Record<string, { sha256: string; content_type: string; size: number }>
  redirects: Record<string, string>
}

export interface ExportDeps {
  wp: WpChannels
  engine: WpSiteEngine
  /** `new ExportCrawler(optionsJson, prevRelease?, prevSearch?, touched?)`. */
  crawler(optionsJson: string, prevRelease?: string, prevSearch?: string, touched?: string): ExportCrawlerLike
  /** The origin WordPress believes it has, and the public one. */
  origin: string
  publicOrigin: string
  /** The previous release and its search index (incremental), and where the new one is kept. */
  previous(): Promise<{ release: Release; search: string } | null>
  keep(release: Release, search: string): Promise<void>
  /** Object storage, then the release to the static data plane (lease-checked on the server). */
  putBlob(sha256: string, bytes: Uint8Array, contentType: string): Promise<void>
  deploy(release: Release, merged: Merged): Promise<void>
}

/** Crawls `live` into a release, stores its new blobs and deploys it (the `publish` of a merge). */
export async function exportAndDeploy(d: ExportDeps, merged: Merged): Promise<{ release: Release; report: unknown }> {
  const prev = await d.previous()
  const crawler = d.crawler(
    JSON.stringify({ origin: d.origin, public_origin: d.publicOrigin }),
    prev ? JSON.stringify(prev.release) : undefined,
    prev ? prev.search : undefined,
    prev ? JSON.stringify(merged.touched) : undefined,
  )
  const out = await d.engine.exclusive(async () => {
    await d.wp.repo({ op: 'session.set', branch: LIVE, user_id: 0, author: { kind: 'system', id: 'export' } })
    for (let path = crawler.nextPath(); path !== undefined; path = crawler.nextPath()) {
      const r = await d.wp.request({ url: path })
      crawler.feed(r.status, r.headers['content-type']?.[0] ?? '', r.headers['location']?.[0], r.body)
    }
    return crawler.finish()
  })
  crawler.free?.()
  const types = new Map(Object.values(out.release.files).map((f) => [f.sha256, f.content_type]))
  for (const b of out.blobs) await d.putBlob(b.sha256, b.bytes, types.get(b.sha256) ?? 'application/octet-stream')
  await d.deploy(out.release, merged)
  const searchSha = out.release.files['/search-index.json']?.sha256
  const search = new TextDecoder().decode(out.blobs.find((b) => b.sha256 === searchSha)?.bytes ?? new Uint8Array())
  await d.keep(out.release, search || '[]')
  return { release: out.release, report: out.report }
}
