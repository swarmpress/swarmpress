/**
 * Page Content Generation Activities
 * Activities for generating content for website pages using writer agents
 */

import { agentFactory, initializeAgents } from '@swarm-press/agents'
import { websiteRepository } from '@swarm-press/backend/dist/db/repositories'
import { agentRepository } from '@swarm-press/backend/dist/db/repositories/agent-repository'
import { getAgentForPageType } from '@swarm-press/shared'

// Initialize agents on first import
let agentsInitialized = false

async function ensureAgentsInitialized() {
  if (!agentsInitialized) {
    initializeAgents()
    agentsInitialized = true
  }
}

export interface PageContentGenerationInput {
  websiteId: string
  pagePath: string
}

export interface PageContentGenerationResult {
  success: boolean
  pagePath: string
  agentName?: string
  title?: string
  blockCount?: number
  error?: string
}

/**
 * Generate content for a single page
 * Uses the appropriate writer agent based on page type
 */
export async function generatePageContentActivity(
  input: PageContentGenerationInput
): Promise<PageContentGenerationResult> {
  const { websiteId, pagePath } = input

  try {
    await ensureAgentsInitialized()

    console.log(`[PageContentGeneration] Starting for ${pagePath}`)

    // Extract page type from path
    const pathParts = pagePath.split('/')
    const filename = pathParts[pathParts.length - 1] || 'unknown.json'
    const pageType = filename.replace('.json', '')

    // Determine which agent should write this page
    const suggestedAgentName = getAgentForPageType(pageType)
    console.log(`[PageContentGeneration] Page type: ${pageType}, suggested agent: ${suggestedAgentName}`)

    // Find the agent by name
    const agents = await agentRepository.findAll()
    const writerAgent = agents.find(
      (a) => a.name.toLowerCase() === suggestedAgentName.toLowerCase() && a.role === 'Writer'
    )

    if (!writerAgent) {
      // Fall back to any writer agent
      const fallbackWriter = agents.find((a) => a.role === 'Writer')
      if (!fallbackWriter) {
        return {
          success: false,
          pagePath,
          error: `No writer agent found for page type: ${pageType}`,
        }
      }
      console.log(`[PageContentGeneration] Using fallback writer: ${fallbackWriter.name}`)
    }

    const selectedAgent = writerAgent || agents.find((a) => a.role === 'Writer')!

    // Get the agent instance
    const agent = await agentFactory.getAgent(selectedAgent.id)
    if (!agent) {
      return {
        success: false,
        pagePath,
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
        success: false,
        pagePath,
        agentName: selectedAgent.name,
        error: response.error || 'Agent execution failed',
      }
    }

    // Extract result details if available
    const resultData = response.data || {}

    return {
      success: true,
      pagePath,
      agentName: selectedAgent.name,
      title: resultData.title,
      blockCount: resultData.block_count,
    }
  } catch (error) {
    console.error(`[PageContentGeneration] Failed for ${pagePath}:`, error)
    return {
      success: false,
      pagePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * List all pages that need content generation
 * Returns pages with empty body arrays
 */
export async function listEmptyPagesActivity(input: {
  websiteId: string
  language?: string
  village?: string
  pageType?: string
  limit?: number
}): Promise<{ pages: Array<{ path: string; title: string; pageType: string; village: string }> }> {
  const { websiteId, language, village, pageType, limit } = input

  try {
    // Import GitHubContentService dynamically
    const { GitHubContentService } = await import('@swarm-press/github-integration/src/content-service')

    // Get website
    const website = await websiteRepository.findById(websiteId)
    if (!website || !website.github_repo) {
      throw new Error(`Website ${websiteId} not found or not connected to GitHub`)
    }

    const contentService = new GitHubContentService({
      owner: website.github_owner || '',
      repo: website.github_repo,
      token: website.github_access_token || '',
      branch: 'main',
      pagesPath: 'content/pages',
    })

    // List all pages
    const allPages = await contentService.listPages()

    // Filter to empty pages
    const emptyPages = allPages.filter((page) => {
      const body = page.content.body
      const isEmpty = !body || !Array.isArray(body) || body.length === 0

      if (!isEmpty) return false

      // Apply filters
      const pathParts = page.path.split('/')
      const pageLang = pathParts[2] || '' // content/pages/{lang}/...
      const pageVillage = pathParts[3] || '' // content/pages/{lang}/{village}/...
      const pageTypeFromPath = (pathParts[4] || '').replace('.json', '')

      if (language && pageLang !== language) return false
      if (village && pageVillage !== village) return false
      if (pageType && pageTypeFromPath !== pageType) return false

      return true
    })

    // Apply limit
    const limitedPages = limit ? emptyPages.slice(0, limit) : emptyPages

    return {
      pages: limitedPages.map((page) => {
        const pathParts = page.path.split('/')
        return {
          path: page.path,
          title: page.content.title,
          pageType: (pathParts[4] || '').replace('.json', ''),
          village: pathParts[3] || '',
        }
      }),
    }
  } catch (error) {
    console.error(`[PageContentGeneration] Failed to list empty pages:`, error)
    return { pages: [] }
  }
}
