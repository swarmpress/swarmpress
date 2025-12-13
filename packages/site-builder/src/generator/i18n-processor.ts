/**
 * i18n Page Processor
 * Converts i18n pages (with inline translations) to single-language pages
 * for static site generation
 */

// =============================================================================
// TYPES
// =============================================================================

export interface LocalizedString {
  [lang: string]: string
}

export interface LocalizedStringArray {
  [lang: string]: string[]
}

export interface I18nPage {
  id: string
  slug: LocalizedString
  title: LocalizedString
  page_type: string
  seo: {
    title: LocalizedString
    description: LocalizedString
    keywords?: LocalizedStringArray
  }
  body: any[]
  metadata?: {
    city?: string
    region?: string
    page_type?: string
  }
  status: string
  created_at: string
  updated_at: string
}

export interface FlatPage {
  id: string
  slug: string
  title: string
  page_type: string
  seo: {
    title: string
    description: string
    keywords?: string[]
  }
  body: any[]
  metadata?: {
    city?: string
    region?: string
    page_type?: string
    lang: string
  }
  status: string
  created_at: string
  updated_at: string
}

// =============================================================================
// LOCALIZATION HELPERS
// =============================================================================

/**
 * Get a localized string value for a specific language
 * Falls back to: requested lang → 'en' → first available → empty string
 */
export function getLocalizedValue(
  value: LocalizedString | string | undefined,
  lang: string
): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value

  // Try requested language
  if (value[lang]) return value[lang]
  // Fall back to English
  if (value['en']) return value['en']
  // Fall back to first available
  const keys = Object.keys(value)
  if (keys.length > 0) return value[keys[0]]

  return ''
}

/**
 * Get a localized array value for a specific language
 */
export function getLocalizedArray(
  value: LocalizedStringArray | string[] | undefined,
  lang: string
): string[] {
  if (value === undefined) return []
  if (Array.isArray(value)) return value

  // Try requested language
  if (value[lang]) return value[lang]
  // Fall back to English
  if (value['en']) return value['en']
  // Fall back to first available
  const keys = Object.keys(value)
  if (keys.length > 0) return value[keys[0]]

  return []
}

/**
 * Recursively flatten a localized object for a specific language
 */
export function flattenLocalizedObject(obj: any, lang: string): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    return obj.map(item => flattenLocalizedObject(item, lang))
  }

  // Check if this is a localized string (object with language keys)
  if (isLocalizedString(obj)) {
    return getLocalizedValue(obj, lang)
  }

  // Recursively process object properties
  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = flattenLocalizedObject(value, lang)
  }
  return result
}

/**
 * Check if an object looks like a LocalizedString
 * (object with language code keys like 'en', 'de', 'fr', 'it')
 */
function isLocalizedString(obj: any): boolean {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false
  }

  const keys = Object.keys(obj)
  if (keys.length === 0) return false

  // Check if all keys are language codes (2-5 chars, lowercase)
  const langCodePattern = /^[a-z]{2,5}$/
  const allLangCodes = keys.every(key => langCodePattern.test(key))

  // Check if all values are strings (or arrays of strings for keywords)
  const allStrings = keys.every(key => {
    const val = obj[key]
    return typeof val === 'string' || (Array.isArray(val) && val.every(v => typeof v === 'string'))
  })

  return allLangCodes && allStrings
}

// =============================================================================
// PAGE FLATTENING
// =============================================================================

/**
 * Flatten an i18n page for a specific language
 * Returns a regular page with all localized strings resolved
 */
export function flattenI18nPage(page: I18nPage, lang: string): FlatPage {
  return {
    id: page.id,
    slug: getLocalizedValue(page.slug, lang),
    title: getLocalizedValue(page.title, lang),
    page_type: page.page_type,
    seo: {
      title: getLocalizedValue(page.seo.title, lang),
      description: getLocalizedValue(page.seo.description, lang),
      keywords: page.seo.keywords ? getLocalizedArray(page.seo.keywords, lang) : undefined,
    },
    body: flattenLocalizedBody(page.body, lang),
    metadata: {
      ...page.metadata,
      lang,
    },
    status: page.status,
    created_at: page.created_at,
    updated_at: page.updated_at,
  }
}

/**
 * Flatten the body array (section blocks) for a specific language
 */
function flattenLocalizedBody(body: any[], lang: string): any[] {
  return body.map(block => flattenLocalizedObject(block, lang))
}

// =============================================================================
// MULTI-LANGUAGE EXPANSION
// =============================================================================

/**
 * Get all available languages from an i18n page
 * by looking at the slug field (which must have all languages)
 */
export function getAvailableLanguages(page: I18nPage): string[] {
  if (typeof page.slug === 'object' && page.slug !== null) {
    return Object.keys(page.slug)
  }
  return ['en'] // Default if no localization
}

/**
 * Expand an i18n page into multiple flat pages (one per language)
 */
export function expandI18nPage(page: I18nPage): FlatPage[] {
  const languages = getAvailableLanguages(page)
  return languages.map(lang => flattenI18nPage(page, lang))
}

/**
 * Expand multiple i18n pages into flat pages for all languages
 */
export function expandI18nPages(pages: I18nPage[]): FlatPage[] {
  return pages.flatMap(page => expandI18nPage(page))
}

// =============================================================================
// FILE LOADING
// =============================================================================

import { readFile, readdir } from 'fs/promises'
import { join, relative } from 'path'
import { existsSync } from 'fs'

/**
 * Load all i18n page files from a directory recursively
 */
export async function loadI18nPages(dir: string): Promise<I18nPage[]> {
  const pages: I18nPage[] = []

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.name.endsWith('.json')) {
        try {
          const content = await readFile(fullPath, 'utf-8')
          const page = JSON.parse(content) as I18nPage
          pages.push(page)
        } catch (err) {
          console.error(`Error loading i18n page ${fullPath}:`, err)
        }
      }
    }
  }

  if (existsSync(dir)) {
    await walk(dir)
  }

  return pages
}

/**
 * Load i18n pages and expand them to all languages
 */
export async function loadAndExpandI18nPages(dir: string): Promise<FlatPage[]> {
  const i18nPages = await loadI18nPages(dir)
  return expandI18nPages(i18nPages)
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  getLocalizedValue,
  getLocalizedArray,
  flattenLocalizedObject,
  flattenI18nPage,
  getAvailableLanguages,
  expandI18nPage,
  expandI18nPages,
  loadI18nPages,
  loadAndExpandI18nPages,
}
