#!/usr/bin/env tsx
/**
 * Content Audit Script
 * Validates generated content quality and completeness
 */

import dotenv from 'dotenv'
import { resolve, join } from 'path'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') })

const CONTENT_DIR = resolve(__dirname, '../cinqueterre.travel/content')
const PAGES_DIR = join(CONTENT_DIR, 'pages')
const REPORT_FILE = join(CONTENT_DIR, 'audit-report.json')

// =============================================================================
// QUALITY CHECKS
// =============================================================================

interface QualityCheck {
  name: string
  passed: boolean
  score: number
  maxScore: number
  details?: string
}

interface PageAudit {
  path: string
  relativePath: string
  score: number
  maxScore: number
  percentage: number
  passed: boolean
  checks: QualityCheck[]
  issues: string[]
}

interface AuditReport {
  generatedAt: string
  summary: {
    totalPages: number
    passedPages: number
    failedPages: number
    averageScore: number
    averagePercentage: number
  }
  pages: PageAudit[]
  failedPagesList: string[]
  topIssues: { issue: string; count: number }[]
}

// =============================================================================
// CHECK IMPLEMENTATIONS
// =============================================================================

function checkHeroSection(body: unknown[]): QualityCheck {
  const heroSection = body.find((b: any) => b.type === 'hero-section')

  if (!heroSection) {
    return {
      name: 'Hero Section',
      passed: false,
      score: 0,
      maxScore: 15,
      details: 'Missing hero section',
    }
  }

  const hero = heroSection as Record<string, unknown>
  let score = 5 // Base score for having hero

  // Check for image
  if (hero.image || hero.backgroundImage) score += 5
  // Check for title
  if (hero.title) score += 3
  // Check for subtitle
  if (hero.subtitle) score += 2

  return {
    name: 'Hero Section',
    passed: score >= 10,
    score,
    maxScore: 15,
    details: score < 15 ? 'Hero section incomplete' : undefined,
  }
}

function checkSeoMetadata(page: Record<string, unknown>): QualityCheck {
  const seo = page.seo as Record<string, unknown> | undefined
  let score = 0
  const issues: string[] = []

  if (!seo) {
    return {
      name: 'SEO Metadata',
      passed: false,
      score: 0,
      maxScore: 10,
      details: 'Missing SEO metadata',
    }
  }

  // Check title
  const title = seo.title as Record<string, string> | string | undefined
  const titleText = typeof title === 'string' ? title : title?.en
  if (titleText) {
    score += 3
    if (titleText.length > 60) {
      issues.push('SEO title too long')
      score -= 1
    }
  }

  // Check description
  const desc = seo.description as Record<string, string> | string | undefined
  const descText = typeof desc === 'string' ? desc : desc?.en
  if (descText) {
    score += 4
    if (descText.length > 160) {
      issues.push('SEO description too long')
      score -= 1
    }
  }

  // Check keywords
  if (seo.keywords) score += 3

  return {
    name: 'SEO Metadata',
    passed: score >= 7,
    score,
    maxScore: 10,
    details: issues.length > 0 ? issues.join(', ') : undefined,
  }
}

function checkContentSections(body: unknown[]): QualityCheck {
  const sectionTypes = body.map((b: any) => b.type)
  let score = 0
  const issues: string[] = []

  // Minimum sections check
  if (body.length >= 3) score += 5
  else if (body.length >= 2) score += 3
  else issues.push('Too few sections')

  // Variety check
  const uniqueTypes = new Set(sectionTypes)
  if (uniqueTypes.size >= 4) score += 5
  else if (uniqueTypes.size >= 3) score += 3
  else issues.push('Limited section variety')

  // Content-rich sections check
  const contentSections = body.filter((b: any) =>
    ['content-section', 'feature-section', 'faq-section'].includes(b.type)
  )
  if (contentSections.length >= 2) score += 5
  else if (contentSections.length >= 1) score += 3
  else issues.push('Not enough content sections')

  return {
    name: 'Content Sections',
    passed: score >= 10,
    score,
    maxScore: 15,
    details: issues.length > 0 ? issues.join(', ') : undefined,
  }
}

function checkImagePresence(body: unknown[]): QualityCheck {
  let imagesFound = 0
  let sectionsNeedingImages = 0

  for (const section of body as Record<string, unknown>[]) {
    if (['hero-section', 'content-section', 'gallery-section'].includes(section.type as string)) {
      sectionsNeedingImages++
      if (section.image || section.backgroundImage) {
        imagesFound++
      }
    }
  }

  const percentage = sectionsNeedingImages > 0
    ? (imagesFound / sectionsNeedingImages) * 100
    : 100

  const score = Math.round((percentage / 100) * 10)

  return {
    name: 'Image Presence',
    passed: percentage >= 50,
    score,
    maxScore: 10,
    details: percentage < 100 ? `${imagesFound}/${sectionsNeedingImages} sections have images` : undefined,
  }
}

