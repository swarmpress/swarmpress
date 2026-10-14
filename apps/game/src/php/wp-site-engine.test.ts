/**
 * The site capabilities over WordPress's two channels (FEAT-108, FEAT-109): authors from
 * attributions, a change request reused per branch, merges refused when the branch moved, the
 * export after a merge, and the release kept for the next incremental export.
 */
import { describe, expect, it } from 'vitest'
import { toResponse, type PhpRequest } from './types'
import { authorOf, exportAndDeploy, pathOf, WpSiteEngine, type ExportCrawlerLike, type Release, type WpChannels } from './wp-site-engine'

const enc = (s: string) => new TextEncoder().encode(s)

/** A governed API with branches, logs and change requests in memory; REST answers from a script. */
function channels(rest: (r: PhpRequest) => { status: number; body: unknown; headers?: Record<string, string[]> } = () => ({ status: 404, body: {} })) {
  const heads: Record<string, string> = { live: 'l1' }
  const crs: { id: number; source: string; status: string; merged?: string; work_item?: number }[] = []
  const sessions: unknown[] = []
  const wp: WpChannels = {
    async request(r) {
      const a = rest(r)
      return toResponse(a.status, a.headers ?? {}, enc(JSON.stringify(a.body)))
    },
    async repo<T>(m: Record<string, unknown>): Promise<T> {
      const op = m.op as string
      if (op === 'branches') return Object.entries(heads).map(([name, head]) => ({ name, head })) as T
      if (op === 'branch.create') return void (heads[m.name as string] = heads.live) as T
      if (op === 'session.set') return void sessions.push(m) as T
      if (op === 'log') return [{ id: heads[m.branch as string] }] as T
      if (op === 'cr.list') return crs.filter((c) => c.status === 'open') as T
      if (op === 'cr.open') {
        crs.push({ id: crs.length + 1, source: m.source as string, status: 'open', work_item: m.work_item as number })
        return { id: crs.length } as T
      }
      if (op === 'cr.get') return { change_request: crs.find((c) => c.id === m.id) } as T
      if (op === 'cr.merge') {
        const cr = crs.find((c) => c.id === m.id)!
        cr.status = 'merged'
        heads.live = `merged-${cr.id}`
        cr.merged = heads.live
        return { id: cr.id, head: heads.live } as T
      }
      throw new Error(`unexpected ${op}`)
    },
  }
  return { wp, heads, crs, sessions }
}

const attribution = (extra: object = {}) => JSON.stringify({ staff_id: 'staff-1', name: 'Giulia', job_id: 4, job_kind: 'draft', work_item: 'work-item-12', model: 'fake', ...extra })

describe('WpSiteEngine', () => {
  it('names the staff member as author, and the approver of a merge', () => {
    expect(authorOf(attribution())).toEqual({ kind: 'agent', id: 'staff-1', job: 'draft-4', model: 'fake' })
    expect(authorOf(attribution({ job_kind: 'publish', job_id: 6, approved_by: 'Ada (CEO)' }), true)).toEqual({ kind: 'human', id: 'Ada (CEO)', job: 'publish-6' })
    expect(pathOf('http://sandbox.invalid/harvest-week/')).toBe('/harvest-week/')
  })

  it('saves on a branch as its author, reuses the open change request, and merges only an unmoved branch', async () => {
    const c = channels((r) => (r.method === 'POST' && r.url.startsWith('/?rest_route=/wp/v2/posts') ? { status: 201, body: { id: 9, link: 'http://sandbox.invalid/harvest-week/' } } : { status: 200, body: [] }))
    const published: unknown[] = []
    const e = new WpSiteEngine(c.wp, { publish: async (m) => void published.push(m) })
    const branch = await e.branchFor('draft-content-1')
    const post = JSON.stringify({ post_type: 'post', slug: 'harvest-week', title: 'Harvest week', excerpt: '', content: '', status: 'publish', categories: [] })
    expect(await e.savePost(branch, null, post, attribution())).toEqual({ id: 9, link: 'http://sandbox.invalid/harvest-week/' })
    expect(c.sessions.at(-1)).toMatchObject({ branch, user_id: 1, author: { kind: 'agent', id: 'staff-1' } })
    await expect(e.savePost('live', null, post, attribution())).rejects.toThrow(/live refuses/)

    const first = await e.openChangeRequest(branch, 'Harvest week', attribution())
    const again = await e.openChangeRequest(branch, 'Harvest week', attribution())
    expect(again.id).toBe(first.id)
    expect(c.crs[0].work_item).toBe(12)

    c.heads[branch] = 'moved'
    await expect(e.merge(first.id, first.head, attribution())).rejects.toThrow(/moved since it was approved/)
    c.heads[branch] = first.head
    const head = await e.merge(first.id, first.head, attribution({ job_kind: 'publish', approved_by: 'Ada' }))
    expect(head).toBe('merged-1')
    expect(await e.merge(first.id, first.head, attribution())).toBe('merged-1')
    await new Promise((r) => setTimeout(r, 0))
    expect(published).toEqual([{ id: 1, head: 'merged-1', workItem: 'work-item-12', touched: ['/harvest-week/'] }])
    expect(await e.releaseStatus(1)).toBe('landed')
  })
})

