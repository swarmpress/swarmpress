/**
 * Localization Utilities
 *
 * Centralized helpers for handling LocalizedString/LocalizedText types
 * across the Cinque Terre theme components.
 *
 * Supports multiple formats:
 * - Plain string: "Hello"
 * - Localized object: { en: "Hello", de: "Hallo", fr: "Bonjour", it: "Ciao" }
 * - Partial localized: { en: "Hello" } (only some languages)
 */

/**
 * LocalizedText type - can be a plain string or object with language keys
 */
export type LocalizedText =
  | string
  | {
      en?: string;
      de?: string;
      fr?: string;
      it?: string;
      [key: string]: string | undefined;
    };

/**
 * LocalizedArray type - array that can be plain or localized
 */
export type LocalizedArray =
  | string[]
  | {
      en?: string[];
      de?: string[];
      fr?: string[];
      it?: string[];
      [key: string]: string[] | undefined;
    };

/**
 * Supported locale codes
 */
export type Locale = 'en' | 'de' | 'fr' | 'it';

/**
 * Default fallback locale
 */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Get localized text from a LocalizedText value
 *
 * Fallback chain:
 * 1. Requested locale
 * 2. English (default)
 * 3. First available value
 * 4. Empty string
 *
 * @param value - The LocalizedText value (string or object)
 * @param locale - The target locale
 * @returns The localized string
 */
export function getText(
  value: LocalizedText | undefined | null,
  locale: string = DEFAULT_LOCALE
): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';

  // Try requested locale
  const localized = value[locale as keyof typeof value];
  if (localized) return localized;

  // Fallback to English
  if (value.en) return value.en;

  // Fallback to first available value
  const values = Object.values(value).filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );
  return values[0] || '';
}

/**
 * Get localized array from a LocalizedArray value
 *
 * @param value - The LocalizedArray value (array or localized object)
 * @param locale - The target locale
 * @returns The localized string array
 */
export function getArray(
  value: LocalizedArray | undefined | null,
  locale: string = DEFAULT_LOCALE
): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  // Try requested locale
  const localized = value[locale as keyof typeof value];
  if (Array.isArray(localized)) return localized;

  // Fallback to English
  if (Array.isArray(value.en)) return value.en;

  // Fallback to first available array
  const arrays = Object.values(value).filter(
    (v): v is string[] => Array.isArray(v) && v.length > 0
  );
  return arrays[0] || [];
}

/**
 * Resolve an item which might be LocalizedText
 * Useful for arrays where each item could be localized
 *
 * @param item - The item (string or LocalizedText object)
 * @param locale - The target locale
 * @returns The resolved string
 */
export function resolveItem(
  item: string | LocalizedText,
  locale: string = DEFAULT_LOCALE
): string {
  if (typeof item === 'string') return item;
  return getText(item, locale);
}

/**
 * Check if a value is a LocalizedText object (not a plain string)
 *
 * @param value - The value to check
 * @returns True if the value is a LocalizedText object
 */
export function isLocalizedObject(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => ['en', 'de', 'fr', 'it'].includes(key))
  );
}

/**
 * Get all available locales from a LocalizedText object
 *
 * @param value - The LocalizedText value
 * @returns Array of available locale codes
 */
export function getAvailableLocales(value: LocalizedText | undefined): Locale[] {
  if (!value || typeof value === 'string') return [];
  return (['en', 'de', 'fr', 'it'] as const).filter(
    (locale) => value[locale] !== undefined && value[locale] !== ''
  );
}
