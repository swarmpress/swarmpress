/**
 * Page Content Generation Workflow
 * Orchestrates batch content generation for website pages using a chain
 * of specialised agents.
 *
 * Chain (WS-D of autonomy migration):
 *   1. PageOrchestratorAgent — produces a structured brief (analyze only)
 *   2. WriterAgent           — drafts blocks per brief (commits via RepoClient)
 *   3. PagePolishAgent       — refines prose, transitions, voice
 *   4. LinkerAgent           — inserts internal links against sitemap
 *   5. MediaSelectorAgent    — validates / replaces image refs
 *
 * Polish runs before Linker so anchor text isn't rewritten after link
 * insertion. Per-page try/catch isolates failures so one bad page does
 * not kill the whole batch.
 */

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  listEmptyPagesActivity,
  resolveChainAgentsActivity,
  invokePageOrchestratorAgent,
  invokeWriterAgent,
  invokePagePolishAgent,
  invokeLinkerAgent,
  invokeMediaSelectorAgent,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes', // Content generation can take time
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
})

/**
 * Optional explicit agent ids per chain role. Falls back to capability
 * lookup (see resolveChainAgentsActivity) when omitted.
 */
export interface PageContentChainAgentOverrides {
  orchestrator?: string
  writer?: string
  polish?: string
  linker?: string
  mediaSelector?: string
}

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
  /** Optional explicit agent ids; missing ids fall back to capability lookup */
  agentOverrides?: PageContentChainAgentOverrides
  /** Optional taskId for activity logging */
  taskId?: string
}

export interface PageContentChainStepResult {
  step: 'orchestrator' | 'writer' | 'polish' | 'linker' | 'media'
  success: boolean
  skipped?: boolean
  error?: string
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
    failedStep?: PageContentChainStepResult['step']
    steps: PageContentChainStepResult[]
    error?: string
  }>
}

/**
 * Page Content Generation Workflow
 *
 * Generates content for multiple pages by invoking the agent chain
 * (PageOrchestrator → Writer → PagePolish → Linker → MediaSelector)
 * per page. Each page is processed sequentially to avoid overwhelming
 * the API; each chain step is also sequential because later agents
 * read what earlier ones produced via RepoClient.
 */
