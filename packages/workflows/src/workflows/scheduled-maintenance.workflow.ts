/**
 * Scheduled Maintenance Workflows
 * Continuous monitoring and validation of content quality
 *
 * Schedules:
 * - Daily: Check for broken media URLs
 * - Weekly: Validate internal links still resolve
 * - Monthly: Flag stale content (events, weather, transport)
 */

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  invokeQAAgent,
  createTask,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  retry: {
    maximumAttempts: 3,
  },
})

// ============================================================================
// Daily Media Check Workflow
// ============================================================================

export interface DailyMediaCheckInput {
  websiteId: string
  qaAgentId: string
}

export interface DailyMediaCheckResult {
  success: boolean
  websiteId: string
  totalImagesChecked: number
  brokenImages: Array<{
    url: string
    contentId?: string
    pageId?: string
    error: string
  }>
  timestamp: string
}

/**
 * Daily Media Check Workflow
 *
 * Runs daily to verify all media URLs are still accessible.
 * Creates tasks for any broken images found.
 */
export async function dailyMediaCheckWorkflow(
  input: DailyMediaCheckInput
): Promise<DailyMediaCheckResult> {
  const { websiteId, qaAgentId } = input
  const timestamp = new Date().toISOString()

  const result: DailyMediaCheckResult = {
    success: false,
    websiteId,
    totalImagesChecked: 0,
    brokenImages: [],
    timestamp,
  }

  try {
    console.log(`[DailyMediaCheck] Starting daily media check for website ${websiteId}`)

    // Use QAAgent to check all media URLs
    const checkTask = `Run a comprehensive media URL check for website ${websiteId}.

Use your check_broken_media tool to:
1. Scan all images in the media-index.json
2. Verify each URL returns a 200 status
3. Report any broken or inaccessible images

Return the full list of broken images with their URLs and error messages.`

    const checkResult = await invokeQAAgent({
      agentId: qaAgentId,
      task: checkTask,
      contentId: websiteId, // Using websiteId as contentId for context
      websiteId,
    })

    if (!checkResult.success) {
      throw new Error(`Media check failed: ${checkResult.error}`)
    }

    result.totalImagesChecked = checkResult.result?.total_checked || 0
    result.brokenImages = checkResult.result?.broken_images || []

    // Create tasks for broken images
    if (result.brokenImages.length > 0) {
      console.log(`[DailyMediaCheck] Found ${result.brokenImages.length} broken images`)

      // Create a single task to fix broken media
      await createTask({
        type: 'generate_media',
        agent_id: qaAgentId,
        website_id: websiteId,
        notes: `Daily media check found ${result.brokenImages.length} broken images:\n${result.brokenImages.map(img => `- ${img.url}: ${img.error}`).join('\n')}`,
      })
    }

    result.success = true
    console.log(`[DailyMediaCheck] Completed. Checked ${result.totalImagesChecked} images, found ${result.brokenImages.length} broken.`)

    return result
  } catch (error) {
    console.error(`[DailyMediaCheck] Workflow failed:`, error)
    return {
      ...result,
      success: false,
    }
  }
}

// ============================================================================
// Weekly Link Validation Workflow
// ============================================================================

export interface WeeklyLinkValidationInput {
  websiteId: string
  qaAgentId: string
  linkerAgentId?: string
  autoFix?: boolean
}

export interface WeeklyLinkValidationResult {
  success: boolean
  websiteId: string
  totalLinksChecked: number
  brokenLinks: Array<{
    sourceUrl: string
    targetUrl: string
    anchorText: string
    error: string
  }>
  fixedLinks: number
  timestamp: string
}

/**
 * Weekly Link Validation Workflow
 *
 * Runs weekly to verify all internal links still resolve.
 * Optionally auto-fixes broken links using LinkerAgent.
 */
