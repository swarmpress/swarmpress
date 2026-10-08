// @vitest-environment jsdom
// The Factory workbench (FEAT-103, ADR-0077): ports as tools.rs has them, the
// machine catalogue's parts, tubes judged by the site's own tool checker
// (`check_tool`), and building a tool in the Studio: a new tool, machines from
// the tray, tubes from outlets to lit inlets, Save writes the tools on the
// base hash. The real checker is crates/blueprint-wasm/pkg; the tests that
// need it are skipped without it.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fireEvent, screen, within } from '@testing-library/preact'
import axe from 'axe-core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import miniJson from '../../../../../crates/blueprint/tests/fixtures/cinqueterre-mini.blueprint.json'
import type { Blueprint, PutBlueprintBody, PutToolsBody, SiteModels, ToolGraph, ToolNode } from '../../blueprint/types'
import { checkTool, setBlueprintWasm, type BlueprintApi } from '../../blueprint/wasm'
import { MockDataSource } from '../mock-source'
import { mountOverlay } from '../mount'
import { flush } from '../testing'
import { addMachine, connect, disconnect, judgeTube, MACHINE_PARTS, newTool, portsOf, removeMachine, updateMachine } from './machines'

const mini = miniJson as unknown as { blueprint: Blueprint; types: Record<string, unknown> }
const part = (id: string) => MACHINE_PARTS.find((p) => p.id === id)!

describe('the machines', () => {
  it('have the ports tools.rs gives them', () => {
    const n = (x: Partial<ToolNode> & { kind: ToolNode['kind'] }) => ({ id: 'n', ...x }) as ToolNode
    expect(portsOf(n({ kind: 'input', port: 'in' }))).toEqual({ ins: [], outs: ['out'] })
    expect(portsOf(n({ kind: 'connector', connector: 'rss' })).ins).toEqual([{ port: 'params', required: false }])
    expect(portsOf(n({ kind: 'op', op: 'merge' })).ins.map((p) => p.port)).toEqual(['in', 'b'])
    expect(portsOf(n({ kind: 'op', op: 'filter' })).ins.map((p) => p.port)).toEqual(['in', 'param'])
    expect(portsOf(n({ kind: 'condition', test: 'compare' })).outs).toEqual(['yes', 'no'])
    expect(portsOf(n({ kind: 'condition', test: 'switch', cases: ['a', 'b'] })).outs).toEqual(['a', 'b', 'else'])
    expect(portsOf(n({ kind: 'output', port: 'out' }))).toEqual({ ins: [{ port: 'in', required: true }], outs: [] })
  })

  it('places, wires, edits and removes machines; inputs and outputs declare their ports', () => {
    let g = newTool('digest', 'Digest')
    let r = addMachine(g, part('input'))
    g = r.graph
    expect(g.inputs).toEqual({ in: 'Json' })
    r = addMachine(g, part('input'))
    expect(r.graph.inputs).toEqual({ in: 'Json', in2: 'Json' })
    g = addMachine(g, part('rss')).graph
    g = addMachine(g, part('limit')).graph
    g = addMachine(g, part('output')).graph
    expect(g.nodes.map((n) => n.id)).toEqual(['input', 'rss', 'limit', 'output'])
    g = connect(g, 'rss.out', 'limit.in')
    g = connect(g, 'limit.out', 'output.in')
    // An inlet takes one tube: a new one replaces the old.
    g = connect(g, 'input.out', 'limit.in')
    expect(g.edges).toEqual([
      ['limit.out', 'output.in'],
      ['input.out', 'limit.in'],
    ])
    g = updateMachine(g, 'limit', { count: 3 })
    expect(g.nodes.find((n) => n.id === 'limit')).toMatchObject({ op: 'limit', count: 3 })
    g = disconnect(g, 'input.out', 'limit.in')
    g = removeMachine(g, 'limit')
    expect(g.edges).toEqual([])
    expect(g.nodes.map((n) => n.id)).toEqual(['input', 'rss', 'output'])
  })
})

