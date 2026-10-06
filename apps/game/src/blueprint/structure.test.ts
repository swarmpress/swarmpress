import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import miniJson from '../../../../crates/blueprint/tests/fixtures/cinqueterre-mini.blueprint.json'
import ferryJson from '../../../../crates/blueprint/tests/fixtures/site/blueprint/tools/ferry-times.tool.json'
import { standupAnswer } from '../llm/mvp-script'
import { commission, commissionCommand, newBriefRef, structureBrief } from './commission'
import { blueprintCommand, blueprintDigest, toolsCommand, toolStubs, type HeldStructure } from './digest'
import type { Blueprint, SiteModels, ToolGraph } from './types'

/**
 * The architects' host side (FEAT-095): the request as a brief and its ref in
 * `Commission`; the site's models as digests (`BlueprintChanged`,
 * `ToolsChanged`) only when the sim holds others; the fake model's answers,
 * the twins of `agents::fake_writer`'s. With `crates/client-wasm/pkg` the
 * commands are applied to the real sim.
 */
const mini = miniJson as unknown as { blueprint: Blueprint; types: Record<string, unknown> }
const ferry = ferryJson as unknown as ToolGraph
const HASH = '0123456789abcdef'.repeat(4)
const TOOL_HASH = 'a1b2c3d4e5f6' + '0'.repeat(52)

const models = (over: Partial<SiteModels> = {}): SiteModels => ({
  commit: 'c0ffee',
  source: 'repo',
  hash: HASH,
  blueprint: mini.blueprint,
  types: mini.types,
  issues: [],
  tools: [{ id: 'ferry-times', hash: TOOL_HASH, graph: ferry, issues: [], manifest: {} }],
  tool_errors: [],
  context: { custom_blocks: [], sections: [], collections: [] },
  town: {},
  ...over,
})

describe('the models as digests', () => {
  it('BlueprintChanged carries the hash bytes and the counts; nothing when the sim holds them', () => {
    const d = blueprintDigest(models())
    expect(d.hash).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef])
    expect(d.page_types).toBe(mini.blueprint.page_types.length)
    expect(d.slots).toBe(mini.blueprint.page_types.reduce((n, t) => n + (t.slots?.length ?? 0), 0))
    expect(JSON.parse(blueprintCommand(models(), null)!)).toEqual({ BlueprintChanged: d })
    const held: HeldStructure = { model: { hash: HASH.slice(0, 32), pageTypes: d.page_types, slots: d.slots, issues: 0 } }
    expect(blueprintCommand(models(), held)).toBeNull()
    expect(blueprintCommand(models({ issues: [{ code: 'bad-id', path: '/', message: 'x' }] }), held)).not.toBeNull()
  })

  it('ToolsChanged: 6 bytes of the hash, the schedule, the agent step role; broken tools left out', () => {
    expect(toolStubs(models())).toEqual([{ tool_ref: 0xa1b2c3d4e5f6, schedule_days: 1, role: null }])
    const agent: ToolGraph = { ...ferry, id: 'teaser', triggers: [{ kind: 'schedule', every_game_days: 90 }], nodes: [...ferry.nodes, { id: 'say', kind: 'agent', role: 'writer' }] }
    const broken = { id: 'broken', hash: 'ff'.repeat(32), graph: ferry, issues: [{ code: 'bad-graph', path: '/', message: 'x' }], manifest: {} }
    const m = models({ tools: [...models().tools, { id: 'teaser', hash: '00000000000a' + '0'.repeat(52), graph: agent, issues: [], manifest: {} }, broken] })
    expect(toolStubs(m)).toEqual([
      { tool_ref: 10, schedule_days: 28, role: 'writer' },
      { tool_ref: 0xa1b2c3d4e5f6, schedule_days: 1, role: null },
    ])
    const held: HeldStructure = { tools: [{ toolRef: 0xa1b2c3d4e5f6, scheduleDays: 1, role: null }] }
    expect(toolsCommand(models(), held)).toBeNull()
    expect(JSON.parse(toolsCommand(m, held)!).ToolsChanged.tools).toHaveLength(2)
    expect(JSON.parse(toolsCommand(models({ tools: [] }), held)!)).toEqual({ ToolsChanged: { tools: [] } })
  })
})

