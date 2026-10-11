// @vitest-environment jsdom
// The Data Studio (ADR-0086): the site's content models read from the real
// fixtures' types — fields with their kinds and required-ness, the relations
// between site types (`$ref`, also as array items), where a model is used
// (collections, tools), the cards as a listbox (click, arrows, Home/End), the
// inspector, the brick strip, the honest empty state, and axe.
import axe from 'axe-core'
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import miniJson from '../../../../../crates/blueprint/tests/fixtures/cinqueterre-mini.blueprint.json'
import weatherJson from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/weather.tool.json'
import FerryDeparture from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryDeparture.json'
import FerryRow from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryRow.json'
import FerryTimetable from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/FerryTimetable.json'
import Teaser from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/Teaser.json'
import Weather from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/Weather.json'
import WeatherReport from '../../../../../crates/blueprint/tests/fixtures/site/blueprint/types/WeatherReport.json'
import type { Blueprint, SiteModels, ToolGraph } from '../../blueprint/types'
import { setBlueprintWasm, type BlueprintApi } from '../../blueprint/wasm'
import { MockDataSource } from '../mock-source'
import { mountOverlay } from '../mount'
import { flush } from '../testing'
import { cardOrder, layout, readModels, typeOf, usageOf } from './data-model'

const mini = miniJson as unknown as { blueprint: Blueprint; types: Record<string, unknown> }
const TYPES = { ...mini.types, FerryDeparture, FerryRow, FerryTimetable, Teaser, Weather, WeatherReport }
const weather = weatherJson as unknown as ToolGraph

function models(over: Partial<SiteModels> & Record<string, unknown> = {}): SiteModels {
  return {
    commit: 'c0ffee1234567',
    source: 'repo',
    hash: 'hash-base',
    blueprint: mini.blueprint,
    types: TYPES,
    issues: [],
    tools: [{ id: weather.id, hash: 'w', graph: weather, issues: [], manifest: {} }],
    tool_errors: [],
    context: { custom_blocks: [], sections: ['blog', 'hikes'], collections: ['hikes', 'restaurants'] },
    town: {},
    ...over,
  }
}

const FAKE: BlueprintApi = {
  checkBlueprint: () => '[]',
  diffBlueprints: () => '[]',
  hashBlueprint: () => 'h',
  checkTool: () => '[]',
  toolManifest: () => '{"capabilities":[]}',
}

let ctx: { cleanup(): void } | null = null
/** The overlay with the site's models, the Studio open on its Data Studio. */
async function open(m: SiteModels) {
  const source = new MockDataSource()
  ;(source as unknown as Record<string, unknown>).getSiteModels = () => Promise.resolve(m)
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
  handle.store.studioTab.value = 'data'
  handle.store.panel.value = 'blueprint'
  await flush()
  await flush()
  return el
}
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})
beforeAll(() => setBlueprintWasm(FAKE))

async function audit(root: Element) {
  const res = await axe.run(root, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] })
  return res.violations.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
}

const cards = () => within(screen.getByRole('listbox', { name: 'Content models' })).getAllByRole('option')
const selectedCard = () => cards().find((c) => c.getAttribute('aria-selected') === 'true')!.getAttribute('data-model')
const inspector = () => screen.getByRole('complementary', { name: /^Model / })

