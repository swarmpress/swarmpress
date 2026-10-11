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
import type { BlueprintChange, PutBlueprintBody, PutBlueprintResult, PutToolsBody } from '../blueprint/types'
import { loadBlueprintWasm } from '../blueprint/wasm'
import { CentralError, type CentralClient } from '../net/central'
import { regionsOf, wordpressModels, type WordPressModels, type WpPaletteColor } from '../php/wp-studio'
import { loadOrchestratorWasm } from '../orchestrator'
import { sandboxUrl } from '../php/wordpress'
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
  /** The Brick Studio's models of `live` (ADR-0082 §4). */
  studioModels(): Promise<WordPressModels>
  /** The CEO's build of a Studio draft: the post types' regions, merged into live (409 when stale, 422 when refused). */
  saveBlueprint(body: PutBlueprintBody | PutToolsBody): Promise<PutBlueprintResult>
  /** The Paint shop's palette, merged into live. */
  savePalette(palette: WpPaletteColor[]): Promise<string>
  /** Opens the wp-admin door on a new branch (ADR-0082 §5). */
  openDoor(): Promise<WpDoor>
}

/**
 * The wp-admin door (ADR-0082 §5): WordPress's admin on its own branch, as the CEO. The door's
 * sandbox speaks on the `door` channel; what it changes is commits on that branch, built into live
 * or discarded like any other change.
 */
export interface WpDoor {
  branch: string
  /** The door page on the sandbox's origin. */
  url: string
  storage(payload: string): Promise<string>
  /** Merges the branch into live (nothing changed: nothing to merge). */
  build(): Promise<string | null>
  discard(): Promise<void>
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
  const site: WordPressSite = {
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
        siteModels: () => site.studioModels(),
        putBlueprint: async (bodyJson: string) => {
          try {
            const r = await site.saveBlueprint(JSON.parse(bodyJson) as PutBlueprintBody)
            onMerged()
            return { status: 'landed', ...r }
          } catch (e) {
            if (e instanceof CentralError && e.status === 409) return { status: 'stale', error: e.message }
            if (e instanceof CentralError && e.status === 422) {
              const issues = ((e.body as { issues?: string[] } | null)?.issues ?? []).map(String)
              return { status: 'refused', error: e.message, issues }
            }
            throw e
          }
        },
      }
    },
    lastExport: () => last,
    async studioModels() {
      const api = await loadBlueprintWasm()
      return wordpressModels(await engine.readStudio(), api as Parameters<typeof wordpressModels>[1])
    },
    async saveBlueprint(body) {
      if (!('blueprint' in body)) throw new CentralError(422, 'tools on a WordPress site are not built yet', { issues: ['A WordPress site has no tools yet.'] })
      const api = await loadBlueprintWasm()
      const studio = await engine.readStudio()
      const current = wordpressModels(studio, api as Parameters<typeof wordpressModels>[1])
      if (body.base_hash !== current.hash) throw new CentralError(409, 'the site changed since the draft began', null)
      const { templates, refused } = regionsOf(body.blueprint, studio)
      if (refused.length) throw new CentralError(422, 'refused', { issues: refused })
      const changes = JSON.parse(api.diffBlueprints(JSON.stringify(current.blueprint), JSON.stringify(body.blueprint))) as BlueprintChange[]
      const commit = await engine.saveTemplates(templates)
      const next = wordpressModels({ ...studio, templates, head: commit }, api as Parameters<typeof wordpressModels>[1])
      return { commit, hash: next.hash, changes, tools: [] }
    },
    savePalette: (palette) => engine.savePalette(palette),
    async openDoor() {
      const branch = await engine.branchFor(`admin-${Date.now().toString(36)}`)
      const ceo = { kind: 'human', id: 'ceo' }
      await o.wordpress.repo({ op: 'session.set', channel: 'door', branch, user_id: 1, author: ceo })
      const base = await o.wordpress.repo<{ id: string }[]>({ op: 'log', branch, limit: 1 })
      return {
        branch,
        url: new URL('door.html', sandboxUrl()).href,
        storage: (payload) => {
          const msg = JSON.parse(payload) as Record<string, unknown>
          return o.wordpress.storage(JSON.stringify({ ...msg, channel: 'door' }))
        },
        async build() {
          const now = await o.wordpress.repo<{ id: string }[]>({ op: 'log', branch, limit: 1 })
          if (now[0]?.id === base[0]?.id) return null
          const { id } = await o.wordpress.repo<{ id: number }>({ op: 'cr.open', source: branch, title: 'wp-admin', author: ceo })
          const merged = await o.wordpress.repo<{ head?: string; error?: string }>({ op: 'cr.merge', id, author: ceo })
          if (!merged.head) throw new Error(merged.error ?? 'the merge was refused')
          return merged.head
        },
        async discard() {
          await o.wordpress.repo({ op: 'branch.delete', name: branch })
        },
      }
    },
  }
  return site
}
