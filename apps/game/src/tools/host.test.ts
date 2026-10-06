// A ToolRun job in the browser (FEAT-091, FEAT-092): input-free tools run
// once (latest), bound tools once per page of their page type with inputs
// from the page, an unbound tool that needs inputs fails loudly; outputs are
// written as site data and the sim gets a digest.
import { describe, expect, it } from 'vitest'
import ferryJson from '../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/ferry-times.tool.json'
import manifests from '../../../../crates/blueprint/tests/fixtures/site/manifests.golden.json'
import FerryDeparture from '../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryDeparture.json'
import FerryRow from '../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryRow.json'
import FerryTimetable from '../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryTimetable.json'
import digestImport from '../../../../crates/blueprint/tests/fixtures/n8n/news-digest.json'
import timetable from '../../../../packages/toolgraph/test/fixtures/ferry-timetable.json'
import type { Blueprint, SiteModels, SiteTool, ToolGraph } from '../blueprint/types'
import { packPages, readContext, runToolJob, type ToolJobDeps } from './host'
import { toolRef } from './runner'

const FERRY_HASH = 'a1b2c3d4e5f6' + '0'.repeat(52)
const DIGEST_HASH = 'b1b2c3d4e5f6' + '0'.repeat(52)
const ferry: SiteTool = { id: 'ferry-times', hash: FERRY_HASH, graph: ferryJson as unknown as ToolGraph, issues: [], manifest: (manifests as Record<string, Record<string, unknown>>)['ferry-times'] }
const digest: SiteTool = {
  id: 'news-digest',
  hash: DIGEST_HASH,
  graph: (digestImport as { graph: unknown }).graph as ToolGraph,
  issues: [],
  manifest: { capabilities: ['web'], origins: ['https://www.ansa.it'] },
}

function models(blueprint: Partial<Blueprint>): SiteModels {
  return {
    commit: 'c0',
    source: 'repo',
    hash: 'h',
    blueprint: { format: 'swarmpress.blueprint.v1', page_types: [], ...blueprint },
    types: { FerryDeparture, FerryRow, FerryTimetable, ...(digestImport as { types: Record<string, unknown> }).types },
    issues: [],
    tools: [ferry, digest],
    tool_errors: [],
    context: { custom_blocks: [], sections: [], collections: [] },
    town: {},
  }
}

function deps(m: SiteModels | null, over: Partial<ToolJobDeps> = {}) {
  const written: { tool: string; key: string; port?: string; value: unknown }[] = []
  const rss = Array.from({ length: 6 }, (_, i) => `<item><title>S${i}</title><link>https://www.ansa.it/${i}</link></item>`).join('')
  const d: ToolJobDeps = {
    models: m,
    pages: [
      { path: 'content/pages/vernazza.json', page_type: 'village' },
      { path: 'content/pages/manarola.json', page_type: 'village' },
      { path: 'content/pages/blog/x.json', page_type: 'blog-article' },
    ],
    readPage: async (path) => ({ id: path, title: { en: path }, metadata: { village: { slug: path.includes('vernazza') ? 'vernazza' : 'manarola', name: 'V' } } }),
    facilities: {
      webFetch: async (url) =>
        url.includes('ansa')
          ? { status: 200, contentType: 'application/rss+xml', text: `<rss><channel>${rss}</channel></rss>` }
          : { status: 200, contentType: 'application/json', text: JSON.stringify(timetable) },
    },
    putData: async (body) => {
      written.push(body as never)
      return { changed: true }
    },
    site: { name: 'Riviera' },
    ...over,
  }
  return { d, written }
}

const outcome = (json: string) => JSON.parse(json)[0] as { JobCompleted?: { digest: { ok: boolean; qa_defects: number; artifact_sha: string } }; JobFailed?: { reason: string } }

describe('tool runs in the browser', () => {
  it('runs an input-free tool once and writes latest', async () => {
    const { d, written } = deps(models({}))
    const o = outcome(await runToolJob({ job_id: 7, tool_ref: toolRef(DIGEST_HASH) }, d))
    expect(o.JobCompleted?.digest.ok).toBe(true)
    expect(o.JobCompleted?.digest.artifact_sha).toMatch(/^[0-9a-f]{32}$/)
    expect(written.map((w) => [w.tool, w.key, w.port])).toEqual([['news-digest', 'latest', 'edit_fields']])
    expect((written[0].value as unknown[]).length).toBe(5)
  }, 20_000)

  it('runs a bound tool once per page of its page type, inputs from the page', async () => {
    const bp: Partial<Blueprint> = {
      page_types: [
        {
          id: 'village',
          label: { en: 'Village' },
          source: { kind: 'page' },
          slots: [{ id: 'ferries', blocks: ['x:ferry-times'], source: { tool: 'ferry-times', inputs: { village: 'page.metadata.village' }, accepts: 'FerryDeparture[]' } }],
        },
      ],
    }
    const { d, written } = deps(models(bp))
    const o = outcome(await runToolJob({ job_id: 8, tool_ref: toolRef(FERRY_HASH) }, d))
    expect(o.JobCompleted?.digest.ok).toBe(true)
    expect(written.map((w) => w.key)).toEqual(['vernazza', 'manarola'])
  }, 20_000)

  it('fails loudly when it cannot run', async () => {
    expect(outcome(await runToolJob({ job_id: 9, tool_ref: toolRef(FERRY_HASH) }, deps(models({})).d)).JobFailed?.reason).toBe('InvalidOutput')
    expect(outcome(await runToolJob({ job_id: 9, tool_ref: 123 }, deps(models({})).d)).JobFailed?.reason).toBe('Infrastructure')
    expect(outcome(await runToolJob({ job_id: 9, tool_ref: 1 }, deps(null).d)).JobFailed?.reason).toBe('Infrastructure')
  })

  it('reads closed context paths, English for localized text', () => {
    expect(readContext('page.title', { page: { title: { en: 'A', de: 'B' } }, site: {} })).toBe('A')
    expect(readContext('site.name', { site: { name: 'R' } })).toBe('R')
    expect(readContext('visitor.city', { site: {} })).toBeUndefined()
    expect(packPages(JSON.stringify({ pages: [{ path: 'p.json', page_type: 'home' }, { path: 3 }] }))).toEqual([{ path: 'p.json', page_type: 'home' }])
    expect(packPages(undefined)).toEqual([])
  })
})
