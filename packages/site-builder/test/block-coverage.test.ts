#!/usr/bin/env tsx
/**
 * Block coverage test
 *
 * Asserts that every block type registered in
 *   packages/shared/src/content/blocks.ts
 * has a matching `case '<type>':` in
 *   packages/site-builder/src/themes/cinque-terre/src/ContentRenderer.astro
 * and vice versa.
 *
 * Run with `tsx packages/site-builder/test/block-coverage.test.ts`.
 * Exits non-zero on any drift.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

const BLOCKS_PATH = resolve(
  REPO_ROOT,
  'packages/shared/src/content/blocks.ts'
)
const RENDERER_PATH = resolve(
  REPO_ROOT,
  'packages/site-builder/src/themes/cinque-terre/src/ContentRenderer.astro'
)

function extractSchemaTypes(source: string): Set<string> {
  // Matches: type: z.literal('foo-bar')
  const types = new Set<string>()
  const re = /type:\s*z\.literal\(\s*['"]([a-z][a-z0-9-]*)['"]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    types.add(m[1])
  }
  return types
}

function extractRendererCases(source: string): Set<string> {
  // Matches: case 'foo-bar':
  const types = new Set<string>()
  const re = /case\s+['"]([a-z][a-z0-9-]*)['"]\s*:/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    types.add(m[1])
  }
  return types
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort()
}

function main(): void {
  const blocksSrc = readFileSync(BLOCKS_PATH, 'utf8')
  const rendererSrc = readFileSync(RENDERER_PATH, 'utf8')

  const schemaTypes = extractSchemaTypes(blocksSrc)
  const rendererTypes = extractRendererCases(rendererSrc)

  // Subschemas embedded inside other schemas (e.g. BlogContentBlockSchema's
  // `type: z.enum([...])`) won't show up via the literal extractor, so the
  // intentionally unrendered set is empty. Update this list if the schema
  // file grows internal-only literal types.
  const KNOWN_INTERNAL: ReadonlySet<string> = new Set([])

  const schemasMissingRenderer = diff(schemaTypes, rendererTypes).filter(
    (t) => !KNOWN_INTERNAL.has(t)
  )
  const renderersMissingSchema = diff(rendererTypes, schemaTypes)

  console.log(`schema block types : ${schemaTypes.size}`)
  console.log(`renderer cases     : ${rendererTypes.size}`)

  let failed = false

  if (schemasMissingRenderer.length > 0) {
    failed = true
    console.error('\n[FAIL] schemas without renderers:')
    for (const t of schemasMissingRenderer) console.error(`  - ${t}`)
  }

  if (renderersMissingSchema.length > 0) {
    failed = true
    console.error('\n[FAIL] renderers without schemas:')
    for (const t of renderersMissingSchema) console.error(`  - ${t}`)
  }

  if (failed) {
    console.error(
      '\nBlock schemas and ContentRenderer.astro are out of sync. ' +
        'Either add a schema in blocks.ts, add a case in ContentRenderer.astro, ' +
        'or remove the orphan.'
    )
    process.exit(1)
  }

  console.log('\n[OK] every schema has a renderer and vice versa.')
}

main()
