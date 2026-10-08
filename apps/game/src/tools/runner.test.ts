// The site's tools in the browser (FEAT-091, T-1): the one interpreter bundle
// in the real QuickJS sandbox, under the tool's derived manifest; its web goes
// through the host's proxy, which may only reach the manifest's origins.
import { describe, expect, it } from 'vitest'
import ferryJson from '../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/ferry-times.tool.json'
import teaserJson from '../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/story-teaser.tool.json'
import manifests from '../../../../crates/blueprint/tests/fixtures/site/manifests.golden.json'
import FerryDeparture from '../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryDeparture.json'
import FerryRow from '../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryRow.json'
import FerryTimetable from '../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryTimetable.json'
import Teaser from '../../../../crates/blueprint/tests/fixtures/site/blueprint/types/Teaser.json'
import timetable from '../../../../packages/toolgraph/test/fixtures/ferry-timetable.json'
import leadJson from '../../../../crates/blueprint/tests/fixtures/n8n/lead-intake.json'
import type { SiteTool, ToolGraph } from '../blueprint/types'
import { browserCredentials } from './credentials'
import { artifactSha, runTool, toolOfRef, toolRef, toolStub } from './runner'

const types = { FerryDeparture, FerryRow, FerryTimetable, Teaser }
const site = (graph: unknown, id: string, hash: string): SiteTool => ({
  id,
  hash,
  graph: graph as ToolGraph,
  issues: [],
  manifest: (manifests as Record<string, Record<string, unknown>>)[id],
})
const ferry = site(ferryJson, 'ferry-times', 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90')

describe('tools in the browser', () => {
  it('names tools by 6 bytes of their hash and reports their schedule and role', () => {
    expect(toolRef(ferry.hash)).toBe(0xa1b2c3d4e5f6)
    expect(toolRef(ferry.hash)).toBeLessThan(2 ** 48)
    expect(toolOfRef([ferry], 0xa1b2c3d4e5f6)).toBe(ferry)
    expect(toolStub(ferry)).toEqual({ tool_ref: 0xa1b2c3d4e5f6, schedule_days: 1, role: null })
    const teaser = site(teaserJson, 'story-teaser', 'ff'.repeat(32))
    expect(toolStub(teaser).role).toBe('writer')
  })

  it('runs a tool in the sandbox through the host proxy', async () => {
    const asked: string[] = []
    const r = await runTool(ferry, types, { village: { slug: 'vernazza', name: 'Vernazza' } }, {
      async webFetch(url) {
        asked.push(url)
        return { status: 200, contentType: 'application/json', text: JSON.stringify(timetable) }
      },
    })
    expect(r.ok).toBe(true)
    expect(asked).toEqual(['https://www.navigazionegolfodeipoeti.it/orari.json'])
    const out = r.outputs.departures as { time: string; to: string }[]
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThanOrEqual(6)
    expect(await artifactSha(r.outputs)).toHaveLength(16)
  }, 20_000)

  it('refuses an origin the manifest does not grant', async () => {
    const wider = { ...ferry, manifest: { ...ferry.manifest, origins: ['https://elsewhere.example.com'] } }
    await expect(
      runTool(wider, types, { village: { slug: 'vernazza', name: 'Vernazza' } }, {
        async webFetch() {
          return { status: 200, contentType: 'application/json', text: '{}' }
        },
      }),
    ).rejects.toThrow(/origin|capability|allow/i)
  }, 20_000)

  // ADR-0076: an imported n8n workflow runs in the same sandbox; its Code and
  // expressions in a nested sandbox without capabilities, its POST through
  // `/web/request`, signed with this browser's credential outside the sandbox.
  it('runs an imported n8n workflow, signing its request with a local credential', async () => {
    const graph = JSON.parse(JSON.stringify((leadJson as { graph: unknown }).graph)) as ToolGraph
    const lookup = graph.nodes.find((n) => n.id === 'lookup-company') as unknown as Record<string, unknown> & { parameters: Record<string, unknown> }
    lookup.parameters.authentication = 'genericCredentialType'
    lookup.credential = 'crm'
    const lead = site(graph, 'lead-intake', 'b'.repeat(64))
    lead.manifest = { capabilities: ['code', 'web'], origins: ['https://api.example-crm.com'] }
    const credentials = browserCredentials(null)
    const sent: { url: string; method: string; headers: Record<string, string>; body: string | null }[] = []
    const facilities = {
      async webFetch(): Promise<never> {
        throw new Error('n8n requests go through webRequest')
      },
      async webRequest(req: { url: string; method: string; headers: Record<string, string>; body: string | null }) {
        sent.push(req)
        return { status: 200, contentType: 'application/json', headers: {}, body: JSON.stringify({ company: { name: 'BigCo', size: 'enterprise' } }) }
      },
      credentials,
    }
    const input = { request: { body: { email: 'Ada@BigCo.com', seats: 12 } } }
    await expect(runTool(lead, {}, input, facilities)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('the credential "crm" is not set up') })
    credentials.set('crm', { kind: 'header', name: 'X-Crm-Key', value: 'k-123' })
    const r = await runTool(lead, {}, input, facilities)
    expect(r.error).toBeUndefined()
    expect(r.outputs.response).toEqual([{ email: 'ada@bigco.com', company: 'BigCo', tier: 'priority', score: 24 }])
    expect(sent.at(-1)).toMatchObject({ method: 'POST', url: 'https://api.example-crm.com/v1/companies/lookup', body: '{"domain":"bigco.com"}' })
    expect(sent.at(-1)!.headers['X-Crm-Key']).toBe('k-123')
    expect(Object.keys(sent.at(-1)!.headers).map((k) => k.toLowerCase())).not.toContain('x-swarmpress-credential')
  }, 30_000)
})
