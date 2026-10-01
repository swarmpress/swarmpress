/**
 * Comprehensive Content Audit
 * Orchestrates all content integrity checks
 */

import Anthropic from '@anthropic-ai/sdk'
import { checkUrls, categorizeUrlStatus, type CheckUrlOutput } from './check-url'
import { scanContentForUrls, groupUrlsByType, getUniqueUrls, type UrlReference, type ScanUrlsOutput } from './scan-urls'
import { validateImageContent, quickImageHeuristics, type ValidateImageOutput } from './validate-image'

// ============================================================================
// Types
// ============================================================================

export interface AuditInput {
  contentPath: string
  checks?: ('images' | 'links' | 'translations' | 'all')[]
  anthropicClient?: Anthropic // For vision validation
  sitemapSlugs?: string[] // Valid internal slugs for link validation
  requiredLanguages?: string[] // e.g., ['en', 'de', 'fr', 'it']
  options?: {
    validateImageContent?: boolean // Use vision API (slower, more accurate)
    concurrency?: number
    timeout?: number
  }
}

export interface AuditIssue {
  id: string
  category: 'broken_image' | 'wrong_image' | 'broken_link' | 'missing_internal_link' | 'missing_translation' | 'invalid_reference'
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  relativePath: string
  jsonPath: string
  url?: string
  description: string
  suggestedFix: string
  autoFixable: boolean
  details?: Record<string, unknown>
}

export interface AuditSummary {
  totalIssues: number
  criticalIssues: number
  highIssues: number
  mediumIssues: number
  lowIssues: number
  byCategory: Record<string, number>
  totalFilesScanned: number
  totalUrlsChecked: number
}

export interface AuditOutput {
  summary: AuditSummary
  issues: AuditIssue[]
  urlScanResult: ScanUrlsOutput
  urlCheckResults?: Map<string, CheckUrlOutput>
  imageValidationResults?: Map<string, ValidateImageOutput>
  generatedAt: string
}

// ============================================================================
// Main Audit Function
// ============================================================================

/**
 * Run comprehensive content audit
 */
