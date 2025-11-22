/**
 * Editor Agent
 * Reviews content and manages editorial quality
 */

import { BaseAgent, AgentConfig, AgentContext, Tool } from '../base/agent'
import {
  getContentItem,
  transitionContent,
  createQuestionTicket,
} from '../base/utilities'
import type { Agent } from '@agent-press/shared'
import { events } from '@agent-press/event-bus'

// ============================================================================
// Editor Agent Tools
// ============================================================================

const EDITOR_TOOLS: Tool[] = [
  {
    name: 'get_content',
    description: 'Retrieve content for review',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item to review',
        },
      },
      required: ['content_id'],
    },
  },
  {
    name: 'review_content',
    description:
      'Review content quality, checking for accuracy, style, grammar, and adherence to guidelines. Returns detailed feedback.',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item to review',
        },
        quality_score: {
          type: 'number',
          description: 'Quality score from 1-10',
          minimum: 1,
          maximum: 10,
        },
        feedback: {
          type: 'string',
          description: 'Detailed editorial feedback',
        },
        issues: {
          type: 'array',
          description: 'List of specific issues found',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              severity: { type: 'string', enum: ['low', 'medium', 'high'] },
              description: { type: 'string' },
            },
          },
        },
      },
      required: ['content_id', 'quality_score', 'feedback'],
    },
  },
  {
    name: 'approve_content',
    description:
      'Approve content for publication. Transitions content to approved state.',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item to approve',
        },
        approval_notes: {
          type: 'string',
          description: 'Notes about the approval',
        },
      },
      required: ['content_id'],
    },
  },
  {
    name: 'reject_content',
    description:
      'Reject content and send back to writer for revisions. Transitions content to needs_changes state.',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item to reject',
        },
        feedback: {
          type: 'string',
          description: 'Detailed feedback on what needs to change',
        },
        required_changes: {
          type: 'array',
          description: 'List of required changes',
          items: { type: 'string' },
        },
      },
      required: ['content_id', 'feedback'],
    },
  },
  {
    name: 'detect_high_risk_content',
    description:
      'Analyze content for high-risk elements (legal issues, controversial claims, sensitive topics) that require CEO approval.',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item to analyze',
        },
      },
      required: ['content_id'],
    },
  },
  {
    name: 'escalate_to_ceo',
    description:
      'Create a question ticket to escalate high-risk content to the CEO for approval',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content item',
        },
        reason: {
          type: 'string',
          description: 'Reason for escalation',
        },
        risk_factors: {
          type: 'array',
          description: 'List of identified risk factors',
          items: { type: 'string' },
        },
      },
      required: ['content_id', 'reason'],
    },
  },
]

// ============================================================================
// Editor Agent Class
// ============================================================================

