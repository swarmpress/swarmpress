/**
 * `kit check` — content validation (schema v2), closed-world links and media,
 * block coverage, theme lint and the path guard, with a ratcheting baseline.
 * The Astro integration runs the content half of this at build start.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_BLOCK_TYPES } from '@swarm-press/content-schema'
import { FALLBACK_RENDERER } from './blocks/fallback-map'
import { coverage, type BlockSource } from './blocks/registry'
import { loadSite, type LoadedSite } from './content/load'
import { applyBaseline, countByCode, readBaseline, type BaselineResult, type Finding } from './findings'
import { lintTheme, pathGuard } from './lint'
import { loadManifest, type ResolvedManifest } from './manifest/load'
import { brokenLinkFindings, checkLinksIn, checkMediaIn, type BrokenLink, type LinkReport } from './resolve'
import { planRoutes, type RoutePlan } from './routes/plan'

export interface CheckOptions {
  root: string
  contentDir?: string
  /** Manifest path (repo-relative) or object; default `site.manifest.json`. */
  manifest?: string
  /** Infer a manifest from legacy config when none exists. */
  infer?: boolean
  themeDir?: string
  strict?: boolean
  baseline?: string
  /** Git ref to diff against for the path guard (`origin/main`). */
  diff?: string
  /** Explicit changed files for the path guard. */
  changedFiles?: string[]
  /** Skip the theme lint (content-only check, used by the build). */
  skipLint?: boolean
}

export interface CheckReport {
  ok: boolean
  manifest?: ResolvedManifest
  site?: LoadedSite
  plan?: RoutePlan
  findings: Finding[]
  baseline: BaselineResult
  coverage: Record<string, BlockSource>
  links: LinkReport
  stats: { pages: number; routes: number; collectionItems: number; media: number; customBlocks: number; blocks: number }
}

/** Core block types the theme overrides: `blocks/<type>.astro` files + keys in theme.config's `blocks: {}`. */
export function themeBlockOverrides(themeAbs: string): string[] {
  const out = new Set<string>()
  const dir = join(themeAbs, 'blocks')
  if (existsSync(dir)) {
    for (const n of readdirSync(dir)) {
      if (n.endsWith('.astro') && CORE_BLOCK_TYPES.includes(n.slice(0, -6))) out.add(n.slice(0, -6))
    }
  }
  for (const cfg of ['theme.config.ts', 'theme.config.mjs', 'theme.config.js']) {
    const f = join(themeAbs, cfg)
    if (!existsSync(f)) continue
    const src = readFileSync(f, 'utf8')
    const m = src.match(/\bblocks\s*:\s*{([\s\S]*?)}/)
    if (m) for (const k of m[1].matchAll(/['"]?([a-z][a-z0-9-]*)['"]?\s*:/g)) if (CORE_BLOCK_TYPES.includes(k[1])) out.add(k[1])
  }
  return [...out].sort()
}

function changedFromGit(root: string, ref: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${ref}...HEAD`], { cwd: root, encoding: 'utf8' })
  return out.split('\n').map((s) => s.trim()).filter(Boolean)
}

export function runCheck(opts: CheckOptions): CheckReport {
  const findings: Finding[] = []
  const emptyLinks: LinkReport = { generatedAt: new Date().toISOString(), checked: 0, broken: [] }
  const empty = (): CheckReport => ({
    ok: false,
    findings,
    baseline: applyBaseline(findings, new Set()),
    coverage: {},
    links: emptyLinks,
    stats: { pages: 0, routes: 0, collectionItems: 0, media: 0, customBlocks: 0, blocks: 0 },
  })
  let manifest: ResolvedManifest
  try {
    manifest = loadManifest(opts.root, { manifest: opts.manifest, contentDir: opts.contentDir, infer: opts.infer })
  } catch (e) {
    findings.push({ severity: 'error', code: 'manifest', file: opts.manifest ?? 'site.manifest.json', path: '', message: (e as Error).message })
    return empty()
  }
  const themeDir = opts.themeDir ?? manifest.manifest.themeDir
  const site = loadSite({ root: opts.root, manifest: manifest.manifest, contentDir: opts.contentDir, themeDir })
  findings.push(...site.findings)
  const plan = planRoutes(site)
  findings.push(...plan.findings)

  // Closed-world links and media.
  const known = new Set(plan.byPath.keys())
  const linkCtx = { base: manifest.manifest.base, languages: manifest.manifest.languages, known }
  const broken: BrokenLink[] = []
  let checked = 0
  const fallbacks = [manifest.manifest.defaultLanguage, 'en']
  for (const page of site.pages) {
    for (const lang of Object.keys(page.routes)) {
      const r = checkLinksIn(page.data.body, page.file, lang, linkCtx, fallbacks)
      checked += r.checked
      broken.push(...r.broken.map((b) => ({ ...b, path: `/body${b.path}` })))
    }
    findings.push(...checkMediaIn(page.data, page.file, site.media))
  }
  findings.push(...brokenLinkFindings(broken, opts.strict ? 'error' : 'warning'))
  const links: LinkReport = { generatedAt: new Date().toISOString(), checked, broken }

  // Block coverage.
  const used = new Map<string, string>()
  let blocks = 0
  for (const p of site.pages) {
    for (const b of p.data.body ?? []) {
      if (typeof b?.type !== 'string') continue
      blocks++
      if (!used.has(b.type)) used.set(b.type, p.file)
    }
  }
  const themeAbs = join(opts.root, themeDir)
  const cov = coverage(used.keys(), {
    theme: themeBlockOverrides(themeAbs),
    custom: site.customBlocks.filter((c) => c.hasComponent).map((c) => c.type),
    fallback: Object.keys(FALLBACK_RENDERER),
  })
  for (const [type, source] of cov) {
    if (source === 'missing') {
      findings.push({ severity: 'error', code: 'missing_renderer', file: used.get(type)!, path: '', message: `block type \`${type}\` has no renderer (not a core block, no theme/blocks/${type.replace(/^x:/, '')}/Component.astro)` })
    }
  }

  // Theme lint + path guard.
  if (!opts.skipLint) {
    if (existsSync(themeAbs) && statSync(themeAbs).isDirectory()) {
      findings.push(...lintTheme({ themeDir: themeAbs, root: opts.root, manifest: manifest.manifest, strict: opts.strict }))
    } else {
      findings.push({ severity: 'warning', code: 'theme_missing', file: themeDir, path: '', message: 'theme directory not found; the kit default theme will be used' })
    }
  }
  const changed = opts.changedFiles ?? (opts.diff ? changedFromGit(opts.root, opts.diff) : undefined)
  if (changed) findings.push(...pathGuard(changed, themeDir))

  if (opts.strict) {
    for (const f of findings) {
      if (f.severity === 'warning' && ['third_party_tracker', 'hardcoded_locale', 'hardcoded_region', 'route_conflict', 'custom_block_example'].includes(f.code)) f.severity = 'error'
    }
  }

  const baselineSet = opts.baseline ? readBaseline(join(opts.root, opts.baseline)) : new Set<string>()
  const baseline = applyBaseline(findings, baselineSet)
  const collectionItems = [...site.collections.values()].reduce((a, l) => a + l.length, 0)
  return {
    ok: baseline.newErrors.length === 0,
    manifest,
    site,
    plan,
    findings,
    baseline,
    coverage: Object.fromEntries(cov),
    links,
    stats: { pages: site.pages.length, routes: plan.entries.length, collectionItems, media: site.media.size, customBlocks: site.customBlocks.length, blocks },
  }
}

