/**
 * Page Content Generation Workflow
 * Orchestrates batch content generation for website pages
 *
 * This workflow:
 * 1. Lists all empty pages that need content
 * 2. Assigns each page to the appropriate writer agent based on page type
 * 3. Generates content for each page sequentially (to avoid rate limits)
 * 4. Reports progress and results
 */

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  generatePageContentActivity,
  listEmptyPagesActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes', // Content generation can take time
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
})

export interface PageContentGenerationWorkflowInput {
  websiteId: string
  /** Filter by language (e.g., 'en', 'de') */
  language?: string
  /** Filter by village (e.g., 'manarola', 'vernazza') */
  village?: string
  /** Filter by page type (e.g., 'restaurants', 'hiking') */
  pageType?: string
  /** Maximum number of pages to process */
  limit?: number
  /** Delay between pages in seconds (for rate limiting) */
  delayBetweenPages?: number
}

export interface PageContentGenerationWorkflowResult {
  success: boolean
  totalPages: number
  processedPages: number
  successfulPages: number
  failedPages: number
  results: Array<{
    path: string
    success: boolean
    agentName?: string
    title?: string
    blockCount?: number
    error?: string
  }>
}

/**
 * Page Content Generation Workflow
 *
 * Generates content for multiple pages using writer agents.
 * Each page is processed sequentially to avoid overwhelming the API.
 */
export async function pageContentGenerationWorkflow(
  input: PageContentGenerationWorkflowInput
): Promise<PageContentGenerationWorkflowResult> {
  const {
    websiteId,
    language,
    village,
    pageType,
    limit,
    delayBetweenPages = 5, // Default 5 second delay
  } = input

  const results: PageContentGenerationWorkflowResult['results'] = []
  let successfulPages = 0
  let failedPages = 0

  try {
    console.log(`[PageContentGeneration] Starting workflow for website ${websiteId}`)

    // Step 1: List all empty pages
    console.log(`[PageContentGeneration] Listing empty pages...`)
    const { pages } = await listEmptyPagesActivity({
      websiteId,
      language,
      village,
      pageType,
      limit,
    })

    console.log(`[PageContentGeneration] Found ${pages.length} empty pages to process`)

    if (pages.length === 0) {
      return {
        success: true,
        totalPages: 0,
        processedPages: 0,
        successfulPages: 0,
        failedPages: 0,
        results: [],
      }
    }

    // Step 2: Process each page
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      console.log(`[PageContentGeneration] Processing page ${i + 1}/${pages.length}: ${page.path}`)

      try {
        // Generate content for this page
        const result = await generatePageContentActivity({
          websiteId,
          pagePath: page.path,
        })

        results.push({
          path: page.path,
          success: result.success,
          agentName: result.agentName,
          title: result.title,
          blockCount: result.blockCount,
          error: result.error,
        })

        if (result.success) {
          successfulPages++
          console.log(`[PageContentGeneration] Successfully generated content for ${page.path}`)
        } else {
          failedPages++
          console.warn(`[PageContentGeneration] Failed to generate content for ${page.path}: ${result.error}`)
        }
      } catch (error) {
        failedPages++
        results.push({
          path: page.path,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        console.error(`[PageContentGeneration] Error processing ${page.path}:`, error)
      }

      // Delay between pages (except for the last one)
      if (i < pages.length - 1 && delayBetweenPages > 0) {
        console.log(`[PageContentGeneration] Waiting ${delayBetweenPages} seconds before next page...`)
        await sleep(`${delayBetweenPages} seconds`)
      }
    }

    console.log(`[PageContentGeneration] Workflow completed: ${successfulPages} successful, ${failedPages} failed`)

    return {
      success: failedPages === 0,
      totalPages: pages.length,
      processedPages: results.length,
      successfulPages,
      failedPages,
      results,
    }
  } catch (error) {
    console.error(`[PageContentGeneration] Workflow failed:`, error)
    return {
      success: false,
      totalPages: 0,
      processedPages: results.length,
      successfulPages,
      failedPages,
      results,
    }
  }
}

/**
 * Single Page Content Generation Workflow
 *
 * Generates content for a single page.
 * Useful for testing or targeted regeneration.
 */
export interface SinglePageContentInput {
  websiteId: string
  pagePath: string
}

export async function singlePageContentGenerationWorkflow(
  input: SinglePageContentInput
): Promise<{
  success: boolean
  pagePath: string
  agentName?: string
  title?: string
  blockCount?: number
  error?: string
}> {
  const { websiteId, pagePath } = input

  try {
    console.log(`[SinglePageContentGeneration] Starting for ${pagePath}`)

    const result = await generatePageContentActivity({
      websiteId,
      pagePath,
    })

    console.log(`[SinglePageContentGeneration] Completed: ${result.success ? 'success' : 'failed'}`)

    return {
      success: result.success,
      pagePath,
      agentName: result.agentName,
      title: result.title,
      blockCount: result.blockCount,
      error: result.error,
    }
  } catch (error) {
    console.error(`[SinglePageContentGeneration] Failed:`, error)
    return {
      success: false,
      pagePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
