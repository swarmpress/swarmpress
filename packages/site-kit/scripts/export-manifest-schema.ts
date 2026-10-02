#!/usr/bin/env tsx
/**
 * Exports the Zod `site.manifest.json` schema as JSON Schema
 * (packages/site-kit/schema/site-manifest.schema.json) for editors, agents and
 * the Rust knowledge crate. With `--check`, exits non-zero if out of date.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { SiteManifestSchema } from '../src/manifest/schema'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../schema/site-manifest.schema.json')

export function manifestJsonSchema(): string {
  const schema = zodToJsonSchema(SiteManifestSchema, {
    name: 'SiteManifest',
    target: 'jsonSchema7',
    $refStrategy: 'none',
  })
  return JSON.stringify(schema, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = manifestJsonSchema()
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    if (current !== text) {
      console.error(`${OUT} is out of date; run pnpm --filter @swarm-press/site-kit schema:export`)
      process.exit(1)
    }
    console.log('site-manifest.schema.json is up to date')
  } else {
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, text)
    console.log(`wrote ${OUT}`)
  }
}
