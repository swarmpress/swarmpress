#!/usr/bin/env npx tsx
/**
 * Content Audit Script for cinqueterre.travel
 *
 * Analyzes all page files and generates a report on:
 * - Content completeness per language
 * - Translation gaps
 * - Quality issues
 * - Priority list for content generation
 */

import * as fs from 'fs'
import * as path from 'path'

const CONTENT_DIR = path.join(__dirname, '../cinqueterre.travel/content/pages')
const LANGUAGES = ['en', 'de', 'fr', 'it'] as const
type Language = typeof LANGUAGES[number]

interface LocalizedString {
  en?: string
  de?: string
  fr?: string
  it?: string
  [key: string]: string | undefined
}

interface ContentBlock {
  type: string
  variant?: string
  title?: LocalizedString
  subtitle?: LocalizedString
  description?: LocalizedString
  eyebrow?: LocalizedString
  features?: Array<{
    title?: LocalizedString
    description?: LocalizedString
  }>
  items?: Array<{
    question?: LocalizedString
    answer?: LocalizedString
  }>
  [key: string]: unknown
}

interface PageContent {
  id: string
  slug: LocalizedString
  title: LocalizedString
  page_type: string
  seo?: {
    title?: LocalizedString
    description?: LocalizedString
    keywords?: LocalizedString | { [lang: string]: string[] }
  }
  body: ContentBlock[]
  metadata?: {
    city?: string
    page_type?: string
  }
  status?: string
}

interface ContentIssue {
  type: 'missing' | 'empty' | 'short' | 'placeholder'
  field: string
  language?: Language
  details?: string
}

interface PageAuditResult {
  path: string
  relativePath: string
  village: string
  pageType: string
  status: string
  hasBody: boolean
  blockCount: number
  languageCompleteness: Record<Language, number>
  issues: ContentIssue[]
  needsContent: Language[]
  quality: 'complete' | 'partial' | 'minimal' | 'empty'
}

interface AuditSummary {
  totalPages: number
  byStatus: Record<string, number>
  byVillage: Record<string, {
    total: number
    complete: number
    partial: number
    minimal: number
    empty: number
  }>
  byPageType: Record<string, {
    total: number
    complete: number
    languageCoverage: Record<Language, number>
  }>
  languageCoverage: Record<Language, {
    complete: number
    partial: number
    missing: number
  }>
  priorityList: PageAuditResult[]
}

// Check if a localized string has content for a given language
function hasContent(value: unknown, lang: Language): boolean {
  if (!value) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'object' && value !== null) {
    const localized = value as LocalizedString
    return typeof localized[lang] === 'string' && localized[lang]!.trim().length > 0
  }
  return false
}

// Get content length for a language
function getContentLength(value: unknown, lang: Language): number {
  if (!value) return 0
  if (typeof value === 'string') return value.trim().length
  if (typeof value === 'object' && value !== null) {
    const localized = value as LocalizedString
    return localized[lang]?.trim().length || 0
  }
  return 0
}

// Check for placeholder text patterns
function isPlaceholder(text: string): boolean {
  const placeholderPatterns = [
    /lorem ipsum/i,
    /placeholder/i,
    /TODO/,
    /FIXME/,
    /\[.*\]/,  // [placeholder text]
    /{{.*}}/,  // {{template}}
    /xxx+/i,
  ]
  return placeholderPatterns.some(pattern => pattern.test(text))
}

// Analyze a content block for language coverage
function analyzeBlock(block: ContentBlock, lang: Language): { hasContent: boolean; score: number } {
  let score = 0
  let maxScore = 0

  // Check common text fields
  const textFields = ['title', 'subtitle', 'description', 'eyebrow', 'content']
  for (const field of textFields) {
    if (block[field] !== undefined) {
      maxScore += 1
      if (hasContent(block[field], lang)) {
        score += 1
      }
    }
  }

  // Check features array
  if (Array.isArray(block.features)) {
    for (const feature of block.features) {
      if (feature.title !== undefined) {
        maxScore += 1
        if (hasContent(feature.title, lang)) score += 1
      }
      if (feature.description !== undefined) {
        maxScore += 1
        if (hasContent(feature.description, lang)) score += 1
      }
    }
  }

  // Check FAQ items
  if (Array.isArray(block.items)) {
    for (const item of block.items) {
      if (item.question !== undefined) {
        maxScore += 1
        if (hasContent(item.question, lang)) score += 1
      }
      if (item.answer !== undefined) {
        maxScore += 1
        if (hasContent(item.answer, lang)) score += 1
      }
    }
  }

  return {
    hasContent: score > 0,
    score: maxScore > 0 ? score / maxScore : 1
  }
}

