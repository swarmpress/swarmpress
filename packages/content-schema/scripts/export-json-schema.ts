#!/usr/bin/env tsx
/**
 * Exports the Zod schemas for the Rust server (crates/content-schema):
 *
 * - `page.schema.json`: the page schema;
 * - `page-types.schema.json`: the page-type registry format (FEAT-089);
 * - `page-types.json`: the core page types, defaults filled in.
 *
 * Run `pnpm --filter @swarm-press/content-schema export`. With `--check`,
 * exits non-zero if a committed file is out of date.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { PageSchema } from '../src/page'
import { CORE_PAGE_TYPES, PageTypesFileSchema } from '../src/page-types'

const here = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(here, '../../../crates/content-schema/schema')

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'

const outputs: Record<string, string> = {
  'page.schema.json': json(
    zodToJsonSchema(PageSchema, { name: 'Page', target: 'jsonSchema7', $refStrategy: 'none' }),
  ),
  'page-types.schema.json': json(
    zodToJsonSchema(PageTypesFileSchema, { name: 'PageTypes', target: 'jsonSchema7', $refStrategy: 'none' }),
  ),
  'page-types.json': json(CORE_PAGE_TYPES),
}

const check = process.argv.includes('--check')
let stale = false
for (const [name, text] of Object.entries(outputs)) {
  const out = resolve(DIR, name)
  if (check) {
    const current = existsSync(out) ? readFileSync(out, 'utf8') : ''
    if (current !== text) {
      console.error(`${out} is out of date; run the export script`)
      stale = true
    } else {
      console.log(`${name} is up to date`)
    }
  } else {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(out, text)
    console.log(`wrote ${out}`)
  }
}
if (stale) process.exit(1)
