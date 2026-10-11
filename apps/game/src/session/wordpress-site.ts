/**
 * A company on WordPress in the session (ADR-0082, ADR-0083; plan M4, M5): the site engine the
 * orchestrator works through, the knowledge client that reads `live`'s registries, and the export
 * and deploy that follow every merge.
 *
 * - **Capabilities:** `WpSiteEngine` over the session's WordPress (both channels).
 * - **Knowledge:** the pack of `live`'s head, built by orchestrator-wasm's `wordpress_pack`; a
 *   merge refreshes it (the head moved).
 * - **Publishing:** after a merge, `live` is crawled through the sandbox (`ExportCrawler`),
 *   incrementally from the release this device last deployed; the new files' bytes go to object
 *   storage and the release to the server, which serves it as the company's site and reports
 *   `DeployLanded` for the work item.
 */
import type { CentralClient } from '../net/central'
import { loadOrchestratorWasm } from '../orchestrator'
import type { WordPressRuntime } from './wordpress-runtime'
import { exportAndDeploy, wpKnowledgeClient, WpSiteEngine, type Merged, type OrchestratorSiteEngine, type Release, type WpChannels } from '../php/wp-site-engine'

/** kv keys of the release this device last deployed (incremental exports). */
export const RELEASE_KEY = 'site.release'
export const RELEASE_SEARCH_KEY = 'site.release.search'

/** The origin WordPress believes it has in the sandbox (its `siteurl`). */
export const SANDBOX_ORIGIN = 'http://sandbox.invalid'

export interface WordPressSiteOptions {
  wordpress: WordPressRuntime
  client: Pick<CentralClient, 'putAsset' | 'putRelease'>
  token: () => string
  store: { getKv(key: string): Promise<string | null>; setKv(key: string, value: string): Promise<void> }
  companyId: string
  /** The public site's origin (the server's `/sites/{company}` until the company has a domain). */
  publicOrigin: string
  /** Where its forms and comments post (the server's `/f/{company}`). */
  formsEndpoint?: string
  log?: (line: string) => void
}

export interface WordPressSite {
  engine: WpSiteEngine
  channels: WpChannels
  knowledgeClient: ReturnType<typeof wpKnowledgeClient>
  /** The engine with a knowledge refresh after every merge, as the orchestrator gets it. */
  orchestratorEngine(onMerged: () => void): OrchestratorSiteEngine
  /** The last export and deploy (for the HUD and tests). */
  lastExport(): { release: Release; report: unknown } | null
}

export async function wordpressSite(o: WordPressSiteOptions): Promise<WordPressSite> {
  const m = await loadOrchestratorWasm()
  const channels: WpChannels = { request: (r) => o.wordpress.request(r), repo: (msg) => o.wordpress.repo(msg) }
  let last: { release: Release; report: unknown } | null = null
  const engine: WpSiteEngine = new WpSiteEngine(channels, {
    log: o.log,
    publish: async (merged: Merged) => {
      last = await exportAndDeploy(
        {
          wp: channels,
          engine,
          crawler: (opts, prev, search, touched) => new m.ExportCrawler(opts, prev, search, touched),
          origin: SANDBOX_ORIGIN,
          publicOrigin: o.publicOrigin,
          formsEndpoint: o.formsEndpoint,
          async previous() {
            const r = await o.store.getKv(RELEASE_KEY)
            return r ? { release: JSON.parse(r) as Release, search: (await o.store.getKv(RELEASE_SEARCH_KEY)) ?? '[]' } : null
          },
          async keep(release, search) {
            await o.store.setKv(RELEASE_KEY, JSON.stringify(release))
            await o.store.setKv(RELEASE_SEARCH_KEY, search)
          },
          putBlob: async (sha, bytes, type) => void (await o.client.putAsset(o.token(), sha, bytes, type)),
          deploy: async (release, mg) => void (await o.client.putRelease(o.token(), release, mg.workItem, mg.id)),
        },
        merged,
      )
      o.log?.(`release ${last.release.id.slice(0, 12)} deployed: ${Object.keys(last.release.files).length} files`)
    },
  })
  const knowledgeClient = wpKnowledgeClient(engine, channels, (reg, commit) => m.wordpress_pack(reg, commit))
  return {
    engine,
    channels,
    knowledgeClient,
    orchestratorEngine(onMerged) {
      return {
        branchFor: (n: string) => engine.branchFor(n),
        findPost: (b: string, t: string, s: string) => engine.findPost(b, t, s),
        savePost: (b: string, id: number | null, p: string, a: string) => engine.savePost(b, id, p, a),
        openChangeRequest: (b: string, t: string, a: string) => engine.openChangeRequest(b, t, a),
        merge: async (id: number, head: string, a: string) => {
          const h = await engine.merge(id, head, a)
          onMerged()
          return h
        },
        releaseStatus: (id: number) => engine.releaseStatus(id),
        redeploy: (id: number) => engine.redeploy(id),
      }
    },
    lastExport: () => last,
  }
}
