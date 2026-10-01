/**
 * LocalizedString Utility
 *
 * Centralized helpers for resolving values from a structured `LocalizedString`
 * (`{ en, de?, fr?, it? }`). Use these instead of ad-hoc fallback patterns
 * (e.g. `value[locale] || value.en`) — those silently break when the schema
 * was loosened to accept plain strings, and they swallow missing translations.
 */

import type { LocalizedString } from '../types/site-definition'

/**
 * Resolve a localized string for a given locale, falling back to the
 * configured fallback locale (default `'en'`) and finally the empty string.
 *
 * @param value - The LocalizedString value (or undefined)
 * @param locale - The desired locale, e.g. `'de'`
 * @param fallback - The fallback locale (defaults to `'en'`)
 * @returns The resolved string, or `''` if no value available
 */
export function getLocalizedValue(
  value: LocalizedString | undefined,
  locale: string = 'en',
  fallback: string = 'en'
): string {
  if (!value) return ''
  const localeKey = locale as keyof LocalizedString
  const fallbackKey = fallback as keyof LocalizedString
  return (value[localeKey] as string | undefined)
    ?? (value[fallbackKey] as string | undefined)
    ?? ''
}