describe('the models, read from the schemas', () => {
  it('derives fields, kinds and required-ness from the fixtures', () => {
    const d = readModels(TYPES)
    expect(d.models.map((m) => m.name)).toEqual(['FerryDeparture', 'FerryRow', 'FerryTimetable', 'HikesItem', 'RestaurantsItem', 'Teaser', 'Weather', 'WeatherReport'])
    const hikes = d.models.find((m) => m.name === 'HikesItem')!
    expect(hikes.closed).toBe(true)
    expect(hikes.fields.map((f) => [f.name, f.type.kind, f.type.label, f.required])).toEqual([
      ['name', 'localized', 'Localized text', false],
      ['slug', 'text', 'Text', true],
    ])
    const w = d.models.find((m) => m.name === 'Weather')!
    expect(w.fields.map((f) => [f.name, f.type.kind, f.required])).toEqual([
      ['temperature', 'number', true],
      ['condition', 'text', true],
    ])
    const t = d.models.find((m) => m.name === 'FerryTimetable')!.fields[0]
    expect(t.type).toMatchObject({ kind: 'relation', list: true, label: 'FerryRow[]', ref: 'FerryRow' })
  })

  it('finds the relations: a $ref to a site type, alone or as array items', () => {
    expect(readModels(TYPES).relations).toEqual([
      { from: 'FerryTimetable', field: 'departures', to: 'FerryRow', many: true, required: true },
      { from: 'WeatherReport', field: 'current', to: 'Weather', many: false, required: true },
    ])
    // LocalizedString is a built-in, not a relation.
    expect(readModels(mini.types).relations).toEqual([])
  })

  it('reads the rest of the subset: enum, integer, boolean, nested objects, #/types/ refs, built-ins, unknown names', () => {
    const site = new Set(['Trailhead'])
    expect(typeOf({ enum: ['easy', 'hard'] }, site)).toMatchObject({ kind: 'enum', values: ['easy', 'hard'] })
    expect(typeOf({ type: 'integer' }, site).kind).toBe('integer')
    expect(typeOf({ type: 'boolean' }, site).kind).toBe('boolean')
    expect(typeOf({ $ref: '#/types/Trailhead' }, site)).toMatchObject({ kind: 'relation', ref: 'Trailhead' })
    expect(typeOf({ $ref: 'Media' }, site).kind).toBe('media')
    expect(typeOf({ type: 'array', items: { $ref: 'Village' } }, site)).toMatchObject({ kind: 'builtin', list: true, label: 'Village[]' })
    expect(typeOf({ $ref: 'Nope' }, site)).toMatchObject({ kind: 'unknown', label: 'Nope' })
    const nested = typeOf({ type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } }, site)
    expect(nested.fields).toEqual([{ name: 'a', type: { kind: 'text', list: false, label: 'Text' }, required: true }])
  })

  it('lays the cards out deterministically, related models side by side', () => {
    const d = readModels(TYPES)
    expect(cardOrder(d)).toEqual(['FerryDeparture', 'FerryTimetable', 'FerryRow', 'HikesItem', 'RestaurantsItem', 'Teaser', 'WeatherReport', 'Weather'])
    expect(layout(d)).toEqual(layout(readModels(TYPES)))
  })

  it('finds where a model is used: its collection and the tools’ ports', () => {
    const m = models()
    expect(usageOf('HikesItem', m).collections).toEqual([{ id: 'hikes', from: 'collection:hikes', items: 14, pageTypes: [] }])
    expect(usageOf('Weather', m).tools).toEqual([{ id: 'weather', port: 'weather', dir: 'output', expr: 'Weather' }])
  })
})

