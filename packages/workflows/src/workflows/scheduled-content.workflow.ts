/**
 * Scheduled Content Workflow
 * Automatically queues content based on the content calendar configuration
 *
 * This workflow:
 * 1. Reads the content calendar config
 * 2. Determines the current season
 * 3. Finds content topics due for generation
 * 4. Creates content briefs and triggers production workflows
 */

import { proxyActivities, sleep, continueAsNew } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  getContentCalendar,
  createContentBrief,
  getExistingContentBySlugs,
  logScheduledContentActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
  },
})

export interface ScheduledContentInput {
  websiteId: string
  dryRun?: boolean // If true, don't actually create content, just log what would be created
  forceCheck?: boolean // If true, run immediately regardless of last check time
}

export interface ScheduledContentResult {
  success: boolean
  contentCreated: number
  contentSkipped: number
  errors: string[]
  details: Array<{
    topicId: string
    title: string
    action: 'created' | 'skipped' | 'error'
    reason?: string
    contentId?: string
  }>
}

interface SeasonConfig {
  season_name: string
  publish_window: {
    start: string // MM-DD format
    end: string
  }
  topics: Array<{
    id: string
    title: string
    slug: string
    priority: string
    content_type: string
    brief: string
    target_length: string
    ideal_publish_date?: string
    keywords?: string[]
  }>
}

interface ContentCalendar {
  seasonal_content: {
    spring: SeasonConfig
    summer: SeasonConfig
    fall: SeasonConfig
    winter: SeasonConfig
  }
  evergreen_content: {
    topics: Array<{
      id: string
      title: string
      slug: string
      priority: string
      content_type: string
      brief: string
      target_length: string
      update_frequency: string
      keywords?: string[]
    }>
  }
}

/**
 * Determine current season based on date
 */
