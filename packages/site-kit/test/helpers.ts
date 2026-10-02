import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const KIT_ROOT = resolve(here, '..')
export const REPO_ROOT = resolve(KIT_ROOT, '../..')
/** Trimmed cinqueterre content shared with crates/knowledge (read-only here). */
export const MINI_CONTENT = join(REPO_ROOT, 'crates/knowledge/tests/fixtures/cinqueterre-mini/content')
/** The starter theme and its fixture site. */
export const STARTER = join(REPO_ROOT, 'themes/starter')
export const FIXTURE_SITE = join(STARTER, 'fixture-site')
/** A site that breaks every rule `kit check` enforces. */
export const BROKEN_SITE = join(KIT_ROOT, 'test/fixtures/broken-site')
/** The real cinqueterre.travel content clone (optional; tests that need it are skipped without it). */
export const REAL_CONTENT = process.env.CINQUETERRE_CONTENT ?? '/home/user/cinqueterre.travel/content'
export const HAS_REAL_CONTENT = existsSync(join(REAL_CONTENT, 'pages'))
