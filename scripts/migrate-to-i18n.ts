/**
 * Migration Script: Convert language-separated pages to i18n structure
 *
 * Before: /content/pages/en/monterosso/overview.json (separate file per language)
 * After:  /content/pages-i18n/monterosso/overview.json (single file with all translations)
 */

import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const CONTENT_DIR = '/Users/drietsch/agentpress/cinqueterre.travel/content/pages'
const OUTPUT_DIR = '/Users/drietsch/agentpress/cinqueterre.travel/content/pages-i18n'
const LANGUAGES = ['en', 'de', 'fr', 'it']

interface OldPage {
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
  metadata: {
    lang: string
    city?: string
    is_default?: boolean
    page_type?: string
  }
  status: string
  created_at: string
  updated_at: string
}

interface LocalizedString {
  [lang: string]: string
}

interface LocalizedStringArray {
  [lang: string]: string[]
}

interface LocalizedSlug {
  [lang: string]: string
}

// Extract canonical path from a language-specific slug
// e.g., "/en/monterosso/overview" → "monterosso/overview"
// e.g., "/de" → ""
function getCanonicalPath(slug: string, lang: string): string {
  const prefix = `/${lang}`
  if (slug === prefix) return ''
  if (slug.startsWith(prefix + '/')) {
    return slug.slice(prefix.length + 1)
  }
  return slug.replace(/^\//, '')
}

// Convert a string field to localized format
function toLocalizedString(pages: Map<string, OldPage>, getter: (p: OldPage) => string | undefined): LocalizedString {
  const result: LocalizedString = {}
  for (const [lang, page] of pages) {
    const value = getter(page)
    if (value !== undefined) {
      result[lang] = value
    }
  }
  return result
}

// Convert array field to localized format
function toLocalizedArray(pages: Map<string, OldPage>, getter: (p: OldPage) => string[] | undefined): LocalizedStringArray {
  const result: LocalizedStringArray = {}
  for (const [lang, page] of pages) {
    const value = getter(page)
    if (value !== undefined) {
      result[lang] = value
    }
  }
  return result
}

// Convert slug field to localized format
function toLocalizedSlug(pages: Map<string, OldPage>): LocalizedSlug {
  const result: LocalizedSlug = {}
  for (const [lang, page] of pages) {
    result[lang] = page.slug
  }
  return result
}

// Recursively localize all string fields in a body block
function localizeBodyBlock(blocks: Map<string, any[]>): any[] {
  // Get the structure from the first available language
  const firstLang = Array.from(blocks.keys())[0]
  const template = blocks.get(firstLang) || []

  return template.map((block, blockIndex) => {
    const localizedBlock: any = { type: block.type }

    // Copy non-localizable fields
    if (block.variant) localizedBlock.variant = block.variant
    if (block.image) localizedBlock.image = block.image

    // Process each field in the block
    for (const [key, value] of Object.entries(block)) {
      if (key === 'type' || key === 'variant' || key === 'image') continue

      if (typeof value === 'string') {
        // Localize string fields
        const localized: LocalizedString = {}
        for (const [lang, langBlocks] of blocks) {
          const langBlock = langBlocks[blockIndex]
          if (langBlock && langBlock[key]) {
            localized[lang] = langBlock[key]
          }
        }
        localizedBlock[key] = localized
      } else if (Array.isArray(value)) {
        // Handle arrays (buttons, features, stats, columns, etc.)
        localizedBlock[key] = value.map((item, itemIndex) => {
          if (typeof item === 'object' && item !== null) {
            return localizeArrayItem(blocks, blockIndex, key, itemIndex, item)
          }
          return item
        })
      } else if (typeof value === 'object' && value !== null) {
        // Handle nested objects
        localizedBlock[key] = localizeNestedObject(blocks, blockIndex, key, value)
      } else {
        localizedBlock[key] = value
      }
    }

    return localizedBlock
  })
}

// Localize an item in an array (button, feature, stat, etc.)
function localizeArrayItem(
  blocks: Map<string, any[]>,
  blockIndex: number,
  arrayKey: string,
  itemIndex: number,
  template: any
): any {
  const result: any = {}

  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') {
      // Fields that should NOT be localized
      const nonLocalizedFields = ['icon', 'platform', 'variant', 'src', 'avatar']

      if (nonLocalizedFields.includes(key)) {
        result[key] = value
      } else {
        // Localize the string
        const localized: LocalizedString = {}
        for (const [lang, langBlocks] of blocks) {
          const langBlock = langBlocks[blockIndex]
          if (langBlock && langBlock[arrayKey] && langBlock[arrayKey][itemIndex]) {
            const langValue = langBlock[arrayKey][itemIndex][key]
            if (langValue) {
              localized[lang] = langValue
            }
          }
        }
        result[key] = Object.keys(localized).length > 0 ? localized : value
      }
    } else if (Array.isArray(value)) {
      // Nested arrays (e.g., links in footer columns)
      result[key] = value.map((nestedItem, nestedIndex) => {
        if (typeof nestedItem === 'object' && nestedItem !== null) {
          return localizeNestedArrayItem(blocks, blockIndex, arrayKey, itemIndex, key, nestedIndex, nestedItem)
        }
        return nestedItem
      })
    } else {
      result[key] = value
    }
  }

  return result
}

