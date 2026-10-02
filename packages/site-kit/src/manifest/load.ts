import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { inferManifest } from './infer'
import { MANIFEST_FILE, assertManifest, type SiteManifest, type SiteManifestInput } from './schema'

export interface ResolvedManifest {
  manifest: SiteManifest
  source: 'file' | 'inferred' | 'object'
  path?: string
  notes: string[]
}

/**
 * Loads `site.manifest.json` (repo root, or `content/site.manifest.json`),
 * accepts an inline object, or infers one from legacy config when `infer`
 * is set and no file exists.
 */
export function loadManifest(
  root: string,
  opts: { manifest?: string | SiteManifestInput; contentDir?: string; infer?: boolean } = {},
): ResolvedManifest {
  const contentDir = opts.contentDir ?? 'content'
  if (opts.manifest && typeof opts.manifest === 'object') {
    return { manifest: assertManifest(opts.manifest, 'siteKit({ manifest })'), source: 'object', notes: [] }
  }
  const candidates = opts.manifest
    ? [isAbsolute(opts.manifest) ? opts.manifest : join(root, opts.manifest)]
    : [join(root, MANIFEST_FILE), join(root, contentDir, MANIFEST_FILE)]
  for (const path of candidates) {
    if (existsSync(path)) {
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(path, 'utf8'))
      } catch (e) {
        throw new Error(`${path}: invalid JSON: ${(e as Error).message}`)
      }
      return { manifest: assertManifest(raw, path), source: 'file', path, notes: [] }
    }
  }
  if (opts.infer) {
    const { manifest, notes } = inferManifest(join(root, contentDir))
    return { manifest, source: 'inferred', notes }
  }
  throw new Error(
    `no ${MANIFEST_FILE} found (looked in ${candidates.join(', ')}). Create one, or run \`kit manifest --infer > ${MANIFEST_FILE}\`.`,
  )
}