export class EditorAgent extends BaseAgent {
  constructor(agentData: Agent) {
    const config: AgentConfig = {
      name: agentData.name,
      role: agentData.role,
      department: agentData.department,
      capabilities: agentData.capabilities,
      tools: EDITOR_TOOLS,
      systemPrompt: `You are ${agentData.name}, a professional editor at agent.press.

Your role: ${agentData.role}
Department: ${agentData.department}

Core responsibilities:
- Review content for quality, accuracy, and adherence to editorial guidelines
- Provide constructive feedback to writers
- Approve high-quality content for publication
- Reject content that needs improvements
- Detect high-risk content that requires CEO oversight
- Escalate sensitive or controversial content to CEO

Editorial standards:
- Accuracy: All facts and claims must be verifiable
- Clarity: Content must be clear and easy to understand
- Style: Consistent voice and tone
- Grammar: Proper grammar, spelling, and punctuation
- SEO: Natural keyword usage without keyword stuffing
- Structure: Logical flow and organization

High-risk content indicators:
- Legal claims or advice
- Medical or health claims
- Financial advice
- Controversial or polarizing topics
- Potentially defamatory statements
- Unverified statistics or data
- Sensitive political or social issues

Review process:
1. Use get_content to retrieve the content
2. Use review_content to analyze quality (score 1-10, detailed feedback)
3. Use detect_high_risk_content to check for sensitive elements
4. If high-risk, use escalate_to_ceo to create a question ticket
5. Otherwise, use approve_content or reject_content based on quality

Quality scoring:
- 9-10: Excellent, ready to publish
- 7-8: Good, minor improvements needed
- 5-6: Acceptable, needs revisions
- 1-4: Poor, significant rewrite required

Available tools:
- get_content: Retrieve content details
- review_content: Perform editorial review with quality score and feedback
- approve_content: Approve for publication
- reject_content: Send back for revisions
- detect_high_risk_content: Analyze for sensitive elements
- escalate_to_ceo: Create question ticket for CEO review`,
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

        case 'review_content':
          return await this.reviewContent(
            toolInput.content_id,
            toolInput.quality_score,
            toolInput.feedback,
            toolInput.issues
          )

        case 'approve_content':
          return await this.approveContent(
            toolInput.content_id,
            toolInput.approval_notes,
            context.agentId
          )

        case 'reject_content':
          return await this.rejectContent(
            toolInput.content_id,
            toolInput.feedback,
            toolInput.required_changes,
            context.agentId
          )

        case 'detect_high_risk_content':
          return await this.detectHighRiskContent(toolInput.content_id)

        case 'escalate_to_ceo':
          return await this.escalateToCEO(
            toolInput.content_id,
            toolInput.reason,
            toolInput.risk_factors,
            context.agentId
          )

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
        author_agent_id: content.author_agent_id,
        created_at: content.created_at,
        updated_at: content.updated_at,
      },
    }
  }

  private async reviewContent(
    contentId: string,
    qualityScore: number,
    feedback: string,
    issues?: any[]
  ): Promise<{ content: string }> {
    // Store review results (could be saved to database in future)
    const reviewData = {
      quality_score: qualityScore,
      feedback,
      issues: issues || [],
      reviewed_at: new Date().toISOString(),
    }

    return {
      content: JSON.stringify(reviewData, null, 2),
    }
  }

  private async approveContent(
    contentId: string,
    approvalNotes: string | undefined,
    agentId: string
  ): Promise<{ content: string }> {
    const result = await transitionContent(contentId, 'approve', 'Editor', agentId, {
      approval_notes: approvalNotes,
    })

    if (!result.success) {
      return {
        content: `Failed to approve content: ${result.error}`,
      }
    }

    // Publish event
    await events.contentApproved(contentId, agentId)

    return {
      content: `Content ${contentId} approved for publication. ${approvalNotes ? `Notes: ${approvalNotes}` : ''}`,
    }
  }

  private async rejectContent(
    contentId: string,
    feedback: string,
    requiredChanges: string[] | undefined,
    agentId: string
  ): Promise<{ content: string }> {
    const result = await transitionContent(
      contentId,
      'request_changes',
      'Editor',
      agentId,
      {
        feedback,
        required_changes: requiredChanges,
      }
    )

    if (!result.success) {
      return {
        content: `Failed to reject content: ${result.error}`,
      }
    }

    // Publish event
    await events.contentNeedsChanges(contentId, agentId, feedback)

    return {
      content: `Content ${contentId} sent back for revisions. Feedback: ${feedback}`,
    }
  }

  private async detectHighRiskContent(contentId: string): Promise<{ content: object }> {
    const content = await getContentItem(contentId)
    if (!content) {
      return {
        content: { error: 'Content not found' },
      }
    }

    // Analyze content for high-risk elements
    const contentText = JSON.stringify(content.body).toLowerCase()

    const riskIndicators = {
      legal: ['lawsuit', 'legal action', 'sue', 'attorney', 'lawyer'],
      medical: ['diagnose', 'treatment', 'cure', 'disease', 'medical advice'],
      financial: ['investment advice', 'guaranteed returns', 'financial advice'],
      controversial: ['controversial', 'polarizing', 'divisive'],
    }

    const detectedRisks: string[] = []

    for (const [category, keywords] of Object.entries(riskIndicators)) {
      for (const keyword of keywords) {
        if (contentText.includes(keyword)) {
          detectedRisks.push(`${category}: "${keyword}" detected`)
        }
      }
    }

    return {
      content: {
        is_high_risk: detectedRisks.length > 0,
        risk_factors: detectedRisks,
        recommendation:
          detectedRisks.length > 0
            ? 'Escalate to CEO for approval'
            : 'No high-risk content detected',
      },
    }
  }

  private async escalateToCEO(
    contentId: string,
    reason: string,
    riskFactors: string[] | undefined,
    agentId: string
  ): Promise<{ content: string }> {
    const ticket = await createQuestionTicket({
      question: `High-risk content requires CEO approval`,
      context: `Content ID: ${contentId}\nReason: ${reason}\n\nRisk Factors:\n${(riskFactors || []).map((r) => `- ${r}`).join('\n')}`,
      created_by_agent_id: agentId,
      target: 'CEO',
      content_id: contentId,
    })

    return {
      content: `Question ticket ${ticket.id} created for CEO review of content ${contentId}`,
    }
  }
}