export function formatCheckReport(r: CheckReport, opts: { verbose?: boolean; limit?: number } = {}): string {
  const limit = opts.verbose ? Infinity : opts.limit ?? 8
  const lines: string[] = []
  const s = r.stats
  if (r.manifest) lines.push(`manifest: ${r.manifest.source}${r.manifest.path ? ` (${r.manifest.path})` : ''}`)
  for (const n of r.manifest?.notes ?? []) lines.push(`  note: ${n}`)
  lines.push(`content: ${s.pages} pages, ${s.blocks} blocks, ${s.collectionItems} collection items, ${s.media} media, ${s.customBlocks} custom blocks → ${s.routes} routes`)
  const cov = Object.entries(r.coverage)
  if (cov.length) {
    const by = (src: string) => cov.filter(([, v]) => v === src).map(([k]) => k)
    lines.push(`coverage: ${by('theme').length} theme, ${by('custom').length} custom, ${by('fallback').length} kit fallback, ${by('missing').length} missing`)
    if (by('fallback').length) lines.push(`  fallback renderers: ${by('fallback').join(', ')}`)
    if (by('missing').length) lines.push(`  MISSING: ${by('missing').join(', ')}`)
  }
  lines.push(`links: ${r.links.checked} internal links checked, ${r.links.broken.length} broken`)
  const errors = r.findings.filter((f) => f.severity === 'error')
  const warnings = r.findings.filter((f) => f.severity === 'warning')
  lines.push(`findings: ${errors.length} errors, ${warnings.length} warnings`)
  const counts = (fs: Finding[]) => Object.entries(countByCode(fs)).map(([k, v]) => `${k}=${v}`).join(' ')
  if (errors.length) lines.push(`  errors by code: ${counts(errors)}`)
  if (warnings.length) lines.push(`  warnings by code: ${counts(warnings)}`)
  const show = (title: string, fs: Finding[]) => {
    if (!fs.length) return
    lines.push('', title)
    const perCode = new Map<string, number>()
    let hidden = 0
    for (const f of fs) {
      const n = (perCode.get(f.code) ?? 0) + 1
      perCode.set(f.code, n)
      if (n > limit) {
        hidden++
        continue
      }
      lines.push(`  ${f.file}${f.path ? ' ' + f.path : ''} [${f.code}] ${f.message}`)
    }
    if (hidden) lines.push(`  … ${hidden} more (use --verbose or --json)`)
  }
  show('NEW ERRORS (fail):', r.baseline.newErrors)
  if (r.baseline.baselined.length) lines.push('', `baselined errors (tolerated): ${r.baseline.baselined.length}`)
  if (r.baseline.fixed.length) {
    lines.push('', `fixed since baseline (${r.baseline.fixed.length}) — remove from the baseline file to lock in the ratchet:`)
    for (const k of r.baseline.fixed.slice(0, limit)) lines.push(`  ${k}`)
  }
  show('WARNINGS:', warnings)
  lines.push('', r.ok ? 'kit check: OK' : `kit check: FAILED (${r.baseline.newErrors.length} new errors)`)
  return lines.join('\n')
}
