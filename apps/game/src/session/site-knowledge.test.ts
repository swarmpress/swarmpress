// The site's knowledge in the session (ADR-0061, K2) with fakes for the
// central client, the store and orchestrator-wasm: where the pack is
// refetched (start, before each standup, after each merge and DeployLanded),
// what a failed refetch keeps, and when the orchestrator is rebound.
import { describe, expect, it, vi } from 'vitest'
import type { KnowledgeFetch, OrchestratorGateway } from '../net/central'
import type { SiteBindingJson } from '../orchestrator/bridge'
import type { SiteKnowledgeRow } from '../store/company-store'
import {
  packStyleGuide,
  refetchAfterMerge,
  refetchOnDeploy,
  SiteKnowledgeKeeper,
  SiteOrchestrator,
  type KnowledgeClient,
  type OrchestratorHandleLike,
} from './site-knowledge'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

function packText(commit: string, avoid: string[] = ['hidden gem']) {
  const style = JSON.stringify({ voice: 'warm', vocabulary: { avoid } }, null, 2)
  return JSON.stringify({ commit, files: { 'content/config/style-guide.json': style }, manifest: { name: 'site' }, pages: [] })
}

type Answer = KnowledgeFetch | 'not-modified' | Error | (() => Promise<never>)

/** A central client that answers from a queue and records the ETag of each request. */
function fakeClient(answers: Answer[]) {
  const etags: (string | null)[] = []
  const client: KnowledgeClient = {
    async knowledge(etag) {
      etags.push(etag ?? null)
      const a = answers.shift()
      if (!a) throw new Error('no more answers')
      if (a instanceof Error) throw a
      if (typeof a === 'function') return a()
      return a
    },
  }
  return { client, etags }
}

const fetched = (commit: string, avoid?: string[]): KnowledgeFetch => ({ pack: packText(commit, avoid), etag: `"${commit}"`, commit })

function fakeStore(initial: SiteKnowledgeRow | null = null) {
  const rows: SiteKnowledgeRow[] = initial ? [initial] : []
  return {
    rows,
    async putKnowledge(row: { commit: string; etag: string; pack: string }) {
      rows.push({ ...row, fetchedAt: rows.length + 1 })
    },
    async latestKnowledge() {
      return rows[rows.length - 1] ?? null
    },
  }
}

const SITE: SiteBindingJson = { site_id: 'cinqueterre.travel', brand_name: 'Dispatch' }

/** orchestrator-wasm's handle: records the bindings it was made with and the jobs run. */
function fakeHandles() {
  const made: { site: SiteBindingJson; jobs: string[]; freed: boolean }[] = []
  const create = vi.fn(async (site: SiteBindingJson): Promise<OrchestratorHandleLike> => {
    const h = { site, jobs: [] as string[], freed: false }
    made.push(h)
    return {
      run: async (job: string) => {
        h.jobs.push(JSON.parse(job).kind)
        return '[]'
      },
      free: () => {
        h.freed = true
      },
      siteSummary: () => JSON.stringify({ site_id: site.site_id, commit: site.knowledge_pack ? JSON.parse(site.knowledge_pack).commit : null }),
    }
  })
  return { made, create }
}

const job = (kind: string) => JSON.stringify({ company_id: 'c1', job_id: 1, kind, project: 'p', work_item: null, brief_ref: '18446744073709551615', revision: 0, staff: [] })

