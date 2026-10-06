// The brick canvas's pure logic (FEAT-090): colours agree with the town
// (town.rs `intent_colour`) and the kit's palette, the street order is the
// town's, edits are pure, and the factory district's layered layout of the
// three fixture tools is the design's (§4.3).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ferryJson from '../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/ferry-times.tool.json'
import teaserJson from '../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/story-teaser.tool.json'
import weatherJson from '../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/weather.tool.json'
import miniJson from '../../../../crates/blueprint/tests/fixtures/cinqueterre-mini.blueprint.json'
import { blockColour, CATALOGUE, hexOf, INTENT_COLOUR, PALETTE, TYPE_COLOUR, typeColour } from './colours'
import { addPageType, addRelationship, addSlot, buildingsOf, freshId, layoutTool, moveSlot, occurrence, removePageType, removeSlot, streetOrder, updateSlot } from './model'
import type { Blueprint, BlueprintChange, ToolGraph } from './types'

const mini = (miniJson as unknown as { blueprint: Blueprint }).blueprint
const tools = [ferryJson, teaserJson, weatherJson] as unknown as ToolGraph[]

describe('colours', () => {
  it('maps every intent to the palette colour town.rs gives it', () => {
    const src = readFileSync(resolve(process.cwd(), '../../crates/blueprint/src/town.rs'), 'utf8')
    const body = src.slice(src.indexOf('pub fn intent_colour'), src.indexOf('fn block_colour'))
    const rust = Object.fromEntries([...body.matchAll(/Intent::(\w+) => "([\w-]+)"/g)].map((m) => [m[1].toLowerCase(), m[2]]))
    expect(rust).toEqual(INTENT_COLOUR)
    const ids = new Set(PALETTE.map((c) => c.id))
    for (const id of Object.values(INTENT_COLOUR)) expect(ids.has(id)).toBe(true)
    for (const id of Object.values(TYPE_COLOUR)) expect(ids.has(id)).toBe(true)
    expect(hexOf('orange')).toBe('#e07a1f')
  })

  it('colours a block by its intent, a site block grey (as the town does)', () => {
    expect(CATALOGUE.length).toBeGreaterThan(40)
    expect(blockColour('editorial-hero')).toBe('sand') // orient
    expect(blockColour('paragraph')).toBe('blue') // inform
    expect(blockColour('closing-note')).toBe('red') // convert
    expect(blockColour('ferry-board')).toBe('grey-light')
  })

  it('gives built-in types fixed tube colours and other types a stable one from the rest', () => {
    expect(typeColour('string')).toBe('white')
    expect(typeColour('Article')).toBe('blue')
    expect(typeColour('Media[]')).toBe('green')
    const a = typeColour('FerryDeparture')
    expect(typeColour('FerryDeparture[]')).toBe(a)
    expect(typeColour('FerryDeparture')).toBe(a)
    expect(['red', 'red-dark', 'black', ...Object.values(TYPE_COLOUR)]).not.toContain(a)
    expect(PALETTE.find((c) => c.id === a)?.class).toBe('solid')
  })
})

