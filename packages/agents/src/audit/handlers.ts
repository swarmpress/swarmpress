/**
 * AuditAgent Tool Handlers
 * Implementations for content integrity auditing
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'

// ============================================================================
// Types
// ============================================================================

interface RunContentAuditInput {
  content_path: string
  checks?: string[]
  validate_image_content?: boolean
  sitemap_slugs?: string[]
}

interface RunLinkinatorInput {
  site_url: string
  concurrency?: number
  timeout?: number
  skip_patterns?: string[]
  recurse?: boolean
}

interface RunLighthouseInput {
  url: string
  categories?: string[]
  device?: 'desktop' | 'mobile'
  output_format?: 'json' | 'html'
}

interface CheckUrlInput {
  url: string
  timeout?: number
}

interface ValidateImageInput {
  image_url: string
  expected_context: string
  village_context?: string
  category_context?: string
}

interface GenerateAuditReportInput {
  audit_results: any
  format?: 'markdown' | 'json' | 'summary'
  include_fixed?: boolean
}

interface CompareAuditsInput {
  previous_audit_path: string
  current_audit_path: string
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * Run comprehensive content audit
 */
export const runContentAuditHandler: ToolHandler<RunContentAuditInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[AuditHandler] run_content_audit called:`, {
      content_path: input.content_path,
      checks: input.checks,
      validate_image_content: input.validate_image_content,
    })

    const { runContentAudit, filterIssuesBySeverity } = await import('@swarm-press/shared')
    const { readFile } = await import('fs/promises')
    const { join } = await import('path')

    // Try to load site config for languages
    let requiredLanguages: string[] = ['en']
    try {
      const siteConfigPath = join(input.content_path, 'site.json')
      const config = JSON.parse(await readFile(siteConfigPath, 'utf-8'))
      if (config.locales) {
        requiredLanguages = config.locales
      }
    } catch {
      // Use default
    }

    // Get Anthropic client if validating images
    let anthropicClient
    if (input.validate_image_content) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      anthropicClient = new Anthropic()
    }

    const result = await runContentAudit({
      contentPath: input.content_path,
      checks: (input.checks as any) || ['all'],
      anthropicClient,
      sitemapSlugs: input.sitemap_slugs,
      requiredLanguages,
      options: {
        validateImageContent: input.validate_image_content || false,
        concurrency: 10,
        timeout: 5000,
      },
    })

    return toolSuccess({
      summary: result.summary,
      issues: result.issues.slice(0, 100), // Limit to first 100 issues
      totalIssues: result.issues.length,
      criticalIssues: filterIssuesBySeverity(result.issues, 'critical'),
      filesScanned: result.summary.totalFilesScanned,
      urlsChecked: result.summary.totalUrlsChecked,
      generatedAt: result.generatedAt,
    })
  } catch (error) {
    console.error('[AuditHandler] run_content_audit error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to run content audit')
  }
}

/**
 * Run Linkinator on live site
 */
export const runLinkinatorHandler: ToolHandler<RunLinkinatorInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[AuditHandler] run_linkinator called:`, {
      site_url: input.site_url,
      concurrency: input.concurrency,
    })

    // Use linkinator package
    const { LinkChecker } = await import('linkinator')

    const checker = new LinkChecker()

    // Track results
    const results: Array<{
      url: string
      status: number
      state: string
      parent?: string
    }> = []

    checker.on('link', (link) => {
      results.push({
        url: link.url,
        status: link.status || 0,
        state: link.state,
        parent: link.parent,
      })
    })

    // Run the check
    const checkResult = await checker.check({
      path: input.site_url,
      concurrency: input.concurrency || 10,
      timeout: input.timeout || 30000,
      recurse: input.recurse !== false,
      linksToSkip: input.skip_patterns,
    })

    // Categorize results
    const broken = results.filter((r) => r.state === 'BROKEN')
    const skipped = results.filter((r) => r.state === 'SKIPPED')
    const ok = results.filter((r) => r.state === 'OK')

    return toolSuccess({
      summary: {
        total: results.length,
        ok: ok.length,
        broken: broken.length,
        skipped: skipped.length,
        passed: checkResult.passed,
      },
      brokenLinks: broken.map((r) => ({
        url: r.url,
        status: r.status,
        foundOn: r.parent,
      })),
      scannedUrls: results.length,
    })
  } catch (error) {
    console.error('[AuditHandler] run_linkinator error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to run Linkinator')
  }
}