export async function runContentAudit(input: AuditInput): Promise<AuditOutput> {
  const {
    contentPath,
    checks = ['all'],
    anthropicClient,
    sitemapSlugs = [],
    requiredLanguages = ['en'],
    options = {},
  } = input

  const {
    validateImageContent: shouldValidateImages = false,
    concurrency = 10,
    timeout = 5000,
  } = options

  const shouldCheckImages = checks.includes('all') || checks.includes('images')
  const shouldCheckLinks = checks.includes('all') || checks.includes('links')
  const shouldCheckTranslations = checks.includes('all') || checks.includes('translations')

  const issues: AuditIssue[] = []
  let issueId = 0

  // Step 1: Scan all content for URLs
  console.log('[Audit] Scanning content for URLs...')
  const urlScanResult = await scanContentForUrls({
    path: contentPath,
    urlTypes: ['all'],
  })

  const { images, internalLinks, externalLinks } = groupUrlsByType(urlScanResult.urls)
  console.log(`[Audit] Found ${images.length} images, ${internalLinks.length} internal links, ${externalLinks.length} external links`)

  // Step 2: Check image accessibility
  let urlCheckResults: Map<string, CheckUrlOutput> | undefined
  if (shouldCheckImages) {
    console.log('[Audit] Checking image accessibility...')
    const uniqueImageUrls = getUniqueUrls(images)
    urlCheckResults = await checkUrls(uniqueImageUrls, {
      timeout,
      concurrency,
      onProgress: (completed, total) => {
        if (completed % 10 === 0) {
          console.log(`[Audit] Checked ${completed}/${total} images`)
        }
      },
    })

    // Record broken images
    for (const [url, result] of urlCheckResults) {
      if (!result.accessible) {
        const refs = images.filter((r) => r.url === url)
        for (const ref of refs) {
          issues.push({
            id: `issue-${++issueId}`,
            category: 'broken_image',
            severity: 'critical',
            file: ref.file,
            relativePath: ref.relativePath,
            jsonPath: ref.jsonPath,
            url,
            description: `Image not accessible: ${result.error || `HTTP ${result.statusCode}`}`,
            suggestedFix: 'Replace with a working image URL or upload a new image',
            autoFixable: false,
            details: { statusCode: result.statusCode, error: result.error },
          })
        }
      }
    }
  }

  // Step 3: Validate image content (if vision API available)
  let imageValidationResults: Map<string, ValidateImageOutput> | undefined
  if (shouldCheckImages && shouldValidateImages && anthropicClient) {
    console.log('[Audit] Validating image content with vision...')
    imageValidationResults = new Map()

    // Only validate accessible images
    const accessibleImages = images.filter((img) => {
      const check = urlCheckResults?.get(img.url)
      return check?.accessible !== false
    })

    // Group images by URL to avoid duplicate validations
    const uniqueImages = new Map<string, UrlReference>()
    for (const img of accessibleImages) {
      if (!uniqueImages.has(img.url)) {
        uniqueImages.set(img.url, img)
      }
    }

    let validated = 0
    for (const [url, ref] of uniqueImages) {
      // First do quick heuristics check
      const heuristics = quickImageHeuristics(url, ref.context)

      // If heuristics raise concerns, do full validation
      if (!heuristics.likelyCorrect || validated < 20) { // Always validate first 20
        try {
          const result = await validateImageContent(
            {
              imageUrl: url,
              expectedContext: ref.context || 'Cinque Terre travel content',
              categoryContext: ref.fieldName,
            },
            anthropicClient
          )
          imageValidationResults.set(url, result)

          if (!result.isCorrect) {
            const refs = images.filter((r) => r.url === url)
            for (const r of refs) {
              issues.push({
                id: `issue-${++issueId}`,
                category: 'wrong_image',
                severity: result.confidence > 0.8 ? 'high' : 'medium',
                file: r.file,
                relativePath: r.relativePath,
                jsonPath: r.jsonPath,
                url,
                description: `Image doesn't match context: ${result.actualContent}`,
                suggestedFix: `Replace with image showing: ${ref.context || 'Cinque Terre content'}`,
                autoFixable: true, // MediaAgent can fix this
                details: {
                  actualContent: result.actualContent,
                  confidence: result.confidence,
                  issues: result.issues,
                },
              })
            }
          }
          validated++

          // Rate limiting
          if (validated % 5 === 0) {
            await new Promise((r) => setTimeout(r, 1000))
          }
        } catch (error) {
          console.error(`[Audit] Failed to validate ${url}:`, error)
        }
      } else if (heuristics.warnings.length > 0) {
        // Record heuristic warnings without full validation
        const refs = images.filter((r) => r.url === url)
        for (const r of refs) {
          issues.push({
            id: `issue-${++issueId}`,
            category: 'wrong_image',
            severity: 'low',
            file: r.file,
            relativePath: r.relativePath,
            jsonPath: r.jsonPath,
            url,
            description: `Possible image issue: ${heuristics.warnings.join('; ')}`,
            suggestedFix: 'Review image manually to verify it matches the content',
            autoFixable: false,
            details: { warnings: heuristics.warnings },
          })
        }
      }
    }
  }

  // Step 4: Check internal links
  if (shouldCheckLinks && sitemapSlugs.length > 0) {
    console.log('[Audit] Checking internal links...')
    for (const link of internalLinks) {
      // Normalize the link path
      const normalizedPath = link.url.replace(/^\/[a-z]{2}\//, '/') // Remove language prefix

      if (!sitemapSlugs.some((slug) => normalizedPath === slug || normalizedPath.startsWith(slug + '/'))) {
        issues.push({
          id: `issue-${++issueId}`,
          category: 'broken_link',
          severity: 'high',
          file: link.file,
          relativePath: link.relativePath,
          jsonPath: link.jsonPath,
          url: link.url,
          description: `Internal link points to non-existent page: ${link.url}`,
          suggestedFix: 'Update link to point to an existing page or remove the link',
          autoFixable: false,
          details: { originalUrl: link.url, normalizedPath },
        })
      }
    }
  }

  // Step 5: Check external links (optional, can be slow)
  if (shouldCheckLinks) {
    console.log('[Audit] Checking external links...')
    const uniqueExternalUrls = getUniqueUrls(externalLinks)
    const externalResults = await checkUrls(uniqueExternalUrls, {
      timeout,
      concurrency: Math.min(concurrency, 5), // Be gentler with external sites
    })

    for (const [url, result] of externalResults) {
      const status = categorizeUrlStatus(result)
      if (status === 'client_error' || status === 'server_error' || status === 'network_error') {
        const refs = externalLinks.filter((r) => r.url === url)
        for (const ref of refs) {
          issues.push({
            id: `issue-${++issueId}`,
            category: 'broken_link',
            severity: status === 'client_error' ? 'high' : 'medium',
            file: ref.file,
            relativePath: ref.relativePath,
            jsonPath: ref.jsonPath,
            url,
            description: `External link broken: ${result.error || `HTTP ${result.statusCode}`}`,
            suggestedFix: 'Update to working URL or remove the link',
            autoFixable: false,
            details: { statusCode: result.statusCode, error: result.error },
          })
        }
      }
    }

    // Merge external results into main results
    if (urlCheckResults) {
      for (const [url, result] of externalResults) {
        urlCheckResults.set(url, result)
      }
    } else {
      urlCheckResults = externalResults
    }
  }

  // Step 6: Check translations (scan JSON for LocalizedString patterns)
  if (shouldCheckTranslations) {
    console.log('[Audit] Checking translations...')
    const translationIssues = await scanForMissingTranslations(contentPath, requiredLanguages)
    issues.push(
      ...translationIssues.map((issue) => ({
        ...issue,
        id: `issue-${++issueId}`,
      }))
    )
  }

  // Build summary
  const summary: AuditSummary = {
    totalIssues: issues.length,
    criticalIssues: issues.filter((i) => i.severity === 'critical').length,
    highIssues: issues.filter((i) => i.severity === 'high').length,
    mediumIssues: issues.filter((i) => i.severity === 'medium').length,
    lowIssues: issues.filter((i) => i.severity === 'low').length,
    byCategory: {},
    totalFilesScanned: urlScanResult.totalFiles,
    totalUrlsChecked: urlCheckResults?.size || 0,
  }

  for (const issue of issues) {
    summary.byCategory[issue.category] = (summary.byCategory[issue.category] || 0) + 1
  }

  return {
    summary,
    issues,
    urlScanResult,
    urlCheckResults,
    imageValidationResults,
    generatedAt: new Date().toISOString(),
  }
}

// ============================================================================
// Translation Check
// ============================================================================

import { readFile, readdir } from 'fs/promises'
import { join } from 'path'

/**
 * Scan content for missing translations in LocalizedString fields
 */
async function scanForMissingTranslations(
  contentPath: string,
  requiredLanguages: string[]
): Promise<Omit<AuditIssue, 'id'>[]> {
  const issues: Omit<AuditIssue, 'id'>[] = []

  async function processDirectory(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        await processDirectory(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = await readFile(fullPath, 'utf-8')
          const json = JSON.parse(content)
          const relativePath = fullPath.replace(contentPath + '/', '')

          const fileIssues = findMissingTranslations(json, '', fullPath, relativePath, requiredLanguages)
          issues.push(...fileIssues)
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  await processDirectory(contentPath)
  return issues
}

/**
 * Recursively find LocalizedString objects with missing translations
 */
function findMissingTranslations(
  obj: unknown,
  jsonPath: string,
  file: string,
  relativePath: string,
  requiredLanguages: string[]
): Omit<AuditIssue, 'id'>[] {
  const issues: Omit<AuditIssue, 'id'>[] = []

  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return issues
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      issues.push(...findMissingTranslations(obj[i], `${jsonPath}[${i}]`, file, relativePath, requiredLanguages))
    }
    return issues
  }

  const record = obj as Record<string, unknown>

  // Check if this looks like a LocalizedString (has 'en' key with string value)
  if (typeof record.en === 'string') {
    const missingLangs = requiredLanguages.filter((lang) => {
      const value = record[lang]
      return value === undefined || value === null || value === ''
    })

    if (missingLangs.length > 0 && missingLangs[0] !== 'en') {
      issues.push({
        category: 'missing_translation',
        severity: missingLangs.length === requiredLanguages.length - 1 ? 'high' : 'medium',
        file,
        relativePath,
        jsonPath,
        description: `Missing translations for: ${missingLangs.join(', ')}`,
        suggestedFix: `Add translations for ${missingLangs.join(', ')}. English value: "${(record.en as string).substring(0, 50)}..."`,
        autoFixable: true, // WriterAgent can generate translations
        details: {
          missingLanguages: missingLangs,
          existingContent: record,
        },
      })
    }
    return issues // Don't recurse into LocalizedString objects
  }

  // Recurse into other objects
  for (const [key, value] of Object.entries(record)) {
    const childPath = jsonPath ? `${jsonPath}.${key}` : key
    issues.push(...findMissingTranslations(value, childPath, file, relativePath, requiredLanguages))
  }

  return issues
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Filter issues by severity
 */
export function filterIssuesBySeverity(
  issues: AuditIssue[],
  minSeverity: 'critical' | 'high' | 'medium' | 'low'
): AuditIssue[] {
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  const threshold = severityOrder[minSeverity]
  return issues.filter((i) => severityOrder[i.severity] <= threshold)
}

/**
 * Filter issues by category
 */
export function filterIssuesByCategory(issues: AuditIssue[], category: AuditIssue['category']): AuditIssue[] {
  return issues.filter((i) => i.category === category)
}

/**
 * Group issues by file
 */
export function groupIssuesByFile(issues: AuditIssue[]): Map<string, AuditIssue[]> {
  const grouped = new Map<string, AuditIssue[]>()
  for (const issue of issues) {
    const existing = grouped.get(issue.relativePath) || []
    existing.push(issue)
    grouped.set(issue.relativePath, existing)
  }
  return grouped
}

/**
 * Get auto-fixable issues
 */
export function getAutoFixableIssues(issues: AuditIssue[]): AuditIssue[] {
  return issues.filter((i) => i.autoFixable)
}

/**
 * Format audit report as markdown
 */
export function formatAuditReportAsMarkdown(audit: AuditOutput): string {
  const lines: string[] = [
    '# Content Integrity Audit Report',
    '',
    `Generated: ${audit.generatedAt}`,
    '',
    '## Summary',
    '',
    `- **Total Issues:** ${audit.summary.totalIssues}`,
    `- **Critical:** ${audit.summary.criticalIssues}`,
    `- **High:** ${audit.summary.highIssues}`,
    `- **Medium:** ${audit.summary.mediumIssues}`,
    `- **Low:** ${audit.summary.lowIssues}`,
    `- **Files Scanned:** ${audit.summary.totalFilesScanned}`,
    `- **URLs Checked:** ${audit.summary.totalUrlsChecked}`,
    '',
    '### By Category',
    '',
  ]

  for (const [category, count] of Object.entries(audit.summary.byCategory)) {
    lines.push(`- ${category}: ${count}`)
  }

  lines.push('', '## Issues', '')

  // Group by severity
  const severities: Array<'critical' | 'high' | 'medium' | 'low'> = ['critical', 'high', 'medium', 'low']
  for (const severity of severities) {
    const severityIssues = audit.issues.filter((i) => i.severity === severity)
    if (severityIssues.length === 0) continue

    lines.push(`### ${severity.charAt(0).toUpperCase() + severity.slice(1)} (${severityIssues.length})`, '')

    for (const issue of severityIssues) {
      lines.push(`#### ${issue.description}`)
      lines.push(`- **File:** ${issue.relativePath}`)
      lines.push(`- **Path:** ${issue.jsonPath}`)
      if (issue.url) lines.push(`- **URL:** ${issue.url}`)
      lines.push(`- **Fix:** ${issue.suggestedFix}`)
      lines.push(`- **Auto-fixable:** ${issue.autoFixable ? 'Yes' : 'No'}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}
