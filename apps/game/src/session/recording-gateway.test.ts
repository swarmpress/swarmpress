import { describe, expect, it } from 'vitest'
import type { Attribution, OrchestratorGateway } from '../net/central'
import { KEEP_GATEWAY_CALLS, recordingGateway, type GatewayCall } from './recording-gateway'

const writer: Attribution = { staff_id: 'staff-1', name: 'Giulia Rossi', persona: 'giulia', role: 'writer', job_id: 2, job_kind: 'draft', model: 'fake-mvp' }

function inner() {
  const seen: unknown[][] = []
  const gw: OrchestratorGateway = {
    async openDraft(...args) {
      seen.push(['draft', ...args])
      return { number: 4, branch: 'drafts/content-c1', head_sha: 'abc' }
    },
    async merge(...args) {
      seen.push(['merge', ...args])
      return 'def'
    },
  }
  return { gw, seen }
}

describe('recordingGateway', () => {
  it('forwards the attribution (G6) and records it with each call', async () => {
    const { gw, seen } = inner()
    const calls: GatewayCall[] = []
    const rec = recordingGateway(gw, calls)
    // orchestrator-wasm passes the attribution as JSON text.
    await rec.openDraft('c1', 'content/pages/blog/a.json', '{}', 'Draft: A', 'work-item-1', JSON.stringify(writer))
    const merge = { ...writer, job_kind: 'publish', reviewed_by: 'Marco Vitali', approved_by: 'ceo (CEO)' }
    await rec.merge(4, 'abc', JSON.stringify(merge))
    expect(seen).toEqual([
      ['draft', 'c1', 'content/pages/blog/a.json', '{}', 'Draft: A', 'work-item-1', JSON.stringify(writer)],
      ['merge', 4, 'abc', JSON.stringify(merge)],
    ])
    expect(calls).toEqual([
      { op: 'draft', workItem: 'work-item-1', number: 4, branch: 'drafts/content-c1', headSha: 'abc', attribution: writer },
      { op: 'merge', number: 4, headSha: 'abc', mergedSha: 'def', attribution: merge },
    ])
  })

  it('without attribution the calls are what they were before', async () => {
    const { gw, seen } = inner()
    const calls: GatewayCall[] = []
    const rec = recordingGateway(gw, calls)
    await rec.openDraft('c1', 'p', '{}', 'm', null)
    await rec.merge(4, 'abc')
    expect(seen).toEqual([
      ['draft', 'c1', 'p', '{}', 'm', null, undefined],
      ['merge', 4, 'abc', undefined],
    ])
    expect(calls.map((c) => c.attribution)).toEqual([null, null])
  })

  it('keeps a bounded log', async () => {
    const calls: GatewayCall[] = []
    const rec = recordingGateway(inner().gw, calls)
    for (let i = 0; i < KEEP_GATEWAY_CALLS + 5; i++) await rec.merge(i, 'abc')
    expect(calls).toHaveLength(KEEP_GATEWAY_CALLS)
    expect(calls[0].number).toBe(5)
  })

  it('forwards the page read and the update of a refresh or fix, recording the update as a draft (ADR-0070)', async () => {
    const seen: unknown[][] = []
    const gw: OrchestratorGateway = {
      openDraft: async () => ({ number: 1, branch: 'b', head_sha: 'h' }),
      merge: async () => 'm',
      async readPage(path) {
        seen.push(['read', path])
        return { page: { id: 'p' }, sha: 'blob1' }
      },
      async openUpdate(...args) {
        seen.push(['update', ...args])
        return { number: 7, branch: 'drafts/content-p', head_sha: 'u1' }
      },
    }
    const calls: GatewayCall[] = []
    const rec = recordingGateway(gw, calls)
    expect(await rec.readPage!('content/pages/blog/a.json')).toEqual({ page: { id: 'p' }, sha: 'blob1' })
    await rec.openUpdate!('p', 'content/pages/blog/a.json', '{}', 'Refresh: A', 'work-item-9', JSON.stringify(writer), 'blob1')
    expect(seen).toEqual([
      ['read', 'content/pages/blog/a.json'],
      ['update', 'p', 'content/pages/blog/a.json', '{}', 'Refresh: A', 'work-item-9', JSON.stringify(writer), 'blob1'],
    ])
    expect(calls).toEqual([{ op: 'draft', workItem: 'work-item-9', number: 7, branch: 'drafts/content-p', headSha: 'u1', attribution: writer }])
    // a gateway without them stays without them: the job fails loudly in the wasm
    expect(recordingGateway(inner().gw, []).readPage).toBeUndefined()
  })
})