describe('the street and the draft', () => {
  it('orders buildings by navigation, then declaration (town.rs street())', () => {
    expect(streetOrder(mini).map((t) => t.id)).toEqual(['blog-article', 'blog-index', 'city', 'info', 'language-root', 'restaurants'])
    const nav = { ...mini, navigation: [{ page_type: 'info' }, { section: 'blog' }, { page_type: 'city' }, { page_type: 'info' }] }
    expect(streetOrder(nav).map((t) => t.id)).toEqual(['info', 'city', 'blog-article', 'blog-index', 'language-root', 'restaurants'])
  })

  it('edits are pure and keep the blueprint consistent', () => {
    let d = addPageType(mini, { id: 'author', label: 'Author', route: '/{lang}/authors/{slug}' })
    expect(mini.page_types).toHaveLength(6)
    expect(d.page_types.at(-1)).toEqual({ id: 'author', label: { en: 'Author' }, route: '/{lang}/authors/{slug}', source: { kind: 'page' }, slots: [] })
    d = addSlot(d, 'author', { id: 'lead', blocks: ['hero'] })
    d = addSlot(d, 'author', { id: 'body', blocks: ['paragraph'] })
    d = moveSlot(d, 'author', 'body', -1)
    expect(d.page_types.at(-1)!.slots!.map((s) => s.id)).toEqual(['body', 'lead'])
    d = updateSlot(d, 'author', 'lead', { min: 1, max: 1 })
    expect(occurrence(d.page_types.at(-1)!.slots![1])).toBe('required, exactly one block')
    d = updateSlot(d, 'author', 'lead', { min: 0, max: null })
    expect(d.page_types.at(-1)!.slots![1]).toEqual({ id: 'lead', blocks: ['hero'] })
    d = addRelationship(d, { from: 'blog-article', to: 'author', kind: 'written-by', cardinality: 'many-to-one' })
    d = removePageType(d, 'author')
    expect(d.relationships).toEqual(mini.relationships)
    expect(d.page_types).toEqual(mini.page_types)
    expect(removeSlot(mini, 'city', 'body').page_types[2].slots!.map((s) => s.id)).toEqual(['lead', 'closing'])
    expect(freshId('storey', ['storey', 'storey-2'])).toBe('storey-3')
  })

  it('draws the draft over its base: added, changed, and removed ones ghosted in place', () => {
    let d = removeSlot(mini, 'city', 'body')
    d = removePageType(d, 'restaurants')
    d = addPageType(d, { id: 'author', label: 'Author' })
    const changes: BlueprintChange[] = [
      { kind: 'added', subject: 'page-type', id: 'author' },
      { kind: 'removed', subject: 'page-type', id: 'restaurants' },
      { kind: 'changed', subject: 'page-type', id: 'city', fields: ['slots'] },
      { kind: 'removed', subject: 'slot', id: 'city/body' },
    ]
    const issues = [{ code: 'bad-slot', path: '/page_types/2/slots/1/blocks/0', message: 'x' }, { code: 'bad-route', path: '/page_types/2/route', message: 'y' }]
    const b = buildingsOf(d, mini, changes, issues)
    expect(b.map((x) => [x.type.id, x.mark])).toEqual([
      ['blog-article', null],
      ['blog-index', null],
      ['city', 'changed'],
      ['info', null],
      ['language-root', null],
      ['author', 'added'],
      ['restaurants', 'removed'],
    ])
    const city = b[2]
    expect(city.storeys.map((s) => [s.slot.id, s.mark, s.index])).toEqual([
      ['lead', null, 0],
      ['body', 'removed', null],
      ['closing', null, 1],
    ])
    expect(city.storeys[2].issues).toHaveLength(1)
    expect(city.issues.map((i) => i.code)).toEqual(['bad-route'])
    expect(b[6].index).toBeNull()
  })
})

describe('the factory district layout (design §4.3)', () => {
  const placed = (g: ToolGraph) => layoutTool(g).nodes.map((n) => `${n.layer}:${n.row}:${n.node.id}`)

  it('layers by the longest path from a source and orders a layer by id', () => {
    // ferry-times: the connector fetches on its own (a source), the input joins at the filter.
    expect(placed(tools[0])).toEqual(['0:0:fetch', '0:1:in', '1:0:rows', '2:0:here', '3:0:shape', '4:0:first', '5:0:out'])
    expect(placed(tools[1])).toEqual(['0:0:in', '1:0:long', '2:0:write', '3:0:out'])
    expect(placed(tools[2])).toEqual(['0:0:in', '1:0:fetch', '2:0:now', '3:0:out'])
    expect(layoutTool(tools[0])).toMatchObject({ layers: 6, rows: 2 })
  })

  it('types every tube by what flows through it', () => {
    const types = (g: ToolGraph) => Object.fromEntries(layoutTool(g).edges.map((e) => [`${e.from}.${e.fromPort}>${e.to}.${e.toPort}`, e.type]))
    expect(types(tools[0])).toEqual({
      'fetch.out>rows.in': 'FerryTimetable',
      'rows.out>here.in': 'FerryRow[]',
      'in.out>here.param': 'Village',
      'here.out>shape.in': 'FerryRow[]',
      'shape.out>first.in': 'FerryDeparture[]',
      'first.out>out.in': 'FerryDeparture[]',
    })
    expect(types(tools[1])).toEqual({ 'in.out>long.in': 'Article', 'long.yes>write.in': 'Article', 'write.out>out.in': 'Teaser' })
    expect(types(tools[2])['in.out>fetch.params']).toBe('string')
  })
})