const PKG = resolve(process.cwd(), '../../crates/blueprint-wasm/pkg') + '/'
const built = existsSync(`${PKG}blueprint_wasm.js`)
const CTX = JSON.stringify({ types: mini.types, custom_blocks: [], sections: [], collections: [], tools: [] })

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe.skipIf(!built)('on the real tool checker', () => {
  let api: BlueprintApi
  beforeAll(async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}blueprint_wasm.js`).href)) as BlueprintApi & { initSync(m: { module: BufferSource }): unknown }
    mod.initSync({ module: readFileSync(`${PKG}blueprint_wasm_bg.wasm`) })
    api = mod
    setBlueprintWasm(mod)
  })
  const check = (g: ToolGraph) => checkTool(api, g, CTX)

  /** feed → limit → output: the smallest useful machine. */
  const digest = (): ToolGraph => {
    let g = newTool('digest', 'Digest')
    g = addMachine(g, part('rss')).graph
    g = addMachine(g, part('limit')).graph
    g = addMachine(g, part('output')).graph
    g = connect(g, 'rss.out', 'limit.in')
    return connect(g, 'limit.out', 'output.in')
  }

  it('builds a working tool from the tray’s defaults', () => {
    expect(check(digest())).toEqual([])
  })

  it('every fetching and shaping part checks once wired between a feed and an output', () => {
    for (const id of ['pick', 'map', 'filter', 'sort', 'limit', 'format', 'agent', 'compare', 'exists', 'switch', 'merge']) {
      let g = newTool('t', 'T')
      g = addMachine(g, part('rss')).graph
      const r = addMachine(g, part(id))
      g = addMachine(r.graph, part('output')).graph
      const node = g.nodes.find((n) => n.id === r.id)!
      g = connect(g, 'rss.out', `${r.id}.in`)
      if (id === 'merge') g = connect(g, 'rss.out', `${r.id}.b`)
      g = connect(g, `${r.id}.${portsOf(node).outs[0]}`, 'output.in')
      const issues = check(g)
      // A part from the tray is complete as placed (no missing setting, no unknown kind); a path that does
      // not fit what flows in is the wiring's business: the inspector sets it, the red seam says so.
      expect(issues.filter((i) => i.code !== 'type-mismatch'), `${id}: ${JSON.stringify(issues)}`).toEqual([])
    }
  })

  it('every fetching part checks on its own into an output', () => {
    for (const id of ['http-get', 'rss', 'web-search', 'knowledge']) {
      let g = newTool('t', 'T')
      const r = addMachine(g, part(id))
      g = addMachine(r.graph, part('output')).graph
      g = connect(g, `${r.id}.out`, 'output.in')
      const issues = check(g)
      expect(issues.filter((i) => i.code !== 'type-mismatch'), `${id}: ${JSON.stringify(issues)}`).toEqual([])
    }
  })

  it("judges a tube with the checker's reason", () => {
    let g = newTool('t', 'T')
    g = addMachine(g, part('rss')).graph
    g = addMachine(g, part('output')).graph
    expect(judgeTube(check, g, 'rss.out', 'rss.params')).toMatchObject({ ok: false, reason: 'A machine cannot feed itself.' })
    const ok = judgeTube(check, g, 'rss.out', 'output.in')
    expect(ok.ok).toBe(true)
    expect(judgeTube(check, ok.next!, 'rss.out', 'output.in')).toMatchObject({ ok: false, reason: 'This tube is already there.' })
  })

  const models = (): SiteModels => ({
    commit: 'c0ffee1234567',
    source: 'repo',
    hash: 'hash-base',
    blueprint: mini.blueprint,
    types: mini.types,
    issues: [],
    tools: [],
    tool_errors: [],
    context: { custom_blocks: [], sections: [], collections: [] },
    town: {},
  })

  it('builds a tool in the Factory and saves it on the base hash', async () => {
    const save = vi.fn(async (_b: PutBlueprintBody | PutToolsBody) => ({ commit: 'abcdef0123', hash: 'h2', changes: [] }))
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
    const studio = within(screen.getByRole('region', { name: /Brick Studio/ }))
    fireEvent.click(studio.getByRole('tab', { name: 'Factory' }))
    await flush()
    expect(studio.getByRole('tab', { name: 'Workbench' }).getAttribute('aria-selected')).toBe('true')

    // A new tool, then three machines from the tray.
    fireEvent.input(studio.getByRole('textbox', { name: 'New tool' }), { target: { value: 'Digest' } })
    fireEvent.click(studio.getByRole('button', { name: 'Add tool' }))
    await flush()
    for (const label of ['Feed', 'Limit', 'Output']) {
      fireEvent.click(studio.getByRole('button', { name: `Place ${label}` }))
      await flush()
    }
    expect([...document.querySelectorAll('[data-node]')].map((n) => n.getAttribute('data-node'))).toEqual(['limit', 'output', 'rss'])

    // A tube: pick the feed's outlet; the limit's inlet lights green, the feed's own inlet stays red.
    fireEvent.click(document.querySelector('[data-outlet="rss.out"]')!)
    await flush()
    expect(document.querySelector('[data-inlet="limit.in"]')!.getAttribute('class')).toContain('is-ok')
    expect(document.querySelector('[data-inlet="rss.params"]')!.getAttribute('class')).toContain('is-no')
    fireEvent.click(document.querySelector('[data-inlet="limit.in"]')!)
    await flush()
    fireEvent.click(document.querySelector('[data-outlet="limit.out"]')!)
    await flush()
    fireEvent.click(document.querySelector('[data-inlet="output.in"]')!)
    await flush()
    expect([...document.querySelectorAll('[data-edge]')].map((e) => e.getAttribute('data-edge')).sort()).toEqual(['limit.out>output.in', 'rss.out>limit.in'])
    expect(studio.getByText('none')).toBeTruthy()

    // Undo takes the last tube back; redo returns it.
    fireEvent.click(studio.getByRole('button', { name: /Undo/ }))
    await flush()
    expect(document.querySelectorAll('[data-edge]')).toHaveLength(1)
    fireEvent.click(studio.getByRole('button', { name: /Redo/ }))
    await flush()

    // Accessible, with a tube in hand and with a machine selected.
    const audit = async () =>
      (await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'], iframes: false })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
    fireEvent.click(document.querySelector('[data-outlet="rss.out"]')!)
    await flush()
    expect(await audit(), 'tube in hand').toEqual([])
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(studio.getByRole('button', { name: /^Machine limit/ }))
    await flush()
    expect(studio.getByRole('complementary', { name: 'Machine limit' })).toBeTruthy()
    expect(await audit(), 'machine selected').toEqual([])

    fireEvent.click(studio.getByRole('button', { name: 'Save tools' }))
    await flush()
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    const body = save.mock.calls[0][0] as PutToolsBody
    expect(body.base_hash).toBe('hash-base')
    expect(Object.keys(body.tools)).toEqual(['digest'])
    expect(body.tools.digest.edges).toHaveLength(2)
    expect(handle.store.toast.value).toMatchObject({ tone: 'ok', text: 'Built: 1 tool saved (commit abcdef0)' })
  })
})
