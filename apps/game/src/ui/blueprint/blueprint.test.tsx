// @vitest-environment jsdom
// The Blueprint panel (FEAT-090, design §5): offered only with the site's
// models; the brick canvas on the real checker (crates/blueprint-wasm/pkg
// from `cargo xtask wasm --only blueprint-wasm`; skipped without it, like the
// kit's spike): buildings in street order, storeys coloured by intent,
// issues on storeys, edits with the live diff, Save with its base hash and
// the server's 409 and 422; the factory district's machines.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import miniJson from '../../../../../crates/blueprint/tests/fixtures/cinqueterre-mini.blueprint.json'
import ferryJson from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/ferry-times.tool.json'
import teaserJson from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/story-teaser.tool.json'
import weatherJson from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/weather.tool.json'
import FerryDeparture from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryDeparture.json'
import FerryRow from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryRow.json'
import FerryTimetable from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryTimetable.json'
import Teaser from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/Teaser.json'
import Weather from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/Weather.json'
import WeatherReport from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/WeatherReport.json'
import type { Blueprint, PutBlueprintBody, PutBlueprintResult, SiteModels, ToolGraph } from '../../blueprint/types'
import { setBlueprintWasm, type BlueprintApi } from '../../blueprint/wasm'
import { MockDataSource } from '../mock-source'
import { mountOverlay } from '../mount'
import { flush } from '../testing'

const mini = miniJson as unknown as { blueprint: Blueprint; types: Record<string, unknown> }
const graphs = [ferryJson, teaserJson, weatherJson] as unknown as ToolGraph[]
const TYPES = { ...mini.types, FerryDeparture, FerryRow, FerryTimetable, Teaser, Weather, WeatherReport }

function models(over: Partial<SiteModels> = {}, bp: Blueprint = mini.blueprint): SiteModels {
  return {
    commit: 'c0ffee1234567',
    source: 'repo',
    hash: 'hash-base',
    blueprint: bp,
    types: TYPES,
    issues: [],
    tools: graphs.map((g) => ({ id: g.id, hash: `${g.id}-hash`, graph: g, issues: [], manifest: {} })),
    tool_errors: [],
    context: { custom_blocks: [], sections: ['blog', 'hikes', 'itinerary', 'restaurants', 'transportation'], collections: ['hikes', 'restaurants'] },
    town: {},
    ...over,
  }
}

type Site = {
  models: SiteModels | null
  save?: (b: PutBlueprintBody) => Promise<PutBlueprintResult>
  reload?: () => Promise<void>
}

let ctx: { cleanup(): void } | null = null
async function open(site: Site) {
  const source = new MockDataSource()
  const s = source as unknown as Record<string, unknown>
  s.getSiteModels = () => Promise.resolve(site.models)
  if (site.save) s.saveBlueprint = site.save
  if (site.reload) s.reloadSiteModels = site.reload
  const el = document.createElement('div')
  document.body.appendChild(el)
  const handle = mountOverlay(el, source)
  ctx = {
    cleanup() {
      handle.dispose()
      el.remove()
    },
  }
  await flush()
  await flush()
  return handle.store
}
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

const nav = () => screen.getByRole('navigation', { name: 'CEO tools' })
const panel = () => screen.getByRole('region', { name: /Site blueprint/ })
const buildingIds = () => [...document.querySelectorAll('[data-building]')].map((g) => g.getAttribute('data-building'))
const storey = (id: string) => document.querySelector(`[data-slot="${id}"]`) as SVGGElement | null

/** A checker that knows no issues and no changes: enough for the panel's own wiring. */
const FAKE: BlueprintApi = {
  checkBlueprint: () => '[]',
  diffBlueprints: () => '[]',
  hashBlueprint: () => 'h',
  checkTool: () => '[]',
  toolManifest: () => '{"capabilities":[]}',
}

