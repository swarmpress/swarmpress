import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadSite } from '../../src/content/load'
import { createRenderContext } from '../../src/context'
import { loadManifest } from '../../src/manifest/load'
import { planRoutes } from '../../src/routes/plan'
import { FIXTURE_SITE } from '../helpers'

// Build-time bindings (FEAT-092, ADR-0072): a tool's output, committed by the
// platform to content/data/<tool>/<key>.json, is site data a block reads with
// `toolData(tool)`: the page's own key first, then `latest`.
const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

function site() {
  const root = mkdtempSync(join(tmpdir(), 'kit-data-'))
  dirs.push(root)
  cpSync(FIXTURE_SITE, root, { recursive: true })
  mkdirSync(join(root, 'content/data/ferry-times'), { recursive: true })
  writeFileSync(join(root, 'content/data/ferry-times/riomaggiore.json'), JSON.stringify([{ time: '09:15', to: 'Monterosso' }]))
  writeFileSync(join(root, 'content/data/ferry-times/latest.json'), JSON.stringify([{ time: '07:00', to: 'Portovenere' }]))
  writeFileSync(join(root, 'content/data/stray.json'), '{}')
  const m = loadManifest(root)
  return loadSite({ root, manifest: m.manifest })
}

describe('tool data', () => {
  it('loads content/data/<tool>/<key>.json and flags files elsewhere', () => {
    const s = site()
    expect([...s.data.keys()].sort()).toEqual(['ferry-times/latest', 'ferry-times/riomaggiore'])
    expect(s.findings.some((f) => f.code === 'data_path' && f.file.endsWith('content/data/stray.json'))).toBe(true)
  })

  it('gives a page its own key first, then latest', () => {
    const s = site()
    const plan = planRoutes(s)
    const at = (file: string) => plan.entries.find((e) => e.page?.file.endsWith(file))!
    const rio = createRenderContext({ site: s, plan, entry: at('pages/riomaggiore.json'), year: 2026 })
    expect(rio.toolData('ferry-times')).toEqual([{ time: '09:15', to: 'Monterosso' }])
    const home = createRenderContext({ site: s, plan, entry: at('pages/index.json'), year: 2026 })
    expect(home.toolData('ferry-times')).toEqual([{ time: '07:00', to: 'Portovenere' }])
    expect(home.toolData('ferry-times', 'riomaggiore')).toEqual([{ time: '09:15', to: 'Monterosso' }])
    expect(home.toolData('tides')).toBeUndefined()
  })
})
