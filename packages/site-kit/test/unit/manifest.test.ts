import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inferManifest } from '../../src/manifest/infer'
import { loadManifest } from '../../src/manifest/load'
import { parseManifest, SiteManifestSchema } from '../../src/manifest/schema'
import { FIXTURE_SITE, HAS_REAL_CONTENT, KIT_ROOT, MINI_CONTENT, REAL_CONTENT } from '../helpers'

const minimal = {
  schemaVersion: 1,
  siteId: 'demo',
  baseUrl: 'https://demo.test',
  languages: ['en', 'de'],
  defaultLanguage: 'en',
  brand: { name: 'Demo' },
}

describe('site.manifest.json schema', () => {
  it('accepts a minimal manifest and fills defaults', () => {
    const m = SiteManifestSchema.parse(minimal)
    expect(m.base).toBe('/')
    expect(m.sections).toEqual([])
    expect(m.collections).toEqual([])
    expect(m.screenshotPages).toEqual(['/'])
    expect(m.themeDir).toBe('theme')
  })

  it('accepts the starter fixture manifest', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURE_SITE, 'site.manifest.json'), 'utf8'))
    const r = parseManifest(raw)
    expect(r.ok, JSON.stringify(r)).toBe(true)
  })

  it('rejects a default language that is not declared', () => {
    const r = parseManifest({ ...minimal, defaultLanguage: 'fr' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.map((i) => i.message).join('\n')).toMatch(/defaultLanguage "fr" is not in languages/)
  })

  it('rejects region slugs that collide with languages, duplicates and unknown section collections', () => {
    const r = parseManifest({
      ...minimal,
      regions: { label: 'Towns', items: [{ slug: 'de', name: 'De', order: 1 }, { slug: 'x', name: 'X', order: 2 }, { slug: 'x', name: 'X2', order: 3 }] },
      sections: [{ slug: 'shops', label: 'Shops', collection: 'shops', perRegion: true }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const msg = r.issues.map((i) => i.message).join('\n')
      expect(msg).toMatch(/collides with a language code/)
      expect(msg).toMatch(/duplicate region "x"/)
      expect(msg).toMatch(/unknown collection "shops"/)
    }
  })

  it('rejects unknown keys, bad media refs and localized values without en', () => {
    expect(parseManifest({ ...minimal, extra: 1 }).ok).toBe(false)
    expect(parseManifest({ ...minimal, brand: { name: 'D', logo: 'logo.png' } }).ok).toBe(false)
    expect(parseManifest({ ...minimal, brand: { name: 'D', logo: 'media:logo-1' } }).ok).toBe(true)
    expect(parseManifest({ ...minimal, brand: { name: 'D', tagline: { de: 'nur deutsch' } } }).ok).toBe(false)
  })

  it('the committed JSON Schema export is in sync with the Zod schema', async () => {
    const committed = readFileSync(join(KIT_ROOT, 'schema/site-manifest.schema.json'), 'utf8')
    const { manifestJsonSchema } = await import('../../scripts/export-manifest-schema')
    expect(manifestJsonSchema()).toBe(committed)
  })

  it('loadManifest reports a missing manifest with a hint, and infers on request', () => {
    expect(() => loadManifest(join(MINI_CONTENT, '..'))).toThrow(/kit manifest --infer/)
    const r = loadManifest(join(MINI_CONTENT, '..'), { infer: true })
    expect(r.source).toBe('inferred')
  })
})

describe('inferManifest (port of knowledge::SiteManifest::infer)', () => {
  it('matches the Rust inference on the cinqueterre-mini fixture', () => {
    const { manifest: m, notes } = inferManifest(MINI_CONTENT)
    expect(m.brand.name).toBe('Cinque Terre Travel Guide')
    expect(m.baseUrl).toBe('https://cinqueterre.travel')
    expect(m.defaultLanguage).toBe('en')
    // Languages: the union of every declaration, first-seen order.
    expect(m.languages).toEqual(['en', 'de', 'it', 'fr'])
    // Villages ordered by entity-index position.
    expect(m.regions?.items.map((r) => r.slug)).toEqual(['riomaggiore', 'manarola', 'corniglia', 'vernazza', 'monterosso'])
    expect(m.regions?.items.find((r) => r.slug === 'vernazza')?.order).toBe(4)
    // Sections from sitemap-index.
    expect(m.sections.find((s) => s.slug === 'restaurants')).toMatchObject({ perRegion: true, collection: 'restaurants' })
    expect(m.sections.find((s) => s.slug === 'blog')).toMatchObject({ perRegion: false })
    expect(m.routes.blogIndex).toBe('blog')
    // Collections from directories.
    expect(m.collections.map((c) => [c.type, !!c.regionField])).toEqual([
      ['hikes', true],
      ['restaurants', true],
    ])
    expect(m.collections[1].label).toBe('Restaurants')
    expect(notes.some((n) => n.includes('config/site.json'))).toBe(true)
  })

  it.skipIf(!HAS_REAL_CONTENT)('infers the full cinqueterre.travel content', () => {
    const { manifest: m } = inferManifest(REAL_CONTENT)
    expect(m.languages.length).toBe(4)
    expect(m.regions?.items.length).toBe(5)
    expect(m.regions?.items[0].slug).toBe('riomaggiore')
    expect(m.sections.some((s) => s.slug === 'blog' && !s.perRegion)).toBe(true)
    expect(m.collections.length).toBeGreaterThan(0)
  })
})