describe('the Blueprint panel is offered with the site models only', () => {
  beforeAll(() => setBlueprintWasm(FAKE))

  it('is not in the toolbar for a source without a site, and B does nothing', async () => {
    const store = await open({ models: null })
    expect(within(nav()).queryByRole('button', { name: /Blueprint/ })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'b' })
    await flush()
    expect(store.panel.value).toBeNull()
  })

  it('appears once the source has the models; B opens it with its two tabs', async () => {
    const store = await open({ models: models() })
    expect(within(nav()).getByRole('button', { name: /Blueprint/ })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'b' })
    await flush()
    await flush()
    expect(store.panel.value).toBe('blueprint')
    const p = within(panel())
    expect(p.getByRole('tab', { name: 'Blueprint' }).getAttribute('aria-selected')).toBe('true')
    expect(p.getByRole('tab', { name: 'Tools' })).toBeTruthy()
    expect(buildingIds()).toHaveLength(6)
  })
})

const PKG = resolve(process.cwd(), '../../crates/blueprint-wasm/pkg') + '/'
const built = existsSync(`${PKG}blueprint_wasm.js`)

describe.skipIf(!built)('the brick canvas on the real checker (blueprint-wasm)', () => {
  beforeAll(async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}blueprint_wasm.js`).href)) as BlueprintApi & { initSync(m: { module: BufferSource }): unknown }
    mod.initSync({ module: readFileSync(`${PKG}blueprint_wasm_bg.wasm`) })
    setBlueprintWasm(mod)
  })

  const openPanel = async (site: Site) => {
    const store = await open(site)
    store.panel.value = 'blueprint'
    // The panel, then the checker it loads.
    await vi.waitFor(() => expect(document.querySelector('[data-checker="ready"]')).toBeTruthy())
    await flush()
    return store
  }

  it('draws one building per page type in street order, a storey per slot coloured by intent', async () => {
    const bp: Blueprint = { ...mini.blueprint, navigation: [{ page_type: 'city' }, ...(mini.blueprint.navigation ?? [])] }
    await openPanel({ models: models({}, bp) })
    expect(buildingIds()).toEqual(['city', 'blog-article', 'blog-index', 'city', 'info', 'language-root', 'restaurants'].filter((x, i, a) => a.indexOf(x) === i))
    const slots = [...document.querySelectorAll('[data-building="blog-article"] [data-slot]')].map((g) => [g.getAttribute('data-slot'), g.getAttribute('data-colour')])
    expect(slots).toEqual([
      ['blog-article/hero', 'sand'], // editorial-hero: orient
      ['blog-article/body', 'sand'], // heading: orient
      ['blog-article/closing', 'red'], // closing-note: convert
    ])
    // A type without slots has no storeys; the relationship is a walkway; the collections are warehouses.
    expect(document.querySelectorAll('[data-building="blog-index"] [data-slot]')).toHaveLength(0)
    expect(document.querySelector('[data-relationship="blog-index>blog-article:links-to"]')).toBeTruthy()
    expect(document.querySelectorAll('[data-collection]')).toHaveLength(2)
    expect(within(panel()).getByText('Issues').textContent).toContain('none')
  })

  it('marks a storey with an issue red and lists the issue', async () => {
    const bp: Blueprint = {
      ...mini.blueprint,
      page_types: [...mini.blueprint.page_types, { id: 'author', label: { en: 'Author' }, route: '/{lang}/authors/{slug}', source: { kind: 'page' }, slots: [{ id: 'lead', blocks: ['nope'] }] }],
    }
    await openPanel({ models: models({}, bp) })
    expect(storey('author/lead')!.getAttribute('data-issue')).toBe('true')
    expect(storey('city/lead')!.getAttribute('data-issue')).toBeNull()
    const list = within(panel()).getByRole('list', { name: 'Issues' })
    expect(list.textContent).toContain('unknown-block')
    expect(list.textContent).toContain('/page_types/6/slots/0/blocks/0')
    // The inspector: simple words first, the JSON in the advanced view.
    fireEvent.click(storey('author/lead')!)
    await flush()
    const insp = within(screen.getByRole('complementary', { name: /Storey lead/ }))
    expect(insp.getByText(/optional, any number of blocks/)).toBeTruthy()
    fireEvent.click(insp.getByRole('tab', { name: 'Advanced' }))
    await flush()
    expect(insp.getByLabelText('JSON').textContent).toContain('"nope"')
  })

  it('adds a page type and a storey: the canvas and the change list show them, checked live', async () => {
    await openPanel({ models: models(), save: vi.fn() })
    const p = within(panel())
    const bin = within(p.getByRole('navigation', { name: 'Parts bin' }))
    fireEvent.input(bin.getByRole('textbox', { name: 'Id' }), { target: { value: 'author' } })
    fireEvent.input(bin.getByRole('textbox', { name: 'Label' }), { target: { value: 'Author' } })
    fireEvent.input(bin.getByRole('textbox', { name: 'Route' }), { target: { value: '/{lang}/authors/{slug}' } })
    fireEvent.click(bin.getByRole('button', { name: 'Add page type' }))
    await flush()
    expect(buildingIds().at(-1)).toBe('author')
    expect(document.querySelector('[data-building="author"]')!.getAttribute('data-mark')).toBe('added')
    const changes = () => within(p.getByRole('list', { name: 'Changes' }))
    expect(changes().getByText('author').closest('li')!.textContent).toMatch(/added\s*page-type\s*author/)

    // The inspector opened on the new type: add a storey; empty, it is an issue of the checker.
    const insp = within(screen.getByRole('complementary', { name: /Author/ }))
    fireEvent.input(insp.getByRole('textbox', { name: 'New storey id' }), { target: { value: 'lead' } })
    fireEvent.click(insp.getByRole('button', { name: 'Add storey' }))
    await flush()
    expect(storey('author/lead')!.getAttribute('data-mark')).toBe('added')
    expect(storey('author/lead')!.getAttribute('data-issue')).toBe('true')
    expect((p.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

    // A block from the parts bin into the selected storey: the issue is gone, the storey takes its colour.
    fireEvent.click(bin.getByRole('button', { name: 'Add hero to lead' }))
    await flush()
    expect(storey('author/lead')!.getAttribute('data-issue')).toBeNull()
    expect(storey('author/lead')!.getAttribute('data-colour')).toBe('sand')
    expect((p.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)

    // Discard: back to the blueprint as saved.
    fireEvent.click(p.getByRole('button', { name: 'Discard' }))
    await flush()
    expect(buildingIds()).not.toContain('author')
    expect(p.getByText('No changes yet.')).toBeTruthy()
  })

  it('ghosts a removed page type and marks a changed one', async () => {
    await openPanel({ models: models(), save: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: /Page type Info \(info\)/ }))
    await flush()
    fireEvent.click(within(screen.getByRole('complementary', { name: /Info/ })).getByRole('button', { name: 'Remove page type' }))
    await flush()
    expect(document.querySelector('[data-building="info"]')!.getAttribute('data-mark')).toBe('removed')
    expect(within(panel()).getByRole('list', { name: 'Changes' }).textContent).toMatch(/removed\s*page-type\s*info/)
  })

  const addAuthor = async () => {
    const bin = within(within(panel()).getByRole('navigation', { name: 'Parts bin' }))
    fireEvent.input(bin.getByRole('textbox', { name: 'Id' }), { target: { value: 'author' } })
    fireEvent.click(bin.getByRole('button', { name: 'Add page type' }))
    await flush()
    const insp = within(screen.getByRole('complementary', { name: /author/ }))
    fireEvent.click(insp.getByRole('button', { name: 'Add storey' }))
    await flush()
    fireEvent.click(bin.getByRole('button', { name: /Add paragraph to/ }))
    await flush()
  }

  it('saves with the base hash, then reloads the models', async () => {
    const save = vi.fn(async (_b: PutBlueprintBody) => ({ commit: 'abcdef0123', hash: 'h2', changes: [{ kind: 'added' as const, subject: 'page-type' as const, id: 'author' }] }))
    const reload = vi.fn(async () => undefined)
    const store = await openPanel({ models: models(), save, reload })
    await addAuthor()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }))
    await flush()
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    const body = save.mock.calls[0][0]
    expect(body.base_hash).toBe('hash-base')
    expect(body.blueprint.page_types.at(-1)).toMatchObject({ id: 'author', slots: [{ id: 'storey', blocks: ['paragraph'] }] })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(store.toast.value).toMatchObject({ tone: 'ok', text: 'Blueprint saved: 1 change (commit abcdef0)' })
  })

  it('shows the server issues of a 422 and offers a reload on a 409', async () => {
    let status = 422
    const save = vi.fn(async () => {
      throw Object.assign(new Error('refused'), { status, body: status === 422 ? { error: 'the blueprint does not check', issues: ['bad-route at /page_types/6/route: no {lang}'] } : { error: 'stale' } })
    })
    const reload = vi.fn(async () => undefined)
    const store = await openPanel({ models: models(), save, reload })
    await addAuthor()
    const p = within(panel())
    fireEvent.click(p.getByRole('button', { name: 'Save' }))
    await flush()
    await flush()
    expect(p.getByRole('list', { name: 'Server issues' }).textContent).toContain('bad-route at /page_types/6/route')
    expect(store.toast.value?.tone).toBe('error')

    status = 409
    fireEvent.click(p.getByRole('button', { name: 'Save' }))
    await flush()
    await flush()
    expect(p.getByText('The blueprint changed since you began editing')).toBeTruthy()
    expect((p.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(p.getByRole('button', { name: 'Reload the blueprint' }))
    await flush()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('edits an imported blueprint only after the CEO starts from it', async () => {
    await openPanel({ models: models({ source: 'imported' }), save: vi.fn() })
    const p = within(panel())
    expect(p.queryByRole('navigation', { name: 'Parts bin' })).toBeNull()
    fireEvent.click(p.getByRole('button', { name: 'Start editing from this import' }))
    await flush()
    expect(p.getByRole('navigation', { name: 'Parts bin' })).toBeTruthy()
    // Saving the import as it is stores it in the repo.
    expect((p.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('is read-only for a source that cannot save', async () => {
    await openPanel({ models: models() })
    expect(within(panel()).queryByRole('navigation', { name: 'Parts bin' })).toBeNull()
    expect(within(panel()).queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('lays the three fixture tools out as machines in layered order, with manifests and triggers', async () => {
    await openPanel({ models: models() })
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Tools' }))
    await flush()
    const cards = [...document.querySelectorAll('[data-tool]')]
    expect(cards.map((c) => c.getAttribute('data-tool'))).toEqual(['ferry-times', 'story-teaser', 'weather'])
    const ferry = cards[0]
    expect([...ferry.querySelectorAll('[data-node]')].map((n) => `${n.getAttribute('data-layer')}:${n.getAttribute('data-row')}:${n.getAttribute('data-node')}`)).toEqual([
      '0:0:fetch',
      '0:1:in',
      '1:0:rows',
      '2:0:here',
      '3:0:shape',
      '4:0:first',
      '5:0:out',
    ])
    expect(ferry.querySelector('[data-edge="fetch.out>rows.in"]')!.getAttribute('data-type')).toBe('FerryTimetable')
    expect(ferry.textContent).toContain('www.navigazionegolfodeipoeti.it')
    expect(ferry.textContent).toContain('every game day, at every site build')
    expect(within(ferry as HTMLElement).getByText('web')).toBeTruthy()
    const teaser = within(cards[1] as HTMLElement)
    expect(teaser.getByText('llm:low')).toBeTruthy()
    expect(teaser.getByText('writer · low')).toBeTruthy()
    expect(within(panel()).getByText(/editing them on the canvas comes with T-1/)).toBeTruthy()
  })
})
