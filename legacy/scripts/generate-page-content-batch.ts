#!/usr/bin/env npx tsx
/**
 * Batch Page Content Generation Script
 *
 * Generates content for empty website pages using writer agents.
 * Can be run standalone or via Temporal workflow.
 *
 * Usage:
 *   npx tsx scripts/generate-page-content-batch.ts [options]
 *
 * Options:
 *   --website-id  UUID of the website (default: looks up cinqueterre.travel)
 *   --language    Filter by language (e.g., 'en', 'de')
 *   --village     Filter by village (e.g., 'manarola', 'vernazza')
 *   --page-type   Filter by page type (e.g., 'restaurants', 'hiking')
 *   --limit       Maximum number of pages to process
 *   --delay       Seconds between pages (default: 5)
 *   --dry-run     List pages without generating content
 *   --single      Process a single page by path
 */

import { GitHubContentService } from '../packages/github-integration/src/content-service'
import { websiteRepository } from '../packages/backend/src/db/repositories/website-repository'
import { agentRepository } from '../packages/backend/src/db/repositories/agent-repository'
import { agentFactory, initializeAgents } from '../packages/agents/src'
import { getAgentForPageType } from '../packages/shared/src/content/agent-page-mapping'

// Parse command line arguments
const args = process.argv.slice(2)
function getArg(name: string, defaultValue?: string): string | undefined {
  const index = args.findIndex((a) => a === `--${name}`)
  if (index !== -1 && args[index + 1]) {
    return args[index + 1]
  }
  return defaultValue
}
const dryRun = args.includes('--dry-run')
const singlePagePath = getArg('single')

interface PageInfo {
  path: string
  title: string
  pageType: string
  village: string
  language: string
}

interface GenerationResult {
  path: string
  success: boolean
  agentName?: string
  title?: string
  blockCount?: number
  error?: string
  duration?: number
}

async function main() {
  console.log('='.repeat(60))
  console.log('Batch Page Content Generation')
  console.log('='.repeat(60))

  // Get website ID
  let websiteId = getArg('website-id')

  if (!websiteId) {
    // Look up cinqueterre.travel
    const websites = await websiteRepository.findAll()
    const cinqueterre = websites.find((w) => w.domain === 'cinqueterre.travel')
    if (cinqueterre) {
      websiteId = cinqueterre.id
      console.log(`Found website: ${cinqueterre.title} (${websiteId})`)
    } else {
      console.error('No website-id provided and cinqueterre.travel not found')
      process.exit(1)
    }
  }

  // Get website details
  const website = await websiteRepository.findById(websiteId)
  if (!website) {
    console.error(`Website ${websiteId} not found`)
    process.exit(1)
  }

  if (!website.github_repo) {
    console.error(`Website ${websiteId} not connected to GitHub`)
    process.exit(1)
  }

  console.log(`Website: ${website.title}`)
  console.log(`GitHub: ${website.github_owner}/${website.github_repo}`)

  // Parse filters
  const language = getArg('language')
  const village = getArg('village')
  const pageType = getArg('page-type')
  const limit = getArg('limit') ? parseInt(getArg('limit')!, 10) : undefined
  const delay = getArg('delay') ? parseInt(getArg('delay')!, 10) : 5

  console.log('\nFilters:')
  console.log(`  Language: ${language || 'all'}`)
  console.log(`  Village: ${village || 'all'}`)
  console.log(`  Page Type: ${pageType || 'all'}`)
  console.log(`  Limit: ${limit || 'no limit'}`)
  console.log(`  Delay: ${delay}s between pages`)
  console.log(`  Dry Run: ${dryRun}`)

  // Initialize GitHub content service
  const contentService = new GitHubContentService({
    owner: website.github_owner || '',
    repo: website.github_repo,
    token: website.github_access_token || '',
    branch: 'main',
    pagesPath: 'content/pages',
  })

  // Handle single page mode
  if (singlePagePath) {
    console.log(`\nProcessing single page: ${singlePagePath}`)
    const result = await generateSinglePage(websiteId, singlePagePath)
    console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`)
    if (result.error) console.log(`Error: ${result.error}`)
    process.exit(result.success ? 0 : 1)
  }

  // List all pages
  console.log('\nListing pages from GitHub...')
  const allPages = await contentService.listPages()
  console.log(`Total pages in repository: ${allPages.length}`)

  // Filter to empty pages
  const emptyPages: PageInfo[] = []

  for (const page of allPages) {
    const body = page.content.body
    const isEmpty = !body || !Array.isArray(body) || body.length === 0

    if (!isEmpty) continue

    // Extract info from path
    const pathParts = page.path.split('/')
    const pageLang = pathParts[2] || '' // content/pages/{lang}/...
    const pageVillage = pathParts[3] || '' // content/pages/{lang}/{village}/...
    const pageTypeFromPath = (pathParts[4] || '').replace('.json', '')

    // Apply filters
    if (language && pageLang !== language) continue
    if (village && pageVillage !== village) continue
    if (pageType && pageTypeFromPath !== pageType) continue

    emptyPages.push({
      path: page.path,
      title: page.content.title,
      pageType: pageTypeFromPath,
      village: pageVillage,
      language: pageLang,
    })
  }

  // Apply limit
  const pagesToProcess = limit ? emptyPages.slice(0, limit) : emptyPages

  console.log(`\nEmpty pages matching filters: ${emptyPages.length}`)
  console.log(`Pages to process: ${pagesToProcess.length}`)

  if (pagesToProcess.length === 0) {
    console.log('\nNo pages to process!')
    process.exit(0)
  }

  // Group by village for summary
  const byVillage = new Map<string, number>()
  const byType = new Map<string, number>()
  for (const page of pagesToProcess) {
    byVillage.set(page.village, (byVillage.get(page.village) || 0) + 1)
    byType.set(page.pageType, (byType.get(page.pageType) || 0) + 1)
  }

  console.log('\nPages by village:')
  for (const [v, count] of byVillage) {
    console.log(`  ${v}: ${count}`)
  }

  console.log('\nPages by type:')
  for (const [t, count] of byType) {
    const agent = getAgentForPageType(t)
    console.log(`  ${t}: ${count} (agent: ${agent})`)
  }

  if (dryRun) {
    console.log('\n--- DRY RUN - No content will be generated ---')
    console.log('\nPages that would be processed:')
    for (const page of pagesToProcess) {
      const agent = getAgentForPageType(page.pageType)
      console.log(`  ${page.path} -> ${agent}`)
    }
    process.exit(0)
  }

  // Initialize agents
  console.log('\nInitializing agents...')
  initializeAgents()

  // Load agents from database
  const agents = await agentRepository.findAll()
  const writerAgents = agents.filter((a) => a.role === 'Writer')
  console.log(`Found ${writerAgents.length} writer agents`)

  // Process pages
  console.log('\n' + '='.repeat(60))
  console.log('Starting content generation...')
  console.log('='.repeat(60))

  const results: GenerationResult[] = []
  let successCount = 0
  let failCount = 0

  for (let i = 0; i < pagesToProcess.length; i++) {
    const page = pagesToProcess[i]
    const progress = `[${i + 1}/${pagesToProcess.length}]`

    console.log(`\n${progress} Processing: ${page.path}`)
    console.log(`  Village: ${page.village}, Type: ${page.pageType}`)

    const startTime = Date.now()
    const result = await generateSinglePage(websiteId, page.path)
    const duration = (Date.now() - startTime) / 1000

    result.duration = duration
    results.push(result)

    if (result.success) {
      successCount++
      console.log(`  ✅ Success in ${duration.toFixed(1)}s`)
      console.log(`     Agent: ${result.agentName}, Blocks: ${result.blockCount}`)
    } else {
      failCount++
      console.log(`  ❌ Failed: ${result.error}`)
    }

    // Delay between pages (except for the last one)
    if (i < pagesToProcess.length - 1 && delay > 0) {
      console.log(`  Waiting ${delay}s...`)
      await new Promise((resolve) => setTimeout(resolve, delay * 1000))
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Total processed: ${results.length}`)
  console.log(`Successful: ${successCount}`)
  console.log(`Failed: ${failCount}`)

  if (failCount > 0) {
    console.log('\nFailed pages:')
    for (const result of results.filter((r) => !r.success)) {
      console.log(`  ${result.path}: ${result.error}`)
    }
  }

  // Calculate average duration
  const successfulResults = results.filter((r) => r.success && r.duration)
  if (successfulResults.length > 0) {
    const avgDuration = successfulResults.reduce((sum, r) => sum + (r.duration || 0), 0) / successfulResults.length
    console.log(`\nAverage generation time: ${avgDuration.toFixed(1)}s`)
  }

  process.exit(failCount > 0 ? 1 : 0)
}