describe('WpSiteEngine.putThemeData (FEAT-115)', () => {
  it('runs the theme calls in order on its branch as the web designer: fonts with their files, styles with the stored paths, parts by slug', async () => {
    const seen: string[] = []
    const c = channels((r) => {
      const route = decodeURIComponent(r.url)
      seen.push(`${r.method ?? 'GET'} ${route}`)
      if (route.includes('/wp/v2/font-families&slug=')) return { status: 200, body: [{ id: 3, font_family_settings: { slug: 'other' } }] }
      if (r.method === 'POST' && route.endsWith('/wp/v2/font-families')) return { status: 201, body: { id: 7 } }
      if (route.includes('/font-faces&')) return { status: 200, body: [{ parent: 3, font_face_settings: { fontWeight: '400', fontStyle: 'normal', src: 'x' } }] }
      if (r.method === 'POST' && route.includes('/font-faces')) return { status: 201, body: { font_face_settings: { src: 'http://sandbox.invalid/wp-content/uploads/fonts/serif-400-normal-1.woff2' } } }
      if (route.includes('/wp/v2/themes')) return { status: 200, body: [{ _links: { 'wp:user-global-styles': [{ href: 'http://sandbox.invalid/?rest_route=/wp/v2/global-styles/12' }] } }] }
      if ((r.method ?? 'GET') === 'GET' && route.includes('/wp/v2/template-parts/canvas//header')) return { status: 404, body: {} }
      return { status: 200, body: {} }
    })
    const e = new WpSiteEngine(c.wp)
    const calls = [
      { call: 'switch-theme', body: { stylesheet: 'canvas' } },
      { call: 'font-family', slug: 'serif', settings: { name: 'Serif', slug: 'serif', fontFamily: 'Serif' } },
      { call: 'font-face', family: 'serif', settings: { fontFamily: 'Serif', fontWeight: '400', fontStyle: 'normal', src: 'file-0' }, file: 'assets/a.woff2', file_name: 'serif-400-normal.woff2', mime: 'font/woff2', src: '/wp-content/uploads/fonts/serif-400-normal.woff2' },
      { call: 'global-styles', body: { settings: { typography: { fontFamilies: [{ fontFace: [{ src: ['/wp-content/uploads/fonts/serif-400-normal.woff2'] }] }] } }, styles: {} } },
      { call: 'upsert', kind: 'template-part', slug: 'header', body: { slug: 'header', content: '<!-- wp:group /-->' }, categories: [], lookup: '/wp/v2/template-parts/canvas//header', collection: '/wp/v2/template-parts', item: '/wp/v2/template-parts/canvas//header' },
    ]
    const data = JSON.stringify({ fonts: [{ slug: 'serif', faces: [{ file: { path: 'assets/a.woff2', sha256: 'abc' } }] }] })
    const files: string[] = []
    await e.branchFor('design-v1')
    const head = await e.putThemeData('design-v1', data, attribution({ job_kind: 'site-theme' }), {
      calls: () => JSON.stringify(calls),
      file: async (sha) => (files.push(sha), new Uint8Array([119, 79, 70, 50])),
    })
    expect(head).toBe('l1')
    expect(c.sessions.at(-1)).toMatchObject({ branch: 'design-v1', user_id: 1, author: { kind: 'agent', id: 'staff-1', job: 'site-theme-4' } })
    expect(files).toEqual(['abc'])
    const writes = seen.filter((x) => x.startsWith('POST'))
    expect(writes).toEqual([
      'POST /?rest_route=/swarmpress/v1/theme',
      // Another family answered the slug query: this one is created.
      'POST /?rest_route=/wp/v2/font-families',
      // Another family's face of the same weight does not count: the file is uploaded.
      'POST /?rest_route=/wp/v2/font-families/7/font-faces',
      'POST /?rest_route=/wp/v2/global-styles/12',
      // A part the site lacks is created in the collection.
      'POST /?rest_route=/wp/v2/template-parts',
    ])
    await expect(e.putThemeData('live', data, attribution(), { calls: () => '[]', file: async () => null })).rejects.toThrow(/live refuses/)
  })
})

describe('exportAndDeploy', () => {
  it('crawls live through the sandbox, uploads the blobs, deploys, and keeps the release for the next export', async () => {
    const c = channels((r) => ({ status: 200, body: { path: r.url } }))
    const engine = new WpSiteEngine(c.wp)
    const fed: string[] = []
    const release: Release = { id: 'r1', files: { '/': { sha256: 'aa', content_type: 'text/html', size: 3 } }, redirects: {} }
    let made: unknown[] = []
    const crawler = (...args: unknown[]): ExportCrawlerLike => {
      made = args
      const queue = ['/', '/feed/']
      return {
        nextPath: () => queue.shift(),
        feed: (status, _ct, _loc, body) => void fed.push(`${status} ${new TextDecoder().decode(body)}`),
        finish: () => ({ release, report: {}, blobs: [{ sha256: 'aa', bytes: enc('<p>') }] }),
      }
    }
    const kept: string[] = []
    const blobs: string[] = []
    const deployed: unknown[] = []
    const out = await exportAndDeploy(
      {
        wp: c.wp,
        engine,
        crawler,
        origin: 'http://sandbox.invalid',
        publicOrigin: 'https://cinqueterre.travel',
        previous: async () => ({ release: { id: 'r0', files: {}, redirects: {} }, search: '[]' }),
        keep: async (r) => void kept.push(r.id),
        putBlob: async (sha, _b, type) => void blobs.push(`${sha} ${type}`),
        deploy: async (r, m) => void deployed.push([r.id, m.workItem]),
      },
      { id: 3, head: 'h', workItem: 'work-item-1', touched: ['/harvest-week/'] },
    )
    expect(out.release.id).toBe('r1')
    expect(fed).toEqual(['200 {"path":"/"}', '200 {"path":"/feed/"}'])
    expect(made.slice(1)).toEqual([JSON.stringify({ id: 'r0', files: {}, redirects: {} }), '[]', '["/harvest-week/"]'])
    expect(c.sessions.at(-1)).toMatchObject({ branch: 'live', user_id: 0 })
    expect(blobs).toEqual(['aa text/html'])
    expect(deployed).toEqual([['r1', 'work-item-1']])
    expect(kept).toEqual(['r1'])
  })
})
