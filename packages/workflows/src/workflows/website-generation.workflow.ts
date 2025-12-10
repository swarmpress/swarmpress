/**
 * Website Generation Master Workflow
 * Orchestrates the complete autonomous generation of a website
 *
 * Phases:
 * 1. Research - Populate collections with data from web research
 * 2. Content Generation - Create content for all pages
 * 3. Editorial Review - Review and approve content
 * 4. Publishing - Build and deploy the static site
 */

import {
  proxyActivities,
  executeChild,
  sleep,
} from '@temporalio/workflow'
import type * as activities from '../activities'

// Proxy activities
const {
  getResearchableCollections,
  getWebsiteContentSummary,
  getPagesNeedingContent,
  generateBriefForPage,
  getContentStatusCounts,
  getWebsiteDetails,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    backoffCoefficient: 2.0,
  },
})

// ============================================================================
// Types
// ============================================================================

export interface WebsiteGenerationInput {
  websiteId: string
  writerAgentId: string
  editorAgentId: string
  engineerAgentId: string
  options?: {
    skipResearch?: boolean
    skipContentGeneration?: boolean
    skipEditorialReview?: boolean
    languagesToProcess?: string[]
    maxPagesPerBatch?: number
    maxConcurrentContent?: number
    autoApproveContent?: boolean
  }
}

export interface WebsiteGenerationResult {
  success: boolean
  websiteId: string
  phases: {
    research?: PhaseResult
    contentGeneration?: PhaseResult
    editorialReview?: PhaseResult
    publishing?: PhaseResult
  }
  summary: {
    totalPages: number
    contentCreated: number
    contentApproved: number
    contentPublished: number
    collectionsPopulated: number
    errors: string[]
  }
}

interface PhaseResult {
  success: boolean
  duration?: number
  stats?: Record<string, number>
  errors?: string[]
}

// ============================================================================
// Main Workflow
// ============================================================================

