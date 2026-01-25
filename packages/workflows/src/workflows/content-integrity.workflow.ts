/**
 * Content Integrity Workflow
 * Audits content for broken images, wrong images, broken links, and missing translations
 * Then orchestrates agents to fix issues automatically where possible
 *
 * Triggers: Scheduled (daily/weekly) or manual
 */

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  invokeWriterAgent,
  invokeMediaSelectorAgent,
  publishContentEvent,
  logAgentActivityToGitHub,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes', // Longer timeout for large audits
  retry: {
    maximumAttempts: 3,
  },
})

// ============================================================================
// Types
// ============================================================================

export interface ContentIntegrityInput {
  websiteId: string
  contentPath: string
  checks: ('images' | 'links' | 'translations' | 'all')[]
  mediaAgentId?: string
  writerAgentId?: string
  options?: {
    validateImageContent?: boolean // Use vision API for image validation
    fixAutomatically?: boolean // Auto-fix issues without human review
    maxIssuesToFix?: number // Limit auto-fixes per run
    requiredLanguages?: string[] // Override: Languages to check (if not specified, loaded from site config)
  }
}

export interface ContentIntegrityResult {
  success: boolean
  auditSummary: {
    totalIssues: number
    criticalIssues: number
    highIssues: number
    mediumIssues: number
    lowIssues: number
    byCategory: Record<string, number>
    filesScanned: number
    urlsChecked: number
  }
  fixesSummary?: {
    attempted: number
    successful: number
    failed: number
    needsManualReview: number
  }
  issues: Array<{
    category: string
    severity: string
    file: string
    jsonPath: string
    url?: string
    description: string
    fixed: boolean
    fixResult?: string
  }>
  generatedAt: string
  error?: string
}

// ============================================================================
// Workflow Implementation
// ============================================================================

/**
 * Content Integrity Audit & Fix Workflow
 *
 * Flow:
 * 1. Run comprehensive content audit (images, links, translations)
 * 2. Categorize issues by severity and type
 * 3. For auto-fixable issues, invoke appropriate agents
 * 4. Generate detailed report
 * 5. Create PR with fixes (if any)
 */
