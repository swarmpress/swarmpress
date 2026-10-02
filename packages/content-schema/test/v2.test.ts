#!/usr/bin/env tsx
/**
 * Schema v2 derivation: mirrors the unit tests of
 * crates/content-model/src/registry.rs so both sides derive the same v2.
 */
import assert from 'node:assert/strict'
import {
  CORE_BLOCK_TYPES,
  MEDIA_REF_PATTERN,
  coreBlockSchemasV2,
  pageSchemaV2,
  toV2,
} from '../src/v2'

assert.equal(CORE_BLOCK_TYPES.length, 46)
assert.equal(coreBlockSchemasV2().size, 46)

const v1 = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'x' },
    title: { type: 'string', minLength: 1 },
    village: { type: 'string' },
    image: { type: 'string' },
    href: { type: 'string' },
    variant: { type: 'string', enum: ['a', 'b'] },
    embed: { type: 'string', format: 'uri' },
    tags: { type: 'array', items: { type: 'string' } },
  },
}
const p = (toV2(v1) as any).properties
assert.ok(Array.isArray(p.title.anyOf))
assert.equal(p.title.anyOf[1].additionalProperties.minLength, 1)
assert.deepEqual(p.village, v1.properties.village)
assert.equal(p.image.pattern, MEDIA_REF_PATTERN)
assert.ok(Array.isArray(p.href.anyOf))
assert.deepEqual(p.variant, v1.properties.variant)
assert.deepEqual(p.embed, v1.properties.embed)
assert.ok(Array.isArray(p.tags.anyOf[0].items.anyOf))
assert.equal(p.tags.anyOf[1].additionalProperties.type, 'array')
assert.deepEqual(p.type, v1.properties.type)

const page = pageSchemaV2() as any
assert.equal(page.properties.body.items.required[0], 'type')
assert.equal(page.properties.template.type, 'string')
assert.equal(page.properties.seo.properties.og_image.pattern, MEDIA_REF_PATTERN)
console.log('ok   v2 derivation matches the Rust registry rules')