describe('SiteKnowledgeKeeper', () => {
  it('starts from the stored pack, revalidates it with its ETag, and takes a new one', async () => {
    const store = fakeStore({ commit: A, etag: `"${A}"`, pack: packText(A), fetchedAt: 1 })
    const { client, etags } = fakeClient(['not-modified', fetched(B, ['stunning'])])
    const changes: string[] = []
    const k = new SiteKnowledgeKeeper(client, store)
    k.onChange((p) => changes.push(p.commit))
    await k.load()
    expect(k.status()).toMatchObject({ commit: A, source: 'store', error: null })
    expect(k.current?.styleGuide).toEqual({ voice: 'warm', vocabulary: { avoid: ['hidden gem'] } })

    expect(await k.refresh('start')).toBe('not-modified')
    expect(etags).toEqual([`"${A}"`])
    expect(k.status()).toMatchObject({ commit: A, source: 'network' })

    expect(await k.refresh('standup')).toBe('fetched')
    expect(etags[1]).toBe(`"${A}"`)
    expect(k.current).toMatchObject({ commit: B, etag: `"${B}"`, text: packText(B, ['stunning']), styleGuide: { vocabulary: { avoid: ['stunning'] } } })
    expect(store.rows.map((r) => r.commit)).toEqual([A, B])
    expect(changes).toEqual([A, B])
    expect(k.status().refreshes).toEqual([
      { reason: 'start', result: 'not-modified' },
      { reason: 'standup', result: 'fetched' },
    ])
  })

  it('keeps the last good pack when the network fails, and says so once per failure streak', async () => {
    const onError = vi.fn()
    const { client } = fakeClient([fetched(A), new TypeError('Failed to fetch'), new TypeError('Failed to fetch'), 'not-modified'])
    const k = new SiteKnowledgeKeeper(client, fakeStore(), { onError })
    expect(await k.refresh('start')).toBe('fetched')
    expect(await k.refresh('standup')).toBe('failed')
    expect(k.current?.commit).toBe(A)
    expect(k.status()).toMatchObject({ commit: A, source: 'network', error: 'Failed to fetch' })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBe(
      `Site knowledge was not refreshed (standup): Failed to fetch; working from the pack of commit ${A.slice(0, 7)}.`,
    )
    expect(await k.refresh('merge')).toBe('failed')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(await k.refresh('deploy')).toBe('not-modified')
    expect(k.status().error).toBeNull()
  })

  it('without any pack every failure is reported, and the store is the only source of a read-only session', async () => {
    const onError = vi.fn()
    const { client } = fakeClient([new Error('413 too large'), new Error('413 too large')])
    const k = new SiteKnowledgeKeeper(client, fakeStore(), { onError })
    await k.refresh('start')
    await k.refresh('standup')
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError.mock.calls[1][0]).toContain('there is no site knowledge yet')
    expect(k.current).toBeNull()

    const ro = new SiteKnowledgeKeeper(null, fakeStore({ commit: A, etag: `"${A}"`, pack: packText(A), fetchedAt: 1 }))
    await ro.load()
    expect(await ro.refresh('start')).toBe('failed')
    expect(ro.status()).toMatchObject({ commit: A, source: 'store' })
    expect(ro.status().error).toContain('read-only')
  })

  it('shares one request between concurrent refreshes, and gives up on one that hangs', async () => {
    let release!: (v: KnowledgeFetch) => void
    const slow = () => new Promise<never>((resolve) => (release = resolve as never))
    const { client, etags } = fakeClient([slow as Answer])
    const k = new SiteKnowledgeKeeper(client, fakeStore())
    const [a, b] = [k.refresh('merge'), k.refresh('deploy')]
    release(fetched(A))
    expect(await Promise.all([a, b])).toEqual(['fetched', 'fetched'])
    expect(etags).toHaveLength(1)

    vi.useFakeTimers()
    try {
      const hang = fakeClient([() => new Promise<never>(() => undefined)])
      const t = new SiteKnowledgeKeeper(hang.client, fakeStore(), { timeoutMs: 1000 })
      const r = t.refresh('standup')
      await vi.advanceTimersByTimeAsync(1001)
      expect(await r).toBe('failed')
      expect(t.status().error).toBe('no answer within 1 s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the style guide of a pack', () => {
    expect(packStyleGuide(packText(A))).toEqual({ voice: 'warm', vocabulary: { avoid: ['hidden gem'] } })
    expect(packStyleGuide(JSON.stringify({ commit: A, files: {} }))).toBeNull()
    expect(packStyleGuide('not json')).toBeNull()
  })
})

describe('the session refetch points (SiteOrchestrator, refetchAfterMerge, refetchOnDeploy)', () => {
  it('refetches before every standup and rebinds the orchestrator at the next job after the pack changed', async () => {
    const { client, etags } = fakeClient([fetched(A), 'not-modified', fetched(B), 'not-modified'])
    const k = new SiteKnowledgeKeeper(client, fakeStore())
    const { made, create } = fakeHandles()
    const orch = new SiteOrchestrator({ keeper: k, site: SITE, create })

    // Session start: fetch, then bind.
    await k.refresh('start')
    await orch.bind()
    expect(made).toHaveLength(1)
    expect(JSON.parse(made[0].site.knowledge_pack!).commit).toBe(A)
    expect(made[0].site).toMatchObject(SITE)
    expect(orch.commit).toBe(A)
    expect(orch.summary()).toEqual({ site_id: 'cinqueterre.travel', commit: A })

    // A standup refetches first (304: same handle).
    await orch.run(job('standup'))
    expect(etags).toEqual([null, `"${A}"`])
    expect(made).toHaveLength(1)
    // Draft and review jobs do not refetch.
    await orch.run(job('draft'))
    await orch.run(job('review'))
    expect(etags).toHaveLength(2)

    // The publish job merges: the gateway refetches after the merge...
    const inner: OrchestratorGateway = {
      openDraft: vi.fn(async () => ({ number: 1, branch: 'drafts/content-c1', head_sha: 'h' })),
      merge: vi.fn(async () => 'merged'),
    }
    const gw = refetchAfterMerge(inner, k)
    expect(await gw.openDraft('c1', 'p', '{}', 'm', null)).toMatchObject({ number: 1 })
    expect(etags).toHaveLength(2)
    expect(await gw.merge(1, 'h', '{"staff_id":"s","name":"n"}')).toBe('merged')
    expect(inner.merge).toHaveBeenCalledWith(1, 'h', '{"staff_id":"s","name":"n"}')
    await k.refresh('merge') // joins the request the merge started
    expect(etags).toEqual([null, `"${A}"`, `"${A}"`])
    expect(k.current?.commit).toBe(B)
    // ...and the next job runs on a handle bound to the new commit; the old one is freed.
    await orch.run(job('publish'))
    expect(made).toHaveLength(2)
    expect(JSON.parse(made[1].site.knowledge_pack!).commit).toBe(B)
    expect(made[0].freed).toBe(true)
    expect(made[0].jobs).toEqual(['standup', 'draft', 'review'])
    expect(made[1].jobs).toEqual(['publish'])

    // A DeployLanded refetches (304); other events and a read-only session do not.
    let readOnly = false
    const onEvent = refetchOnDeploy(k, () => !readOnly)
    onEvent({ kind: 'DeployFailed' })
    onEvent({ kind: 'DeployLanded' })
    await k.refresh('deploy')
    expect(etags).toEqual([null, `"${A}"`, `"${A}"`, `"${B}"`])
    readOnly = true
    onEvent({ kind: 'DeployLanded' })
    expect(etags).toHaveLength(4)
    expect(k.status().refreshes.map((r) => r.reason)).toEqual(['start', 'standup', 'merge', 'deploy'])
  })

  it('runs on the last good pack when a standup refetch fails', async () => {
    const { client } = fakeClient([fetched(A), new TypeError('Failed to fetch')])
    const onError = vi.fn()
    const k = new SiteKnowledgeKeeper(client, fakeStore(), { onError })
    const { made, create } = fakeHandles()
    const orch = new SiteOrchestrator({ keeper: k, site: SITE, create })
    await k.refresh('start')
    expect(await orch.run(job('standup'))).toBe('[]')
    expect(made).toHaveLength(1)
    expect(made[0].jobs).toEqual(['standup'])
    expect(orch.commit).toBe(A)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('without any pack a standup, draft or review fails loudly; a publish runs without one', async () => {
    const { client, etags } = fakeClient([new Error('502 broken index'), new Error('502 broken index'), new Error('502 broken index')])
    const k = new SiteKnowledgeKeeper(client, fakeStore())
    const { made, create } = fakeHandles()
    const orch = new SiteOrchestrator({ keeper: k, site: SITE, create })
    await expect(orch.run(job('draft'))).rejects.toThrow('no site knowledge for the draft job: 502 broken index')
    // A standup refetches before it, then once more because there is still no pack.
    await expect(orch.run(job('standup'))).rejects.toThrow(/no site knowledge for the standup job/)
    expect(etags).toHaveLength(3)
    expect(made).toHaveLength(0)
    // Merging needs no knowledge: the handle is bound without a pack.
    const { client: none } = fakeClient([])
    const k2 = new SiteKnowledgeKeeper(none, fakeStore())
    const orch2 = new SiteOrchestrator({ keeper: k2, site: SITE, create })
    expect(await orch2.run(job('publish'))).toBe('[]')
    expect(made[0].site.knowledge_pack).toBeNull()
    expect(orch2.commit).toBeNull()
  })
})
