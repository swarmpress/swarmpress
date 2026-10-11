/** Choosing a company's PHP backend (FEAT-105, ADR-0079): explicit, never a silent fallback. */
import { describe, expect, it } from 'vitest'
import { openWordPress } from './wordpress'
import { PHP_BACKENDS, resolvePhpBackend, wordpressEngineFromQuery } from './backend'
import { isPhpUnavailable } from './types'

describe('PHP backends', () => {
  it('?php= wins over the stored choice, which wins over the default; unknown values are errors', () => {
    expect(resolvePhpBackend('?php=fake', 'php-wasm')).toBe('fake')
    expect(resolvePhpBackend('', 'fake')).toBe('fake')
    expect(resolvePhpBackend('', null)).toBe('php-wasm')
    expect(() => resolvePhpBackend('?php=mysql', null)).toThrow(/unknown PHP backend/)
  })

  it('FrankenPHP is registered for the contract and unavailable, and opening it fails loudly', async () => {
    expect(PHP_BACKENDS.frankenphp.available).toBe(false)
    const err = await openWordPress({ backend: 'frankenphp', storage: { storage: async () => '{}', repo: async () => ({}) as never } }).catch((e: unknown) => e)
    expect(isPhpUnavailable(err)).toBe(true)
  })

  it('?site=wordpress opts a company into the WordPress engine', () => {
    expect(wordpressEngineFromQuery('?site=wordpress')).toBe(true)
    expect(wordpressEngineFromQuery('?site=astro')).toBe(false)
  })
})