/**
 * Run Lighthouse audit
 */
export const runLighthouseHandler: ToolHandler<RunLighthouseInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[AuditHandler] run_lighthouse called:`, {
      url: input.url,
      categories: input.categories,
      device: input.device,
    })

    // Use lighthouse package
    const lighthouse = await import('lighthouse')
    const chromeLauncher = await import('chrome-launcher')

    // Launch Chrome
    const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] })

    // Configure Lighthouse
    const options = {
      logLevel: 'error' as const,
      output: input.output_format || 'json',
      onlyCategories: input.categories || ['performance', 'accessibility', 'best-practices', 'seo'],
      port: chrome.port,
      formFactor: input.device || 'desktop',
      screenEmulation: input.device === 'mobile'
        ? { mobile: true, width: 375, height: 812, deviceScaleFactor: 2 }
        : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1 },
    }

    // Run Lighthouse
    const runnerResult = await lighthouse.default(input.url, options)

    // Close Chrome
    await chrome.kill()

    if (!runnerResult?.lhr) {
      return toolError('Lighthouse did not return results')
    }

    const { lhr } = runnerResult

    // Extract scores
    const scores: Record<string, number> = {}
    for (const [key, category] of Object.entries(lhr.categories)) {
      scores[key] = Math.round((category as any).score * 100)
    }

    // Extract key metrics
    const metrics: Record<string, any> = {}
    const metricKeys = [
      'first-contentful-paint',
      'largest-contentful-paint',
      'cumulative-layout-shift',
      'total-blocking-time',
      'speed-index',
    ]

    for (const key of metricKeys) {
      const audit = lhr.audits[key]
      if (audit) {
        metrics[key] = {
          score: Math.round((audit.score || 0) * 100),
          displayValue: audit.displayValue,
          numericValue: audit.numericValue,
        }
      }
    }

    // Extract failed audits
    const failedAudits = Object.entries(lhr.audits)
      .filter(([, audit]: [string, any]) => audit.score !== null && audit.score < 0.9)
      .slice(0, 20)
      .map(([id, audit]: [string, any]) => ({
        id,
        title: audit.title,
        description: audit.description,
        score: Math.round((audit.score || 0) * 100),
        displayValue: audit.displayValue,
      }))

    return toolSuccess({
      url: input.url,
      device: input.device || 'desktop',
      scores,
      metrics,
      failedAudits,
      fetchTime: lhr.fetchTime,
    })
  } catch (error) {
    console.error('[AuditHandler] run_lighthouse error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to run Lighthouse')
  }
}

/**
 * Check single URL
 */
export const checkUrlHandler: ToolHandler<CheckUrlInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[AuditHandler] check_url called: ${input.url}`)

    const { checkUrl } = await import('@swarm-press/shared')
    const result = await checkUrl({ url: input.url, timeout: input.timeout })

    return toolSuccess(result)
  } catch (error) {
    console.error('[AuditHandler] check_url error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to check URL')
  }
}

/**
 * Validate image content with vision
 */
