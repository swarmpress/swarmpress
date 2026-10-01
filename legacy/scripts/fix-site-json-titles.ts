#!/usr/bin/env npx tsx
/**
 * Script to fix double-nested LocalizedString titles in site.json
 *
 * Problem: Titles are structured as { "en": { "en": "..." } }
 * Fix: Transform to { "en": "...", "de": "", "it": "", "fr": "" }
 */

import fs from 'fs'
import path from 'path'

const SITE_JSON_PATH = path.join(__dirname, '../cinqueterre.travel/content/site.json')
const LOCALES = ['en', 'de', 'it', 'fr']

interface LocalizedString {
  [locale: string]: string | LocalizedString
}

interface SitemapNode {
  id: string
  type: string
  position?: { x: number; y: number }
  data?: {
    slug?: string
    title?: LocalizedString
    description?: LocalizedString
    status?: string
    parentId?: string
    [key: string]: unknown
  }
}

interface SiteDefinition {
  sitemap?: {
    nodes?: SitemapNode[]
    edges?: unknown[]
  }
  [key: string]: unknown
}

/**
 * Recursively unwrap nested LocalizedString to get the actual string value
 */
function unwrapNestedString(val: unknown, locale: string = 'en'): string {
  if (typeof val === 'string') return val
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const record = val as Record<string, unknown>
    const nested = record[locale] ?? record['en'] ?? Object.values(record)[0]
    return unwrapNestedString(nested, locale)
  }
  return ''
}

/**
 * Check if a LocalizedString is double-nested
 */
function isDoubleNested(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const val = record[key]
    // If the value is an object (not string), it's nested
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return true
    }
  }
  return false
}

/**
 * Fix a potentially double-nested LocalizedString
 */
function fixLocalizedString(value: unknown): Record<string, string> | null {
  if (!value) return null
  if (typeof value === 'string') {
    // Plain string - convert to localized
    return LOCALES.reduce((acc, locale) => {
      acc[locale] = locale === 'en' ? value : ''
      return acc
    }, {} as Record<string, string>)
  }

  if (typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const result: Record<string, string> = {}

  // For each configured locale, extract the actual string value
  for (const locale of LOCALES) {
    const localeValue = record[locale]
    if (localeValue !== undefined) {
      // Unwrap nested structure if needed
      result[locale] = unwrapNestedString(localeValue, locale)
    } else {
      // No value for this locale
      result[locale] = ''
    }
  }

  return result
}

/**
 * Process site.json and fix all double-nested titles
 */
function fixSiteJson() {
  console.log('Reading site.json...')

  if (!fs.existsSync(SITE_JSON_PATH)) {
    console.error(`File not found: ${SITE_JSON_PATH}`)
    process.exit(1)
  }

  const content = fs.readFileSync(SITE_JSON_PATH, 'utf-8')
  const siteData: SiteDefinition = JSON.parse(content)

  let fixedCount = 0
  let totalNodes = 0

  if (siteData.sitemap?.nodes) {
    totalNodes = siteData.sitemap.nodes.length

    for (const node of siteData.sitemap.nodes) {
      if (node.data) {
        // Fix title
        if (node.data.title && isDoubleNested(node.data.title)) {
          const fixed = fixLocalizedString(node.data.title)
          if (fixed) {
            console.log(`  Fixed title for node "${node.id}": "${unwrapNestedString(node.data.title, 'en')}"`)
            node.data.title = fixed as LocalizedString
            fixedCount++
          }
        }

        // Fix description if also nested
        if (node.data.description && isDoubleNested(node.data.description)) {
          const fixed = fixLocalizedString(node.data.description)
          if (fixed) {
            console.log(`  Fixed description for node "${node.id}"`)
            node.data.description = fixed as LocalizedString
          }
        }
      }
    }
  }

  console.log(`\nProcessed ${totalNodes} nodes, fixed ${fixedCount} titles`)

  if (fixedCount > 0) {
    // Create backup
    const backupPath = SITE_JSON_PATH + '.backup'
    fs.copyFileSync(SITE_JSON_PATH, backupPath)
    console.log(`Created backup at: ${backupPath}`)

    // Write fixed content
    fs.writeFileSync(SITE_JSON_PATH, JSON.stringify(siteData, null, 2))
    console.log(`\nWrote fixed site.json`)
  } else {
    console.log('\nNo fixes needed - all titles are properly formatted')
  }
}

// Run the fix
fixSiteJson()
