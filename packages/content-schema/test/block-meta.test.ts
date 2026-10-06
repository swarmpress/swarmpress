#!/usr/bin/env tsx
/**
 * Block metadata as data (FEAT-089): every core block has metadata, the file
 * parses, and the values the Rust tests pin read the same here.
 */
import assert from 'node:assert/strict'
import { BLOCK_META, blockMeta, blockMetaDrift } from '../src/block-meta'
import { CORE_BLOCK_TYPES } from '../src/v2'

assert.deepEqual(blockMetaDrift(), { missing: [], unknown: [] })
assert.equal(BLOCK_META.length, CORE_BLOCK_TYPES.length)
assert.deepEqual(
  BLOCK_META.map((m) => m.type),
  [...CORE_BLOCK_TYPES],
  'block metadata is in schema order',
)
assert.equal(blockMeta('paragraph')?.intent, 'inform')
assert.equal(blockMeta('editorial-hero')?.category, 'editorial')
assert.equal(blockMeta('newsletter')?.intent, 'convert')
assert.equal(blockMeta('nope'), undefined)
for (const m of BLOCK_META) {
  if (m.media) assert.ok(m.media.min <= m.media.max, m.type)
  if (m.linking) assert.ok(m.linking.minLinks <= m.linking.maxLinks, m.type)
}
console.log('block-meta: ok')