// Analyze a page file
function analyzePage(filePath: string): PageAuditResult {
  const relativePath = path.relative(CONTENT_DIR, filePath)
  const parts = relativePath.replace('.json', '').split(path.sep)

  let village = 'general'
  let pageType = 'unknown'

  if (parts.length === 1) {
    // Root level files like index.json, cinque-terre.json
    pageType = parts[0]
  } else if (parts.length === 2) {
    // Village sub-pages like monterosso/restaurants.json
    village = parts[0]
    pageType = parts[1]
  }

  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PageContent

  const issues: ContentIssue[] = []
  const languageCompleteness: Record<Language, number> = { en: 0, de: 0, fr: 0, it: 0 }

  // Check if body exists and has content
  const hasBody = Array.isArray(content.body) && content.body.length > 0

  if (!hasBody) {
    issues.push({ type: 'empty', field: 'body', details: 'No body content' })
  } else {
    // Analyze each block for each language
    for (const lang of LANGUAGES) {
      let totalScore = 0
      let blockCount = 0

      for (const block of content.body) {
        const analysis = analyzeBlock(block, lang)
        if (analysis.hasContent || analysis.score > 0) {
          totalScore += analysis.score
          blockCount++
        }
      }

      languageCompleteness[lang] = blockCount > 0 ? totalScore / content.body.length : 0
    }
  }

  // Check SEO fields
  if (!content.seo?.title) {
    issues.push({ type: 'missing', field: 'seo.title' })
  } else {
    for (const lang of LANGUAGES) {
      if (!hasContent(content.seo.title, lang)) {
        issues.push({ type: 'missing', field: 'seo.title', language: lang })
      }
    }
  }

  if (!content.seo?.description) {
    issues.push({ type: 'missing', field: 'seo.description' })
  } else {
    for (const lang of LANGUAGES) {
      if (!hasContent(content.seo.description, lang)) {
        issues.push({ type: 'missing', field: 'seo.description', language: lang })
      }
    }
  }

  // Check title
  for (const lang of LANGUAGES) {
    if (!hasContent(content.title, lang)) {
      issues.push({ type: 'missing', field: 'title', language: lang })
    }
  }

  // Determine which languages need content
  const needsContent: Language[] = LANGUAGES.filter(lang => languageCompleteness[lang] < 0.5)

  // Determine quality level
  let quality: 'complete' | 'partial' | 'minimal' | 'empty'
  const avgCompleteness = Object.values(languageCompleteness).reduce((a, b) => a + b, 0) / 4

  if (!hasBody) {
    quality = 'empty'
  } else if (avgCompleteness >= 0.8) {
    quality = 'complete'
  } else if (avgCompleteness >= 0.4) {
    quality = 'partial'
  } else {
    quality = 'minimal'
  }

  return {
    path: filePath,
    relativePath,
    village,
    pageType,
    status: content.status || 'unknown',
    hasBody,
    blockCount: content.body?.length || 0,
    languageCompleteness,
    issues,
    needsContent,
    quality
  }
}

// Walk directory and find all JSON files
function findAllPages(dir: string): string[] {
  const pages: string[] = []

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        pages.push(fullPath)
      }
    }
  }

  walk(dir)
  return pages
}

// Generate the audit report
function generateAudit(): AuditSummary {
  console.log('🔍 Scanning pages...\n')

  const pageFiles = findAllPages(CONTENT_DIR)
  const results: PageAuditResult[] = []

  for (const file of pageFiles) {
    try {
      const result = analyzePage(file)
      results.push(result)
    } catch (error) {
      console.error(`Error analyzing ${file}:`, error)
    }
  }

  // Build summary
  const summary: AuditSummary = {
    totalPages: results.length,
    byStatus: {},
    byVillage: {},
    byPageType: {},
    languageCoverage: {
      en: { complete: 0, partial: 0, missing: 0 },
      de: { complete: 0, partial: 0, missing: 0 },
      fr: { complete: 0, partial: 0, missing: 0 },
      it: { complete: 0, partial: 0, missing: 0 }
    },
    priorityList: []
  }

  for (const result of results) {
    // By status
    summary.byStatus[result.status] = (summary.byStatus[result.status] || 0) + 1

    // By village
    if (!summary.byVillage[result.village]) {
      summary.byVillage[result.village] = { total: 0, complete: 0, partial: 0, minimal: 0, empty: 0 }
    }
    summary.byVillage[result.village].total++
    summary.byVillage[result.village][result.quality]++

    // By page type
    if (!summary.byPageType[result.pageType]) {
      summary.byPageType[result.pageType] = {
        total: 0,
        complete: 0,
        languageCoverage: { en: 0, de: 0, fr: 0, it: 0 }
      }
    }
    summary.byPageType[result.pageType].total++
    if (result.quality === 'complete') {
      summary.byPageType[result.pageType].complete++
    }
    for (const lang of LANGUAGES) {
      summary.byPageType[result.pageType].languageCoverage[lang] += result.languageCompleteness[lang]
    }

    // Language coverage
    for (const lang of LANGUAGES) {
      if (result.languageCompleteness[lang] >= 0.8) {
        summary.languageCoverage[lang].complete++
      } else if (result.languageCompleteness[lang] >= 0.3) {
        summary.languageCoverage[lang].partial++
      } else {
        summary.languageCoverage[lang].missing++
      }
    }
  }

  // Average language coverage by page type
  for (const pageType of Object.keys(summary.byPageType)) {
    const total = summary.byPageType[pageType].total
    for (const lang of LANGUAGES) {
      summary.byPageType[pageType].languageCoverage[lang] /= total
    }
  }

  // Build priority list (pages needing work, sorted by importance)
  const priorityOrder: Record<string, number> = {
    'overview': 1,
    'restaurants': 2,
    'hiking': 3,
    'hotels': 4,
    'beaches': 5,
    'things-to-do': 6,
    'events': 7,
    'getting-here': 8,
    'weather': 9,
    'faq': 10
  }

  summary.priorityList = results
    .filter(r => r.quality !== 'complete' || r.needsContent.length > 0)
    .sort((a, b) => {
      // Sort by quality first (empty > minimal > partial)
      const qualityOrder = { empty: 0, minimal: 1, partial: 2, complete: 3 }
      if (qualityOrder[a.quality] !== qualityOrder[b.quality]) {
        return qualityOrder[a.quality] - qualityOrder[b.quality]
      }
      // Then by page type priority
      const aPriority = priorityOrder[a.pageType] || 99
      const bPriority = priorityOrder[b.pageType] || 99
      return aPriority - bPriority
    })

  return summary
}