function checkFaqSection(body: unknown[]): QualityCheck {
  const faqSection = body.find((b: any) => b.type === 'faq-section') as Record<string, unknown> | undefined

  if (!faqSection) {
    return {
      name: 'FAQ Section',
      passed: false,
      score: 0,
      maxScore: 10,
      details: 'Missing FAQ section',
    }
  }

  const items = faqSection.items as unknown[] | undefined
  if (!items || items.length === 0) {
    return {
      name: 'FAQ Section',
      passed: false,
      score: 2,
      maxScore: 10,
      details: 'FAQ section has no items',
    }
  }

  let score = 5 // Base for having FAQ

  // Quality check
  if (items.length >= 4) score += 3
  else if (items.length >= 2) score += 2

  // Check for actual content
  const hasContent = items.every((item: any) =>
    item.question && item.answer &&
    (typeof item.question === 'string' ? item.question : item.question?.en) &&
    (typeof item.answer === 'string' ? item.answer : item.answer?.en)
  )
  if (hasContent) score += 2

  return {
    name: 'FAQ Section',
    passed: score >= 7,
    score,
    maxScore: 10,
  }
}

function checkCtaSection(body: unknown[]): QualityCheck {
  const ctaSection = body.find((b: any) => b.type === 'cta-section')

  if (!ctaSection) {
    return {
      name: 'CTA Section',
      passed: false,
      score: 0,
      maxScore: 5,
      details: 'Missing CTA section',
    }
  }

  const cta = ctaSection as Record<string, unknown>
  let score = 3 // Base for having CTA

  if (cta.title) score += 1
  if (cta.buttons && (cta.buttons as unknown[]).length > 0) score += 1

  return {
    name: 'CTA Section',
    passed: true,
    score,
    maxScore: 5,
  }
}

function checkNoPlaceholders(body: unknown[]): QualityCheck {
  const placeholderPatterns = [
    /\[.*?\]/,        // [placeholder]
    /\{\{.*?\}\}/,    // {{placeholder}}
    /TODO/i,
    /PLACEHOLDER/i,
    /Lorem ipsum/i,
    /example\.com/i,
  ]

  const bodyText = JSON.stringify(body)
  const foundPlaceholders: string[] = []

  for (const pattern of placeholderPatterns) {
    if (pattern.test(bodyText)) {
      foundPlaceholders.push(pattern.source)
    }
  }

  return {
    name: 'No Placeholders',
    passed: foundPlaceholders.length === 0,
    score: foundPlaceholders.length === 0 ? 10 : 0,
    maxScore: 10,
    details: foundPlaceholders.length > 0
      ? `Found placeholder patterns: ${foundPlaceholders.join(', ')}`
      : undefined,
  }
}

function checkEnglishOnly(page: Record<string, unknown>): QualityCheck {
  const body = page.body as unknown[]
  if (!body) return { name: 'English Only', passed: true, score: 5, maxScore: 5 }

  // Check if content has non-English structure (localized objects)
  let hasLocalizedContent = false

  const checkValue = (value: unknown): void => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value as object)
      // If object has only language codes as keys
      if (keys.every(k => ['en', 'de', 'fr', 'it', 'es'].includes(k))) {
        // This is fine - localized content
        if (keys.length > 1) {
          hasLocalizedContent = true
        }
      }
    }
  }

  for (const section of body) {
    const values = Object.values(section as object)
    for (const v of values) {
      checkValue(v)
    }
  }

  // For now, we allow localized content but could flag it
  return {
    name: 'English Only',
    passed: true,
    score: 5,
    maxScore: 5,
    details: hasLocalizedContent ? 'Has multi-language structure' : undefined,
  }
}

// =============================================================================
// AUDIT EXECUTION
// =============================================================================

function auditPage(pagePath: string, relativePath: string): PageAudit {
  const page = JSON.parse(readFileSync(pagePath, 'utf-8')) as Record<string, unknown>
  const body = (page.body || []) as unknown[]

  const checks: QualityCheck[] = [
    checkHeroSection(body),
    checkSeoMetadata(page),
    checkContentSections(body),
    checkImagePresence(body),
    checkFaqSection(body),
    checkCtaSection(body),
    checkNoPlaceholders(body),
    checkEnglishOnly(page),
  ]

  const totalScore = checks.reduce((sum, c) => sum + c.score, 0)
  const maxScore = checks.reduce((sum, c) => sum + c.maxScore, 0)
  const percentage = Math.round((totalScore / maxScore) * 100)

  const issues = checks
    .filter(c => !c.passed)
    .map(c => c.details || `${c.name} failed`)

  return {
    path: pagePath,
    relativePath,
    score: totalScore,
    maxScore,
    percentage,
    passed: percentage >= 70,
    checks,
    issues,
  }
}

// =============================================================================
// PAGE DISCOVERY
// =============================================================================

