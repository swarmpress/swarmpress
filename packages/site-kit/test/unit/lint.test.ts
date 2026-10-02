import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isAllowedDependency, lintTheme, pathGuard } from '../../src/lint'
import { SiteManifestSchema } from '../../src/manifest/schema'

const manifest = SiteManifestSchema.parse({
  schemaVersion: 1,
  siteId: 't',
  baseUrl: 'https://t.test',
  languages: ['en', 'de', 'it'],
  defaultLanguage: 'en',
  brand: { name: 'T' },
  regions: { label: 'Villages', items: [{ slug: 'vernazza', name: 'Vernazza', order: 1 }] },
  analytics: { endpoint: 'https://play.test', projectKey: 'k' },
})

const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

/** Lints a throwaway theme made of `files`; returns the finding codes per file. */
function lint(files: Record<string, string>, m = manifest) {
  const root = mkdtempSync(join(tmpdir(), 'kit-lint-'))
  roots.push(root)
  for (const [name, text] of Object.entries(files)) {
    const full = join(root, 'theme', name)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return lintTheme({ themeDir: join(root, 'theme'), root, manifest: m })
}
const codes = (fs: { code: string }[]) => fs.map((f) => f.code).sort()

describe('theme lint', () => {
  it('passes a clean component', () => {
    const f = lint({
      'blocks/paragraph.astro': `---\nimport RichText from '@swarm-press/site-kit/components/RichText.astro'\nconst { block, ctx } = Astro.props\n---\n<RichText text={ctx.l(block.markdown)} ctx={ctx} />\n{ctx.languages.map((l) => <span lang={l}>{l}</span>)}\n`,
    })
    expect(f).toEqual([])
  })

  it('forbids node/fs imports, process.env, fetch and globbing', () => {
    const f = lint({
      'x.astro': `---\nimport fs from 'fs'\nimport { join } from 'node:path'\nconst k = process.env.KEY\nconst r = await fetch('https://api.test')\nconst all = import.meta.glob('./*.md')\n---\n`,
    })
    expect(codes(f)).toEqual(['forbidden_api', 'forbidden_api', 'forbidden_api', 'forbidden_import', 'forbidden_import'])
  })

  it('enforces the dependency allowlist in imports and package.json', () => {
    expect(isAllowedDependency('@fontsource/inter/400.css')).toBe(true)
    expect(isAllowedDependency('react-dom/client')).toBe(true)
    expect(isAllowedDependency('left-pad')).toBe(false)
    const f = lint({
      'x.ts': `import pad from 'left-pad'\nimport cfg from 'virtual:site-kit/config'\nimport up from '../../outside'\n`,
      'package.json': JSON.stringify({ dependencies: { astro: '^5', axios: '1' } }),
    })
    expect(codes(f)).toEqual(['dependency_not_allowed', 'dependency_not_allowed', 'dependency_not_allowed', 'import_outside_theme'])
  })

  it('rejects remote scripts, stylesheets, fonts and third-party trackers', () => {
    const f = lint({
      'a.astro': `<script src="https://cdn.test/x.js"></script>\n<link rel="stylesheet" href="https://cdn.test/x.css">\n<link rel="preconnect" href="https://fonts.gstatic.com">\n<script>gtag('config', 'G-1')</script>\n`,
      'b.css': `@import url("https://fonts.googleapis.com/css2?family=Inter");\n@font-face { font-family: X; src: url(https://cdn.test/x.woff2) }\n`,
    })
    expect(codes(f)).toEqual(['remote_font', 'remote_font', 'remote_font', 'remote_script', 'remote_stylesheet', 'third_party_tracker'])
  })

  it('rejects value imports from the kit root (type imports and /theme are fine)', () => {
    const f = lint({
      'theme.config.ts': `import { defineTheme } from '@swarm-press/site-kit'\nimport type { RenderContext } from '@swarm-press/site-kit'\nimport { defineTheme as d } from '@swarm-press/site-kit/theme'\n`,
    })
    expect(codes(f)).toEqual(['kit_root_import'])
  })

  it('allows client:visible islands only', () => {
    const f = lint({ 'a.astro': `<Map client:visible />\n<Map client:load />\n` })
    expect(codes(f)).toEqual(['island_directive'])
  })

  it('flags hardcoded locale lists, comparisons, property reads and tags', () => {
    const f = lint({
      'a.astro': `---\nconst langs = ['en', 'de']\nconst isDe = ctx.lang === 'de'\nconst title = block.title.it\nconst loc = 'de-DE'\n---\n`,
    })
    expect(codes(f)).toEqual(['hardcoded_locale', 'hardcoded_locale', 'hardcoded_locale', 'hardcoded_locale'])
  })

  it('flags hardcoded region slugs and names', () => {
    const f = lint({ 'a.astro': `---\nconst v = ctx.region?.slug === 'vernazza'\n---\n<h1>Welcome to Vernazza</h1>\n` })
    expect(codes(f)).toEqual(['hardcoded_region', 'hardcoded_region'])
  })

  it('ignores comments', () => {
    const f = lint({ 'a.ts': `// import fs from 'fs'\n/* fetch('x') */\nexport const x = 1\n` })
    expect(f).toEqual([])
  })

  it('warns when the manifest has no tracker', () => {
    const { analytics: _a, ...noTracker } = manifest
    const f = lint({ 'a.ts': 'export {}\n' }, noTracker as typeof manifest)
    expect(f).toMatchObject([{ code: 'tracker_missing', severity: 'warning' }])
  })
})

describe('path guard', () => {
  it('only lets theme PRs touch theme/**', () => {
    const f = pathGuard(['theme/blocks/a.astro', 'content/pages/x.json', '.github/workflows/deploy.yml'], 'theme')
    expect(f.map((x) => x.file)).toEqual(['content/pages/x.json', '.github/workflows/deploy.yml'])
    expect(f[0].code).toBe('path_guard')
  })
})