export async function weeklyLinkValidationWorkflow(
  input: WeeklyLinkValidationInput
): Promise<WeeklyLinkValidationResult> {
  const { websiteId, qaAgentId, linkerAgentId, autoFix = false } = input
  const timestamp = new Date().toISOString()

  const result: WeeklyLinkValidationResult = {
    success: false,
    websiteId,
    totalLinksChecked: 0,
    brokenLinks: [],
    fixedLinks: 0,
    timestamp,
  }

  try {
    console.log(`[WeeklyLinkValidation] Starting weekly link validation for website ${websiteId}`)

    // Use QAAgent to check all internal links
    const checkTask = `Run a comprehensive internal link validation for website ${websiteId}.

Use your check_broken_internal_links tool to:
1. Scan all pages in sitemap-index.json
2. Extract all internal links from content
3. Verify each link resolves to a valid page in the sitemap
4. Report any broken or orphaned links

Return the full list of broken links with source page, target URL, and error.`

    const checkResult = await invokeQAAgent({
      agentId: qaAgentId,
      task: checkTask,
      contentId: websiteId,
      websiteId,
    })

    if (!checkResult.success) {
      throw new Error(`Link validation failed: ${checkResult.error}`)
    }

    result.totalLinksChecked = checkResult.result?.total_checked || 0
    result.brokenLinks = checkResult.result?.broken_links || []

    // Optionally auto-fix broken links
    if (result.brokenLinks.length > 0 && autoFix && linkerAgentId) {
      console.log(`[WeeklyLinkValidation] Auto-fixing ${result.brokenLinks.length} broken links`)

      const { invokeLinkerAgent } = proxyActivities<typeof activities>({
        startToCloseTimeout: '15 minutes',
      })

      const fixTask = `Fix the following broken internal links for website ${websiteId}:

${result.brokenLinks.map(link => `- Source: ${link.sourceUrl}, Target: ${link.targetUrl}, Anchor: "${link.anchorText}"`).join('\n')}

Use your validate_links and insert_links tools to:
1. Find the correct URLs from sitemap-index.json
2. Update the broken links with valid URLs
3. If no valid target exists, remove the link

Report how many links were fixed.`

      const fixResult = await invokeLinkerAgent({
        agentId: linkerAgentId,
        task: fixTask,
        contentId: websiteId,
        websiteId,
      })

      if (fixResult.success) {
        result.fixedLinks = fixResult.result?.links_fixed || 0
      }
    }

    // Create task if broken links remain
    if (result.brokenLinks.length > result.fixedLinks) {
      const remainingBroken = result.brokenLinks.length - result.fixedLinks
      await createTask({
        type: 'editorial_review',
        agent_id: qaAgentId,
        website_id: websiteId,
        notes: `Weekly link validation found ${remainingBroken} broken links that need manual attention:\n${result.brokenLinks.slice(0, 10).map(link => `- ${link.sourceUrl} → ${link.targetUrl}`).join('\n')}${result.brokenLinks.length > 10 ? `\n...and ${result.brokenLinks.length - 10} more` : ''}`,
      })
    }

    result.success = true
    console.log(`[WeeklyLinkValidation] Completed. Checked ${result.totalLinksChecked} links, found ${result.brokenLinks.length} broken, fixed ${result.fixedLinks}.`)

    return result
  } catch (error) {
    console.error(`[WeeklyLinkValidation] Workflow failed:`, error)
    return {
      ...result,
      success: false,
    }
  }
}

// ============================================================================
// Monthly Stale Content Check Workflow
// ============================================================================

export interface MonthlyStaleContentInput {
  websiteId: string
  qaAgentId: string
  staleThresholds?: {
    events?: number // days
    weather?: number // days
    transport?: number // days
    general?: number // days
  }
}

export interface MonthlyStaleContentResult {
  success: boolean
  websiteId: string
  staleContent: Array<{
    contentId: string
    pageSlug: string
    contentType: string
    lastUpdated: string
    daysSinceUpdate: number
    reason: string
  }>
  totalPagesChecked: number
  timestamp: string
}

/**
 * Monthly Stale Content Check Workflow
 *
 * Runs monthly to identify content that may be outdated.
 * Creates tasks for content that exceeds staleness thresholds.
 */
