/**
 * The `kit` CLI.
 *
 *   kit check [--strict] [--baseline kit-baseline.json] [--write-baseline file] [--json report.json]
 *             [--diff origin/main] [--infer] [--manifest file] [--content dir] [--theme dir] [--verbose]
 *   kit migrate [v1..v2] [--write] [--verbose]
 *   kit blocks-doc [--out BLOCKS.md]
 *   kit screenshots [--dist dist] [--out .kit/screenshots] [--widths 375,768,1280,1440] [--langs en,de]
 *                   [--baseline dir] [--threshold 0.005]
 *   kit manifest [--infer]
 *
 * Every command takes `--root <dir>` (default: cwd).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { blocksDoc } from './blocks-doc'
import { formatCheckReport, runCheck } from './check'
import { loadSite } from './content/load'
import { writeBaseline } from './findings'
import { loadManifest } from './manifest/load'
import { formatMigrateSummary, migrateContent } from './migrate'

const BOOL_FLAGS = new Set(['strict', 'write', 'verbose', 'infer', 'help'])

type Args = { _: string[]; flags: Record<string, string | boolean> }

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2)
      if (v !== undefined) out.flags[k] = v
      else if (!BOOL_FLAGS.has(k) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out.flags[k] = argv[++i]
      else out.flags[k] = true
    } else out._.push(a)
  }
  return out
}

const HELP = `kit — @swarm-press/site-kit CLI

  kit check [--strict] [--baseline file] [--write-baseline file] [--json file] [--diff ref] [--infer] [--verbose]
      schema-v2 content validation, closed-world links + media, block coverage, theme lint, path guard
  kit migrate [v1..v2] [--write] [--verbose]
      codemods for legacy content drift (dry run by default)
  kit blocks-doc [--out file]
      writer documentation generated from core + custom block schemas
  kit screenshots [--dist dist] [--out dir] [--widths 375,768,1280,1440] [--langs en,de] [--baseline dir]
      Playwright screenshots of manifest.screenshotPages + cockpit.visual.v1 (CHROMIUM_PATH env)
  kit manifest [--infer]
      print the (validated or inferred) site manifest

Common: --root <dir> (default cwd), --manifest <file>, --content <dir> (default content), --theme <dir>`

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const [cmd, ...rest] = args._
  const f = args.flags
  const root = resolve(String(f.root ?? process.cwd()))
  const flag = (k: string) => (typeof f[k] === 'string' && f[k] !== 'true' ? (f[k] as string) : undefined)
  const on = (k: string) => f[k] === true || f[k] === 'true'
  const abs = (p: string) => (isAbsolute(p) ? p : join(root, p))
  const contentDir = flag('content') ?? 'content'

  switch (cmd) {
    case undefined:
    case 'help':
      console.log(HELP)
      return 0

    case 'check': {
      const report = runCheck({
        root,
        contentDir,
        manifest: flag('manifest'),
        infer: on('infer'),
        themeDir: flag('theme'),
        strict: on('strict'),
        baseline: flag('baseline'),
        diff: flag('diff'),
      })
      console.log(formatCheckReport(report, { verbose: on('verbose') }))
      const json = flag('json')
      if (json) {
        mkdirSync(dirname(abs(json)), { recursive: true })
        writeFileSync(
          abs(json),
          JSON.stringify(
            {
              ok: report.ok,
              stats: report.stats,
              coverage: report.coverage,
              newErrors: report.baseline.newErrors,
              baselined: report.baseline.baselined.length,
              fixed: report.baseline.fixed,
              findings: report.findings,
              links: report.links,
            },
            null,
            2,
          ) + '\n',
        )
        console.log(`report: ${json}`)
      }
      const wb = flag('write-baseline')
      if (wb) {
        const b = writeBaseline(abs(wb), report.findings)
        console.log(`baseline: wrote ${b.entries.length} entries to ${wb}`)
        return 0
      }
      return report.ok ? 0 : 1
    }

    case 'migrate': {
      const range = rest[0] ?? 'v1..v2'
      if (range !== 'v1..v2') {
        console.error(`kit migrate: unsupported range ${range} (available: v1..v2)`)
        return 2
      }
      const write = on('write')
      const r = migrateContent(root, { contentDir, write })
      console.log(formatMigrateSummary(r, write, on('verbose')))
      return 0
    }

    case 'blocks-doc': {
      const m = loadManifest(root, { manifest: flag('manifest'), contentDir, infer: true })
      const site = loadSite({ root, manifest: m.manifest, contentDir, themeDir: flag('theme') })
      const md = blocksDoc(site.customBlocks, { title: `${m.manifest.brand.name} — content blocks` })
      const out = flag('out')
      if (out) {
        writeFileSync(abs(out), md)
        console.log(`wrote ${out}`)
      } else process.stdout.write(md)
      return 0
    }

    case 'screenshots': {
      const { takeScreenshots, validateVisualDocument } = await import('./screenshots')
      const m = loadManifest(root, { manifest: flag('manifest'), contentDir, infer: on('infer') })
      const site = loadSite({ root, manifest: m.manifest, contentDir, themeDir: flag('theme') })
      const outDir = abs(flag('out') ?? '.kit/screenshots')
      const doc = await takeScreenshots({
        root,
        site,
        dist: abs(flag('dist') ?? 'dist'),
        outDir,
        widths: flag('widths')?.split(',').map(Number),
        langs: flag('langs')?.split(','),
        baselineDir: flag('baseline') ? abs(flag('baseline')!) : undefined,
        threshold: flag('threshold') ? Number(flag('threshold')) : undefined,
      })
      const errs = validateVisualDocument(doc)
      const by = doc.comparisons.reduce<Record<string, number>>((a, c) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {})
      console.log(`screenshots: ${doc.comparisons.length} (${Object.entries(by).map(([k, v]) => `${k}=${v}`).join(' ')}) → ${join(outDir, 'cockpit.visual.json')}`)
      if (errs.length) console.error(errs.join('\n'))
      return errs.length || by.fail ? 1 : 0
    }

    case 'manifest': {
      const m = loadManifest(root, { manifest: flag('manifest'), contentDir, infer: on('infer') })
      for (const n of m.notes) console.error(`note: ${n}`)
      console.log(JSON.stringify({ $schema: './node_modules/@swarm-press/site-kit/schema/site-manifest.schema.json', ...m.manifest }, null, 2))
      return 0
    }

    default:
      console.error(`kit: unknown command "${cmd}"\n\n${HELP}`)
      return 2
  }
}
