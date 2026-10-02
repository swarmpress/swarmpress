import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SchemaRegistry, validatePage } from '../../src/content/validate'
import { migrateContent, migratePage } from '../../src/migrate'
import { MINI_CONTENT } from '../helpers'

const page = (body: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'p',
  slug: { en: '/en/p' },
  title: { en: 'Page title', de: 'Seitentitel' },
  page_type: 'page',
  body,
  ...extra,
})

const block = (r: { page: unknown }, i = 0) => (r.page as { body: Record<string, unknown>[] }).body[i]

describe('kit migrate codemods', () => {
  it('editorial-intro: content → leftContent (+ rightContent when it splits)', () => {
    const one = migratePage(page([{ type: 'editorial-intro', content: 'Only one.' }]))
    expect(block(one)).toEqual({ type: 'editorial-intro', leftContent: 'Only one.' })
    const two = migratePage(page([{ type: 'editorial-intro', content: { en: ['a', 'b', 'c'], de: ['x', 'y'] } }]))
    expect(block(two)).toEqual({ type: 'editorial-intro', leftContent: { en: 'a\n\nb', de: 'x' }, rightContent: { en: 'c', de: 'y' } })
    expect(two.changes[0].rule).toBe('editorial-intro/content-to-leftContent')
  })

  it('closing-note: buttons / primaryButton → actions, author → page metadata', () => {
    const r = migratePage(
      page([
        {
          type: 'closing-note',
          title: 'Bye',
          content: ['p1', 'p2'],
          author: 'Giulia',
          buttons: [{ text: 'Plan', url: '/plan' }, { text: 'Read', url: '/blog' }],
          primaryButton: { label: 'Go', href: '/go' },
        },
      ]),
    )
    expect(block(r)).toEqual({
      type: 'closing-note',
      title: 'Bye',
      content: 'p1\n\np2',
      actions: [
        { label: 'Plan', href: '/plan', variant: 'primary' },
        { label: 'Read', href: '/blog', variant: 'secondary' },
        { label: 'Go', href: '/go', variant: 'primary' },
      ],
    })
    expect((r.page as { metadata: unknown }).metadata).toEqual({ closingNote: { author: 'Giulia' } })
  })

  it('faq-section: faqs → items, heading → title', () => {
    const r = migratePage(page([{ type: 'faq-section', heading: 'FAQ', faqs: [{ question: 'Q', answer: 'A' }] }]))
    expect(block(r)).toEqual({ type: 'faq-section', title: 'FAQ', items: [{ question: 'Q', answer: 'A' }] })
  })

  it('blog-article: unwraps the post wrapper; keeps title/date; extras → metadata', () => {
    const r = migratePage(
      page([
        {
          type: 'blog-article',
          post: { title: 'T', date: '2026-01-02', author: { name: 'Ana', image: 'https://img.test/a.jpg', bio: 'Writer' }, image: 'https://img.test/h.jpg', tags: ['x'] },
          content: { intro: 'Intro', sections: [{ title: 'S1', text: 'Body' }], quote: { text: 'Q', author: 'Z' } },
        },
      ]),
    )
    expect(block(r)).toEqual({
      type: 'blog-article',
      title: 'T',
      date: '2026-01-02',
      author: 'Ana',
      authorImage: 'https://img.test/a.jpg',
      heroImage: 'https://img.test/h.jpg',
      content: [
        { type: 'paragraph', text: 'Intro' },
        { type: 'heading', level: 2, text: 'S1' },
        { type: 'paragraph', text: 'Body' },
        { type: 'quote', text: 'Q' },
      ],
    })
    expect((r.page as { metadata: { blog: unknown } }).metadata.blog).toEqual({ quoteAuthor: 'Z', author: { bio: 'Writer' }, tags: ['x'] })
  })

  it('blog-article: fills a missing title from the page title', () => {
    const r = migratePage(page([{ type: 'blog-article', content: [{ type: 'paragraph', text: 'x' }] }]))
    expect(block(r).title).toEqual({ en: 'Page title', de: 'Seitentitel' })
  })

  it('is idempotent and leaves clean pages untouched', () => {
    const p = page([{ type: 'faq-section', title: 'FAQ', items: [] }])
    const r = migratePage(p)
    expect(r.changes).toEqual([])
    expect(r.page).toBe(p)
    const once = migratePage(page([{ type: 'faq-section', faqs: [] }]))
    expect(migratePage(once.page).changes).toEqual([])
  })

  it('makes migrated blocks valid against schema v2', () => {
    const registry = SchemaRegistry.core()
    const before = page([{ type: 'faq-section', heading: 'FAQ', faqs: [{ question: 'Q', answer: 'A' }] }])
    expect(validatePage(before, registry).length).toBeGreaterThan(0)
    expect(validatePage(migratePage(before).page, registry)).toEqual([])
  })
})

describe('migrateContent over a content tree', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'kit-migrate-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  cpSync(MINI_CONTENT, join(tmp, 'content'), { recursive: true })

  it('is a dry run by default and writes with --write', () => {
    const file = join(tmp, 'content/pages/blog/5-hidden-gelaterias-you-need-to-try.json')
    const original = readFileSync(file, 'utf8')
    const dry = migrateContent(tmp)
    expect(dry.files.length).toBeGreaterThan(0)
    expect(dry.byRule['blog-article/unwrap-post']).toBeGreaterThan(0)
    expect(readFileSync(file, 'utf8')).toBe(original)
    const wet = migrateContent(tmp, { write: true })
    expect(wet.files.length).toBe(dry.files.length)
    expect(readFileSync(file, 'utf8')).not.toBe(original)
    expect(migrateContent(tmp).files).toEqual([])
  })
})
