/**
 * Theme lint (part of `kit check`): keeps agent-authored themes inside the
 * presentation sandbox.
 *
 *   forbidden_import      fs, path, node:*, child_process, … (themes never touch the machine)
 *   forbidden_api         process.env, fetch(), import.meta.glob, Astro.glob (data comes from ctx)
 *   dependency_not_allowed bare imports / package.json deps outside the allowlist
 *   import_outside_theme  relative imports escaping the theme dir
 *   remote_script         <script src="https://…">
 *   remote_font           Google Fonts, Typekit, @font-face url(https://…)
 *   remote_stylesheet     <link rel=stylesheet href="https://…">, @import url(https://…)
 *   hardcoded_locale      ['en','de'] lists, lang === 'de', value.de, 'de-DE'
 *   hardcoded_region      region slugs / names from the manifest in theme code
 *   third_party_tracker   GA, GTM, Plausible, … (the kit ships the first-party tracker)
 *   island_directive      client:load / client:idle / client:only (client:visible only)
 *   kit_root_import       value imports from the kit package root (use @swarm-press/site-kit/theme)
 *   tracker_missing       site.manifest.json has no analytics block
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { Finding } from './findings'
import { localize } from './i18n'
import type { SiteManifest } from './manifest/schema'

export const DEPENDENCY_ALLOWLIST: readonly (string | RegExp)[] = [
  '@swarm-press/site-kit',
  'astro',
  'astro:assets',
  'react',
  'react-dom',
  'clsx',
  'tailwind-merge',
  'class-variance-authority',
  'lucide-react',
  'embla-carousel-react',
  /^@fontsource(-variable)?\//,
]

const FORBIDDEN_MODULES = new Set([
  'fs',
  'fs/promises',
  'path',
  'child_process',
  'os',
  'http',
  'https',
  'net',
  'tls',
  'dgram',
  'dns',
  'worker_threads',
  'cluster',
  'process',
  'vm',
  'module',
])

const SOURCE_EXT = new Set(['.astro', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.kit', '.git', 'test-results'])

export interface LintOptions {
  themeDir: string
  /** Repo root, for repo-relative file names in findings. */
  root: string
  manifest: SiteManifest
  strict?: boolean
}

/** Theme source files (skips node_modules, build output and nested sites). */
export function themeFiles(themeDir: string): string[] {
  const out: string[] = []
  const visit = (d: string, top: boolean) => {
    if (!top && existsSync(join(d, 'site.manifest.json'))) return // a nested site (e.g. fixture-site)
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) visit(full, false)
      } else if (SOURCE_EXT.has(extname(name)) || name === 'package.json') {
        out.push(full)
      }
    }
  }
  if (existsSync(themeDir)) visit(themeDir, true)
  return out
}

