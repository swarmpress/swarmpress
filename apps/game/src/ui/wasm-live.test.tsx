// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { screen, within } from '@testing-library/preact'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cmd, toJson } from './commands'
import { mountOverlay } from './mount'
import { flush } from './testing'
import { hasOrgApi, WasmDataSource, type SimOrgApi } from './wasm-source'

/**
 * The overlay over the real wasm sim (`Sim.demo`, the cinqueterre company),
 * read through `WasmDataSource`. Needs `cargo xtask wasm`; skipped without
 * crates/client-wasm/pkg.
 */
// vitest runs with apps/game as the working directory.
const PKG = resolve(process.cwd(), '../../crates/client-wasm/pkg') + '/'
const built = existsSync(`${PKG}client_wasm.js`)

type WasmModule = {
  initSync(m: { module: BufferSource }): unknown
  Sim: { demo(seed: bigint): SimOrgApi & { advance(n: number): void; steps_per_day(): bigint; free(): void } }
}
let wasm: WasmModule

describe.skipIf(!built)('WasmDataSource over the real sim', () => {
  beforeAll(async () => {
    wasm = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}client_wasm.js`).href)) as WasmModule
    wasm.initSync({ module: readFileSync(`${PKG}client_wasm_bg.wasm`) })
  })
  let dispose: (() => void) | null = null
  afterEach(() => {
    dispose?.()
    dispose = null
  })
  const demo = () => {
    const sim = wasm.Sim.demo(42n)
    sim.advance(Number(sim.steps_per_day()) / 2)
    return sim
  }

  it('exposes the organization API and every staff persona is in the catalog', async () => {
    const sim = demo()
    expect(hasOrgApi(sim)).toBe(true)
    const s = new WasmDataSource(sim)
    const org = await s.getOrg()
    expect(org.executive).toMatchObject({ cfo: expect.any(String), secretary: expect.any(String) })
    expect(org.staff.length).toBeGreaterThanOrEqual(12)
    for (const st of org.staff) expect(await s.getPersona(st.persona), st.persona).toBeDefined()
    const f = await s.getFinance()
    expect(typeof f.cashEur).toBe('number')
    expect(Array.isArray((await s.getInbox()).tickets)).toBe(true)
    expect(Array.isArray((await s.getPlan()).items)).toBe(true)
  })

  it('applies and rejects commands with the sim reasons', async () => {
    const s = new WasmDataSource(demo())
    expect(await s.validate(toJson(cmd.praise('staff-1')))).toEqual({ ok: true })
    expect(await s.apply(toJson(cmd.praise('staff-1')))).toEqual({ ok: true })
    const over = await s.validate(toJson(cmd.assign('staff-1', 'project-1', 150)))
    expect(over.ok).toBe(false)
    expect(over.reason).toBeTruthy()
    expect(await s.validate(toJson(cmd.setDelegation('low-and-medium')))).toEqual({ ok: true })
    expect(await s.validate(toJson(cmd.createProject({ name: 'Amalfi Dispatch', slug: 'amalfi-dispatch', domain: 'amalfi.travel' })))).toBeDefined()
    // Plan commands are not in the sim yet: rejected loudly, never silently accepted.
    const plan = await s.validate(toJson(cmd.assignPhase('work-item-1', 0, 'staff-1')))
    expect(plan).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown variant `AssignPhase`/) })
  })

  it('renders the org chart, finance and inbox from the sim', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const h = mountOverlay(el, new WasmDataSource(demo()))
    dispose = () => {
      h.dispose()
      el.remove()
    }
    await h.store.refresh()
    for (const id of ['org', 'finance', 'inbox', 'projects', 'plan'] as const) {
      h.store.panel.value = id
      await flush()
      expect(document.getElementById(`panel-${id}`), id).toBeTruthy()
      expect(document.body.textContent).not.toContain('Loading…')
    }
    h.store.panel.value = 'org'
    await flush()
    const giulia = h.store.persona('giulia')!.name
    expect(within(screen.getByRole('region', { name: /Org chart/ })).getByRole('button', { name: new RegExp(giulia) })).toBeTruthy()
  })
})
