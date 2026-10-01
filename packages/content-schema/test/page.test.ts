#!/usr/bin/env tsx
/**
 * Validates the shared fixtures in crates/content-schema/fixtures with Zod.
 * The Rust crate runs the same fixtures through its JSON Schema validator;
 * both must agree (valid/ passes, invalid/ fails).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PageSchema } from '../src/page'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(here, '../../../crates/content-schema/fixtures')

let failures = 0
for (const kind of ['valid', 'invalid'] as const) {
  const dir = resolve(FIXTURES, kind)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const result = PageSchema.safeParse(JSON.parse(readFileSync(resolve(dir, file), 'utf8')))
    const ok = result.success === (kind === 'valid')
    if (!ok) failures++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${kind}/${file}`)
  }
}
if (failures > 0) {
  console.error(`${failures} fixture(s) disagreed with the schema`)
  process.exit(1)
}