/** Blanks out comments, keeping offsets (so line numbers stay right). */
export function stripComments(src: string, ext: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  let s = src.replace(/\/\*[\s\S]*?\*\//g, blank)
  if (ext !== '.css') s = s.replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
  if (ext === '.astro') s = s.replace(/<!--[\s\S]*?-->/g, blank)
  return s
}

/** Blanks string literal contents (keeps the quotes), for code-shape checks. */
function stripStrings(src: string): string {
  return src.replace(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g, (_m, q: string, body: string) => q + body.replace(/[^\n]/g, ' ') + q)
}

function lineCol(src: string, index: number): string {
  const before = src.slice(0, index)
  const line = before.split('\n').length
  const col = index - before.lastIndexOf('\n')
  return `L${line}:${col}`
}

export function isAllowedDependency(spec: string): boolean {
  const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
  return DEPENDENCY_ALLOWLIST.some((a) => (typeof a === 'string' ? spec === a || pkg === a || spec.startsWith(a + '/') : a.test(spec)))
}

function importSpecifiers(src: string): { spec: string; index: number }[] {
  const out: { spec: string; index: number }[] = []
  const res = [
    /\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?(['"])([^'"\n]+)\1/g,
    /\bexport\s+[\w*{}\s,$]+\s+from\s+(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /@import\s+(?:url\()?\s*(['"])([^'"\n]+)\1/g,
  ]
  for (const re of res) {
    for (const m of src.matchAll(re)) out.push({ spec: m[2], index: m.index ?? 0 })
  }
  return out
}

export function lintTheme(opts: LintOptions): Finding[] {
  const { themeDir, root, manifest } = opts
  const findings: Finding[] = []
  const languages = manifest.languages
  const langAlt = languages.map((l) => l.replace(/[-]/g, '\\-')).join('|')
  const regions = manifest.regions?.items ?? []
  const regionNames = [...new Set(regions.flatMap((r) => [localize(r.name, 'en')]).filter((n) => n.length > 3))]
  const absTheme = resolve(themeDir)
  const rel = (f: string) => relative(root, f).split(sep).join('/')

  if (!manifest.analytics) {
    findings.push({
      severity: opts.strict ? 'error' : 'warning',
      code: 'tracker_missing',
      file: 'site.manifest.json',
      path: '/analytics',
      message: 'no analytics { endpoint, projectKey }: the first-party tracker tag will not be rendered',
    })
  }

  for (const file of themeFiles(themeDir)) {
    const ext = extname(file)
    const raw = readFileSync(file, 'utf8')
    const f = rel(file)
    const push = (code: string, index: number, message: string, severity: Finding['severity'] = 'error') =>
      findings.push({ severity, code, file: f, path: lineCol(raw, index), message })

    if (file.endsWith('package.json')) {
      try {
        const pkg = JSON.parse(raw) as Record<string, Record<string, string> | undefined>
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
          for (const dep of Object.keys(pkg[field] ?? {})) {
            if (!isAllowedDependency(dep)) push('dependency_not_allowed', raw.indexOf(`"${dep}"`), `${field} "${dep}" is not on the kit allowlist`)
          }
        }
      } catch {
        push('invalid_json', 0, 'package.json is not valid JSON')
      }
      continue
    }

    const code = stripComments(raw, ext)
    const shape = stripStrings(code)

    for (const { spec, index } of importSpecifiers(code)) {
      if (/^https?:\/\/|^\/\//.test(spec)) {
        if (/fonts\.(googleapis|gstatic)\.com|typekit\.net|fonts\.bunny\.net/.test(spec)) push('remote_font', index, `remote font "${spec}"; self-host fonts under public/fonts/`)
        else push(ext === '.css' ? 'remote_stylesheet' : 'remote_script', index, `remote import "${spec}"`)
        continue
      }
      const bare = spec.replace(/^node:/, '')
      if (spec.startsWith('node:') || FORBIDDEN_MODULES.has(bare) || FORBIDDEN_MODULES.has(bare.split('/')[0])) {
        push('forbidden_import', index, `themes may not import "${spec}" (no filesystem or node APIs; read data from ctx)`)
        continue
      }
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const target = resolve(dirname(file), spec)
        if (!target.startsWith(absTheme + sep) && target !== absTheme) {
          push('import_outside_theme', index, `"${spec}" resolves outside the theme directory`)
        }
        continue
      }
      if (spec.startsWith('virtual:') || spec.startsWith('astro:') && spec !== 'astro:assets') {
        push('dependency_not_allowed', index, `"${spec}" is kit-internal`)
        continue
      }
      if (!isAllowedDependency(spec)) push('dependency_not_allowed', index, `"${spec}" is not on the kit dependency allowlist`)
    }

    // The package root pulls the build-time integration (Vite plugins, native
    // binaries) into the page bundle; runtime code imports '@swarm-press/site-kit/theme'.
    for (const m of code.matchAll(/\bimport\s+(?!type\b)[^'";]*?\bfrom\s+(['"])@swarm-press\/site-kit\1/g)) {
      push('kit_root_import', m.index ?? 0, "value import from '@swarm-press/site-kit'; use '@swarm-press/site-kit/theme' (or `import type`)")
    }

    for (const m of shape.matchAll(/\bprocess\.env\b|\bimport\.meta\.glob\b|\bAstro\.glob\b|\bfetch\s*\(/g)) {
      push('forbidden_api', m.index ?? 0, `\`${m[0].replace(/\s*\($/, '(')}\` is not available to themes; use ctx`)
    }

    // Remote scripts / stylesheets / fonts in markup and CSS.
    for (const m of code.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'](https?:)?\/\/[^"']+["']/gi)) {
      push('remote_script', m.index ?? 0, 'remote <script src>; bundle scripts with the theme (the tracker is injected by the kit)')
    }
    for (const m of code.matchAll(/<link\b[^>]*\bhref\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi)) {
      const isFont = /fonts\.(googleapis|gstatic)\.com|typekit\.net|fonts\.bunny\.net/.test(m[1])
      const isStyle = /rel\s*=\s*["'](stylesheet|preload|preconnect)["']/i.test(m[0])
      if (isFont) push('remote_font', m.index ?? 0, `remote font "${m[1]}"; self-host fonts under public/fonts/`)
      else if (isStyle) push('remote_stylesheet', m.index ?? 0, `remote stylesheet "${m[1]}"`)
    }
    if (ext === '.css' || ext === '.astro') {
      for (const m of code.matchAll(/@font-face\s*{[^}]*url\(\s*['"]?((?:https?:)?\/\/[^'")]+)/gi)) {
        push('remote_font', m.index ?? 0, `@font-face loads "${m[1]}"; self-host fonts under public/fonts/`)
      }
    }
    for (const m of code.matchAll(/googletagmanager\.com|google-analytics\.com|\bgtag\s*\(|plausible\.io|cdn\.segment\.com|static\.hotjar\.com|\bfbq\s*\(|umami\.is|matomo\.(js|php)/gi)) {
      push('third_party_tracker', m.index ?? 0, `"${m[0]}": third-party analytics are not allowed; the kit renders the first-party tracker`)
    }
    for (const m of code.matchAll(/\bclient:(load|idle|only|media)\b/g)) {
      push('island_directive', m.index ?? 0, `client:${m[1]} — islands hydrate with client:visible only`)
    }

    // Hardcoded locales.
    if (ext !== '.css') {
      for (const m of code.matchAll(/\[\s*(['"])[a-z]{2}(?:-[A-Za-z]{2,4})?\1(?:\s*,\s*(['"])[a-z]{2}(?:-[A-Za-z]{2,4})?\2)+\s*,?\s*\]/g)) {
        push('hardcoded_locale', m.index ?? 0, `hardcoded language list ${m[0].replace(/\s+/g, '')}; use ctx.languages`)
      }
      if (langAlt) {
        const cmp = new RegExp(`(?:[!=]==?\\s*(['"])(?:${langAlt})\\1)|(?:(['"])(?:${langAlt})\\2\\s*[!=]==?)`, 'g')
        for (const m of code.matchAll(cmp)) push('hardcoded_locale', m.index ?? 0, `comparison with a hardcoded language ${m[0].trim()}; use ctx.lang / ctx.l()`)
        const prop = new RegExp(`(?<![\\w$])[A-Za-z_$][\\w$]*\\??\\.(?:${langAlt})(?![\\w$-])|\\[\\s*(['"])(?:${langAlt})\\1\\s*\\]`, 'g')
        for (const m of shape.matchAll(prop)) {
          if (/^(Astro|console|Math|JSON|Object|Array|Number|String|Promise|ctx)\./.test(m[0])) continue
          push('hardcoded_locale', m.index ?? 0, `\`${m[0]}\` reads one language directly; use ctx.l(value)`)
        }
        const tag = new RegExp(`(['"])(?:${langAlt})-[A-Z]{2}\\1`, 'g')
        for (const m of code.matchAll(tag)) push('hardcoded_locale', m.index ?? 0, `hardcoded locale ${m[0]}; derive it from ctx.lang`)
      }
    }

    // Hardcoded regions.
    for (const r of regions) {
      const slugRe = new RegExp(`(['"\`/])${r.slug.replace(/-/g, '\\-')}(['"\`/])`, 'g')
      for (const m of code.matchAll(slugRe)) push('hardcoded_region', m.index ?? 0, `region slug "${r.slug}" is hardcoded; use ctx.nav.regions / manifest data`)
    }
    for (const name of regionNames) {
      const nameRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
      for (const m of code.matchAll(nameRe)) push('hardcoded_region', m.index ?? 0, `region name "${name}" is hardcoded; use ctx.nav.regions / ctx.region`)
    }
  }
  return findings
}

/** Path guard: files changed by a theme PR must stay under the theme dir. */
export function pathGuard(changed: string[], themeDir: string): Finding[] {
  const prefix = themeDir.replace(/\/+$/, '') + '/'
  return changed
    .filter((p) => p && !p.startsWith(prefix))
    .map((p) => ({
      severity: 'error' as const,
      code: 'path_guard',
      file: p,
      path: '',
      message: `theme changes may only touch ${prefix}** (the kit, content and workflows are platform-owned)`,
    }))
}
