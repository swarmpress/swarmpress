#!/usr/bin/env tsx
/**
 * Exports the Zod page schema as JSON Schema for the Rust server
 * (crates/content-schema). Run `pnpm --filter @swarm-press/content-schema export`.
 * With `--check`, exits non-zero if the committed file is out of date.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { PageSchema } from '../src/page'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../../../crates/content-schema/schema/page.schema.json')

const schema = zodToJsonSchema(PageSchema, {
  name: 'Page',
  target: 'jsonSchema7',
  $refStrategy: 'none',
})
const text = JSON.stringify(schema, null, 2) + '\n'

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== text) {
    console.error(`${OUT} is out of date; run the export script`)
    process.exit(1)
  }
  console.log('page.schema.json is up to date')
} else {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  console.log(`wrote ${OUT}`)
}