export async function contentIntegrityWorkflow(
  input: ContentIntegrityInput
): Promise<ContentIntegrityResult> {
  const {
    websiteId,
    contentPath,
    checks,
    mediaAgentId,
    writerAgentId,
    options = {},
  } = input

  const {
    validateImageContent = false,
    fixAutomatically = false,
    maxIssuesToFix = 50,
    requiredLanguages: providedLanguages,
  } = options

  console.log(`[ContentIntegrity] Starting audit for website ${websiteId}`)
  console.log(`[ContentIntegrity] Content path: ${contentPath}`)
  console.log(`[ContentIntegrity] Checks: ${checks.join(', ')}`)

  // Load required languages from site config if not provided
  let requiredLanguages: string[] = providedLanguages || []
  if (requiredLanguages.length === 0) {
    try {
      const siteConfig = await loadSiteConfigActivity({ contentPath })
      requiredLanguages = siteConfig?.locales || ['en']
      console.log(`[ContentIntegrity] Loaded languages from site config: ${requiredLanguages.join(', ')}`)
    } catch (error) {
      console.log(`[ContentIntegrity] Could not load site config, defaulting to English only`)
      requiredLanguages = ['en']
    }
  }

  try {
    // Step 1: Run the audit using the shared audit module
    console.log(`[ContentIntegrity] Step 1: Running content audit...`)

    // Import audit function - this runs in activity context
    const auditResult = await runAuditActivity({
      contentPath,
      checks,
      validateImageContent,
      requiredLanguages,
    })

    console.log(`[ContentIntegrity] Audit complete: ${auditResult.summary.totalIssues} issues found`)

    const issues = auditResult.issues.map((issue: any) => ({
      ...issue,
      fixed: false,
      fixResult: undefined as string | undefined,
    }))

    // Step 2: If auto-fix is enabled and we have agents, attempt fixes
    let fixesSummary = {
      attempted: 0,
      successful: 0,
      failed: 0,
      needsManualReview: 0,
    }

    if (fixAutomatically && (mediaAgentId || writerAgentId)) {
      console.log(`[ContentIntegrity] Step 2: Auto-fixing issues...`)

      // Group issues by type for efficient processing
      const imageIssues = issues.filter(
        (i: any) => i.category === 'broken_image' || i.category === 'wrong_image'
      )
      const linkIssues = issues.filter((i: any) => i.category === 'broken_link')
      const translationIssues = issues.filter(
        (i: any) => i.category === 'missing_translation'
      )

      // Fix image issues with MediaAgent
      if (mediaAgentId && imageIssues.length > 0) {
        const imagesToFix = imageIssues
          .filter((i: any) => i.autoFixable !== false)
          .slice(0, Math.min(maxIssuesToFix, imageIssues.length))

        console.log(`[ContentIntegrity] Fixing ${imagesToFix.length} image issues with MediaAgent`)

        for (const issue of imagesToFix) {
          fixesSummary.attempted++

          try {
            const fixTask = `Fix image issue in content:
File: ${issue.file}
JSON Path: ${issue.jsonPath}
Current URL: ${issue.url || 'unknown'}
Problem: ${issue.description}

Use your fix_broken_image tool to:
1. Search for a suitable replacement image for "${issue.context || 'Cinque Terre content'}"
2. Upload the new image to CDN
3. Update the content file

The content file is at: ${contentPath}/${issue.file}`

            const result = await invokeMediaSelectorAgent({
              agentId: mediaAgentId,
              task: fixTask,
              contentId: issue.id,
              websiteId,
            })

            if (result.success) {
              issue.fixed = true
              issue.fixResult = 'Fixed by MediaAgent'
              fixesSummary.successful++
            } else {
              issue.fixResult = `Failed: ${result.error}`
              fixesSummary.failed++
            }
          } catch (error) {
            issue.fixResult = `Error: ${error instanceof Error ? error.message : 'Unknown'}`
            fixesSummary.failed++
          }

          // Small delay between fixes
          await sleep('1 second')
        }
      }

      // Fix translation issues with WriterAgent
      if (writerAgentId && translationIssues.length > 0) {
        const translationsToFix = translationIssues
          .filter((i: any) => i.autoFixable !== false)
          .slice(0, Math.min(maxIssuesToFix - fixesSummary.attempted, translationIssues.length))

        console.log(`[ContentIntegrity] Fixing ${translationsToFix.length} translation issues with WriterAgent`)

        for (const issue of translationsToFix) {
          fixesSummary.attempted++

          try {
            const missingLangs = issue.details?.missingLanguages || []
            const existingContent = issue.details?.existingContent || {}
            const sourceText = existingContent.en || ''

            if (!sourceText) {
              issue.fixResult = 'No English source text available'
              fixesSummary.needsManualReview++
              continue
            }

            const fixTask = `Generate missing translations:
File: ${issue.file}
JSON Path: ${issue.jsonPath}
Missing languages: ${missingLangs.join(', ')}
English source: "${sourceText}"

Use your generate_translation tool for each missing language.
Then update the content file at: ${contentPath}/${issue.file}`

            const result = await invokeWriterAgent({
              agentId: writerAgentId,
              task: fixTask,
              websiteId,
            })

            if (result.success) {
              issue.fixed = true
              issue.fixResult = 'Translations generated by WriterAgent'
              fixesSummary.successful++
            } else {
              issue.fixResult = `Failed: ${result.error}`
              fixesSummary.failed++
            }
          } catch (error) {
            issue.fixResult = `Error: ${error instanceof Error ? error.message : 'Unknown'}`
            fixesSummary.failed++
          }

          // Small delay between fixes
          await sleep('500 milliseconds')
        }
      }

      // Link issues typically need manual review
      for (const issue of linkIssues) {
        if (!issue.fixed) {
          fixesSummary.needsManualReview++
        }
      }
    }

    // Step 3: Generate final report
    console.log(`[ContentIntegrity] Workflow complete`)
    console.log(`[ContentIntegrity] Fixes attempted: ${fixesSummary.attempted}`)
    console.log(`[ContentIntegrity] Fixes successful: ${fixesSummary.successful}`)

    return {
      success: true,
      auditSummary: {
        totalIssues: auditResult.summary.totalIssues,
        criticalIssues: auditResult.summary.criticalIssues,
        highIssues: auditResult.summary.highIssues,
        mediumIssues: auditResult.summary.mediumIssues,
        lowIssues: auditResult.summary.lowIssues,
        byCategory: auditResult.summary.byCategory,
        filesScanned: auditResult.summary.totalFilesScanned,
        urlsChecked: auditResult.summary.totalUrlsChecked,
      },
      fixesSummary: fixAutomatically ? fixesSummary : undefined,
      issues: issues.map((i: any) => ({
        category: i.category,
        severity: i.severity,
        file: i.relativePath || i.file,
        jsonPath: i.jsonPath,
        url: i.url,
        description: i.description,
        fixed: i.fixed,
        fixResult: i.fixResult,
      })),
      generatedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error(`[ContentIntegrity] Workflow failed:`, error)
    return {
      success: false,
      auditSummary: {
        totalIssues: 0,
        criticalIssues: 0,
        highIssues: 0,
        mediumIssues: 0,
        lowIssues: 0,
        byCategory: {},
        filesScanned: 0,
        urlsChecked: 0,
      },
      issues: [],
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Activity Wrapper for Audit (to be added to activities/index.ts)
// ============================================================================

/**
 * Load site configuration to get available locales
 */
async function loadSiteConfigActivity(params: {
  contentPath: string
}): Promise<{ locales: string[]; defaultLocale: string } | null> {
  const { readFile } = await import('fs/promises')
  const { join } = await import('path')

  // Try to load site.json from content root
  const possiblePaths = [
    join(params.contentPath, 'site.json'),
    join(params.contentPath, 'config.json'),
    join(params.contentPath, 'config', 'site.json'),
  ]

  for (const configPath of possiblePaths) {
    try {
      const content = await readFile(configPath, 'utf-8')
      const config = JSON.parse(content)

      if (config.locales && Array.isArray(config.locales)) {
        return {
          locales: config.locales,
          defaultLocale: config.defaultLocale || config.locales[0] || 'en',
        }
      }
    } catch {
      // Try next path
    }
  }

  return null
}

/**
 * Run audit activity - wraps the shared audit module
 * This needs to be registered as a Temporal activity
 */
async function runAuditActivity(params: {
  contentPath: string
  checks: string[]
  validateImageContent: boolean
  requiredLanguages: string[]
}): Promise<any> {
  // This is a placeholder - in real implementation, this would call
  // the runContentAudit function from @swarm-press/shared
  // For now, we'll proxy it through an activity
  const { runContentAudit } = await import('@swarm-press/shared')

  const result = await runContentAudit({
    contentPath: params.contentPath,
    checks: params.checks as any,
    requiredLanguages: params.requiredLanguages,
    options: {
      validateImageContent: params.validateImageContent,
      concurrency: 10,
    },
  })

  return result
}