/**
 * Generate content for a single page
 */
async function generateSinglePage(websiteId: string, pagePath: string): Promise<GenerationResult> {
  try {
    // Extract page type from path
    const pathParts = pagePath.split('/')
    const filename = pathParts[pathParts.length - 1] || 'unknown.json'
    const pageType = filename.replace('.json', '')

    // Determine which agent should write this page
    const suggestedAgentName = getAgentForPageType(pageType)

    // Find the agent by name
    const agents = await agentRepository.findAll()
    const writerAgent = agents.find(
      (a) => a.name.toLowerCase() === suggestedAgentName.toLowerCase() && a.role === 'Writer'
    )

    const selectedAgent = writerAgent || agents.find((a) => a.role === 'Writer')

    if (!selectedAgent) {
      return {
        path: pagePath,
        success: false,
        error: `No writer agent found for page type: ${pageType}`,
      }
    }

    // Get the agent instance
    const agent = await agentFactory.getAgent(selectedAgent.id)
    if (!agent) {
      return {
        path: pagePath,
        success: false,
        error: `Failed to create agent instance for ${selectedAgent.name}`,
      }
    }

    // Create the task for the agent
    const task = `Generate content for the website page at "${pagePath}".

Instructions:
1. First, use the generate_page_content tool with website_id="${websiteId}" and page_path="${pagePath}" to load the page and collection context
2. Review the brief and available collection items
3. Create engaging, emotional content that reflects your unique writing persona
4. Use collection-embed blocks to showcase relevant items
5. Include practical tips and local insights
6. Use the write_page_content tool to save your content to GitHub

Remember to:
- Write in your distinctive voice
- Create a compelling narrative
- Naturally incorporate the collection items
- Make readers feel the essence of the place`

    // Execute the agent
    const response = await agent.execute(
      {
        taskType: 'generate_page_content',
        description: task,
        context: { websiteId, pagePath },
      },
      {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        websiteId,
      }
    )

    if (!response.success) {
      return {
        path: pagePath,
        success: false,
        agentName: selectedAgent.name,
        error: response.error || 'Agent execution failed',
      }
    }

    // Extract result details if available
    const resultData = response.data || {}

    return {
      path: pagePath,
      success: true,
      agentName: selectedAgent.name,
      title: resultData.title,
      blockCount: resultData.block_count,
    }
  } catch (error) {
    return {
      path: pagePath,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
