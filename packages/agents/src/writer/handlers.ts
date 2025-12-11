/**
 * WriterAgent Tool Handlers
 * Implementations that connect tools to database operations
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'
import { validateContentBlocks } from '../base/utilities'
import {
  getAgentForPageType,
  getCollectionsForPageType,
  getAgentExpertise,
  loadCollectionItems,
  type ContentServiceInterface,
  type LoadedCollectionItem,
} from '@swarm-press/shared'

// ============================================================================
// Repository Access
// Import directly from source to pick up latest changes
// ============================================================================

async function getContentRepository() {
  // Import from source to avoid stale dist issues during development
  const { contentRepository } = await import('@swarm-press/backend/src/db/repositories/content-repository')
  return contentRepository
}

async function getWebsiteRepository() {
  const { websiteRepository } = await import('@swarm-press/backend/src/db/repositories/website-repository')
  return websiteRepository
}

async function getGitHubContentService(websiteId: string) {
  // Dynamic import to avoid circular dependencies
  const githubIntegration = await import('@swarm-press/github-integration/src/content-service')
  const websiteRepository = await getWebsiteRepository()
  const website = await websiteRepository.findById(websiteId)

  if (!website || !website.github_repo) {
    throw new Error(`Website ${websiteId} not found or not connected to GitHub`)
  }

  return new githubIntegration.GitHubContentService({
    owner: website.github_owner || '',
    repo: website.github_repo,
    token: website.github_access_token || '',
    branch: 'main',
    contentPath: 'content/collections',
    pagesPath: 'content/pages',
  })
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Get content - fetch a content item by ID
 */
export const getContentHandler: ToolHandler<{ content_id: string }> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    const contentRepository = await getContentRepository()
    const content = await contentRepository.findById(input.content_id)

    if (!content) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    return toolSuccess({
      id: content.id,
      title: content.title,
      brief: content.brief,
      status: content.status,
      body: content.body,
      metadata: content.metadata,
      website_id: content.website_id,
      author_agent_id: content.author_agent_id,
      created_at: content.created_at,
      updated_at: content.updated_at,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to fetch content')
  }
}

/**
 * Write draft - create or update content body
 */