describe('commissioning', () => {
  it('stores the brief first, then logs the command with its ref', async () => {
    const order: string[] = []
    const deps = {
      validate: vi.fn(() => undefined),
      apply: vi.fn((json: string) => (order.push(`apply ${json}`), { ok: true })),
      putBrief: vi.fn(async (ref: string, record: string) => void order.push(`brief ${ref} ${JSON.parse(record).kind}`)),
    }
    const r = await commission(deps, 'project-1', 'structure', '  Add an author page type\nand link articles.  ', 4242)
    expect(r.ok).toBe(true)
    expect(order).toEqual(['brief 4242 structure', `apply {"Commission":{"project":"project-1","kind":"Structure","brief_ref":4242}}`])
    const brief = JSON.parse(deps.putBrief.mock.calls[0][1])
    expect(brief.brief.angle).toBe('Add an author page type\nand link articles.')
    expect(brief.brief.title).toBe('Add an author page type')
    expect(brief).toEqual(structureBrief('structure', 'Add an author page type\nand link articles.'))
  })

  it('refuses before storing anything when the sim would', async () => {
    const deps = { validate: () => 'the project has as many open structure, tool and theme items as it may', apply: vi.fn(), putBrief: vi.fn() }
    expect(await commission(deps, 'project-1', 'tool', 'Ferries')).toEqual({ ok: false, reason: 'the project has as many open structure, tool and theme items as it may' })
    expect(await commission(deps, 'project-1', 'tool', '   ')).toMatchObject({ ok: false })
    expect(deps.putBrief).not.toHaveBeenCalled()
    expect(deps.apply).not.toHaveBeenCalled()
  })

  it('brief refs are exact JS numbers', () => {
    const r = newBriefRef(() => new Uint32Array([0xffffffff, 0xffffffff]))
    expect(Number.isSafeInteger(r)).toBe(true)
    expect(r).toBeGreaterThan(0)
    expect(newBriefRef(() => new Uint32Array([0, 0]))).toBe(1)
    expect(commissionCommand('project-1', 'tool', r)).toBe(`{"Commission":{"project":"project-1","kind":"Tool","brief_ref":${r}}}`)
  })
})

describe("the fake model's architects (agents::fake_writer twins)", () => {
  const prompt = (task: string, body: string) => `## Task: ${task}\n\n## Request\nx\n\n${body}`

  it('proposes an author page type, under a free id, from the articles', () => {
    const r = standupAnswer(prompt('site architect', '## Blueprint\nPage types:\n- blog-article «Article» /{lang}/blog/{slug}\n- author «Author» /a\n'))
    const v = (r as { json: { edits: { op: string; id?: string; from?: string; to?: string }[] } }).json
    expect(v.edits[0]).toMatchObject({ op: 'add-page-type', id: 'author-2' })
    expect(v.edits[1]).toMatchObject({ op: 'add-relationship', from: 'blog-article', to: 'author-2' })
  })

  it('builds the ferry tool with the ferry types, else a tool of built-in types', () => {
    const withTypes = standupAnswer(prompt('tool build', '## Site types\n- FerryDeparture: {}\n- FerryRow: {}\n- FerryTimetable: {}\n'))
    expect((withTypes as { json: { graph: ToolGraph } }).json.graph).toEqual(ferry)
    const without = standupAnswer(prompt('tool build', '## Site types\n- none\n'))
    expect((without as { json: { graph: ToolGraph } }).json.graph.id).toBe('latest-pages')
  })
})

const PKG = resolve(process.cwd(), '../../crates/client-wasm/pkg') + '/'
const built = existsSync(`${PKG}client_wasm.js`)
type WasmSim = { apply_command_json(json: string): void; validate_command_json(json: string): string | undefined; plan_json(): string; org_json(): string; free(): void }

describe.skipIf(!built)('on the real sim (client-wasm)', () => {
  let Sim: { demo(seed: bigint): WasmSim }
  beforeAll(async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}client_wasm.js`).href)) as { initSync(m: { module: BufferSource }): unknown; Sim: typeof Sim }
    mod.initSync({ module: readFileSync(`${PKG}client_wasm_bg.wasm`) })
    Sim = mod.Sim
  })

  it('takes the digests once and the commission with its exact ref', async () => {
    const sim = Sim.demo(7n)
    const held = () => (JSON.parse(sim.plan_json()) as { structure: HeldStructure }).structure
    for (const cmd of [blueprintCommand(models(), held()), toolsCommand(models(), held())]) sim.apply_command_json(cmd!)
    // The sim now holds them: nothing more to log.
    expect(blueprintCommand(models(), held())).toBeNull()
    expect(toolsCommand(models(), held())).toBeNull()
    expect(held().tools).toEqual([expect.objectContaining({ toolRef: 0xa1b2c3d4e5f6, scheduleDays: 1, role: null })])

    const project = (JSON.parse(sim.org_json()) as { projects: { id: string; status: string }[] }).projects.find((p) => p.status === 'active')!.id
    const ref = newBriefRef()
    const r = await commission(
      { validate: (j) => sim.validate_command_json(j), apply: (j) => (sim.apply_command_json(j), { ok: true }), putBrief: async () => undefined },
      project,
      'structure',
      'Add an author page type',
      ref,
    )
    // The demo office may have nobody for structure work; either way the sim decided, and a taken ref is exact.
    if (r.ok) {
      const items = (JSON.parse(sim.plan_json()) as { items: { kind: string; briefRefText: string | null }[] }).items
      expect(items.find((i) => i.kind === 'structure')?.briefRefText).toBe(String(ref))
    } else expect(r.reason).toMatch(/hire|project|structure/)
    sim.free()
  })
})
