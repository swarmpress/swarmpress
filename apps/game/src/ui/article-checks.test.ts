import { describe, expect, it } from 'vitest'
import golden from '../../../../crates/agents/tests/fixtures/article/page.golden.json'
import styleGuide from '../../../../crates/agents/tests/fixtures/style-guide.json'
import { legacyMvpPage } from '../llm/mvp-script'
import { bannedHits, bodyWords, measureArticle, phraseCount, WORD_TOLERANCE } from './article-checks'

/** Measured checks (increment U1, ADR-0059): numbers counted from the page, the same every time. */
const BANNED = styleGuide.vocabulary.avoid
const simplePage = (): Record<string, unknown> => structuredClone(legacyMvpPage('We climbed to the terraces at seven, before the sun reached the vines.'))

describe('measureArticle', () => {
  it('counts the golden article: body words against the target, blocks, hero, closing note, links, media, banned phrases', () => {
    const c = measureArticle(golden, { targetWords: 400, bannedPhrases: BANNED })
    expect(c).toEqual({
      // intro 25 + 24, sections 40 + 31, 35 + list 34 + callout 22, 33 + 27, closing note 43.
      words: 314,
      targetWords: 400,
      ratio: 0.785,
      withinTarget: true,
      blocks: 15,
      heroes: 1,
      heroFirst: true,
      closingNotes: 1,
      closingLast: true,
      links: 2,
      media: 2,
      mediaNotHttps: 0,
      unknownBlocks: [],
      banned: [],
    })
    // The title, the dek, headings, captions and addresses are not body words.
    expect(bodyWords({ body: golden.body.filter((b) => ['editorial-hero', 'heading', 'image'].includes(b.type)) })).toBe(0)
  })

  it('judges the word count by the ±25% band, and not at all without a target', () => {
    expect(WORD_TOLERANCE).toBe(0.25)
    const at = (targetWords: number | null) => measureArticle(golden, { targetWords })
    expect(at(400)).toMatchObject({ withinTarget: true })
    // 314 words: the band of a 419-word target starts at 314.25.
    expect(at(418)).toMatchObject({ withinTarget: true })
    expect(at(419)).toMatchObject({ withinTarget: false })
    expect(at(251)).toMatchObject({ withinTarget: false })
    expect(at(252)).toMatchObject({ withinTarget: true })
    for (const none of [null, 0, -5]) expect(at(none)).toMatchObject({ targetWords: null, ratio: null, withinTarget: null })
    expect(measureArticle(golden)).toMatchObject({ targetWords: null, banned: null })
  })

  it('measures the older simple shape: no hero, no closing note', () => {
    const c = measureArticle(simplePage(), { targetWords: 600, bannedPhrases: BANNED })
    expect(c).toMatchObject({
      // paragraph 13 + callout 10; the heading is not counted.
      words: 23,
      withinTarget: false,
      blocks: 3,
      heroes: 0,
      heroFirst: false,
      closingNotes: 0,
      closingLast: false,
      links: 0,
      media: 0,
      unknownBlocks: [],
      banned: [],
    })
    expect(c.ratio).toBeCloseTo(0.04)
  })

  it('reports what is wrong with a page: two heroes, a closing note in the middle, an http image, unknown blocks', () => {
    const page = {
      body: [
        { type: 'paragraph', markdown: 'one two three' },
        { type: 'editorial-hero', title: 'A', image: 'http://example.com/a.jpg' },
        { type: 'hero', title: 'B', backgroundImage: 'https://example.com/b.jpg' },
        { type: 'closing-note', title: 'End', content: 'four &amp; five', actions: [{ label: 'x', href: '/en/x' }, { label: 'y', href: '' }] },
        { type: 'gallery', images: [{ src: 'javascript:alert(1)', alt: 'a' }, { src: 'https://example.com/c.jpg', alt: 'c' }] },
        { type: 'gallery' },
        { type: 'quote', text: 'six seven' },
        { type: 'faq', items: [{ question: 'eight nine?', answer: 'ten' }] },
        { markdown: 'no type' },
        'junk',
      ],
    }
    expect(measureArticle(page)).toMatchObject({
      // 3 + closing (four & five) 3 + quote 2 + faq 3.
      words: 11,
      blocks: 10,
      heroes: 2,
      heroFirst: false,
      closingNotes: 1,
      closingLast: false,
      links: 1,
      media: 4,
      mediaNotHttps: 2,
      unknownBlocks: ['gallery', '(no type)'],
    })
    for (const junk of [null, 'page', 7, [], {}, { body: 'text' }]) expect(measureArticle(junk)).toMatchObject({ words: 0, blocks: 0, heroes: 0, closingNotes: 0, links: 0, media: 0 })
  })
})

describe('banned phrases', () => {
  it('uses the list of the site style guide', () => {
    expect(BANNED).toContain('hidden gem')
    expect(BANNED).toContain('stunning')
  })

  it('matches whole words, case-insensitive, as the house-style validator does', () => {
    expect(phraseCount('A stunning view. Stunning! Not stunningly, not astunning.', 'stunning')).toBe(2)
    expect(phraseCount('This Hidden Gem is a hidden gem.', 'hidden gem')).toBe(2)
    expect(phraseCount('hidden gems', 'hidden gem')).toBe(0)
    expect(phraseCount('must-see sights; a must-seen thing', 'must-see')).toBe(1)
    expect(phraseCount('iconico, l’iconic, élegendary', 'iconic')).toBe(1)
    expect(phraseCount('anything', '')).toBe(0)
  })

  it('finds them anywhere in the page and counts each', () => {
    const page = structuredClone(golden) as typeof golden
    ;(page.body[1] as unknown as { markdown: string }).markdown += ' It is a hidden gem with a stunning view.'
    ;(page.body[14] as unknown as { content: string }).content += ' Truly stunning.'
    page.seo.description.en = 'An iconic harvest.'
    expect(bannedHits(page, BANNED)).toEqual([
      { phrase: 'hidden gem', count: 1 },
      { phrase: 'stunning', count: 2 },
      { phrase: 'iconic', count: 1 },
    ])
    expect(measureArticle(page, { bannedPhrases: BANNED }).banned).toHaveLength(3)
    expect(measureArticle(page, { bannedPhrases: [] }).banned).toEqual([])
    expect(measureArticle(page, { bannedPhrases: null }).banned).toBeNull()
  })
})