export const writeDraftHandler: ToolHandler<{
  content_id: string
  title: string
  body: any[]
}> = async (input, context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] write_draft called:`, {
      content_id: input.content_id,
      title: input.title,
      bodyType: typeof input.body,
      bodyIsArray: Array.isArray(input.body),
      bodyLength: Array.isArray(input.body) ? input.body.length : 'N/A',
      firstBlock: Array.isArray(input.body) && input.body[0] ? JSON.stringify(input.body[0]).substring(0, 200) : 'N/A',
    })

    // Validate body is an array of blocks
    if (!Array.isArray(input.body)) {
      return toolError('Body must be an array of content blocks')
    }

    // Validate each block has a type
    for (let i = 0; i < input.body.length; i++) {
      const block = input.body[i]
      if (!block || typeof block !== 'object') {
        return toolError(`Block at index ${i} is not a valid object`)
      }
      if (!block.type) {
        return toolError(`Block at index ${i} is missing required "type" field`)
      }
    }

    // Validate content blocks structure
    const validation = validateContentBlocks(input.body)
    if (!validation.valid) {
      return toolError(`Invalid content blocks: ${validation.errors?.join(', ')}`)
    }

    const contentRepository = await getContentRepository()

    // Check content exists
    const existing = await contentRepository.findById(input.content_id)
    if (!existing) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    // Update content
    const updated = await contentRepository.update(input.content_id, {
      title: input.title,
      body: input.body,
      updated_at: new Date().toISOString(),
    })

    if (!updated) {
      return toolError('Failed to update content')
    }

    // If content is in brief_created status, transition to draft
    if (existing.status === 'brief_created') {
      const transitionResult = await contentRepository.transition(
        input.content_id,
        'writer.started',  // Matches state machine event name
        'Writer',  // Matches state machine allowedActors
        context.agentId
      )
      if (!transitionResult.success) {
        console.warn(`[WriterHandler] Could not transition to draft: ${transitionResult.error}`)
      }
    }

    return toolSuccess({
      content_id: updated.id,
      title: updated.title,
      status: updated.status,
      block_count: input.body.length,
      message: 'Draft saved successfully',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to write draft')
  }
}

/**
 * Revise draft - update content based on feedback
 */
export const reviseDraftHandler: ToolHandler<{
  content_id: string
  title?: string
  body: any[]
  revision_notes?: string
}> = async (input, context): Promise<ToolResult> => {
  try {
    // Validate body
    if (!Array.isArray(input.body)) {
      return toolError('Body must be an array of content blocks')
    }

    const validation = validateContentBlocks(input.body)
    if (!validation.valid) {
      return toolError(`Invalid content blocks: ${validation.errors?.join(', ')}`)
    }

    const contentRepository = await getContentRepository()

    // Check content exists
    const existing = await contentRepository.findById(input.content_id)
    if (!existing) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    // Build update data
    const updateData: Record<string, any> = {
      body: input.body,
      updated_at: new Date().toISOString(),
    }

    if (input.title) {
      updateData.title = input.title
    }

    // Add revision notes to metadata
    if (input.revision_notes) {
      const metadata = existing.metadata || {}
      const revisions = metadata.revisions || []
      revisions.push({
        date: new Date().toISOString(),
        agent_id: context.agentId,
        notes: input.revision_notes,
      })
      updateData.metadata = { ...metadata, revisions }
    }

    // Update content
    const updated = await contentRepository.update(input.content_id, updateData)

    if (!updated) {
      return toolError('Failed to update content')
    }

    // If content is in needs_changes status, transition back to draft
    if (existing.status === 'needs_changes') {
      const transitionResult = await contentRepository.transition(
        input.content_id,
        'revisions_applied',  // Matches state machine event name
        'Writer',  // Matches state machine allowedActors
        context.agentId
      )
      if (transitionResult.success) {
        console.log(`[WriterHandler] Transitioned content back to draft`)
      }
    }

    return toolSuccess({
      content_id: updated.id,
      title: updated.title,
      status: updated.status,
      block_count: input.body.length,
      revision_notes: input.revision_notes,
      message: 'Revision saved successfully',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to revise draft')
  }
}

/**
 * Submit for review - transition content to editorial review
 */
export const submitForReviewHandler: ToolHandler<{ content_id: string }> = async (
  input,
  context
): Promise<ToolResult> => {
  try {
    const contentRepository = await getContentRepository()

    // Check content exists
    const content = await contentRepository.findById(input.content_id)
    if (!content) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    // Check content has a body
    if (!content.body || !Array.isArray(content.body) || content.body.length === 0) {
      return toolError('Cannot submit empty content for review. Please write a draft first.')
    }

    // Transition to in_editorial_review
    const result = await contentRepository.transition(
      input.content_id,
      'submit_for_review',
      'Writer',  // Matches state machine allowedActors
      context.agentId
    )

    if (!result.success) {
      return toolError(`Failed to submit for review: ${result.error}`)
    }

    return toolSuccess({
      content_id: input.content_id,
      previous_status: content.status,
      new_status: 'in_editorial_review',
      message: 'Content submitted for editorial review',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to submit for review')
  }
}

/**
 * Generate page content - load page and collections for content generation
 */
export const generatePageContentHandler: ToolHandler<{
  website_id: string
  page_path: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] generate_page_content called:`, {
      website_id: input.website_id,
      page_path: input.page_path,
    })

    const contentService = await getGitHubContentService(input.website_id)

    // Get the page from GitHub
    const pageFile = await contentService.getPageByPath(input.page_path)
    if (!pageFile) {
      return toolError(`Page not found: ${input.page_path}`)
    }

    const page = pageFile.content
    const metadata = page.metadata || {}

    // Extract village and page_type from metadata or path
    const village = (metadata.city as string) || extractVillageFromPath(input.page_path)
    const pageType = page.page_type || (metadata.page_type as string) || extractPageTypeFromPath(input.page_path)
    const language = (metadata.lang as string) || 'en'

    // Determine which agent should write this page
    const suggestedAgent = getAgentForPageType(pageType)
    const agentExpertise = getAgentExpertise(suggestedAgent)

    // Get relevant collection types for this page type
    const relevantCollections = getCollectionsForPageType(pageType)

    // Load collection items filtered by village
    const collectionContext: string[] = []
    const loadedItems: Record<string, LoadedCollectionItem[]> = {}

    for (const collectionType of relevantCollections) {
      try {
        const items = await loadCollectionItems(
          contentService as ContentServiceInterface,
          collectionType,
          { village, published: true, limit: 20 }
        )

        if (items.length > 0) {
          loadedItems[collectionType] = items
          collectionContext.push(
            `\n### ${collectionType} (${items.length} items in ${village})\n` +
            items.map((item) =>
              `- **${item.title}**${item.summary ? `: ${item.summary.slice(0, 100)}...` : ''} [slug: ${item.slug}]`
            ).join('\n')
          )
        }
      } catch (error) {
        console.warn(`[WriterHandler] Failed to load collection ${collectionType}:`, error)
      }
    }

    // Build the brief for the agent
    const brief = {
      page: {
        id: page.id,
        path: input.page_path,
        title: page.title,
        slug: page.slug,
        page_type: pageType,
        current_body: page.body,
        seo: page.seo,
      },
      context: {
        village,
        language,
        suggested_agent: suggestedAgent,
        agent_expertise: agentExpertise,
        relevant_collections: relevantCollections,
      },
      collections: loadedItems,
      instructions: `
## Your Task
Create engaging, emotional content for the "${page.title}" page in ${village}.

## Page Context
- Village: ${village}
- Page Type: ${pageType}
- Language: ${language}
- Suggested Writer: ${suggestedAgent} (${agentExpertise})

## Available Collections
${collectionContext.length > 0 ? collectionContext.join('\n') : 'No collection items available for this village.'}

## Content Guidelines
1. Write in your unique voice and persona
2. Create an engaging narrative that naturally incorporates the collection items
3. Use collection-embed blocks to showcase curated items
4. Include practical tips, local insights, and personal touches
5. Make readers feel the essence of ${village}

## Block Types to Use
- hero: For the page header with an evocative title and subtitle
- paragraph: For narrative content (use markdown for formatting)
- collection-embed: To embed filtered collection items
- callout: For tips, warnings, or special recommendations
- quote: For local sayings or testimonials
- list: For bullet points or numbered lists
- faq: For frequently asked questions

When ready, use the write_page_content tool to save your content.
`,
    }

    return toolSuccess(brief)
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to generate page content')
  }
}