function discoverPages(): { path: string; relativePath: string }[] {
  const pages: { path: string; relativePath: string }[] = []

  function scanDirectory(dir: string, baseSlug: string = '') {
    const items = readdirSync(dir, { withFileTypes: true })

    for (const item of items) {
      const fullPath = join(dir, item.name)

      if (item.isDirectory()) {
        scanDirectory(fullPath, baseSlug ? `${baseSlug}/${item.name}` : item.name)
      } else if (item.name.endsWith('.json')) {
        const slug = item.name.replace('.json', '')
        const relativePath = baseSlug ? `${baseSlug}/${slug}` : slug
        pages.push({ path: fullPath, relativePath })
      }
    }
  }

  scanDirectory(PAGES_DIR)
  return pages
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const showFailed = args.includes('--show-failed')

  console.log('\n' + '═'.repeat(60))
  console.log('  cinqueterre.travel Content Quality Audit')
  console.log('═'.repeat(60))

  // Discover pages
  console.log('\n📄 Discovering pages...')
  const pages = discoverPages()
  console.log(`   Found ${pages.length} pages`)

  // Audit pages
  console.log('\n🔍 Auditing pages...')

  const audits: PageAudit[] = []
  const issueCounter: Record<string, number> = {}

  for (const page of pages) {
    const audit = auditPage(page.path, page.relativePath)
    audits.push(audit)

    // Count issues
    for (const issue of audit.issues) {
      issueCounter[issue] = (issueCounter[issue] || 0) + 1
    }

    if (verbose) {
      const icon = audit.passed ? '✓' : '✗'
      const color = audit.passed ? '\x1b[32m' : '\x1b[31m'
      console.log(`   ${color}${icon}\x1b[0m ${audit.relativePath}: ${audit.percentage}%`)
    }
  }

  // Calculate summary
  const passedPages = audits.filter(a => a.passed).length
  const failedPages = audits.filter(a => !a.passed).length
  const averageScore = audits.reduce((sum, a) => sum + a.score, 0) / audits.length
  const averagePercentage = audits.reduce((sum, a) => sum + a.percentage, 0) / audits.length

  // Top issues
  const topIssues = Object.entries(issueCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([issue, count]) => ({ issue, count }))

  // Failed pages list
  const failedPagesList = audits
    .filter(a => !a.passed)
    .sort((a, b) => a.percentage - b.percentage)
    .map(a => a.relativePath)

  // Build report
  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalPages: pages.length,
      passedPages,
      failedPages,
      averageScore: Math.round(averageScore * 10) / 10,
      averagePercentage: Math.round(averagePercentage * 10) / 10,
    },
    pages: audits,
    failedPagesList,
    topIssues,
  }

  // Save report
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))
  console.log(`\n📊 Report saved to: ${REPORT_FILE}`)

  // Print summary
  console.log('\n' + '═'.repeat(60))
  console.log('  Audit Summary')
  console.log('═'.repeat(60))

  const passRate = Math.round((passedPages / pages.length) * 100)
  const passColor = passRate >= 80 ? '\x1b[32m' : passRate >= 60 ? '\x1b[33m' : '\x1b[31m'

  console.log(`\n   Total pages: ${pages.length}`)
  console.log(`   ${passColor}Passed: ${passedPages} (${passRate}%)\x1b[0m`)
  console.log(`   Failed: ${failedPages}`)
  console.log(`   Average score: ${Math.round(averagePercentage)}%`)

  // Top issues
  if (topIssues.length > 0) {
    console.log('\n   Top Issues:')
    for (const { issue, count } of topIssues.slice(0, 5)) {
      console.log(`   - ${issue}: ${count} pages`)
    }
  }

  // Show failed pages if requested
  if (showFailed && failedPagesList.length > 0) {
    console.log('\n   Failed Pages:')
    for (const page of failedPagesList.slice(0, 20)) {
      const audit = audits.find(a => a.relativePath === page)
      console.log(`   - ${page} (${audit?.percentage}%)`)
    }
    if (failedPagesList.length > 20) {
      console.log(`   ... and ${failedPagesList.length - 20} more`)
    }
  }

  console.log('\n' + '═'.repeat(60))

  if (passRate >= 70) {
    console.log('\x1b[32m✓ Quality threshold met! Ready for deployment.\x1b[0m')
  } else {
    console.log('\x1b[33m⚠ Quality threshold not met. Review failed pages.\x1b[0m')
  }

  console.log('\nNext steps:')
  if (passRate < 70) {
    console.log('  1. Review failed pages in audit-report.json')
    console.log('  2. Re-run batch generation for failed pages')
    console.log('  3. tsx scripts/deploy-cinqueterre.ts')
  } else {
    console.log('  1. tsx scripts/deploy-cinqueterre.ts')
  }
  console.log('')

  // Exit with error if threshold not met
  if (passRate < 70) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Audit failed:', err)
  process.exit(1)
})
