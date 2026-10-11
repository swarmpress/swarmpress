/**
 * The Brick Studio over WordPress (FEAT-110, ADR-0082 §4): post types as buildings, a template's
 * regions as storeys (a post type without one is one free region), WordPress's blocks as the
 * checker's set, and a saved draft back into regions (a new post type refused).
 */
import { describe, expect, it } from 'vitest'
import { FREE_REGION_BLOCKS, regionsOf, wordpressBlueprint, wordpressModels, type WpStudio } from './wp-studio'

const studio = (over: Partial<WpStudio> = {}): WpStudio => ({
  head: 'abc123',
  postTypes: [
    { slug: 'post', name: 'Posts', hierarchical: false },
    { slug: 'page', name: 'Pages', hierarchical: true },
    { slug: 'attachment', name: 'Media', hierarchical: false },
    { slug: 'wp_template', name: 'Templates', hierarchical: false },
  ],
  templates: {},
  blockTypes: ['core/paragraph', 'core/heading', 'core/list', 'core/image', 'core/quote', 'core/group'],
  plugins: [{ plugin: 'forms/forms', name: 'Forms', status: 'active', governed: false }],
  palette: [{ slug: 'base', name: 'Base', color: '#ffffff' }],
  userStylesId: null,
  ...over,
})

describe('the Studio over WordPress', () => {
  it('shows the site’s post types as buildings with one free region each', () => {
    const bp = wordpressBlueprint(studio())
    expect(bp.page_types.map((t) => t.id)).toEqual(['post', 'page'])
    expect(bp.page_types[0]).toMatchObject({ label: { en: 'Posts' }, route: '/{slug}/', source: { kind: 'page' } })
    expect(bp.page_types[0].slots).toEqual([{ id: 'content', blocks: FREE_REGION_BLOCKS.filter((b) => studio().blockTypes.includes(b)), min: 0 }])
  })

  it('shows a template’s regions as storeys, with only the blocks the site has', () => {
    const bp = wordpressBlueprint(studio({ templates: { post: { regions: [{ id: 'intro', blocks: ['core/heading', 'acme/gone'], min: 1, max: 1 }, { id: 'body', blocks: ['core/paragraph', 'core/list'] }] } } }))
    expect(bp.page_types[0].slots).toEqual([
      { id: 'intro', blocks: ['core/heading'], min: 1, max: 1 },
      { id: 'body', blocks: ['core/paragraph', 'core/list'], min: 0 },
    ])
  })

  it('gives the checker WordPress’s blocks, a hash, the palette as tokens and the plugins', () => {
    const m = wordpressModels(studio(), { hashBlueprint: (t) => `h:${t.length}`, townDesign: () => '{"format":"swarmpress.design.v1"}' })
    expect(m.engine).toBe('wordpress')
    expect(m.context.custom_blocks).toContain('core/paragraph')
    expect(m.hash).toMatch(/^h:\d+$/)
    expect(m.tokens).toEqual([['--wp--preset--color--base', '#ffffff']])
    expect(m.town).toEqual({ format: 'swarmpress.design.v1' })
    expect(m.plugins[0].governed).toBe(false)
  })

  it('turns a saved draft into regions; the free region removes the template; a new post type is refused', () => {
    const s = studio({ templates: { page: { regions: [{ id: 'hero', blocks: ['core/image'] }] } } })
    const bp = wordpressBlueprint(s)
    bp.page_types[0].slots = [{ id: 'intro', blocks: ['core/heading'], min: 1, max: 1 }, { id: 'body', blocks: ['core/paragraph'] }]
    bp.page_types[1].slots = wordpressBlueprint(studio()).page_types[1].slots
    const { templates, refused } = regionsOf(bp, s)
    expect(refused).toEqual([])
    expect(templates).toEqual({ post: { regions: [{ id: 'intro', blocks: ['core/heading'], min: 1, max: 1 }, { id: 'body', blocks: ['core/paragraph'] }] } })
    bp.page_types.push({ id: 'event', label: { en: 'Events' }, source: { kind: 'page' }, slots: [] })
    expect(regionsOf(bp, s).refused).toEqual(['event: a new post type is code (a plugin), not an edit'])
  })
})
