import { CORE_BLOCK_TYPES } from '@swarm-press/content-schema'
import { describe, expect, it } from 'vitest'
import { FALLBACK_RENDERER } from '../../src/blocks/fallback-map'
import { coverage, createBlockResolver } from '../../src/blocks/registry'
import { defineTheme, ThemeDefinitionError } from '../../src/theme'
import { DEFAULT_TOKENS, flattenTokens, mergeTokens, tokensToCss } from '../../src/tokens'

describe('design tokens → CSS', () => {
  const tokens = {
    color: {
      $type: 'color',
      brand: { 500: { $value: '#1f5f8b' }, DEFAULT: { $value: '{color.brand.500}' } },
      ink: { $value: '#111' },
    },
    font: { serif: { $type: 'fontFamily', $value: ['Source Serif 4', 'Georgia', 'serif'] } },
    radius: { card: { $type: 'dimension', $value: '0.75rem' } },
    motion: { fast: { $type: 'duration', $value: '150ms' } },
  }
  it('flattens W3C tokens into Tailwind 4 namespaced variables with aliases', () => {
    const vars = Object.fromEntries(flattenTokens(tokens).map((v) => [v.name, v.value]))
    expect(vars['--color-brand-500']).toBe('#1f5f8b')
    expect(vars['--color-brand']).toBe('var(--color-brand-500)')
    expect(vars['--color-ink']).toBe('#111')
    expect(vars['--font-serif']).toBe('"Source Serif 4", Georgia, serif')
    expect(vars['--radius-card']).toBe('0.75rem')
    expect(vars['--duration-motion-fast'] ?? vars['--motion-fast']).toBe('150ms')
  })
  it('emits an @theme block and a :root block', () => {
    const css = tokensToCss(tokens)
    expect(css.theme).toMatch(/^@theme \{\n/)
    expect(css.theme).toContain('--color-brand-500: #1f5f8b;')
    expect(css.root).toMatch(/^:root \{\n/)
  })
  it('fails loudly on dangling aliases', () => {
    expect(() => flattenTokens({ color: { a: { $type: 'color', $value: '{color.nope}' } } })).toThrow(/does not resolve/)
  })
  it('merges theme tokens over the kit defaults', () => {
    const merged = mergeTokens(DEFAULT_TOKENS, { color: { accent: { $value: '#ff0000' } } })
    const vars = Object.fromEntries(flattenTokens(merged).map((v) => [v.name, v.value]))
    expect(vars['--color-accent']).toBe('#ff0000')
    expect(vars['--color-bg']).toBe('#ffffff')
  })
})

describe('block registry + dispatcher', () => {
  const resolve = createBlockResolver({
    theme: { paragraph: 'ThemeParagraph' },
    custom: { 'x:wine-map': 'WineMap' },
    fallback: { paragraph: 'KitParagraph', heading: 'KitHeading' },
  })
  it('prefers the theme, then custom blocks, then the kit fallback', () => {
    expect(resolve('paragraph')).toEqual({ component: 'ThemeParagraph', source: 'theme' })
    expect(resolve('heading')).toEqual({ component: 'KitHeading', source: 'fallback' })
    expect(resolve('x:wine-map')).toEqual({ component: 'WineMap', source: 'custom' })
    expect(resolve('x:unknown')).toEqual({ source: 'missing' })
    expect(resolve('not-a-block')).toEqual({ source: 'missing' })
  })
  it('has a neutral fallback renderer for every core block', () => {
    const missing = CORE_BLOCK_TYPES.filter((t) => !FALLBACK_RENDERER[t])
    expect(missing).toEqual([])
  })
  it('reports coverage per used block type', () => {
    const cov = coverage(['paragraph', 'heading', 'x:wine-map', 'x:gone'], { theme: ['paragraph'], custom: ['x:wine-map'], fallback: Object.keys(FALLBACK_RENDERER) })
    expect(Object.fromEntries(cov)).toEqual({ heading: 'fallback', paragraph: 'theme', 'x:gone': 'missing', 'x:wine-map': 'custom' })
  })
})

describe('defineTheme', () => {
  it('accepts a valid theme', () => {
    const t = defineTheme({ name: 't', blocks: { paragraph: {} }, customBlocks: [{ name: 'wine-map', component: {} }] })
    expect(Object.isFrozen(t)).toBe(true)
  })
  it('rejects unknown layouts, non-core blocks, bad and shadowing custom blocks', () => {
    expect(() =>
      defineTheme({
        name: 't',
        layouts: { Sidebar: {} } as never,
        blocks: { 'x:foo': {}, banana: {} },
        customBlocks: [{ name: 'Bad Name', component: {} }, { name: 'paragraph', component: {} }],
      }),
    ).toThrow(ThemeDefinitionError)
    try {
      defineTheme({ name: 't', blocks: { banana: {} } })
    } catch (e) {
      expect((e as Error).message).toMatch(/"banana" is not a core block type/)
    }
  })
})
