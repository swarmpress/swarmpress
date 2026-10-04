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
})
