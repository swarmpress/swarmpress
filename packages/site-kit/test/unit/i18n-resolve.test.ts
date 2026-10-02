import { describe, expect, it } from 'vitest'
import type { MediaEntry } from '../../src/content/load'
import { createT, languageName, localize, localizeAny, localizeList, textDirection } from '../../src/i18n'
import { absoluteUrl, checkLinksIn, checkMediaIn, collectLinks, resolveHref, resolveMedia, routeUrl, withBase } from '../../src/resolve'

describe('localize / localizeAny / localizeList', () => {
  it('reads plain strings for every language', () => {
    expect(localize('Hello', 'de')).toBe('Hello')
  })
  it('picks the language, then the fallback chain, then en', () => {
    const v = { en: 'Hello', de: 'Hallo', it: '' }
    expect(localize(v, 'de')).toBe('Hallo')
    expect(localize(v, 'it')).toBe('Hello') // empty counts as missing
    expect(localize(v, 'fr', ['de'])).toBe('Hallo')
    expect(localize(v, 'fr')).toBe('Hello')
  })
  it('falls back to any value when en is absent, and to "" for nothing', () => {
    expect(localize({ de: 'Nur' }, 'fr')).toBe('Nur')
    expect(localize(undefined, 'en')).toBe('')
    expect(localize({ en: { nested: true } }, 'en')).toBe('')
  })
  it('keeps non-language objects intact', () => {
    const obj = { label: 'x', href: '/y' }
    expect(localizeAny(obj, 'de')).toBe(obj)
  })
  it('handles lists localized per language and lists of localized items', () => {
    expect(localizeList({ en: ['a', 'b'], de: ['c'] }, 'de')).toEqual(['c'])
    expect(localizeList([{ en: 'a', de: 'A' }, 'b'], 'de')).toEqual(['A', 'b'])
    expect(localize({ en: ['p1', 'p2'] }, 'en')).toBe('p1\n\np2')
  })
})

describe('t()', () => {
  it('prefers theme strings, then kit strings, then en, then the key', () => {
    const t = createT('de', { de: { 'nav.home': 'Heim' }, en: { custom: 'Custom {n}' } })
    expect(t('nav.home')).toBe('Heim')
    expect(t('custom', { n: 3 })).toBe('Custom 3')
    expect(t('does.not.exist')).toBe('does.not.exist')
    const tFr = createT('fr')
    expect(tFr('nav.home')).not.toBe('nav.home')
  })
  it('computes language names and direction instead of hardcoding them', () => {
    expect(languageName('de')).toBe('Deutsch')
    expect(languageName('it')).toBe('Italiano')
    expect(textDirection('ar')).toBe('rtl')
    expect(textDirection('en')).toBe('ltr')
  })
})

describe('URLs and base', () => {
  it('joins base and route with trailing slashes', () => {
    expect(withBase('/', '/en/x')).toBe('/en/x')
    expect(withBase('/preview/42/', '/en/x')).toBe('/preview/42/en/x')
    expect(routeUrl('/', '/en/riomaggiore')).toBe('/en/riomaggiore/')
    expect(routeUrl('/p/', '/')).toBe('/p/')
    expect(absoluteUrl('https://a.test/', '/p/', '/en')).toBe('https://a.test/p/en/')
  })
})

describe('closed-world link resolution', () => {
  const ctx = { base: '/b/', languages: ['en', 'de'], known: new Set(['/en', '/en/riomaggiore', '/de/riomaggiore']) }
  it('prefixes the current language and the base for internal links', () => {
    expect(resolveHref('/riomaggiore/', 'de', ctx)).toEqual({ href: '/b/de/riomaggiore/', internal: true, ok: true, route: '/de/riomaggiore' })
  })
  it('keeps explicit language prefixes, query and hash', () => {
    expect(resolveHref('/en/riomaggiore?x=1#top', 'de', ctx).href).toBe('/b/en/riomaggiore/?x=1#top')
  })
  it('flags unknown routes but never external, mailto, hash or asset links', () => {
    expect(resolveHref('/nowhere', 'en', ctx).ok).toBe(false)
    for (const h of ['https://x.test/a', 'mailto:a@b.c', '#top', '//cdn.test/x']) expect(resolveHref(h, 'en', ctx)).toMatchObject({ internal: false, ok: true })
    expect(resolveHref('/files/menu.pdf', 'en', ctx)).toMatchObject({ ok: true, href: '/b/files/menu.pdf' })
  })
  it('checks every link field of a page, per language', () => {
    const body = [
      { type: 'closing-note', actions: [{ label: 'a', href: { en: '/riomaggiore', de: '/manarola' } }] },
      { type: 'cards', items: [{ url: 'https://ext.test' }, { url: '/en' }] },
    ]
    expect(collectLinks(body).map((l) => l.path)).toEqual(['/0/actions/0/href', '/1/items/0/url', '/1/items/1/url'])
    const de = checkLinksIn(body, 'p.json', 'de', ctx)
    expect(de.checked).toBe(2)
    expect(de.broken).toEqual([{ file: 'p.json', path: '/0/actions/0/href', lang: 'de', href: '/manarola', resolved: '/de/manarola' }])
    expect(checkLinksIn(body, 'p.json', 'en', ctx).broken).toEqual([])
  })
})

describe('media resolution', () => {
  const media = new Map<string, MediaEntry>([
    ['m1', { id: 'm1', url: 'https://img.test/1.jpg', alt: { en: 'One', de: 'Eins' }, width: 800, height: 600 } as MediaEntry],
    ['local', { id: 'local', url: '/images/x.jpg' } as MediaEntry],
  ])
  it('resolves media:<id> through the index with localized alt', () => {
    expect(resolveMedia('media:m1', media, { base: '/', lang: 'de' })).toEqual({ src: 'https://img.test/1.jpg', alt: 'Eins', width: 800, height: 600, id: 'm1' })
    expect(resolveMedia('media:local', media, { base: '/p/', lang: 'en' })?.src).toBe('/p/images/x.jpg')
  })
  it('passes URLs and root paths through, rejects unknown ids and junk', () => {
    expect(resolveMedia('https://x.test/a.png', media, { base: '/', lang: 'en' })).toEqual({ src: 'https://x.test/a.png' })
    expect(resolveMedia('/a.png', media, { base: '/p/', lang: 'en' })).toEqual({ src: '/p/a.png' })
    expect(resolveMedia('media:nope', media, { base: '/', lang: 'en' })).toBeUndefined()
    expect(resolveMedia('a.png', media, { base: '/', lang: 'en' })).toBeUndefined()
  })
  it('reports unknown media ids as errors', () => {
    const f = checkMediaIn({ body: [{ type: 'image', src: 'media:nope' }, { type: 'image', src: 'media:m1' }] }, 'p.json', media)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', code: 'unknown_media', path: '/body/0/src' })
  })
})