/**
 * Write page content - save content to a GitHub page
 */
export const writePageContentHandler: ToolHandler<{
  website_id: string
  page_path: string
  title: string
  body: any[]
  seo?: Record<string, unknown>
}> = async (input, context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] write_page_content called:`, {
      website_id: input.website_id,
      page_path: input.page_path,
      title: input.title,
      bodyLength: Array.isArray(input.body) ? input.body.length : 'N/A',
    })

    // Validate body is an array of blocks
    if (!Array.isArray(input.body)) {
      return toolError('Body must be an array of content blocks')
    }

    // Validate each block has a type
    for (let i = 0; i < input.body.length; i++) {
      const block = input.body[i]
      if (!block || typeof block !== 'object') {
        return toolError(`Block at index ${i} is not a valid object`)
      }
      if (!block.type) {
        return toolError(`Block at index ${i} is missing required "type" field`)
      }
    }

    const contentService = await getGitHubContentService(input.website_id)

    // Get the existing page
    const pageFile = await contentService.getPageByPath(input.page_path)
    if (!pageFile) {
      return toolError(`Page not found: ${input.page_path}`)
    }

    // Update the page
    const updatedPage = {
      ...pageFile.content,
      title: input.title,
      body: input.body,
      seo: input.seo || pageFile.content.seo,
      status: 'draft',
      updated_at: new Date().toISOString(),
    }

    // Save to GitHub
    const result = await contentService.savePageByPath(
      input.page_path,
      updatedPage,
      `Update page content: ${input.title} [by ${context.agentName}]`
    )

    return toolSuccess({
      page_path: input.page_path,
      title: input.title,
      block_count: input.body.length,
      commit: result.commit,
      message: 'Page content saved successfully to GitHub',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to write page content')
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractVillageFromPath(path: string): string {
  // Path format: content/pages/{lang}/{village}/{page_type}.json
  const parts = path.split('/')
  if (parts.length >= 4) {
    return parts[parts.length - 2] || 'unknown' // Second to last part
  }
  return 'unknown'
}

function extractPageTypeFromPath(path: string): string {
  // Path format: content/pages/{lang}/{village}/{page_type}.json
  const parts = path.split('/')
  const filename = parts[parts.length - 1] || 'unknown.json'
  return filename.replace('.json', '')
}

// ============================================================================
// Export Handler Map
// ============================================================================

export const writerToolHandlers: Record<string, ToolHandler> = {
  get_content: getContentHandler,
  write_draft: writeDraftHandler,
  revise_draft: reviseDraftHandler,
  submit_for_review: submitForReviewHandler,
  generate_page_content: generatePageContentHandler,
  write_page_content: writePageContentHandler,
}
