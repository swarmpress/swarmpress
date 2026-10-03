// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import golden from '../../../../crates/agents/tests/fixtures/article/page.golden.json'
import { legacyMvpPage } from '../llm/mvp-script'
import { articleHtml, articleSummary, decodeEntities, escapeHtml, httpsImageUrl, localized, PREVIEW_CSP } from './article-preview'

/**
 * The preview document (increment U1, ADR-0059): the page JSON is model
 * output, so these tests feed it hostile pages and look at the DOM a browser
 * would build from the result. Nothing of a page may become an element, an
 * attribute or an address other than an `https:` image.
 */
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const render = (page: unknown, opts?: Parameters<typeof articleHtml>[1]) => parse(articleHtml(page, opts))
const texts = (doc: Document, selector: string) => [...doc.querySelectorAll(selector)].map((el) => el.textContent)

/** Elements and attributes a page must never be able to add. */
function expectInert(doc: Document) {
  expect(doc.querySelectorAll('script, iframe, object, embed, form, input, button, link, base, a, svg, math, video, audio')).toHaveLength(0)
  // The only `<meta>`s and the only `<style>` are the document's own, in the head.
  expect(doc.body.querySelectorAll('meta, style')).toHaveLength(0)
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of el.getAttributeNames()) {
      expect(attr.startsWith('on'), `${el.tagName} ${attr}`).toBe(false)
      expect(['style', 'srcdoc', 'href', 'action', 'formaction', 'srcset'], `${el.tagName} ${attr}`).not.toContain(attr)
    }
  }
  for (const img of doc.querySelectorAll('img')) expect(img.getAttribute('src')).toMatch(/^https:\/\//)
}

/** The page the scripted MVP model wrote before the staged article: the older, simple shape (no hero). */
const simplePage = () => {
  return structuredClone(legacyMvpPage('We climbed to the terraces at seven, before the sun reached the vines.')) as Record<string, unknown>
}

describe('the golden article (the shape the orchestrator assembles)', () => {
  const doc = render(golden)

  it('has exactly one h1: the hero title, with its entities decoded', () => {
    expect(texts(doc, 'h1')).toEqual(['Crates, Ladders & Sweet Wine: Harvest Week in Manarola'])
    expect(doc.title).toBe('Crates, Ladders & Sweet Wine: Harvest Week in Manarola')
    // Escaped once in the source: not markup, and not `&amp;amp;`.
    const html = articleHtml(golden)
    expect(html).toContain('<h1 class="title">Crates, Ladders &amp; Sweet Wine: Harvest Week in Manarola</h1>')
    expect(html).not.toContain('&amp;amp;')
  })

  it('renders every block in order: hero, intro, sections, list, callout, image, closing note', () => {
    expect(doc.querySelector('.hero .badge')!.textContent).toBe('Food & Drink')
    expect(doc.querySelector('.hero .dek')!.textContent).toBe('What the Sciacchetrà harvest looks like from the path above the village, and how to watch it without getting in the way.')
    expect(texts(doc, 'h2')).toEqual(['Where the vines grow', 'How to watch the harvest', 'What ends up in the glass', 'Before you go'])
    expect(doc.querySelectorAll('article > p.text')).toHaveLength(7)
    expect(texts(doc, 'article > ul > li')).toEqual([
      'Stay on the marked path and leave the vineyard gates as you find them.',
      'Step aside for anyone carrying a crate; they have the right of way.',
      'Ask before you photograph people at work.',
    ])
    expect(doc.querySelector('aside.callout.callout-info')!.textContent).toContain('carry water')
    expect(doc.querySelector('figure figcaption')!.textContent).toBe('Photo by Luca Bravo on Unsplash')
    // The closing note's content is the other HTML field of the theme: decoded for display.
    expect(doc.querySelector('.closing .closing-text')!.textContent).toContain('all day & evening')
    expect(doc.querySelector('.closing .badge')!.textContent).toBe('Practical Notes')
    expect(doc.querySelectorAll('.placeholder')).toHaveLength(0)
  })

  it('loads the hero and the inline image from their https addresses, and nothing else', () => {
    const imgs = [...doc.querySelectorAll('img')]
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      'https://images.unsplash.com/photo-1499678329028-101435549a4e?q=80&w=2000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=1200&auto=format&fit=crop',
    ])
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['', 'Manarola seen from the sea at dusk'])
    expect(imgs.every((i) => i.getAttribute('referrerpolicy') === 'no-referrer')).toBe(true)
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')).toBe(PREVIEW_CSP)
    expect(PREVIEW_CSP).toContain("default-src 'none'")
    expect(PREVIEW_CSP).toContain('img-src https:')
    expect(PREVIEW_CSP).not.toMatch(/script-src|connect-src|frame-src/)
    expectInert(doc)
  })

  it('names the closing note’s links as text instead of linking them', () => {
    expect(texts(doc, '.closing .actions li')).toEqual(['Manarola /en/manarola', 'Hiking from Manarola /en/manarola/hiking'])
    expect(doc.querySelectorAll('a')).toHaveLength(0)
  })

  it('summarises title and dek for the ticket', () => {
    expect(articleSummary(golden)).toEqual({
      title: 'Crates, Ladders & Sweet Wine: Harvest Week in Manarola',
      dek: 'What the Sciacchetrà harvest looks like from the path above the village, and how to watch it without getting in the way.',
      badge: 'Food & Drink',
    })
  })
})

