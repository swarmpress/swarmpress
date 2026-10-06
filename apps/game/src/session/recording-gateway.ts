/**
 * The session's gateway wrapper (`hook.gateway()`, the e2e suites): records
 * every draft, merge and redeploy and forwards each call unchanged, attribution
 * included (ADR-0056 decision 8, as narrowed by ADR-0058: the persona as the
 * draft's author, the provenance trailers on the squash commit).
 */
import type { Attribution, OrchestratorGateway } from '../net/central'

export interface GatewayCall {
  op: 'draft' | 'merge' | 'redeploy'
  workItem?: string | null
  number: number
  branch?: string
  headSha?: string
  mergedSha?: string
  /** The attribution the call carried (parsed), or null without one. */
  attribution: Attribution | null
}

const parsed = (a: Attribution | string | null | undefined): Attribution | null =>
  a == null || a === '' ? null : typeof a === 'string' ? (JSON.parse(a) as Attribution) : a

/** Calls kept (the oldest are dropped). */
export const KEEP_GATEWAY_CALLS = 200

export function recordingGateway(inner: OrchestratorGateway, calls: GatewayCall[]): OrchestratorGateway {
  const keep = (c: GatewayCall) => {
    calls.push(c)
    if (calls.length > KEEP_GATEWAY_CALLS) calls.splice(0, calls.length - KEEP_GATEWAY_CALLS)
  }
  return {
    async openDraft(contentId, path, pageJson, message, workItem, attribution) {
      const r = await inner.openDraft(contentId, path, pageJson, message, workItem, attribution)
      keep({ op: 'draft', workItem, number: r.number, branch: r.branch, headSha: r.head_sha, attribution: parsed(attribution) })
      return r
    },
    async merge(number, headSha, attribution) {
      const sha = await inner.merge(number, headSha, attribution)
      keep({ op: 'merge', number, headSha, mergedSha: sha, attribution: parsed(attribution) })
      return sha
    },
    ...(inner.deployState ? { deployState: (number: number) => inner.deployState!(number) } : {}),
    ...(inner.redeploy
      ? {
          async redeploy(number: number) {
            const r = await inner.redeploy!(number)
            keep({ op: 'redeploy', workItem: r.work_item, number, attribution: null })
            return r
          },
        }
      : {}),
    // ADR-0070: a refresh or fix reads its page and drafts an update naming its blob.
    ...(inner.readPage ? { readPage: (path: string) => inner.readPage!(path) } : {}),
    // FEAT-095: the site's models and the architects' approved changes, forwarded.
    ...(inner.siteModels ? { siteModels: () => inner.siteModels!() } : {}),
    ...(inner.putBlueprint ? { putBlueprint: (body: string) => inner.putBlueprint!(body) } : {}),
    ...(inner.putTool ? { putTool: (graph: string, message: string) => inner.putTool!(graph, message) } : {}),
    ...(inner.openUpdate
      ? {
          async openUpdate(...args: Parameters<NonNullable<OrchestratorGateway['openUpdate']>>) {
            const r = await inner.openUpdate!(...args)
            keep({ op: 'draft', workItem: args[4], number: r.number, branch: r.branch, headSha: r.head_sha, attribution: parsed(args[5]) })
            return r
          },
        }
      : {}),
  }
}