function getCurrentSeason(date: Date = new Date()): 'spring' | 'summer' | 'fall' | 'winter' {
  const month = date.getMonth() + 1 // 1-12
  const day = date.getDate()
  const mmdd = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`

  // Spring: March 1 - May 31
  if (mmdd >= '03-01' && mmdd <= '05-31') return 'spring'
  // Summer: June 1 - August 31
  if (mmdd >= '06-01' && mmdd <= '08-31') return 'summer'
  // Fall: September 1 - November 30
  if (mmdd >= '09-01' && mmdd <= '11-30') return 'fall'
  // Winter: December 1 - February 28/29
  return 'winter'
}

/**
 * Check if we're in the lead-up period for a season
 * (4 weeks before the season starts)
 */
function isInLeadUpPeriod(
  season: 'spring' | 'summer' | 'fall' | 'winter',
  date: Date = new Date()
): boolean {
  const seasonStarts: Record<string, { month: number; day: number }> = {
    spring: { month: 3, day: 1 },
    summer: { month: 6, day: 1 },
    fall: { month: 9, day: 1 },
    winter: { month: 12, day: 1 },
  }

  const start = seasonStarts[season]
  const seasonStartDate = new Date(date.getFullYear(), start.month - 1, start.day)

  // If we're past this year's season start, check next year
  if (date > seasonStartDate) {
    seasonStartDate.setFullYear(seasonStartDate.getFullYear() + 1)
  }

  // Calculate 4 weeks before
  const leadUpStart = new Date(seasonStartDate)
  leadUpStart.setDate(leadUpStart.getDate() - 28)

  return date >= leadUpStart && date < seasonStartDate
}

/**
 * Scheduled Content Workflow
 *
 * This workflow should be run on a schedule (e.g., daily or weekly)
 * to check for content that needs to be generated.
 */
export async function scheduledContentWorkflow(
  input: ScheduledContentInput
): Promise<ScheduledContentResult> {
  const { websiteId, dryRun = false } = input
  const result: ScheduledContentResult = {
    success: true,
    contentCreated: 0,
    contentSkipped: 0,
    errors: [],
    details: [],
  }

  try {
    console.log(`[ScheduledContent] Starting scheduled content check for website ${websiteId}`)
    console.log(`[ScheduledContent] Dry run: ${dryRun}`)

    // Step 1: Load content calendar
    const calendar = await getContentCalendar(websiteId)
    if (!calendar) {
      result.errors.push('Content calendar not found')
      result.success = false
      return result
    }

    console.log(`[ScheduledContent] Loaded content calendar`)

    // Step 2: Determine what content to generate
    const currentSeason = getCurrentSeason()
    const nextSeason = getNextSeason(currentSeason)
    const inLeadUp = isInLeadUpPeriod(nextSeason)

    console.log(`[ScheduledContent] Current season: ${currentSeason}`)
    console.log(`[ScheduledContent] Next season: ${nextSeason}`)
    console.log(`[ScheduledContent] In lead-up period for next season: ${inLeadUp}`)

    // Collect topics to check
    const topicsToCheck: Array<{
      season: string
      topic: SeasonConfig['topics'][0]
    }> = []

    // Add current season topics
    const currentSeasonConfig = calendar.seasonal_content[currentSeason]
    if (currentSeasonConfig?.topics) {
      for (const topic of currentSeasonConfig.topics) {
        topicsToCheck.push({ season: currentSeason, topic })
      }
    }

    // Add next season topics if in lead-up period
    if (inLeadUp) {
      const nextSeasonConfig = calendar.seasonal_content[nextSeason]
      if (nextSeasonConfig?.topics) {
        for (const topic of nextSeasonConfig.topics) {
          topicsToCheck.push({ season: nextSeason, topic })
        }
      }
    }

    console.log(`[ScheduledContent] Found ${topicsToCheck.length} seasonal topics to check`)

    // Step 3: Check which content already exists
    const slugsToCheck = topicsToCheck.map(t => t.topic.slug)
    const existingContent = await getExistingContentBySlugs(websiteId, slugsToCheck)
    const existingSlugs = new Set(existingContent.map((c: { slug: string }) => c.slug))

    console.log(`[ScheduledContent] ${existingSlugs.size} topics already have content`)

    // Step 4: Create content for topics that don't exist
    for (const { season, topic } of topicsToCheck) {
      if (existingSlugs.has(topic.slug)) {
        result.contentSkipped++
        result.details.push({
          topicId: topic.id,
          title: topic.title,
          action: 'skipped',
          reason: 'Content already exists',
        })
        continue
      }

      // Only create high priority content automatically
      if (topic.priority !== 'high' && topic.priority !== 'critical') {
        result.contentSkipped++
        result.details.push({
          topicId: topic.id,
          title: topic.title,
          action: 'skipped',
          reason: `Priority ${topic.priority} - requires manual trigger`,
        })
        continue
      }

      if (dryRun) {
        console.log(`[ScheduledContent] DRY RUN: Would create "${topic.title}"`)
        result.details.push({
          topicId: topic.id,
          title: topic.title,
          action: 'skipped',
          reason: 'Dry run mode',
        })
        continue
      }

      try {
        console.log(`[ScheduledContent] Creating content brief for "${topic.title}"`)

        const contentId = await createContentBrief({
          websiteId,
          title: topic.title,
          slug: topic.slug,
          brief: topic.brief,
          contentType: topic.content_type,
          metadata: {
            season,
            topic_id: topic.id,
            target_length: topic.target_length,
            keywords: topic.keywords || [],
            scheduled_generation: true,
          },
        })

        await logScheduledContentActivity({
          websiteId,
          topicId: topic.id,
          title: topic.title,
          action: 'created',
          contentId,
        })

        result.contentCreated++
        result.details.push({
          topicId: topic.id,
          title: topic.title,
          action: 'created',
          contentId,
        })

        // Small delay between content creations
        await sleep('2 seconds')
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        result.errors.push(`Failed to create "${topic.title}": ${errorMsg}`)
        result.details.push({
          topicId: topic.id,
          title: topic.title,
          action: 'error',
          reason: errorMsg,
        })
      }
    }

    console.log(`[ScheduledContent] Workflow completed`)
    console.log(`[ScheduledContent] Created: ${result.contentCreated}`)
    console.log(`[ScheduledContent] Skipped: ${result.contentSkipped}`)
    console.log(`[ScheduledContent] Errors: ${result.errors.length}`)

    return result
  } catch (error) {
    console.error(`[ScheduledContent] Workflow failed:`, error)
    result.success = false
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

function getNextSeason(current: 'spring' | 'summer' | 'fall' | 'winter'): 'spring' | 'summer' | 'fall' | 'winter' {
  const order: Array<'spring' | 'summer' | 'fall' | 'winter'> = ['spring', 'summer', 'fall', 'winter']
  const currentIndex = order.indexOf(current)
  return order[(currentIndex + 1) % 4]
}

/**
 * Long-running scheduled content workflow
 * Runs continuously, checking for content to generate on a schedule
 */
export async function continuousScheduledContentWorkflow(
  input: ScheduledContentInput & { checkIntervalHours?: number }
): Promise<void> {
  const { checkIntervalHours = 24 } = input

  // Run the check
  await scheduledContentWorkflow(input)

  // Sleep until next check
  await sleep(`${checkIntervalHours} hours`)

  // Continue as new to avoid history growth
  await continueAsNew<typeof continuousScheduledContentWorkflow>(input)
}
