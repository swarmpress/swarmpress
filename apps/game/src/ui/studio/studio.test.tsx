// @vitest-environment jsdom
// The Brick Studio (FEAT-100) and the instruction booklet (FEAT-101), ADR-0077:
// the snap engine judges drops with the site's checker (green studs, red seams
// with the checker's reason), undo and redo, the booklet's steps and bags
// (each step the base with its prefix of changes applied, by the server's own
// code), the Building workbench (pick a part, drop it on a storey or in a gap),
// and a staff proposal opened as a booklet from its Inbox ticket, answered
// from inside it. The real checker is crates/blueprint-wasm/pkg (from
// `cargo xtask wasm`); the tests that need it are skipped without it.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fireEvent, screen, within } from '@testing-library/preact'
import axe from 'axe-core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import miniJson from '../../../../../crates/blueprint/tests/fixtures/cinqueterre-mini.blueprint.json'
import { CORE_TYPES, insertSlot, updateSlot } from '../../blueprint/model'
import type { Blueprint, BlueprintChange, ModelIssue, SiteModels } from '../../blueprint/types'
import { applyChanges, checkBlueprint, diffBlueprints, setBlueprintWasm, type BlueprintApi } from '../../blueprint/wasm'
import { fakeCompanyStore, LIVE_ITEM, liveSim, liveTicket, setupLive } from '../live-testing'
import { MockDataSource } from '../mock-source'
import { mountOverlay } from '../mount'
import { flush } from '../testing'
import { companyStoreOptions } from '../wasm-source'
import { commit, historyOf, redo, undo } from './history'
import { dropTargets, judgeAll, judgeDrop, placeBlock, storeyIdFor, targetKey } from './snap'
import { bagOf, bookletOf, partsOf, SITE_BAG } from './steps'

const mini = miniJson as unknown as { blueprint: Blueprint; types: Record<string, unknown> }
const base = mini.blueprint

describe('the snap engine', () => {
  // A checker that knows one rule: no storey may hold `callout`.
  const check = (bp: Blueprint): ModelIssue[] =>
    bp.page_types.flatMap((t) => (t.slots ?? []).filter((s) => s.blocks.includes('callout')).map((s) => ({ code: 'unknown-block', path: `/page_types/${t.id}/${s.id}`, message: `callout is not allowed in ${s.id}` })))
  const type = base.page_types.find((t) => (t.slots ?? []).length >= 2)!
  const first = type.slots![0]

  it('lists every storey and every gap of a type, gaps around the storeys', () => {
    const targets = dropTargets(base, type.id)
    expect(targets.filter((t) => t.kind === 'storey')).toHaveLength(type.slots!.length)
    expect(targets.filter((t) => t.kind === 'gap')).toHaveLength(type.slots!.length + 1)
    expect(targets[0]).toEqual({ kind: 'gap', type: type.id, index: 0 })
  })

  it('drops a block on a storey or as a new optional storey in a gap', () => {
    const onStorey = placeBlock(base, { kind: 'storey', type: type.id, slot: first.id }, 'quote')!
    expect(onStorey.page_types.find((t) => t.id === type.id)!.slots![0].blocks).toEqual([...first.blocks, 'quote'])
    const inGap = placeBlock(base, { kind: 'gap', type: type.id, index: 1 }, 'quote')!
    expect(inGap.page_types.find((t) => t.id === type.id)!.slots![1]).toEqual({ id: 'quote', blocks: ['quote'], min: 0 })
    // A second quote storey gets a fresh id.
    expect(storeyIdFor(inGap, type.id, 'quote')).toBe('quote-2')
  })

  it("refuses with the checker's reason, and a block the storey already has", () => {
    const refused = judgeDrop(check, base, { kind: 'storey', type: type.id, slot: first.id }, 'callout')
    expect(refused).toMatchObject({ ok: false, reason: `callout is not allowed in ${first.id}`, next: null })
    const dup = judgeDrop(check, base, { kind: 'storey', type: type.id, slot: first.id }, first.blocks[0])
    expect(dup).toMatchObject({ ok: false, reason: 'This storey already has that block.' })
    const ok = judgeDrop(check, base, { kind: 'gap', type: type.id, index: 0 }, 'quote')
    expect(ok.ok).toBe(true)
    expect(ok.next).not.toBeNull()
  })

  it('judges a drop by the issues it adds, not those the draft already had', () => {
    const broken = updateSlot(base, type.id, first.id, { blocks: [...first.blocks, 'callout'] })
    // The draft already has the callout issue: a harmless drop elsewhere is still fine.
    const v = judgeDrop(check, broken, { kind: 'gap', type: type.id, index: type.slots!.length }, 'quote')
    expect(v.ok).toBe(true)
    const all = judgeAll(check, base, type.id, 'callout')
    expect([...all.values()].every((x) => !x.ok)).toBe(true)
    expect(all.has(targetKey({ kind: 'gap', type: type.id, index: 0 }))).toBe(true)
  })
})

