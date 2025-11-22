/**
 * Writer Agent
 * Creates and revises content drafts
 */

import { BaseAgent, AgentConfig, AgentContext, Tool } from '../base/agent'
import {
  getContentItem,
  updateContentBody,
  transitionContent,
  createParagraphBlock,
  createHeadingBlock,
  createHeroBlock,
  createImageBlock,
  createListBlock,
  createQuoteBlock,
  validateContentBlocks,
} from '../base/utilities'
import type { Agent } from '@agent-press/shared'
import { events } from '@agent-press/event-bus'

// ============================================================================
// Writer Agent Tools
// ============================================================================

const WRITER_TOOLS: Tool[] = [
  {
    name: 'write_draft',
    description:
      'Create a draft for a content item using structured JSON blocks. Use this to write the initial content based on a brief.',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item to write',
        },
        blocks: {
          type: 'array',
          description:
            'Array of content blocks (paragraph, heading, hero, image, list, quote, etc.)',
          items: {
            type: 'object',
          },
        },
      },
      required: ['content_id', 'blocks'],
    },
  },
  {
    name: 'revise_draft',
    description:
      'Revise an existing content draft based on feedback. Updates the content blocks.',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item to revise',
        },
        blocks: {
          type: 'array',
          description: 'Updated array of content blocks',
          items: {
            type: 'object',
          },
        },
        revision_notes: {
          type: 'string',
          description: 'Notes explaining what was revised',
        },
      },
      required: ['content_id', 'blocks'],
    },
  },
  {
    name: 'submit_for_review',
    description:
      'Submit a content draft to the editorial team for review. Transitions the content to in_editorial_review state.',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item to submit',
        },
      },
      required: ['content_id'],
    },
  },
  {
    name: 'get_content',
    description: 'Retrieve the current content item to review or revise',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item to retrieve',
        },
      },
      required: ['content_id'],
    },
  },
]

// ============================================================================
// Writer Agent Class
// ============================================================================

export class WriterAgent extends BaseAgent {
  constructor(agentData: Agent) {
    const config: AgentConfig = {
      name: agentData.name,
      role: agentData.role,
      department: agentData.department,
      capabilities: agentData.capabilities,
      tools: WRITER_TOOLS,
      systemPrompt: `You are ${agentData.name}, a professional content writer at agent.press.

Your role: ${agentData.role}
Department: ${agentData.department}

Core responsibilities:
- Write high-quality, engaging content based on briefs
- Create content using structured JSON blocks (paragraph, heading, hero, image, list, quote, etc.)
- Revise content based on editorial feedback
- Submit completed drafts for review

Content structure guidelines:
- Use heading blocks for section titles (levels 1-6)
- Use paragraph blocks for body text
- Use hero blocks for prominent featured content with headlines and CTAs
- Use image blocks with descriptive alt text
- Use list blocks (ordered/unordered) for structured information
- Use quote blocks for testimonials or notable quotes
- Always validate content blocks before submitting

Writing style:
- Clear, concise, and engaging
- SEO-conscious (natural keyword usage)
- Appropriate tone for the target audience
- Well-structured with logical flow

When you receive a task:
1. Use get_content to review any existing content or brief
2. Create or revise content using write_draft or revise_draft
3. When ready, use submit_for_review to send to editorial team

Available tools:
- get_content: Retrieve content item details
- write_draft: Create initial content draft with JSON blocks
- revise_draft: Update content based on feedback
- submit_for_review: Submit to editorial review`,
    }

    super(config)
  }

  protected async executeTool(
    toolName: string,
    toolInput: any,
    context: AgentContext
  ): Promise<{ content: string | object; is_error?: boolean }> {
    try {
      switch (toolName) {
        case 'get_content':
          return await this.getContent(toolInput.content_id)

        case 'write_draft':
          return await this.writeDraft(
            toolInput.content_id,
            toolInput.blocks,
            context.agentId
          )

        case 'revise_draft':
          return await this.reviseDraft(
            toolInput.content_id,
            toolInput.blocks,
            toolInput.revision_notes,
            context.agentId
          )

        case 'submit_for_review':
          return await this.submitForReview(toolInput.content_id, context.agentId)

        default:
          return {
            content: `Unknown tool: ${toolName}`,
            is_error: true,
          }
      }
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : 'Tool execution failed',
        is_error: true,
      }
    }
  }

  // ============================================================================
  // Tool Implementations
  // ============================================================================

  private async getContent(contentId: string): Promise<{ content: object }> {
    const content = await getContentItem(contentId)
    if (!content) {
      return {
        content: { error: 'Content not found' },
      }
    }

    return {
      content: {
        id: content.id,
        type: content.type,
        status: content.status,
        metadata: content.metadata,
        body: content.body,
        created_at: content.created_at,
        updated_at: content.updated_at,
      },
    }
  }

  private async writeDraft(
    contentId: string,
    blocks: any[],
    agentId: string
  ): Promise<{ content: string }> {
    // Validate blocks
    const validation = validateContentBlocks(blocks)
    if (!validation.valid) {
      return {
        content: `Content validation failed: ${validation.errors.join(', ')}`,
      }
    }

    // Update content body
    const result = await updateContentBody(contentId, blocks)
    if (!result.success) {
      return {
        content: `Failed to write draft: ${result.error}`,
      }
    }

    // Transition to draft state if needed
    const content = await getContentItem(contentId)
    if (content && content.status === 'brief_created') {
      await transitionContent(contentId, 'writer.started', 'Writer', agentId)
    }

    // Publish event
    await events.contentCreated(contentId, agentId)

    return {
      content: `Draft written successfully for content ${contentId} with ${blocks.length} blocks`,
    }
  }

  private async reviseDraft(
    contentId: string,
    blocks: any[],
    revisionNotes: string | undefined,
    agentId: string
  ): Promise<{ content: string }> {
    // Validate blocks
    const validation = validateContentBlocks(blocks)
    if (!validation.valid) {
      return {
        content: `Content validation failed: ${validation.errors.join(', ')}`,
      }
    }

    // Update content body
    const result = await updateContentBody(contentId, blocks)
    if (!result.success) {
      return {
        content: `Failed to revise draft: ${result.error}`,
      }
    }

    // Transition back to draft if it was in needs_changes
    const content = await getContentItem(contentId)
    if (content && content.status === 'needs_changes') {
      await transitionContent(contentId, 'revisions_applied', 'Writer', agentId, {
        revision_notes: revisionNotes,
      })
    }

    return {
      content: `Draft revised successfully for content ${contentId}. ${revisionNotes ? `Notes: ${revisionNotes}` : ''}`,
    }
  }

  private async submitForReview(
    contentId: string,
    agentId: string
  ): Promise<{ content: string }> {
    const result = await transitionContent(
      contentId,
      'submit_for_review',
      'Writer',
      agentId
    )

    if (!result.success) {
      return {
        content: `Failed to submit for review: ${result.error}`,
      }
    }

    // Publish event
    await events.contentSubmittedForReview(contentId, agentId)

    return {
      content: `Content ${contentId} submitted for editorial review`,
    }
  }
}