// Localize a nested array item (e.g., links in footer columns)
function localizeNestedArrayItem(
  blocks: Map<string, any[]>,
  blockIndex: number,
  arrayKey: string,
  itemIndex: number,
  nestedArrayKey: string,
  nestedIndex: number,
  template: any
): any {
  const result: any = {}

  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') {
      const nonLocalizedFields = ['platform', 'variant']

      if (nonLocalizedFields.includes(key)) {
        result[key] = value
      } else {
        const localized: LocalizedString = {}
        for (const [lang, langBlocks] of blocks) {
          const langBlock = langBlocks[blockIndex]
          if (langBlock?.[arrayKey]?.[itemIndex]?.[nestedArrayKey]?.[nestedIndex]?.[key]) {
            localized[lang] = langBlock[arrayKey][itemIndex][nestedArrayKey][nestedIndex][key]
          }
        }
        result[key] = Object.keys(localized).length > 0 ? localized : value
      }
    } else {
      result[key] = value
    }
  }

  return result
}

// Localize a nested object
function localizeNestedObject(
  blocks: Map<string, any[]>,
  blockIndex: number,
  objectKey: string,
  template: any
): any {
  const result: any = {}

  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') {
      const localized: LocalizedString = {}
      for (const [lang, langBlocks] of blocks) {
        const langBlock = langBlocks[blockIndex]
        if (langBlock && langBlock[objectKey] && langBlock[objectKey][key]) {
          localized[lang] = langBlock[objectKey][key]
        }
      }
      result[key] = Object.keys(localized).length > 0 ? localized : value
    } else {
      result[key] = value
    }
  }

  return result
}

// Find all page files and group by canonical path
function findAllPages(): Map<string, Map<string, OldPage>> {
  const pageGroups = new Map<string, Map<string, OldPage>>()

  for (const lang of LANGUAGES) {
    // Language root file
    const rootFile = path.join(CONTENT_DIR, `${lang}.json`)
    if (fs.existsSync(rootFile)) {
      const content = JSON.parse(fs.readFileSync(rootFile, 'utf-8')) as OldPage
      const canonicalPath = ''

      if (!pageGroups.has(canonicalPath)) {
        pageGroups.set(canonicalPath, new Map())
      }
      pageGroups.get(canonicalPath)!.set(lang, content)
    }

    // Language subdirectory
    const langDir = path.join(CONTENT_DIR, lang)
    if (fs.existsSync(langDir)) {
      walkDirectory(langDir, lang, pageGroups)
    }
  }

  return pageGroups
}

// Recursively walk directory and collect pages
function walkDirectory(
  dir: string,
  lang: string,
  pageGroups: Map<string, Map<string, OldPage>>
) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      walkDirectory(fullPath, lang, pageGroups)
    } else if (entry.name.endsWith('.json')) {
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as OldPage
        const canonicalPath = getCanonicalPath(content.slug, lang)

        if (!pageGroups.has(canonicalPath)) {
          pageGroups.set(canonicalPath, new Map())
        }
        pageGroups.get(canonicalPath)!.set(lang, content)
      } catch (err) {
        console.error(`Error reading ${fullPath}:`, err)
      }
    }
  }
}

// Merge language versions into a single i18n page
function mergePagesToI18n(canonicalPath: string, pages: Map<string, OldPage>): any {
  // Use first available language as template
  const firstLang = Array.from(pages.keys())[0]
  const template = pages.get(firstLang)!

  // Collect body blocks by language
  const bodyBlocks = new Map<string, any[]>()
  for (const [lang, page] of pages) {
    bodyBlocks.set(lang, page.body || [])
  }

  // Build the i18n page
  const i18nPage = {
    id: template.id || uuidv4(),
    slug: toLocalizedSlug(pages),
    title: toLocalizedString(pages, p => p.title),
    page_type: template.page_type,
    seo: {
      title: toLocalizedString(pages, p => p.seo?.title),
      description: toLocalizedString(pages, p => p.seo?.description),
      keywords: toLocalizedArray(pages, p => p.seo?.keywords),
    },
    body: localizeBodyBlock(bodyBlocks),
    metadata: {
      city: template.metadata?.city,
      page_type: template.metadata?.page_type || template.page_type,
    },
    status: template.status || 'published',
    created_at: template.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  return i18nPage
}

// Main migration function
async function migrate() {
  console.log('Starting migration to i18n page structure...\n')

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // Find all pages grouped by canonical path
  const pageGroups = findAllPages()
  console.log(`Found ${pageGroups.size} unique pages across ${LANGUAGES.length} languages\n`)

  let migratedCount = 0
  let skippedCount = 0

  for (const [canonicalPath, pages] of pageGroups) {
    const languagesAvailable = Array.from(pages.keys()).join(', ')

    // Skip if less than 2 languages (nothing to merge)
    if (pages.size < 2) {
      console.log(`⚠️  Skipping "${canonicalPath || '(root)'}" - only has: ${languagesAvailable}`)
      skippedCount++
      continue
    }

    try {
      const i18nPage = mergePagesToI18n(canonicalPath, pages)

      // Determine output path
      let outputPath: string
      if (canonicalPath === '') {
        outputPath = path.join(OUTPUT_DIR, 'index.json')
      } else {
        outputPath = path.join(OUTPUT_DIR, `${canonicalPath}.json`)
      }

      // Create subdirectories if needed
      const outputDir = path.dirname(outputPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      // Write the merged file
      fs.writeFileSync(outputPath, JSON.stringify(i18nPage, null, 2))
      console.log(`✅ Migrated: ${canonicalPath || '(root)'} [${languagesAvailable}] → ${path.relative(OUTPUT_DIR, outputPath)}`)
      migratedCount++
    } catch (err) {
      console.error(`❌ Error migrating "${canonicalPath}":`, err)
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Migration complete!`)
  console.log(`  Migrated: ${migratedCount} pages`)
  console.log(`  Skipped:  ${skippedCount} pages (single language only)`)
  console.log(`  Output:   ${OUTPUT_DIR}`)
}

// Run
migrate().catch(console.error)