export async function monthlyStaleContentWorkflow(
  input: MonthlyStaleContentInput
): Promise<MonthlyStaleContentResult> {
  const {
    websiteId,
    qaAgentId,
    staleThresholds = {
      events: 7, // Events stale after 7 days
      weather: 1, // Weather stale after 1 day
      transport: 30, // Transport info stale after 30 days
      general: 90, // General content stale after 90 days
    },
  } = input
  const timestamp = new Date().toISOString()

  const result: MonthlyStaleContentResult = {
    success: false,
    websiteId,
    staleContent: [],
    totalPagesChecked: 0,
    timestamp,
  }

  try {
    console.log(`[MonthlyStaleContent] Starting monthly stale content check for website ${websiteId}`)

    // Use QAAgent to analyze content freshness
    const checkTask = `Analyze content freshness for website ${websiteId}.

Check all pages and identify stale content based on these thresholds:
- Events: stale after ${staleThresholds.events} days
- Weather information: stale after ${staleThresholds.weather} days
- Transport schedules: stale after ${staleThresholds.transport} days
- General content: stale after ${staleThresholds.general} days

For each page:
1. Determine the content type (events, weather, transport, general)
2. Check the last_updated timestamp
3. Calculate days since last update
4. Flag as stale if exceeds threshold

Return the list of stale content with:
- Page slug
- Content type
- Last updated date
- Days since update
- Reason for staleness`

    const checkResult = await invokeQAAgent({
      agentId: qaAgentId,
      task: checkTask,
      contentId: websiteId,
      websiteId,
    })

    if (!checkResult.success) {
      throw new Error(`Stale content check failed: ${checkResult.error}`)
    }

    result.totalPagesChecked = checkResult.result?.total_checked || 0
    result.staleContent = checkResult.result?.stale_content || []

    // Group stale content by type and create tasks
    if (result.staleContent.length > 0) {
      console.log(`[MonthlyStaleContent] Found ${result.staleContent.length} stale content items`)

      const contentByType = result.staleContent.reduce((acc, item) => {
        if (!acc[item.contentType]) {
          acc[item.contentType] = []
        }
        acc[item.contentType]!.push(item)
        return acc
      }, {} as Record<string, typeof result.staleContent>)

      // Create tasks for each content type
      for (const [contentType, items] of Object.entries(contentByType)) {
        await createTask({
          type: 'write_draft',
          agent_id: qaAgentId,
          website_id: websiteId,
          notes: `Monthly stale content check: ${items.length} ${contentType} items need updating:\n${items.slice(0, 5).map(item => `- ${item.pageSlug}: ${item.daysSinceUpdate} days old`).join('\n')}${items.length > 5 ? `\n...and ${items.length - 5} more` : ''}`,
        })
      }
    }

    result.success = true
    console.log(`[MonthlyStaleContent] Completed. Checked ${result.totalPagesChecked} pages, found ${result.staleContent.length} stale.`)

    return result
  } catch (error) {
    console.error(`[MonthlyStaleContent] Workflow failed:`, error)
    return {
      ...result,
      success: false,
    }
  }
}

// ============================================================================
// Combined Maintenance Workflow
// ============================================================================

export interface MaintenanceScheduleInput {
  websiteId: string
  qaAgentId: string
  linkerAgentId?: string
  runDaily?: boolean
  runWeekly?: boolean
  runMonthly?: boolean
  autoFixLinks?: boolean
}

export interface MaintenanceScheduleResult {
  success: boolean
  websiteId: string
  dailyResult?: DailyMediaCheckResult
  weeklyResult?: WeeklyLinkValidationResult
  monthlyResult?: MonthlyStaleContentResult
  timestamp: string
}

/**
 * Combined Maintenance Workflow
 *
 * Can run all maintenance checks or specific ones based on schedule.
 * Useful for manual triggers or testing.
 */
export async function maintenanceScheduleWorkflow(
  input: MaintenanceScheduleInput
): Promise<MaintenanceScheduleResult> {
  const {
    websiteId,
    qaAgentId,
    linkerAgentId,
    runDaily = true,
    runWeekly = true,
    runMonthly = true,
    autoFixLinks = false,
  } = input
  const timestamp = new Date().toISOString()

  const result: MaintenanceScheduleResult = {
    success: false,
    websiteId,
    timestamp,
  }

  try {
    console.log(`[MaintenanceSchedule] Starting maintenance for website ${websiteId}`)

    // Run daily check
    if (runDaily) {
      console.log(`[MaintenanceSchedule] Running daily media check`)
      result.dailyResult = await dailyMediaCheckWorkflow({ websiteId, qaAgentId })
      await sleep('5 seconds')
    }

    // Run weekly check
    if (runWeekly) {
      console.log(`[MaintenanceSchedule] Running weekly link validation`)
      result.weeklyResult = await weeklyLinkValidationWorkflow({
        websiteId,
        qaAgentId,
        linkerAgentId,
        autoFix: autoFixLinks,
      })
      await sleep('5 seconds')
    }

    // Run monthly check
    if (runMonthly) {
      console.log(`[MaintenanceSchedule] Running monthly stale content check`)
      result.monthlyResult = await monthlyStaleContentWorkflow({ websiteId, qaAgentId })
    }

    result.success = true
    console.log(`[MaintenanceSchedule] All scheduled maintenance completed`)

    return result
  } catch (error) {
    console.error(`[MaintenanceSchedule] Workflow failed:`, error)
    return {
      ...result,
      success: false,
    }
  }
}