export const validateImageHandler: ToolHandler<ValidateImageInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[AuditHandler] validate_image called:`, {
      image_url: input.image_url.slice(0, 100),
      expected_context: input.expected_context,
    })

    const { validateImageContent } = await import('@swarm-press/shared')
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic()

    const result = await validateImageContent(
      {
        imageUrl: input.image_url,
        expectedContext: input.expected_context,
        villageContext: input.village_context,
        categoryContext: input.category_context,
      },
      client
    )

    return toolSuccess(result)
  } catch (error) {
    console.error('[AuditHandler] validate_image error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to validate image')
  }
}

/**
 * Generate audit report
 */
export const generateAuditReportHandler: ToolHandler<GenerateAuditReportInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[AuditHandler] generate_audit_report called:`, {
      format: input.format,
      include_fixed: input.include_fixed,
    })

    const { formatAuditReportAsMarkdown } = await import('@swarm-press/shared')

    const auditResult = input.audit_results

    // Filter out fixed issues if requested
    let issues = auditResult.issues || []
    if (!input.include_fixed) {
      issues = issues.filter((i: any) => !i.fixed)
    }

    const filteredResult = { ...auditResult, issues }

    switch (input.format) {
      case 'markdown':
        return toolSuccess({
          report: formatAuditReportAsMarkdown(filteredResult),
          format: 'markdown',
        })

      case 'summary':
        return toolSuccess({
          report: {
            totalIssues: filteredResult.summary?.totalIssues || issues.length,
            criticalIssues: filteredResult.summary?.criticalIssues || 0,
            highIssues: filteredResult.summary?.highIssues || 0,
            mediumIssues: filteredResult.summary?.mediumIssues || 0,
            lowIssues: filteredResult.summary?.lowIssues || 0,
            byCategory: filteredResult.summary?.byCategory || {},
            topIssues: issues.slice(0, 10),
          },
          format: 'summary',
        })

      default:
        return toolSuccess({
          report: filteredResult,
          format: 'json',
        })
    }
  } catch (error) {
    console.error('[AuditHandler] generate_audit_report error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to generate audit report')
  }
}

/**
 * Compare two audits
 */
export const compareAuditsHandler: ToolHandler<CompareAuditsInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[AuditHandler] compare_audits called:`, {
      previous: input.previous_audit_path,
      current: input.current_audit_path,
    })

    const { readFile } = await import('fs/promises')

    const previous = JSON.parse(await readFile(input.previous_audit_path, 'utf-8'))
    const current = JSON.parse(await readFile(input.current_audit_path, 'utf-8'))

    // Create issue key for comparison
    const issueKey = (issue: any) => `${issue.file || issue.relativePath}:${issue.jsonPath}:${issue.url || ''}`

    const previousKeys = new Set((previous.issues || []).map(issueKey))
    const currentKeys = new Set((current.issues || []).map(issueKey))

    // Find new, resolved, and unchanged
    const newIssues = (current.issues || []).filter((i: any) => !previousKeys.has(issueKey(i)))
    const resolvedIssues = (previous.issues || []).filter((i: any) => !currentKeys.has(issueKey(i)))
    const unchangedIssues = (current.issues || []).filter((i: any) => previousKeys.has(issueKey(i)))

    return toolSuccess({
      comparison: {
        previousTotal: previous.summary?.totalIssues || previous.issues?.length || 0,
        currentTotal: current.summary?.totalIssues || current.issues?.length || 0,
        newIssues: newIssues.length,
        resolvedIssues: resolvedIssues.length,
        unchangedIssues: unchangedIssues.length,
        trend: newIssues.length > resolvedIssues.length ? 'worse' : newIssues.length < resolvedIssues.length ? 'better' : 'same',
      },
      newIssues: newIssues.slice(0, 20),
      resolvedIssues: resolvedIssues.slice(0, 20),
      previousDate: previous.generatedAt,
      currentDate: current.generatedAt,
    })
  } catch (error) {
    console.error('[AuditHandler] compare_audits error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to compare audits')
  }
}

// ============================================================================
// Export Handler Map
// ============================================================================

export const auditAgentHandlers: Record<string, ToolHandler<any>> = {
  run_content_audit: runContentAuditHandler,
  run_linkinator: runLinkinatorHandler,
  run_lighthouse: runLighthouseHandler,
  check_url: checkUrlHandler,
  validate_image: validateImageHandler,
  generate_audit_report: generateAuditReportHandler,
  compare_audits: compareAuditsHandler,
}
