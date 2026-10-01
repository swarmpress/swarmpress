/**
 * Page Content Generation Activities
 * Activities for generating content for website pages using writer agents
 */

import { agentFactory, initializeAgents } from '@swarm-press/agents'
import { websiteRepository } from '@swarm-press/backend/dist/db/repositories'
import { agentRepository } from '@swarm-press/backend/dist/db/repositories/agent-repository'
import { getAgentForPageType } from '@swarm-press/shared'

// ============================================================================
// Chain agent resolution (WS-D autonomy migration)
// ============================================================================

/**
 * Capability → role lookup table used by resolveChainAgentsActivity.
 * The first capability listed is preferred; later ones are accepted as
 * fallbacks. This matches the seeded capability names in scripts/seed.ts.
 */
const CHAIN_ROLE_CAPABILITIES: Record<
  'orchestrator' | 'writer' | 'polish' | 'linker' | 'mediaSelector',
  string[]
> = {
  orchestrator: ['create_page_brief', 'validate_page_flow', 'analyze_component_dependencies'],
  writer: ['write_page_content', 'write_draft', 'content_writing'],
  polish: ['polish_prose', 'rewrite_transitions', 'remove_redundancy', 'unify_voice'],
  linker: ['insert_links', 'find_link_opportunities', 'validate_links'],
  mediaSelector: ['validate_image_relevance', 'find_matching_images', 'suggest_missing_media'],
}

export interface ResolveChainAgentsInput {
  websiteId: string
  overrides?: {
    orchestrator?: string
    writer?: string
    polish?: string
    linker?: string
    mediaSelector?: string
  }
}

export interface ResolveChainAgentsResult {
  orchestrator: string
  writer: string
  polish: string
  linker: string
  mediaSelector: string
}

/**
 * Resolve the agent id for each chain role.
 *
 * Resolution rules (per role):
 * 1. If `overrides.<role>` is provided, use it verbatim.
 * 2. Otherwise, scan all agents and return the first one whose
 *    capabilities array contains any of the role's preferred capabilities.
 * 3. If neither path resolves an agent, return an empty string. The
 *    caller is expected to log a warning and skip the chain step
 *    (writer is the one role the workflow treats as required).
 *
 * Capabilities may be stored as either `string[]` or
 * `Array<{ name: string; enabled?: boolean }>` — both shapes are
 * supported (matching the factory's tolerant parsing).
 */
export async function resolveChainAgentsActivity(
  input: ResolveChainAgentsInput
): Promise<ResolveChainAgentsResult> {
  const overrides = input.overrides ?? {}

  // Load all agents once. The seed script gives us a small (~9 row)
  // fixture so this is cheap; for production we could scope by website.
  const agents = await agentRepository.findAll()

  const hasCapability = (agent: any, cap: string): boolean => {
    const caps = agent.capabilities
    if (!Array.isArray(caps)) return false
    return caps.some((c: any) => {
      if (typeof c === 'string') return c === cap
      if (c && typeof c === 'object' && typeof c.name === 'string') {
        return c.name === cap && c.enabled !== false
      }
      return false
    })
  }

  const findByRole = (role: keyof typeof CHAIN_ROLE_CAPABILITIES): string => {
    const overrideId = overrides[role]
    if (overrideId) return overrideId

    const candidates = CHAIN_ROLE_CAPABILITIES[role]
    for (const cap of candidates) {
      const match = agents.find((a: any) => hasCapability(a, cap))
      if (match) {
        console.log(
          `[ChainResolver] Resolved role=${role} → agent=${match.name} (${match.id}) via capability=${cap}`
        )
        return match.id
      }
    }

    console.warn(
      `[ChainResolver] No agent found for role=${role} (tried capabilities: ${candidates.join(', ')})`
    )
    return ''
  }

  return {
    orchestrator: findByRole('orchestrator'),
    writer: findByRole('writer'),
    polish: findByRole('polish'),
    linker: findByRole('linker'),
    mediaSelector: findByRole('mediaSelector'),
  }
}

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