describe('undo and redo', () => {
  it('steps back and forward; a new edit drops the redo branch', () => {
    let h = historyOf('a')
    h = commit(h, 'b')
    h = commit(h, 'c')
    h = undo(h)
    expect(h.present).toBe('b')
    h = redo(h)
    expect(h.present).toBe('c')
    h = undo(undo(h))
    expect(h.present).toBe('a')
    h = commit(h, 'd')
    expect(h.future).toEqual([])
    expect(redo(h).present).toBe('d')
    expect(undo(historyOf('x'))).toEqual(historyOf('x'))
  })
})

describe('the booklet steps', () => {
  it('bags changes by building, the site last', () => {
    expect(bagOf({ kind: 'added', subject: 'page-type', id: 'author' })).toBe('author')
    expect(bagOf({ kind: 'changed', subject: 'slot', id: 'home/hero' })).toBe('home')
    expect(bagOf({ kind: 'added', subject: 'relationship', id: 'blog-article>author:written-by' })).toBe('blog-article')
    expect(bagOf({ kind: 'changed', subject: 'navigation', id: 'navigation' })).toBe(SITE_BAG)
  })

  it('builds a relationship after both its buildings, and a new building after the ones that stand', () => {
    const p: Blueprint = { ...base, page_types: [...base.page_types, { id: 'author', label: { en: 'Author' }, source: { kind: 'page' }, slots: [{ id: 'profile', blocks: ['hero'] }] }] }
    const changes: BlueprintChange[] = [
      { kind: 'added', subject: 'relationship', id: 'blog-article>author:written-by' },
      { kind: 'added', subject: 'page-type', id: 'author' },
    ]
    const book = bookletOf(base, p, changes, () => null)
    expect(book.steps.map((s) => s.change.subject)).toEqual(['page-type', 'relationship'])
    expect(book.steps.map((s) => s.bag)).toEqual(['author', 'author'])
    expect(book.steps.at(-1)!.after).toBe(p)
  })

  it('calls out the storeys and blocks a step adds and takes away', () => {
    const t = base.page_types.find((x) => (x.slots ?? []).length >= 1)!
    const s = t.slots![0]
    const after = insertSlot(updateSlot(base, t.id, s.id, { blocks: [...s.blocks, 'quote'] }), t.id, 0, { id: 'lead', blocks: ['hero'], min: 0 })
    expect(partsOf(base, after, { kind: 'changed', subject: 'page-type', id: t.id })).toEqual(['+ storey lead', '+ hero', '+ quote'])
  })
})

const PKG = resolve(process.cwd(), '../../crates/blueprint-wasm/pkg') + '/'
const built = existsSync(`${PKG}blueprint_wasm.js`)