// Print the report
function printReport(summary: AuditSummary) {
  console.log('=' .repeat(60))
  console.log('📊 CINQUETERRE.TRAVEL CONTENT AUDIT REPORT')
  console.log('=' .repeat(60))
  console.log()

  console.log(`Total Pages: ${summary.totalPages}`)
  console.log()

  // Status breakdown
  console.log('📋 By Status:')
  for (const [status, count] of Object.entries(summary.byStatus)) {
    console.log(`   ${status}: ${count}`)
  }
  console.log()

  // Village breakdown
  console.log('🏘️  By Village:')
  for (const [village, stats] of Object.entries(summary.byVillage)) {
    const completePct = ((stats.complete / stats.total) * 100).toFixed(0)
    console.log(`   ${village.padEnd(15)} ${stats.total} pages (${completePct}% complete, ${stats.partial} partial, ${stats.minimal} minimal, ${stats.empty} empty)`)
  }
  console.log()

  // Language coverage
  console.log('🌍 Language Coverage:')
  for (const lang of LANGUAGES) {
    const stats = summary.languageCoverage[lang]
    const completePct = ((stats.complete / summary.totalPages) * 100).toFixed(0)
    const partialPct = ((stats.partial / summary.totalPages) * 100).toFixed(0)
    const missingPct = ((stats.missing / summary.totalPages) * 100).toFixed(0)
    console.log(`   ${lang.toUpperCase()}: ${completePct}% complete, ${partialPct}% partial, ${missingPct}% missing`)
  }
  console.log()

  // Page type breakdown
  console.log('📄 By Page Type:')
  const pageTypes = Object.entries(summary.byPageType)
    .sort((a, b) => b[1].total - a[1].total)

  for (const [pageType, stats] of pageTypes) {
    const completePct = ((stats.complete / stats.total) * 100).toFixed(0)
    const langStr = LANGUAGES.map(l =>
      `${l}:${(stats.languageCoverage[l] * 100).toFixed(0)}%`
    ).join(' ')
    console.log(`   ${pageType.padEnd(15)} ${stats.total} pages, ${completePct}% complete | ${langStr}`)
  }
  console.log()

  // Priority list (top 20)
  console.log('🎯 Priority List (Top 20 pages needing work):')
  const top20 = summary.priorityList.slice(0, 20)
  for (let i = 0; i < top20.length; i++) {
    const page = top20[i]
    const needsLangs = page.needsContent.join(', ') || 'none'
    console.log(`   ${(i + 1).toString().padStart(2)}. [${page.quality.padEnd(8)}] ${page.relativePath}`)
    console.log(`       Needs: ${needsLangs} | Blocks: ${page.blockCount}`)
  }
  console.log()

  // Summary statistics
  const totalNeedingWork = summary.priorityList.length
  const emptyPages = summary.priorityList.filter(p => p.quality === 'empty').length
  const minimalPages = summary.priorityList.filter(p => p.quality === 'minimal').length
  const partialPages = summary.priorityList.filter(p => p.quality === 'partial').length

  console.log('=' .repeat(60))
  console.log('📈 SUMMARY')
  console.log('=' .repeat(60))
  console.log(`   Pages needing work: ${totalNeedingWork}`)
  console.log(`   Empty pages: ${emptyPages}`)
  console.log(`   Minimal content: ${minimalPages}`)
  console.log(`   Partial content: ${partialPages}`)
  console.log()

  // Estimated generation work
  const contentPieces = summary.priorityList.reduce((acc, p) => acc + p.needsContent.length, 0)
  console.log(`   Estimated content pieces to generate: ${contentPieces}`)
  console.log(`   (Each piece = 1 page × 1 language)`)
  console.log()
}

// Save detailed report as JSON
function saveDetailedReport(summary: AuditSummary) {
  const outputPath = path.join(__dirname, '../cinqueterre.travel/content-audit.json')
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2))
  console.log(`💾 Detailed report saved to: ${outputPath}`)
}

// Main
const summary = generateAudit()
printReport(summary)
saveDetailedReport(summary)