export async function websiteGenerationWorkflow(
  input: WebsiteGenerationInput
): Promise<WebsiteGenerationResult> {
  const {
    websiteId,
    writerAgentId,
    editorAgentId,
    engineerAgentId,
    options = {},
  } = input

  const {
    skipResearch = false,
    skipContentGeneration = false,
    skipEditorialReview = false,
    languagesToProcess,
    maxPagesPerBatch = 10,
    autoApproveContent = false,
  } = options

  const result: WebsiteGenerationResult = {
    success: false,
    websiteId,
    phases: {},
    summary: {
      totalPages: 0,
      contentCreated: 0,
      contentApproved: 0,
      contentPublished: 0,
      collectionsPopulated: 0,
      errors: [],
    },
  }

  console.log(`[WebsiteGeneration] Starting for website ${websiteId}`)

  try {
    // Get website details
    const website = await getWebsiteDetails(websiteId)
    if (!website) {
      throw new Error(`Website ${websiteId} not found`)
    }

    console.log(`[WebsiteGeneration] Website: ${website.name} (${website.domain})`)

    // ========================================================================
    // Phase 1: Research
    // ========================================================================
    if (!skipResearch) {
      console.log(`[WebsiteGeneration] Phase 1: Research`)
      const researchStart = Date.now()

      const collections = await getResearchableCollections(websiteId)
      console.log(`[WebsiteGeneration] Found ${collections.length} research-enabled collections`)

      let collectionsPopulated = 0
      const researchErrors: string[] = []

      for (const collection of collections) {
        console.log(`[WebsiteGeneration] Researching: ${collection.displayName}`)

        try {
          // Execute research via child workflow for isolation
          const researchResult = await executeChild('collectionResearchWorkflow', {
            args: [{
              websiteId,
              collectionType: collection.collectionType,
              agentId: writerAgentId,
              maxResults: 50,
            }],
            workflowId: `research-${websiteId}-${collection.collectionType}-${Date.now()}`,
          })

          if (researchResult.success) {
            collectionsPopulated++
            console.log(`[WebsiteGeneration] ${collection.displayName}: ${researchResult.itemsCreated} items`)
          } else {
            researchErrors.push(`${collection.collectionType}: ${researchResult.errors.join(', ')}`)
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error'
          researchErrors.push(`${collection.collectionType}: ${errMsg}`)
          console.error(`[WebsiteGeneration] Research error for ${collection.collectionType}:`, error)
        }

        // Rate limit between collections
        await sleep('5 seconds')
      }

      result.phases.research = {
        success: researchErrors.length === 0,
        duration: Date.now() - researchStart,
        stats: { collectionsPopulated, totalCollections: collections.length },
        errors: researchErrors,
      }
      result.summary.collectionsPopulated = collectionsPopulated
      result.summary.errors.push(...researchErrors)
    }

    // ========================================================================
    // Phase 2: Content Generation
    // ========================================================================
    if (!skipContentGeneration) {
      console.log(`[WebsiteGeneration] Phase 2: Content Generation`)
      const contentStart = Date.now()

      // Get pages that need content
      const languages = languagesToProcess || website.languages
      let totalCreated = 0
      const contentErrors: string[] = []

      for (const lang of languages) {
        console.log(`[WebsiteGeneration] Processing language: ${lang}`)

        const pages = await getPagesNeedingContent(websiteId, lang)
        console.log(`[WebsiteGeneration] ${pages.length} pages need content for ${lang}`)

        // Process pages SEQUENTIALLY to avoid API rate limits
        // Each content production calls Claude, so we need to be careful about concurrency
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i]
          if (!page) continue // Skip if page is undefined
          console.log(`[WebsiteGeneration] Processing page ${i + 1}/${pages.length}: ${page.title}`)

          try {
            // Generate brief
            const briefResult = await generateBriefForPage(page)
            if (!briefResult.success || !briefResult.contentId) {
              contentErrors.push(`Brief failed for ${page.title}: ${briefResult.error}`)
              continue
            }

            // Start content production (sequential, one at a time)
            const contentResult = await executeChild('contentProductionWorkflow', {
              args: [{
                contentId: briefResult.contentId,
                writerAgentId,
                brief: briefResult.brief,
                maxRevisions: 2,
              }],
              workflowId: `content-${briefResult.contentId}`,
            })

            if (contentResult.success) {
              totalCreated++
              console.log(`[WebsiteGeneration] ✓ Content created for: ${page.title}`)
            } else {
              contentErrors.push(`Content failed for ${page.title}: ${contentResult.error}`)
              console.log(`[WebsiteGeneration] ✗ Content failed for: ${page.title}`)
            }
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Unknown error'
            contentErrors.push(`Error for ${page.title}: ${errMsg}`)
            console.error(`[WebsiteGeneration] Error processing ${page.title}:`, errMsg)
          }

          // Rate limit delay between pages (10 seconds to be safe)
          if (i < pages.length - 1) {
            await sleep('10 seconds')
          }
        }
      }

      result.phases.contentGeneration = {
        success: contentErrors.length < totalCreated,
        duration: Date.now() - contentStart,
        stats: { created: totalCreated, errors: contentErrors.length },
        errors: contentErrors.slice(0, 10), // Limit error list
      }
      result.summary.contentCreated = totalCreated
      result.summary.errors.push(...contentErrors.slice(0, 5))
    }

    // ========================================================================
    // Phase 3: Editorial Review
    // ========================================================================
    if (!skipEditorialReview) {
      console.log(`[WebsiteGeneration] Phase 3: Editorial Review`)
      const reviewStart = Date.now()

      // Get content awaiting review
      const statusCounts = await getContentStatusCounts(websiteId)
      const awaitingReview = statusCounts['in_editorial_review'] || 0

      console.log(`[WebsiteGeneration] ${awaitingReview} content items awaiting review`)

      let approved = 0
      const reviewErrors: string[] = []

      // Process reviews in batches
      if (awaitingReview > 0 && !autoApproveContent) {
        // Execute editorial review workflow
        const reviewResult = await executeChild('editorialReviewBatchWorkflow', {
          args: [{
            websiteId,
            editorAgentId,
            batchSize: maxPagesPerBatch,
          }],
          workflowId: `editorial-review-${websiteId}-${Date.now()}`,
        })

        approved = reviewResult.approved || 0
        if (reviewResult.errors) {
          reviewErrors.push(...reviewResult.errors)
        }
      } else if (autoApproveContent) {
        // Auto-approve all content (for testing)
        console.log(`[WebsiteGeneration] Auto-approving content`)
        // This would need implementation to bulk-approve
        approved = awaitingReview
      }

      result.phases.editorialReview = {
        success: reviewErrors.length === 0,
        duration: Date.now() - reviewStart,
        stats: { reviewed: awaitingReview, approved },
        errors: reviewErrors,
      }
      result.summary.contentApproved = approved
    }

    // ========================================================================
    // Phase 4: Publishing
    // ========================================================================
    console.log(`[WebsiteGeneration] Phase 4: Publishing`)
    const publishStart = Date.now()

    try {
      // Execute publishing workflow
      const publishResult = await executeChild('publishingWorkflow', {
        args: [{
          websiteId,
          engineerAgentId,
          deployTarget: 'github-pages',
        }],
        workflowId: `publish-${websiteId}-${Date.now()}`,
      })

      result.phases.publishing = {
        success: publishResult.success,
        duration: Date.now() - publishStart,
        stats: { published: publishResult.success ? 1 : 0 },
        errors: publishResult.error ? [publishResult.error] : [],
      }

      if (publishResult.success) {
        result.summary.contentPublished = result.summary.contentApproved
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error'
      result.phases.publishing = {
        success: false,
        duration: Date.now() - publishStart,
        errors: [errMsg],
      }
      result.summary.errors.push(`Publishing: ${errMsg}`)
    }

    // ========================================================================
    // Final Summary
    // ========================================================================
    const summary = await getWebsiteContentSummary(websiteId)
    result.summary.totalPages = summary.totalPages

    result.success = Object.values(result.phases).every(p => p?.success !== false)

    console.log(`[WebsiteGeneration] Complete!`)
    console.log(`[WebsiteGeneration] Summary:`)
    console.log(`  - Total Pages: ${result.summary.totalPages}`)
    console.log(`  - Content Created: ${result.summary.contentCreated}`)
    console.log(`  - Content Approved: ${result.summary.contentApproved}`)
    console.log(`  - Collections Populated: ${result.summary.collectionsPopulated}`)
    console.log(`  - Errors: ${result.summary.errors.length}`)

    return result
  } catch (error) {
    console.error(`[WebsiteGeneration] Workflow failed:`, error)
    result.summary.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

// ============================================================================
// Supporting Workflows
// ============================================================================

// Note: CollectionResearchInput and CollectionResearchResult are defined in collection-research.workflow.ts

/**
 * Editorial Review Batch Workflow
 * Reviews content in batches
 */
export interface EditorialReviewBatchInput {
  websiteId: string
  editorAgentId: string
  batchSize?: number
}

export interface EditorialReviewBatchResult {
  success: boolean
  reviewed: number
  approved: number
  rejected: number
  needsChanges: number
  errors: string[]
}

// This would delegate to the existing editorial-review.workflow.ts
