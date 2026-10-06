import { describe, expect, it } from 'vitest'
import type { PageRecord } from '../../src/content/load'
import { isArticle, type RouteEntry } from '../../src/routes/plan'

// FEAT-089: the route planner reads the page-type registry instead of its
// own list of article spellings.
const entry = (kind: RouteEntry['kind'], pageType?: string): RouteEntry =>
  ({
    kind,
    route: 'page',
    lang: 'en',
    path: '/en/x',
    key: 'x',
    params: {},
    page: pageType === undefined ? undefined : ({ pageType } as PageRecord),
  }) as RouteEntry

describe('isArticle', () => {
  it('knows the article type and its aliases from the registry', () => {
    for (const t of ['blog-article', 'blog-post', 'article']) {
      expect(isArticle(entry('page', t))).toBe(true)
    }
  })
  it('rejects other types and pages without one', () => {
    for (const t of ['blog-index', 'village', 'page']) {
      expect(isArticle(entry('page', t))).toBe(false)
    }
    expect(isArticle(entry('page'))).toBe(false)
  })
  it('takes the blog-post route kind as an article', () => {
    expect(isArticle(entry('blog-post'))).toBe(true)
  })
})
