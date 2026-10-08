// @vitest-environment jsdom
// Importing an n8n workflow on the Tools tab (FEAT-096, ADR-0076): the
// preview shows how each node was taken, the manifest the real Rust checker
// derives (blueprint-wasm; skipped without it) and its issues; Install writes
// the tool with the base hash; a sealed step keeps Install disabled. The
// credentials panel lists what the tools sign in with.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fireEvent, render, screen, cleanup } from '@testing-library/preact'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import leadWf from '../../../../../packages/toolgraph/test/fixtures/n8n/lead-intake.json'
import sealedWf from '../../../../../packages/toolgraph/test/fixtures/n8n/sealed-mix.json'
import leadTool from '../../../../../crates/blueprint/tests/fixtures/n8n/lead-intake.json'
import type { SiteModels, ToolGraph } from '../../blueprint/types'
import { contextOf, setBlueprintWasm, type BlueprintApi } from '../../blueprint/wasm'
import { browserCredentials } from '../../tools/credentials'
import { MockDataSource } from '../mock-source'
import { createOverlayStore, StoreContext } from '../store'
import { flush } from '../testing'
import { CredentialsPanel, credentialsNeeded } from './Credentials'
import { N8nImportPanel, parseN8nExport } from './N8nImport'

const models = (tools: SiteModels['tools'] = []): SiteModels => ({
  commit: 'c0ffee',
  source: 'repo',
  hash: 'hash-base',
  blueprint: { format: 'swarmpress.blueprint.v1', page_types: [] },
  types: {},
  issues: [],
  tools,
  tool_errors: [],
  context: { custom_blocks: [], sections: [], collections: [] },
  town: {},
})

afterEach(() => cleanup())

describe('n8n exports', () => {
  it('reads a workflow, or a template wrapping one, and refuses anything else', () => {
    expect(parseN8nExport(JSON.stringify(leadWf)).name).toBe('Lead intake')
    expect(parseN8nExport(JSON.stringify({ id: 1, workflow: leadWf })).nodes).toHaveLength(9)
    expect(() => parseN8nExport('{"nodes": 1}')).toThrow('not an n8n workflow')
    expect(() => parseN8nExport('nope')).toThrow('not JSON')
  })

  it('lists the credentials the tools sign in with, set or missing', () => {
    const graph = JSON.parse(JSON.stringify((leadTool as unknown as { graph: ToolGraph }).graph)) as ToolGraph
    ;(graph.nodes.find((n) => n.id === 'lookup-company') as Record<string, unknown>).credential = 'crm'
    const m = models([{ id: 'lead-intake', hash: 'h', graph, issues: [], manifest: {} }])
    expect([...credentialsNeeded(m)]).toEqual([['crm', ['lead-intake']]])
    const store = browserCredentials(null)
    render(<CredentialsPanel models={m} store={store} />)
    expect(document.querySelector('[data-credential="crm"]')!.textContent).toContain('missing')
    fireEvent.click(screen.getByText('Set up'))
    fireEvent.input(screen.getByPlaceholderText('Header name (X-Api-Key)'), { target: { value: 'X-Crm-Key' } })
    fireEvent.input(screen.getByPlaceholderText('Secret'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByText('Save in this browser'))
    expect(store.get('crm')).toEqual({ kind: 'header', name: 'X-Crm-Key', value: 's3cret' })
    expect(document.querySelector('[data-credential="crm"]')!.textContent).toContain('set')
    expect(document.body.textContent).not.toContain('s3cret')
  })
})

const PKG = resolve(process.cwd(), '../../crates/blueprint-wasm/pkg') + '/'
const built = existsSync(`${PKG}blueprint_wasm.js`)

describe.skipIf(!built)('the n8n import on the real checker (blueprint-wasm)', () => {
  let api: BlueprintApi
  beforeAll(async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}blueprint_wasm.js`).href)) as BlueprintApi & { initSync(m: { module: BufferSource }): unknown }
    mod.initSync({ module: readFileSync(`${PKG}blueprint_wasm_bg.wasm`) })
    setBlueprintWasm(mod)
    api = mod
  })

  const mount = (save?: (b: unknown) => Promise<unknown>) => {
    const source = new MockDataSource()
    const s = source as unknown as Record<string, unknown>
    if (save) s.saveBlueprint = save
    s.reloadSiteModels = () => Promise.resolve()
    const store = createOverlayStore(source)
    const m = models()
    render(
      <StoreContext.Provider value={store}>
        <N8nImportPanel models={m} api={api} ctx={contextOf(m)} />
      </StoreContext.Provider>,
    )
  }
  const paste = (wf: unknown) => fireEvent.change(screen.getByLabelText('n8n workflow JSON'), { target: { value: JSON.stringify(wf) } })

  it('previews the mapping and the derived manifest, then installs the tool', async () => {
    const save = vi.fn(async (_body: unknown) => ({ commit: 'c1', hash: 'h1', changes: [], tools: ['lead-intake'] }))
    mount(save)
    paste(leadWf)
    const preview = document.querySelector('[data-n8n-preview="lead-intake"]')!
    expect([...preview.querySelectorAll('.bp-n8n-map li')].map((li) => li.getAttribute('data-as'))).toEqual(['input', 'n8n', 'n8n', 'n8n', 'n8n', 'n8n', 'n8n', 'n8n'])
    expect(preview.textContent).toContain('code')
    expect(preview.textContent).toContain('from https://api.example-crm.com')
    const button = screen.getByText('Install lead-intake') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    const body = save.mock.calls[0][0] as unknown as { base_hash: string; tools: Record<string, ToolGraph> }
    expect(body.base_hash).toBe('hash-base')
    expect(Object.keys(body.tools)).toEqual(['lead-intake'])
    expect(body.tools['lead-intake'].nodes.some((n) => n.kind === 'n8n')).toBe(true)
  })

  it('a sealed step keeps Install disabled, with its reasons', () => {
    mount(async () => ({}))
    paste(sealedWf)
    const preview = document.querySelector('[data-n8n-preview="sealed-mix"]')!
    expect(preview.textContent).toContain('JavaScript only')
    expect(preview.textContent).toContain('n8n-nodes-base.slack has no swarm.press equivalent')
    expect((screen.getByText('Install sealed-mix') as HTMLButtonElement).disabled).toBe(true)
  })
})