export async function pageContentGenerationWorkflow(
  input: PageContentGenerationWorkflowInput
): Promise<PageContentGenerationWorkflowResult> {
  const {
    websiteId,
    language,
    village,
    pageType: pageTypeFilter,
    limit,
    delayBetweenPages = 5,
    agentOverrides,
    taskId,
  } = input

  const results: PageContentGenerationWorkflowResult['results'] = []
  let successfulPages = 0
  let failedPages = 0

  try {
    console.log(`[PageContentGeneration] Starting workflow for website ${websiteId}`)

    // Resolve the chain's agent ids once per workflow run (DB lookup, so it
    // must live in an activity to stay deterministic). Missing roles return
    // empty strings; the per-step caller treats empty as "skip with warning".
    const chainAgents = await resolveChainAgentsActivity({
      websiteId,
      overrides: agentOverrides,
    })

    console.log(`[PageContentGeneration] Resolved chain agents:`, chainAgents)

    // Step 1: List all empty pages
    console.log(`[PageContentGeneration] Listing empty pages...`)
    const { pages } = await listEmptyPagesActivity({
      websiteId,
      language,
      village,
      pageType: pageTypeFilter,
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

    // Step 2: Process each page through the chain
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      if (!page) continue

      const pagePath = page.path
      const lang = (pagePath.split('/')[2] ?? language ?? 'en')
      const pageType = page.pageType ?? pageTypeFilter

      console.log(`[PageContentGeneration] Processing page ${i + 1}/${pages.length}: ${pagePath}`)

      const steps: PageContentChainStepResult[] = []
      let pageOk = true
      let firstError: string | undefined
      let failedStep: PageContentChainStepResult['step'] | undefined

      try {
        // 1. Orchestrator (optional — skip if no orchestrator agent resolved)
        if (chainAgents.orchestrator) {
          const orchTask = `Produce a structured page brief for ${pagePath} (type=${pageType ?? 'unknown'}, lang=${lang}). Use the create_page_brief tool. Return the brief as your tool result.`
          const orchResult = await invokePageOrchestratorAgent({
            agentId: chainAgents.orchestrator,
            task: orchTask,
            websiteId,
            taskId,
          })
          steps.push({ step: 'orchestrator', success: orchResult.success, error: orchResult.error })
          if (!orchResult.success) {
            pageOk = false
            firstError = `orchestrator: ${orchResult.error ?? 'unknown error'}`
            failedStep = 'orchestrator'
            throw new Error(firstError)
          }
        } else {
          console.warn(`[PageContentGeneration] No orchestrator agent resolved; skipping step for ${pagePath}`)
          steps.push({ step: 'orchestrator', success: true, skipped: true })
        }

        // 2. Writer (REQUIRED — fail page if missing)
        if (!chainAgents.writer) {
          pageOk = false
          firstError = 'writer: no agent resolved for capability (write_page_content/write_draft)'
          failedStep = 'writer'
          steps.push({ step: 'writer', success: false, error: firstError })
          throw new Error(firstError)
        }
        const writerTask = `Generate content for ${pagePath} using the orchestrator's brief. First call generate_page_content to load the page + collection context, then call write_page_content to commit the drafted blocks to the repo.`
        const writerResult = await invokeWriterAgent({
          agentId: chainAgents.writer,
          task: writerTask,
          websiteId,
          taskId,
        })
        steps.push({ step: 'writer', success: writerResult.success, error: writerResult.error })
        if (!writerResult.success) {
          pageOk = false
          firstError = `writer: ${writerResult.error ?? 'unknown error'}`
          failedStep = 'writer'
          throw new Error(firstError)
        }

        // 3. PagePolish (optional)
        if (chainAgents.polish) {
          const polishTask = `Refine the prose at ${pagePath}. Smooth transitions, remove redundancy, unify voice. Use the polish_prose and rewrite_transitions tools as needed; re-read the latest page JSON before editing.`
          const polishResult = await invokePagePolishAgent({
            agentId: chainAgents.polish,
            task: polishTask,
            contentId: pagePath, // use pagePath as content handle in the chain
            websiteId,
            taskId,
          })
          steps.push({ step: 'polish', success: polishResult.success, error: polishResult.error })
          if (!polishResult.success) {
            pageOk = false
            firstError = `polish: ${polishResult.error ?? 'unknown error'}`
            failedStep = 'polish'
            throw new Error(firstError)
          }
        } else {
          console.warn(`[PageContentGeneration] No polish agent resolved; skipping step for ${pagePath}`)
          steps.push({ step: 'polish', success: true, skipped: true })
        }

        // 4. Linker (optional)
        if (chainAgents.linker) {
          const linkerTask = `Scan ${pagePath} for internal-link opportunities. Use find_link_opportunities and insert_links tools. Respect linking-policy.json.`
          const linkerResult = await invokeLinkerAgent({
            agentId: chainAgents.linker,
            task: linkerTask,
            contentId: pagePath,
            websiteId,
            taskId,
          })
          steps.push({ step: 'linker', success: linkerResult.success, error: linkerResult.error })
          if (!linkerResult.success) {
            pageOk = false
            firstError = `linker: ${linkerResult.error ?? 'unknown error'}`
            failedStep = 'linker'
            throw new Error(firstError)
          }
        } else {
          console.warn(`[PageContentGeneration] No linker agent resolved; skipping step for ${pagePath}`)
          steps.push({ step: 'linker', success: true, skipped: true })
        }

        // 5. MediaSelector (optional)
        if (chainAgents.mediaSelector) {
          const mediaTask = `Validate all image references in ${pagePath} against the media-index for the village/entity this page belongs to. Use validate_image_relevance and find_matching_images tools; replace mismatches.`
          const mediaResult = await invokeMediaSelectorAgent({
            agentId: chainAgents.mediaSelector,
            task: mediaTask,
            contentId: pagePath,
            websiteId,
            taskId,
          })
          steps.push({ step: 'media', success: mediaResult.success, error: mediaResult.error })
          if (!mediaResult.success) {
            pageOk = false
            firstError = `media: ${mediaResult.error ?? 'unknown error'}`
            failedStep = 'media'
            throw new Error(firstError)
          }
        } else {
          console.warn(`[PageContentGeneration] No media-selector agent resolved; skipping step for ${pagePath}`)
          steps.push({ step: 'media', success: true, skipped: true })
        }
      } catch (err) {
        // Per-page try/catch — one failure does not kill the batch.
        if (!firstError) {
          firstError = err instanceof Error ? err.message : 'Unknown error'
        }
        pageOk = false
        console.error(`[PageContentGeneration] Chain failed for ${pagePath} at step ${failedStep ?? '?'}: ${firstError}`)
      }

      if (pageOk) {
        successfulPages++
        console.log(`[PageContentGeneration] Chain succeeded for ${pagePath}`)
      } else {
        failedPages++
      }

      results.push({
        path: pagePath,
        success: pageOk,
        failedStep,
        steps,
        error: firstError,
      })

      // Delay between pages (except after the last one)
      if (i < pages.length - 1 && delayBetweenPages > 0) {
        console.log(`[PageContentGeneration] Waiting ${delayBetweenPages}s before next page...`)
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
 * Generates content for a single page via the full chain. Useful for
 * testing or targeted regeneration. Reuses pageContentGenerationWorkflow's
 * per-page logic by funneling the path through a synthetic list.
 */
export interface SinglePageContentInput {
  websiteId: string
  pagePath: string
  agentOverrides?: PageContentChainAgentOverrides
  taskId?: string
}

export async function singlePageContentGenerationWorkflow(
  input: SinglePageContentInput
): Promise<{
  success: boolean
  pagePath: string
  failedStep?: PageContentChainStepResult['step']
  steps: PageContentChainStepResult[]
  error?: string
}> {
  const { websiteId, pagePath, agentOverrides, taskId } = input

  console.log(`[SinglePageContentGeneration] Starting for ${pagePath}`)

  // Reuse the batch workflow's chain by inlining a single iteration.
  // We invoke the chain activities directly here to avoid double-listing
  // the page; the batch workflow keys off listEmptyPagesActivity.
  const chainAgents = await resolveChainAgentsActivity({
    websiteId,
    overrides: agentOverrides,
  })

  const lang = pagePath.split('/')[2] ?? 'en'
  const filename = pagePath.split('/').pop() ?? ''
  const pageType = filename.replace('.json', '')

  const steps: PageContentChainStepResult[] = []
  let firstError: string | undefined
  let failedStep: PageContentChainStepResult['step'] | undefined

  try {
    if (chainAgents.orchestrator) {
      const r = await invokePageOrchestratorAgent({
        agentId: chainAgents.orchestrator,
        task: `Produce a structured page brief for ${pagePath} (type=${pageType}, lang=${lang}). Use the create_page_brief tool.`,
        websiteId,
        taskId,
      })
      steps.push({ step: 'orchestrator', success: r.success, error: r.error })
      if (!r.success) {
        failedStep = 'orchestrator'
        firstError = `orchestrator: ${r.error}`
        throw new Error(firstError)
      }
    } else {
      steps.push({ step: 'orchestrator', success: true, skipped: true })
    }

    if (!chainAgents.writer) {
      failedStep = 'writer'
      firstError = 'writer: no agent resolved'
      steps.push({ step: 'writer', success: false, error: firstError })
      throw new Error(firstError)
    }
    const w = await invokeWriterAgent({
      agentId: chainAgents.writer,
      task: `Generate content for ${pagePath}. Use generate_page_content then write_page_content tools.`,
      websiteId,
      taskId,
    })
    steps.push({ step: 'writer', success: w.success, error: w.error })
    if (!w.success) {
      failedStep = 'writer'
      firstError = `writer: ${w.error}`
      throw new Error(firstError)
    }

    if (chainAgents.polish) {
      const r = await invokePagePolishAgent({
        agentId: chainAgents.polish,
        task: `Refine the prose at ${pagePath}.`,
        contentId: pagePath,
        websiteId,
        taskId,
      })
      steps.push({ step: 'polish', success: r.success, error: r.error })
      if (!r.success) {
        failedStep = 'polish'
        firstError = `polish: ${r.error}`
        throw new Error(firstError)
      }
    } else {
      steps.push({ step: 'polish', success: true, skipped: true })
    }

    if (chainAgents.linker) {
      const r = await invokeLinkerAgent({
        agentId: chainAgents.linker,
        task: `Scan ${pagePath} for internal-link opportunities.`,
        contentId: pagePath,
        websiteId,
        taskId,
      })
      steps.push({ step: 'linker', success: r.success, error: r.error })
      if (!r.success) {
        failedStep = 'linker'
        firstError = `linker: ${r.error}`
        throw new Error(firstError)
      }
    } else {
      steps.push({ step: 'linker', success: true, skipped: true })
    }

    if (chainAgents.mediaSelector) {
      const r = await invokeMediaSelectorAgent({
        agentId: chainAgents.mediaSelector,
        task: `Validate image references in ${pagePath}.`,
        contentId: pagePath,
        websiteId,
        taskId,
      })
      steps.push({ step: 'media', success: r.success, error: r.error })
      if (!r.success) {
        failedStep = 'media'
        firstError = `media: ${r.error}`
        throw new Error(firstError)
      }
    } else {
      steps.push({ step: 'media', success: true, skipped: true })
    }

    return { success: true, pagePath, steps }
  } catch (err) {
    if (!firstError) firstError = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[SinglePageContentGeneration] Failed at step ${failedStep}:`, err)
    return {
      success: false,
      pagePath,
      failedStep,
      steps,
      error: firstError,
    }
  }
}