describe('the older simple shape (what the scripted MVP writes today)', () => {
  it('shows the page title as the one h1 and the SEO description as the dek', () => {
    const page = simplePage()
    const doc = render(page)
    expect(texts(doc, 'h1')).toEqual(['Harvest week in Manarola'])
    expect(doc.querySelector('.dek')!.textContent).toBe('Picking Sciacchetrà grapes on the terraces.')
    expect(texts(doc, 'h2')).toEqual(['On the terraces'])
    expect(doc.querySelector('p.text')!.textContent).toMatch(/terraces/)
    expect(doc.querySelector('aside.callout')!.textContent).toBe('The harvest moves with the weather; check before you go.')
    expect(articleSummary(page)).toMatchObject({ title: 'Harvest week in Manarola', dek: 'Picking Sciacchetrà grapes on the terraces.' })
    expectInert(doc)
  })

  it('renders quote, ordered list and faq', () => {
    const page = simplePage()
    ;(page.body as unknown[]).push(
      { type: 'quote', text: 'We pick at first light.', attribution: 'Maria, grower' },
      { type: 'list', ordered: true, items: ['Climb', 'Pick', 'Carry'] },
      { type: 'faq', items: [{ question: 'When is the harvest?', answer: 'In September.' }] },
    )
    const doc = render(page)
    expect(doc.querySelector('blockquote p')!.textContent).toBe('We pick at first light.')
    expect(doc.querySelector('blockquote footer')!.textContent).toBe('Maria, grower')
    expect(texts(doc, 'ol > li')).toEqual(['Climb', 'Pick', 'Carry'])
    expect(texts(doc, '.faq dt')).toEqual(['When is the harvest?'])
    expect(texts(doc, '.faq dd')).toEqual(['In September.'])
    expect(doc.querySelectorAll('.placeholder')).toHaveLength(0)
  })

  it('falls back to the work item’s title when the page names none', () => {
    expect(texts(render({ body: [{ type: 'paragraph', markdown: 'Text.' }] }, { fallbackTitle: 'Harvest week' }), 'h1')).toEqual(['Harvest week'])
    expect(texts(render({ body: [] }), 'h1')).toEqual(['Untitled article'])
    expect(render({ body: [] }).querySelector('.empty')!.textContent).toBe('This page has no body blocks.')
    // Not a page at all: still a document, still inert.
    for (const junk of [null, 'page', 42, [], { body: 'text' }]) expectInert(render(junk))
  })
})

