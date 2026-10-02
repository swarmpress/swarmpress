import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { blocksDoc } from '../../src/blocks-doc'
import { formatCheckReport, runCheck } from '../../src/check'
import { main } from '../../src/cli'
import { loadSite } from '../../src/content/load'
import { loadManifest } from '../../src/manifest/load'
import { BROKEN_SITE, FIXTURE_SITE, HAS_REAL_CONTENT, REAL_CONTENT } from '../helpers'

const tmps: string[] = []
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('kit check', () => {
  it('passes on the starter fixture site (theme lint of the starter included)', () => {
    const r = runCheck({ root: FIXTURE_SITE })
    expect(r.baseline.newErrors, formatCheckReport(r)).toEqual([])
    expect(r.ok).toBe(true)
    expect(Object.values(r.coverage)).not.toContain('missing')
    expect(r.coverage['editorial-hero']).toBe('theme')
    expect(r.coverage['x:key-facts']).toBe('custom')
    expect(r.stats.pages).toBeGreaterThan(0)
    expect(r.findings.filter((f) => f.file.startsWith('..') && f.severity === 'error')).toEqual([])
  })

  it('fails on the broken fixture with actionable messages', () => {
    const r = runCheck({ root: BROKEN_SITE })
    expect(r.ok).toBe(false)
    const byCode = new Map(r.baseline.newErrors.map((f) => [f.code, f]))
    for (const code of [
      'schema',
      'unknown_media',
      'unregistered_custom_block',
      'missing_renderer',
      'forbidden_import',
      'remote_script',
      'remote_font',
      'third_party_tracker',
      'hardcoded_locale',
      'hardcoded_region',
    ]) {
      expect(byCode.has(code), `expected a ${code} error`).toBe(true)
    }
    const text = formatCheckReport(r, { verbose: true })
    expect(text).toMatch(/heading: must be one of: 2, 3, 4/)
    expect(text).toMatch(/localized object is missing "en"/)
    expect(text).toMatch(/"media:does-not-exist" is not in content\/config\/media-index.json/)
    expect(text).toMatch(/theme\/blocks\/heading.astro L2:1 \[forbidden_import\]/)
    expect(text).toMatch(/MISSING: x:mystery/)
    expect(text).toMatch(/kit check: FAILED/)
    // Broken links are warnings unless --strict.
    expect(r.findings.find((f) => f.code === 'broken_link')?.severity).toBe('warning')
    expect(runCheck({ root: BROKEN_SITE, strict: true }).baseline.newErrors.some((f) => f.code === 'broken_link')).toBe(true)
  })

  it('ratchets with a baseline: existing errors tolerated, new ones fail, fixed ones reported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-check-'))
    tmps.push(dir)
    cpSync(BROKEN_SITE, dir, { recursive: true })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await main(['check', '--root', dir])).toBe(1)
    expect(await main(['check', '--root', dir, '--write-baseline', 'kit-baseline.json'])).toBe(0)
    expect(await main(['check', '--root', dir, '--baseline', 'kit-baseline.json'])).toBe(0)

    // A new violation fails despite the baseline.
    const pagePath = join(dir, 'content/pages/index.json')
    const page = JSON.parse(readFileSync(pagePath, 'utf8'))
    page.body.push({ type: 'quote' })
    writeFileSync(pagePath, JSON.stringify(page))
    const withNew = runCheck({ root: dir, baseline: 'kit-baseline.json' })
    expect(withNew.ok).toBe(false)
    expect(withNew.baseline.newErrors.map((f) => f.path)).toEqual(['/body/5'])

    // Fixing a baselined error shows up as "fixed".
    page.body.pop()
    page.body[0].level = 2
    writeFileSync(pagePath, JSON.stringify(page))
    const fixed = runCheck({ root: dir, baseline: 'kit-baseline.json' })
    expect(fixed.ok).toBe(true)
    expect(fixed.baseline.fixed).toEqual(['content/pages/index.json#/body/0/level:schema'])
    log.mockRestore()
  })

  it('the path guard rejects theme PRs that touch content or workflows', () => {
    const r = runCheck({ root: FIXTURE_SITE, changedFiles: ['../blocks/paragraph.astro', 'content/pages/index.json'], themeDir: '..' })
    expect(r.baseline.newErrors.map((f) => f.code)).toEqual(['path_guard'])
  })

  it.skipIf(!HAS_REAL_CONTENT)('reports schema drift on the full cinqueterre.travel content (inferred manifest)', () => {
    // Read-only: the site repo is checked in place, never modified.
    const r = runCheck({ root: dirname(REAL_CONTENT), contentDir: basename(REAL_CONTENT), infer: true, skipLint: true })
    expect(r.manifest?.source).toBe('inferred')
    expect(r.stats.pages).toBeGreaterThan(100)
    expect(r.ok).toBe(false) // known drift; a site migrates with `kit migrate` + a baseline
    expect(r.findings.some((f) => f.code === 'schema')).toBe(true)
  })
})

describe('kit blocks-doc', () => {
  it('documents core blocks and the theme custom blocks from their schemas', () => {
    const m = loadManifest(FIXTURE_SITE)
    const site = loadSite({ root: FIXTURE_SITE, manifest: m.manifest })
    const md = blocksDoc(site.customBlocks, { title: 'Fixture blocks' })
    expect(md).toMatch(/^# Fixture blocks/)
    expect(md).toMatch(/`editorial-hero`/)
    expect(md).toMatch(/`x:key-facts`/)
    expect(md).toMatch(/\| Field \| Type \| Required \| Notes \|/)
  })
})

describe('kit CLI', () => {
  it('prints help and rejects unknown commands', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await main([])).toBe(0)
    expect(await main(['bogus'])).toBe(2)
    expect(await main(['migrate', 'v0..v1'])).toBe(2)
    log.mockRestore()
    err.mockRestore()
  })
})