describe('the Data Studio in the Studio', () => {
  it('draws a card per model with its fields, and a line per relation', async () => {
    await open(models())
    expect(cards().map((c) => c.getAttribute('data-model'))).toEqual(['FerryDeparture', 'FerryTimetable', 'FerryRow', 'HikesItem', 'RestaurantsItem', 'Teaser', 'WeatherReport', 'Weather'])
    expect(cards()[2].textContent).toContain('stop')
    expect(cards()[2].getAttribute('aria-label')).toBe('FerryRow, 3 fields')
    expect([...document.querySelectorAll('[data-relation]')].map((e) => e.getAttribute('data-relation'))).toEqual(['FerryTimetable.departures>FerryRow', 'WeatherReport.current>Weather'])
    expect(document.querySelector('.ds-caption')!.textContent).toContain('FerryTimetable has many departures')
    // The strip: the field kinds the site uses, counted.
    const strip = within(screen.getByRole('region', { name: 'Field types on this site' }))
    expect(strip.getByText('Text').closest('li')!.textContent).toContain('9 fields')
    expect(strip.getByText('Relation').closest('li')!.textContent).toContain('2 fields')
    expect(strip.queryByText('Boolean')).toBeNull()
    // Read-only: nothing to add, save or edit.
    expect(within(screen.getByRole('region', { name: 'Data models' })).queryByRole('button', { name: /add|save|new/i })).toBeNull()
  })

  it('selects by click: the inspector shows the fields with type pills, relations in and out, the collection', async () => {
    await open(models())
    expect(selectedCard()).toBe('FerryDeparture')
    fireEvent.click(cards().find((c) => c.getAttribute('data-model') === 'Weather')!)
    await flush()
    expect(selectedCard()).toBe('Weather')
    const insp = within(inspector())
    expect(inspector().getAttribute('aria-label')).toBe('Model Weather')
    const temp = insp.getByText('temperature').closest('li')!
    expect(temp.textContent).toContain('Number')
    expect(temp.textContent).toContain('required')
    expect(insp.getByText('Tools').nextElementSibling!.textContent).toContain('weather')
    fireEvent.click(insp.getByRole('tab', { name: 'Relations' }))
    await flush()
    const into = within(insp.getByRole('list', { name: 'Pointed at by' }))
    expect(into.getByText('current')).toBeTruthy()
    // A relation leads to its model.
    fireEvent.click(into.getByRole('button', { name: 'WeatherReport' }))
    await flush()
    expect(selectedCard()).toBe('WeatherReport')
    expect(within(inspector()).getByRole('list', { name: 'Points to' }).textContent).toContain('Weather')

    fireEvent.click(cards().find((c) => c.getAttribute('data-model') === 'HikesItem')!)
    await flush()
    const settings = within(inspector()).getByText('Collection').closest('dl')!
    expect(settings.textContent).toContain('hikes')
    expect(settings.textContent).toContain('collection:hikes')
    expect(settings.textContent).toContain('14')
    fireEvent.click(within(inspector()).getByRole('tab', { name: 'Validation' }))
    await flush()
    const rules = within(inspector()).getByRole('list', { name: 'Validation' }).textContent
    expect(rules).toContain('Required: slug')
    expect(rules).toContain('Closed')
  })

  it('selects by keyboard: arrows, Home and End move along the cards with a roving tab stop', async () => {
    await open(models())
    // The panel takes the focus when it opens (after paint); the cards take it from there.
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('panel-blueprint'))
    const first = cards()[0]
    expect(first.tabIndex).toBe(0)
    expect(cards()[1].tabIndex).toBe(-1)
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    await flush()
    expect(selectedCard()).toBe('FerryTimetable')
    await flush()
    expect(document.activeElement?.getAttribute('data-model')).toBe('FerryTimetable')
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    await flush()
    expect(selectedCard()).toBe('Weather')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    await flush()
    expect(selectedCard()).toBe('WeatherReport')
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    await flush()
    expect(selectedCard()).toBe('FerryDeparture')
    expect(cards()[0].tabIndex).toBe(0)
  })

  it('says so when the site has no models; a WordPress site names its post types', async () => {
    await open(models({ types: {} }))
    expect(within(screen.getByRole('region', { name: 'Data models' })).getByRole('status').textContent).toContain('no content types')
    expect(screen.queryByRole('listbox', { name: 'Content models' })).toBeNull()
    ctx?.cleanup()
    const bp: Blueprint = { format: 'swarmpress.blueprint.v1', page_types: [{ id: 'post', label: { en: 'Posts' }, source: { kind: 'page' } }, { id: 'page', label: { en: 'Pages' }, source: { kind: 'page' } }] }
    await open(models({ types: {}, blueprint: bp, engine: 'wordpress' }))
    const status = within(screen.getByRole('region', { name: 'Data models' })).getByRole('status')
    expect(status.textContent).toContain('WordPress')
    expect(status.textContent).toContain('post, page')
  })

  it('has no axe violations, with models and without', async () => {
    const el = await open(models())
    expect(await audit(el)).toEqual([])
    fireEvent.click(within(inspector()).getByRole('tab', { name: 'Relations' }))
    await flush()
    expect(await audit(el)).toEqual([])
    ctx?.cleanup()
    const empty = await open(models({ types: {} }))
    expect(await audit(empty)).toEqual([])
  })
})