describe('untrusted page JSON', () => {
  const ATTACK = '<script>alert(1)</script><img src=x onerror=alert(2)>'

  it('shows markup in any text field as text', () => {
    const page = {
      title: { en: ATTACK },
      seo: { description: { en: ATTACK } },
      body: [
        { type: 'paragraph', markdown: ATTACK },
        { type: 'heading', level: 2, text: ATTACK },
        { type: 'list', ordered: false, items: [ATTACK] },
        { type: 'callout', style: ATTACK, title: ATTACK, content: ATTACK },
        { type: 'quote', text: ATTACK, attribution: ATTACK },
        { type: 'faq', items: [{ question: ATTACK, answer: ATTACK }] },
        { type: 'image', src: 'https://example.com/a.jpg', alt: ATTACK, caption: ATTACK },
        { type: 'closing-note', badge: ATTACK, title: ATTACK, content: ATTACK, actions: [{ label: ATTACK, href: ATTACK }] },
      ],
    }
    const doc = render(page, { fallbackTitle: ATTACK })
    expectInert(doc)
    expect(texts(doc, 'h1')).toEqual([ATTACK])
    expect(doc.querySelector('p.text')!.textContent).toBe(ATTACK)
    expect(doc.querySelector('li')!.textContent).toBe(ATTACK)
    // A style outside the fixed list is not a class name.
    expect(doc.querySelector('aside')!.className).toBe('callout callout-info')
    expect([...doc.querySelectorAll('img')].map((i) => i.getAttribute('alt'))).toEqual([ATTACK])
    expect(doc.title).toBe(ATTACK)
  })

  it('decodes the pre-escaped HTML fields for display and never turns them into markup', () => {
    const page = {
      body: [
        { type: 'editorial-hero', title: '&lt;script&gt;alert(1)&lt;/script&gt; Tom &amp; Jerry &#39;s &quot;wine&quot;', subtitle: 'Dek', image: 'https://example.com/h.jpg' },
        { type: 'paragraph', markdown: 'Kept as written: &amp; &lt;b&gt;' },
        { type: 'closing-note', title: 'End', content: '&lt;img src=x onerror=alert(1)&gt; &amp;lt; raw <b onclick="x()">bold</b>' },
      ],
    }
    const doc = render(page)
    expectInert(doc)
    expect(texts(doc, 'h1')).toEqual(['<script>alert(1)</script> Tom & Jerry \'s "wine"'])
    // Only the two HTML fields are decoded; a paragraph is printed as the theme prints it.
    expect(doc.querySelector('p.text')!.textContent).toBe('Kept as written: &amp; &lt;b&gt;')
    // One decoding pass: `&amp;lt;` is the text `&lt;`, and raw markup stays text.
    expect(doc.querySelector('.closing-text')!.textContent).toBe('<img src=x onerror=alert(1)> &lt; raw <b onclick="x()">bold</b>')
    expect(doc.querySelectorAll('b')).toHaveLength(0)
  })

  it('an onerror= attribute attempt through alt or src stays inside the attribute value', () => {
    const page = {
      body: [
        { type: 'image', src: 'https://example.com/a.jpg" onerror="alert(1)', alt: '" onerror="alert(1)" x="' },
        { type: 'image', src: "https://example.com/b.jpg' onerror='alert(1)", alt: "' onerror='alert(1)" },
      ],
    }
    const doc = render(page)
    expectInert(doc)
    const imgs = [...doc.querySelectorAll('img')]
    expect(imgs).toHaveLength(2)
    expect(imgs.map((i) => i.getAttributeNames().sort())).toEqual([
      ['alt', 'class', 'referrerpolicy', 'src'],
      ['alt', 'class', 'referrerpolicy', 'src'],
    ])
    expect(imgs[0].getAttribute('alt')).toBe('" onerror="alert(1)" x="')
    // The URL parser percent-encodes what it keeps; nothing breaks out of `src`.
    expect(imgs[0].getAttribute('src')).toBe('https://example.com/a.jpg%22%20onerror=%22alert(1)')
  })

  it('drops a javascript: image URL, and every other address that is not https', () => {
    const bad = ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'http://example.com/a.jpg', '//example.com/a.jpg', '/giulia.png', 'https://user:pw@example.com/a.jpg', 'https://', '', null, 7, { href: 'https://x' }]
    for (const src of bad) expect(httpsImageUrl(src), String(src)).toBeNull()
    expect(httpsImageUrl(' https://example.com/a b.jpg ')).toBe('https://example.com/a%20b.jpg')

    const page = {
      body: [
        { type: 'editorial-hero', title: 'T', image: 'javascript:alert(1)' },
        ...bad.map((src) => ({ type: 'image', src, alt: 'A terrace', caption: 'Caption stays' })),
      ],
    }
    const doc = render(page)
    expectInert(doc)
    expect(doc.querySelectorAll('img')).toHaveLength(0)
    expect(articleHtml(page)).not.toMatch(/javascript:/i)
    // The reader is told an image is missing, and still gets its alt text and caption.
    const figures = [...doc.querySelectorAll('figure')]
    expect(figures).toHaveLength(bad.length)
    expect(figures[0].querySelector('.placeholder')!.textContent).toBe('Image not shown: the preview loads images from https: addresses only. A terrace')
    expect(figures[0].querySelector('figcaption')!.textContent).toBe('Caption stays')
    expect(doc.querySelector('.hero .placeholder')).not.toBeNull()
  })

  it('shows an unknown block type as a labelled placeholder instead of dropping it', () => {
    const page = {
      title: 'T',
      body: [
        { type: 'paragraph', markdown: 'Before.' },
        { type: 'gallery', layout: 'grid', images: [{ src: 'https://example.com/a.jpg', alt: 'a' }] },
        { type: 'editorial-intro', badge: 'Intro', quote: 'q', leftContent: '<p onclick="x()">html</p>', rightContent: '<script>x</script>' },
        { type: '<b>bold</b>' },
        { markdown: 'no type' },
        'a string',
        null,
        { type: 'paragraph', markdown: 'After.' },
      ],
    }
    const doc = render(page)
    expectInert(doc)
    expect(texts(doc, '.placeholder')).toEqual([
      'Block gallery is not shown in this preview.',
      'Block editorial-intro is not shown in this preview.',
      'Block <b>bold</b> is not shown in this preview.',
      'Block (no type) is not shown in this preview.',
      'A block that is not an object is not shown.',
      'A block that is not an object is not shown.',
    ])
    expect(texts(doc, 'p.text')).toEqual(['Before.', 'After.'])
    // The HTML fields of an unknown block are not rendered at all.
    expect(doc.body.textContent).not.toContain('html')
  })

  it('always has exactly one h1, whatever the page holds', () => {
    const hero = (title: string) => ({ type: 'editorial-hero', title, image: 'https://example.com/h.jpg' })
    const pages: unknown[] = [
      golden,
      simplePage(),
      { body: [hero('First'), hero('Second'), { type: 'hero', title: 'Third' }] },
      { title: 'Page title', body: [{ type: 'heading', level: 1, text: 'A level-1 heading' }, { type: 'heading', level: 0, text: 'Zero' }, { type: 'heading', level: 9, text: 'Nine' }, { type: 'heading', text: 'None' }] },
      { title: 'Page title', body: [{ type: 'paragraph', markdown: 'x' }, hero('Late hero')] },
      { body: [{ type: 'paragraph', markdown: '<h1>not a heading</h1>' }] },
      {},
    ]
    for (const page of pages) expect(render(page).querySelectorAll('h1'), JSON.stringify(page).slice(0, 80)).toHaveLength(1)
    // Later heroes keep their title, one level down; heading levels stay between 2 and 6.
    expect(texts(render(pages[2]), 'h1, h2')).toEqual(['First', 'Second', 'Third'])
    expect([...render(pages[3]).querySelectorAll('h2, h3, h4, h5, h6')].map((h) => `${h.tagName} ${h.textContent}`)).toEqual(['H2 A level-1 heading', 'H2 Zero', 'H6 Nine', 'H2 None'])
    expect(texts(render(pages[4]), 'h1')).toEqual(['Late hero'])
  })

  it('takes the language only from a two-letter code', () => {
    expect(render({ title: { en: 'Harvest', de: 'Ernte' }, body: [] }, { lang: 'de' }).documentElement.lang).toBe('de')
    expect(texts(render({ title: { en: 'Harvest', de: 'Ernte' }, body: [] }, { lang: 'de' }), 'h1')).toEqual(['Ernte'])
    expect(render({ body: [] }, { lang: '"><script>' }).documentElement.lang).toBe('en')
  })
})

describe('helpers', () => {
  it('escapeHtml covers text and quoted attribute values', () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;')
  })

  it('decodeEntities decodes once and leaves what it does not know', () => {
    expect(decodeEntities('Tom &amp; Jerry &lt;3 &gt; &quot;x&quot; &#39;y&#39; &#x27;z&#x27; &apos;a&apos; caf&#233;')).toBe(`Tom & Jerry <3 > "x" 'y' 'z' 'a' café`)
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
    expect(decodeEntities('&unknown; &#0; &#xD800; &#1114112; & plain')).toBe('&unknown; &#0; &#xD800; &#1114112; & plain')
  })

  it('localized reads a plain string or a LocalizedString', () => {
    expect(localized('Plain')).toBe('Plain')
    expect(localized({ en: 'Harvest', it: 'Vendemmia' }, 'it')).toBe('Vendemmia')
    expect(localized({ en: 'Harvest' }, 'de')).toBe('Harvest')
    expect(localized({ it: 'Vendemmia' })).toBe('Vendemmia')
    expect([null, 3, ['x'], { en: 3 }].map((v) => localized(v))).toEqual(['', '', '', ''])
  })
})