const models = (over: Partial<SiteModels> = {}): SiteModels => ({
  commit: 'c0ffee1234567',
  source: 'repo',
  hash: 'hash-base',
  blueprint: base,
  types: mini.types,
  issues: [],
  tools: [],
  tool_errors: [],
  context: { custom_blocks: [], sections: ['blog', 'hikes', 'itinerary', 'restaurants', 'transportation'], collections: ['hikes', 'restaurants'] },
  town: {},
  ...over,
})

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe.skipIf(!built)('on the real checker (blueprint-wasm)', () => {
  let api: BlueprintApi
  beforeAll(async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}blueprint_wasm.js`).href)) as BlueprintApi & { initSync(m: { module: BufferSource }): unknown }
    mod.initSync({ module: readFileSync(`${PKG}blueprint_wasm_bg.wasm`) })
    api = mod
    setBlueprintWasm(mod)
  })

  /** A proposal: a new author page type and one more block on the first storey of the first type. */
  const proposal = (): Blueprint => {
    const t = base.page_types.find((x) => (x.slots ?? []).length >= 1)!
    const s = t.slots![0]
    const next = updateSlot(base, t.id, s.id, { blocks: [...s.blocks, 'quote'] })
    next.page_types.push({ id: 'author', label: { en: 'Author' }, route: '/{lang}/authors/{slug}', source: { kind: 'page' }, slots: [{ id: 'profile', blocks: ['hero'], min: 1, max: 1 }] })
    return next
  }

  it('makes one step per change, each the base with its prefix applied, the last the whole proposal', () => {
    const p = proposal()
    const changes = diffBlueprints(api, base, p)
    expect(changes.length).toBeGreaterThanOrEqual(2)
    const book = bookletOf(base, p, changes, (cs) => applyChanges(api, base, p, cs))
    expect(book.steps).toHaveLength(changes.length)
    book.steps.forEach((s, i) => expect(s.after).toEqual(applyChanges(api, base, p, book.steps.slice(0, i + 1).map((x) => x.change))))
    expect(diffBlueprints(api, book.steps.at(-1)!.after, p)).toEqual([])
    // The new building's bag comes after the existing ones in street order, and its step calls out the building.
    const author = book.steps.find((s) => s.bag === 'author')!
    expect(author.parts).toContain('+ building author')
    expect(book.bags.map((b) => b.id)).toContain('author')
  })

  const openStudio = async () => {
    const save = vi.fn(async () => ({ commit: 'abcdef0123', hash: 'h2', changes: [] as BlueprintChange[] }))
    const source = new MockDataSource()
    const s = source as unknown as Record<string, unknown>
    s.getSiteModels = () => Promise.resolve(models())
    s.saveBlueprint = save
    s.reloadSiteModels = async () => undefined
    const el = document.createElement('div')
    document.body.appendChild(el)
    const handle = mountOverlay(el, source)
    cleanup = () => {
      handle.dispose()
      el.remove()
    }
    await flush()
    await flush()
    handle.store.panel.value = 'blueprint'
    await vi.waitFor(() => expect(document.querySelector('[data-checker="ready"]')).toBeTruthy())
    await flush()
    const studio = within(screen.getByRole('region', { name: /Brick Studio/ }))
    fireEvent.click(studio.getByRole('tab', { name: 'Building' }))
    await flush()
    // The first of the site's own buildings: a platform one (🔒) keeps its storeys.
    const own = base.page_types.find((t) => !CORE_TYPES.has(t.id) && (t.slots ?? []).length > 0)!
    fireEvent.click(within(studio.getByRole('navigation', { name: 'Buildings' })).getByRole('button', { name: new RegExp(`^${own.label.en}`) }))
    await flush()
    return { studio, save }
  }

  it('picks a part, lights the places it fits, and builds a new storey where it is dropped; undo takes it back', async () => {
    const { studio, save } = await openStudio()
    const elevation = document.querySelector('[data-elevation]')!
    const type = elevation.getAttribute('data-elevation')!
    const storeys = () => [...document.querySelectorAll(`[data-elevation="${type}"] [data-slot]`)].map((g) => g.getAttribute('data-slot'))
    const before = storeys()
    fireEvent.click(studio.getByRole('button', { name: 'Pick up quote' }))
    await flush()
    expect(studio.getByRole('button', { name: 'Pick up quote' }).getAttribute('aria-pressed')).toBe('true')
    // Targets light up; a lit gap takes it as a new storey at that place.
    const gap = document.querySelector(`[data-drop^="gap:${type}/"].is-ok`)!
    expect(gap).toBeTruthy()
    const at = Number(gap.getAttribute('data-drop')!.split('/').pop())
    fireEvent.click(gap)
    await flush()
    const expected = [...before]
    expected.splice(at, 0, `${type}/quote`)
    expect(storeys()).toEqual(expected)
    expect(document.querySelector(`[data-slot="${type}/quote"]`)!.getAttribute('data-mark')).toBe('added')
    // Put down: nothing is lit any more.
    expect(document.querySelector('[data-drop]')).toBeNull()
    fireEvent.click(studio.getByRole('button', { name: /Undo/ }))
    await flush()
    expect(storeys()).toEqual(before)
    fireEvent.click(studio.getByRole('button', { name: /Redo/ }))
    await flush()
    expect(storeys()).toEqual(expected)

    // Review your build: the booklet, then Build it saves the draft.
    fireEvent.click(studio.getByRole('button', { name: 'Review your build' }))
    await flush()
    const booklet = within(screen.getByRole('dialog', { name: 'Review your build' }))
    expect(booklet.getByRole('list', { name: 'Parts in this step' }).textContent).toContain('+ storey quote')
    fireEvent.click(booklet.getByRole('button', { name: 'Build it' }))
    await flush()
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect((save.mock.calls[0] as unknown as [{ blueprint: Blueprint }])[0].blueprint.page_types.find((t) => t.id === type)!.slots![at].id).toBe('quote')
  })

  it('shows a red seam with the reason where the part does not fit', async () => {
    const { studio } = await openStudio()
    const type = document.querySelector('[data-elevation]')!.getAttribute('data-elevation')!
    const slot = base.page_types.find((t) => t.id === type)!.slots![0]
    // Found through the tray's search: not every part is in the first category.
    fireEvent.input(studio.getByRole('searchbox', { name: 'Find a part' }), { target: { value: slot.blocks[0] } })
    await flush()
    fireEvent.click(studio.getByRole('button', { name: `Pick up ${slot.blocks[0]}` }))
    await flush()
    const target = document.querySelector(`[data-drop="storey:${type}/${slot.id}"]`)!
    expect(target.getAttribute('aria-disabled')).toBe('true')
    expect(target.getAttribute('aria-label')).toContain('not allowed')
    expect(target.querySelector('title')!.textContent).toBe('This storey already has that block.')
  })

  it('locks a platform building: no part can be placed, and it says why', async () => {
    const { studio } = await openStudio()
    fireEvent.click(within(studio.getByRole('navigation', { name: 'Buildings' })).getByRole('button', { name: /^Article/ }))
    await flush()
    expect(studio.getByText(/A platform building/)).toBeTruthy()
    expect((studio.getByRole('button', { name: 'Pick up paragraph' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens a staff proposal from its ticket as a booklet, and Build it approves', async () => {
    const p = proposal()
    const changes = diffBlueprints(api, base, p)
    const sim = liveSim()
    sim.state.inbox.tickets.push(
      liveTicket({ id: 'ticket-95', kind: 'structure-approval', priority: 'high', routedViaSecretary: false, options: ['approve', 'send-back', 'kill', 'defer'], defaultOption: 'defer', workItem: LIVE_ITEM }),
    )
    const plan = {
      items: { [LIVE_ITEM]: { title: 'Structure: Add an author page type', brief: 'Add an author page type.' } },
      posts: { [LIVE_ITEM]: [{ type: 'artifact', author: 'staff-3', text: 'Adds an author page type.', payload: { structure: { kind: 'structure', summary: 'Adds an author page type.', changes, base_hash: 'hash-base', hash: 'h2', revision: 0 } } }] },
    }
    const artifact = JSON.stringify({ structure: { kind: 'structure', summary: 'Adds an author page type.', base_hash: 'hash-base', proposal: p, changes } })
    const c = setupLive(sim, companyStoreOptions(fakeCompanyStore(plan, { artifacts: { [LIVE_ITEM]: artifact } }), { id: 'c1', site_repo: 'swarmpress/site' }))
    cleanup = () => c.cleanup()
    // The site's models as the session would have read them (a signal under its read-only type).
    ;(c.store.siteModels as unknown as { value: SiteModels }).value = models()
    await c.store.refresh()
    c.store.panel.value = 'inbox'
    await flush()
    await flush()
    const t = within(within(screen.getByRole('region', { name: /Inbox/ })).getByRole('article', { name: 'Structure approval' }))
    fireEvent.click(await t.findByRole('button', { name: 'Open the booklet' }))
    await flush()
    await flush()
    const booklet = within(screen.getByRole('dialog', { name: "The architect's building instructions" }))
    expect(booklet.getByText(/of \d+/).textContent).toContain(`of ${changes.length}`)
    expect(booklet.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(expect.arrayContaining(['Defer', 'Kill', 'Send back…', 'Build it']))
    // Step through to the end with the arrow key, then build.
    for (let i = 0; i < changes.length; i++) fireEvent.keyDown(window, { key: 'ArrowRight' })
    await flush()
    fireEvent.click(booklet.getByRole('button', { name: 'Build it' }))
    await flush()
    expect(sim.applied).toEqual(['{"AnswerTicket":{"ticket":"ticket-95","option":"approve"}}'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('has no axe violations: the Town, the Building with a part in hand, and the booklet', async () => {
    const audit = async () =>
      (await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'], iframes: false })).violations.map(
        (v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
      )
    const { studio } = await openStudio()
    fireEvent.click(studio.getByRole('button', { name: 'Pick up quote' }))
    await flush()
    expect(await audit(), 'building, armed').toEqual([])
    fireEvent.click(document.querySelector('[data-drop].is-ok')!)
    await flush()
    fireEvent.click(studio.getByRole('button', { name: 'Review your build' }))
    await flush()
    expect(await audit(), 'booklet').toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Keep building' }))
    fireEvent.click(studio.getByRole('tab', { name: 'Town' }))
    await flush()
    expect(await audit(), 'town').toEqual([])
  })

  it('checks a drop with the same checker the server runs', () => {
    const t = base.page_types.find((x) => (x.slots ?? []).length >= 1)!
    const v = judgeDrop((bp) => checkBlueprint(api, bp, JSON.stringify({ types: mini.types, custom_blocks: [], sections: [], collections: [], tools: [] })), base, { kind: 'storey', type: t.id, slot: t.slots![0].id }, 'no-such-block')
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/no-such-block/)
  })
})
