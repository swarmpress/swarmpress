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
import type { SiteTool, ToolGraph } from '../blueprint/types'
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
})
