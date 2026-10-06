#!/usr/bin/env tsx
/**
 * The page-type registry (FEAT-089): the format's rules and the core types.
 * crates/content-model/src/page_types.rs reads the exported core registry;
 * its tests check the same pages against it.
 */
import assert from 'node:assert/strict'
import {
  CORE_PAGE_TYPES,
  PAGE_TYPES_FORMAT,
  PageTypesFileSchema,
  isArticleType,
  resolvePageType,
  unknownCoreBlocks,
} from '../src/page-types'

// The core registry parses, and names only core blocks.
assert.equal(CORE_PAGE_TYPES.format, PAGE_TYPES_FORMAT)
assert.deepEqual(
  CORE_PAGE_TYPES.page_types.map((t) => t.id),
  ['blog-article', 'blog-index'],
)
assert.deepEqual(unknownCoreBlocks(), [])

// Aliases resolve; the site kit's article test reads them.
for (const name of ['blog-article', 'blog-post', 'article']) {
  assert.ok(isArticleType(name), name)
}
for (const name of ['blog-index', 'village', 'page', '']) {
  assert.ok(!isArticleType(name), name)
}
assert.equal(resolvePageType('blog-post')?.id, 'blog-article')
assert.equal(resolvePageType('village'), undefined)

const file = (page_types: unknown[]) => ({ format: PAGE_TYPES_FORMAT, page_types })
const ok = (v: unknown) => PageTypesFileSchema.safeParse(v).success

// A site's own type with defaults filled in.
const site = PageTypesFileSchema.parse(
  file([{ id: 'village', label: { en: 'Village' }, slots: [{ id: 'intro', blocks: ['village-intro'], max: 1 }] }]),
)
assert.equal(site.page_types[0].slots?.[0].min, 0)
assert.deepEqual(site.page_types[0].aliases, [])

// Rejected: a block in two slots, a slot twice, a type twice (also via an
// alias), min above max, a bad id, unknown fields, the wrong format.
const slot = (id: string, blocks: string[]) => ({ id, blocks })
assert.ok(!ok(file([{ id: 'a', label: { en: 'A' }, slots: [slot('s', ['paragraph']), slot('t', ['paragraph'])] }])))
assert.ok(!ok(file([{ id: 'a', label: { en: 'A' }, slots: [slot('s', ['paragraph']), slot('s', ['image'])] }])))
assert.ok(!ok(file([{ id: 'a', label: { en: 'A' } }, { id: 'a', label: { en: 'B' } }])))
assert.ok(!ok(file([{ id: 'a', label: { en: 'A' } }, { id: 'b', label: { en: 'B' }, aliases: ['a'] }])))
assert.ok(!ok(file([{ id: 'a', label: { en: 'A' }, slots: [{ id: 's', blocks: ['image'], min: 2, max: 1 }] }])))
assert.ok(!ok(file([{ id: 'Blog Article', label: { en: 'A' } }])))
assert.ok(!ok(file([{ id: 'a', label: { en: 'A' }, colour: 'red' }])))
assert.ok(!ok({ format: 'swarmpress.page-types.v0', page_types: [] }))
// Custom blocks are fine.
assert.ok(ok(file([{ id: 'a', label: { en: 'A' }, slots: [slot('s', ['x:key-facts'])] }])))

console.log('page-types: ok')
