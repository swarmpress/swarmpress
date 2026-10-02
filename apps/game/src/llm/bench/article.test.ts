// The TypeScript mirror of the Rust section checks replays the vectors the
// Rust test exports (crates/agents/tests/bench_schemas.rs), so the mirror and
// `check_section` cannot drift apart unnoticed.
import { describe, expect, it } from 'vitest'
import { validateJsonSchema } from '../structured'
import { CATEGORIES, HERO_ALIASES, LINK_ALIASES, RUST, SCHEMAS, SECTION_IDS, checkSection, readingText, rustWordCount, sectionDigest, sectionWords } from './article'

describe('the exported Rust fixture', () => {
  it('holds the stage schemas, the standup roster and the vectors', () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual(['closing', 'moderator', 'outline', 'review', 'section'])
    expect(SECTION_IDS).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(HERO_ALIASES).toHaveLength(6)
    expect(LINK_ALIASES).toHaveLength(8)
    expect(CATEGORIES.length).toBeGreaterThan(0)
    expect(RUST.participants.map((p) => p.id)).toEqual(['staff-5', 'staff-1', 'staff-2'])
    expect(RUST.vectors.check_section.length).toBeGreaterThan(5)
    // The moderator may name a participant or nobody.
    const next = (SCHEMAS.moderator.properties as Record<string, { enum: string[] }>).next.enum
    expect(next).toEqual(['staff-5', 'staff-1', 'staff-2', ''])
  })

  it('only uses keywords the subset validator knows (no anyOf), as the Rust test asserts for the article schemas', () => {
    const keys = new Set<string>()
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k)
          if (k !== 'properties') walk(x)
          else Object.values(x as object).forEach(walk)
        }
      }
    }
    Object.values(SCHEMAS).forEach(walk)
    for (const bad of ['anyOf', 'oneOf', 'allOf', '$ref', 'pattern']) expect(keys.has(bad)).toBe(false)
  })
})

describe('rustWordCount', () => {
  it.each(RUST.vectors.word_count.map((v) => [JSON.stringify(v.text), v.text, v.words] as const))('%s has the Rust count', (_, text, words) => {
    expect(rustWordCount(text)).toBe(words)
  })
})

describe('checkSection mirrors check_section', () => {
  it.each(RUST.vectors.check_section.map((v) => [v.name, v] as const))('%s', (_, v) => {
    const kinds = checkSection(v.draft, { section: v.section, budgetWords: v.budget_words }).map((e) => e.kind)
    expect(kinds).toEqual(v.kinds)
    // The shape is valid by the schema whatever the checks say (except the empty draft).
    if (v.draft.blocks.length > 0) expect(validateJsonSchema(v.draft, SCHEMAS.section).ok).toBe(true)
  })

  it('reports the band in the message the repair turn would send', () => {
    const [e] = checkSection({ blocks: [{ type: 'paragraph', text: 'one two three', items: [] }] }, { section: 's1', budgetWords: 100 })
    expect(e).toEqual({ kind: 'too_short', message: 'has 3 words; about 100 were asked for (60 to 140 is accepted)' })
  })
})

describe('reading text', () => {
  const draft = {
    blocks: [
      { type: 'paragraph' as const, text: 'The first train is busiest before nine. The slipway empties after it.', items: [] },
      { type: 'list' as const, text: '', items: ['one', 'two'] },
      { type: 'tip' as const, text: 'Ask at the ticket office.', items: [] },
    ],
  }

  it('counts section words like the length check', () => {
    expect(sectionWords(draft)).toBe(12 + 2 + 5)
  })

  it('digests a section into heading, first and last sentence', () => {
    expect(sectionDigest('Getting there', draft)).toBe('Getting there: The first train is busiest before nine. … Ask at the ticket office.')
    expect(sectionDigest('Empty', { blocks: [] })).toBe('Empty: ')
  })

  it('renders the article with section tags for the review', () => {
    const outline = { title: 'T', dek: 'D', category: 'Hiking', hero: 'M1', sections: [{ heading: 'H1', points: ['p'], words: 100 }], closing_title: 'Before you go', links: [] }
    const text = readingText(outline, [draft], { content: 'Go early.' })
    expect(text).toContain('## [s1] H1')
    expect(text).toContain('- one')
    expect(text).toContain('Tip: Ask at the ticket office.')
    expect(text).toContain('## [closing] Before you go\nGo early.')
  })
})
