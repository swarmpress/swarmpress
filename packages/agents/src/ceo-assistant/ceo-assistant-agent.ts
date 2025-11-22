/**
 * CEO Assistant Agent
 * Organizes and summarizes information for CEO decision-making
 */

import { BaseAgent, AgentConfig, AgentContext, Tool } from '../base/agent'
import { getQuestionTicket, answerQuestionTicket } from '../base/utilities'
import { questionTicketRepository, taskRepository } from '@agent-press/backend'
import type { Agent } from '@agent-press/shared'

// ============================================================================
// CEO Assistant Agent Tools
// ============================================================================

const CEO_ASSISTANT_TOOLS: Tool[] = [
  {
    name: 'get_pending_tickets',
    description: 'Retrieve all open question tickets awaiting CEO review',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'summarize_ticket',
    description: 'Create a concise summary of a question ticket for CEO review',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The ID of the ticket to summarize',
        },
      },
      required: ['ticket_id'],
    },
  },
  {
    name: 'summarize_all_tickets',
    description:
      'Create a comprehensive summary of all pending tickets with priority categorization',
    input_schema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['brief', 'detailed'],
          description: 'Summary format',
        },
      },
    },
  },
  {
    name: 'categorize_ticket',
    description: 'Categorize a ticket by urgency and topic',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The ID of the ticket to categorize',
        },
      },
      required: ['ticket_id'],
    },
  },
  {
    name: 'get_task_overview',
    description: 'Get an overview of all tasks across the organization',
    input_schema: {
      type: 'object',
      properties: {
        status_filter: {
          type: 'string',
          enum: ['all', 'in_progress', 'blocked', 'completed'],
          description: 'Filter tasks by status',
        },
      },
    },
  },
  {
    name: 'organize_escalations',
    description:
      'Organize and prioritize all escalations by urgency and business impact',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
]

// ============================================================================
// CEO Assistant Agent Class
// ============================================================================

export class CEOAssistantAgent extends BaseAgent {
  constructor(agentData: Agent) {
    const config: AgentConfig = {
      name: agentData.name,
      role: agentData.role,
      department: agentData.department,
      capabilities: agentData.capabilities,
      tools: CEO_ASSISTANT_TOOLS,
      systemPrompt: `You are ${agentData.name}, the CEO Assistant at agent.press.

Your role: ${agentData.role}
Department: ${agentData.department}

Core responsibilities:
- Organize and summarize question tickets for CEO review
- Prioritize escalations by urgency and business impact
- Provide concise, actionable summaries
- Track organizational tasks and identify blockers
- Present information in CEO-friendly format

Prioritization criteria:
- HIGH: Legal issues, financial decisions, high-risk content, critical blockers
- MEDIUM: Strategic decisions, resource allocation, policy questions
- LOW: Informational requests, minor clarifications

Summary guidelines:
- Be concise but comprehensive
- Lead with the most critical information
- Provide context and background
- Include recommended actions when applicable
- Use clear, executive-level language

When organizing information:
1. Group by category and urgency
2. Highlight time-sensitive items
3. Provide context for decision-making
4. Identify dependencies and blockers
5. Suggest next steps

Available tools:
- get_pending_tickets: Retrieve all open tickets
- summarize_ticket: Create ticket summary
- summarize_all_tickets: Comprehensive ticket overview
- categorize_ticket: Categorize by urgency and topic
- get_task_overview: Organization-wide task status
- organize_escalations: Prioritize all escalations`,
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
        case 'get_pending_tickets':
          return await this.getPendingTickets()

        case 'summarize_ticket':
          return await this.summarizeTicket(toolInput.ticket_id)

        case 'summarize_all_tickets':
          return await this.summarizeAllTickets(toolInput.format || 'brief')

        case 'categorize_ticket':
          return await this.categorizeTicket(toolInput.ticket_id)

        case 'get_task_overview':
          return await this.getTaskOverview(toolInput.status_filter || 'all')

        case 'organize_escalations':
          return await this.organizeEscalations()

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

  private async getPendingTickets(): Promise<{ content: object }> {
    const tickets = await questionTicketRepository.findForCEO()

    return {
      content: {
        total_count: tickets.length,
        tickets: tickets.map((t) => ({
          id: t.id,
          question: t.question,
          context: t.context,
          created_by: t.created_by_agent_id,
          created_at: t.created_at,
          content_id: t.content_id,
          task_id: t.task_id,
        })),
      },
    }
  }

  private async summarizeTicket(ticketId: string): Promise<{ content: object }> {
    const ticket = await getQuestionTicket(ticketId)
    if (!ticket) {
      return {
        content: { error: 'Ticket not found' },
      }
    }

    // Analyze ticket for categorization
    const category = this.analyzeTicketCategory(ticket.question, ticket.context)

    return {
      content: {
        ticket_id: ticketId,
        summary: {
          question: ticket.question,
          context: ticket.context,
          created_by: ticket.created_by_agent_id,
          created_at: ticket.created_at,
          category: category.category,
          urgency: category.urgency,
          recommended_action: category.recommendation,
        },
      },
    }
  }

  private async summarizeAllTickets(
    format: string
  ): Promise<{ content: string | object }> {
    const tickets = await questionTicketRepository.findForCEO()

    if (tickets.length === 0) {
      return {
        content: 'No pending tickets require CEO review.',
      }
    }

    // Categorize all tickets
    const categorized = tickets.map((ticket) => {
      const category = this.analyzeTicketCategory(ticket.question, ticket.context)
      return {
        ...ticket,
        ...category,
      }
    })

    // Group by urgency
    const high = categorized.filter((t) => t.urgency === 'HIGH')
    const medium = categorized.filter((t) => t.urgency === 'MEDIUM')
    const low = categorized.filter((t) => t.urgency === 'LOW')

    if (format === 'brief') {
      return {
        content: `# CEO Ticket Summary

**Total Pending:** ${tickets.length}
**High Priority:** ${high.length}
**Medium Priority:** ${medium.length}
**Low Priority:** ${low.length}

${high.length > 0 ? `## High Priority\n${high.map((t) => `- [${t.id}] ${t.question}`).join('\n')}` : ''}

${medium.length > 0 ? `## Medium Priority\n${medium.map((t) => `- [${t.id}] ${t.question}`).join('\n')}` : ''}

${low.length > 0 ? `## Low Priority\n${low.map((t) => `- [${t.id}] ${t.question}`).join('\n')}` : ''}`,
      }
    }

    // Detailed format
    return {
      content: {
        summary: {
          total: tickets.length,
          by_urgency: {
            high: high.length,
            medium: medium.length,
            low: low.length,
          },
        },
        high_priority: high.map((t) => ({
          id: t.id,
          question: t.question,
          category: t.category,
          created_at: t.created_at,
          recommendation: t.recommendation,
        })),
        medium_priority: medium.map((t) => ({
          id: t.id,
          question: t.question,
          category: t.category,
          created_at: t.created_at,
        })),
        low_priority: low.map((t) => ({
          id: t.id,
          question: t.question,
          category: t.category,
          created_at: t.created_at,
        })),
      },
    }
  }

  private async categorizeTicket(ticketId: string): Promise<{ content: object }> {
    const ticket = await getQuestionTicket(ticketId)
    if (!ticket) {
      return {
        content: { error: 'Ticket not found' },
      }
    }

    const category = this.analyzeTicketCategory(ticket.question, ticket.context)

    return {
      content: {
        ticket_id: ticketId,
        category: category.category,
        urgency: category.urgency,
        reasoning: category.reasoning,
        recommendation: category.recommendation,
      },
    }
  }

  private async getTaskOverview(statusFilter: string): Promise<{ content: object }> {
    let tasks

    if (statusFilter === 'all') {
      tasks = await taskRepository.findAll()
    } else {
      tasks = await taskRepository.findByStatus(statusFilter as any)
    }

    const byStatus = {
      planned: tasks.filter((t) => t.status === 'planned').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      cancelled: tasks.filter((t) => t.status === 'cancelled').length,
    }

    const blocked = tasks.filter((t) => t.status === 'blocked')

    return {
      content: {
        total_tasks: tasks.length,
        by_status: byStatus,
        blocked_tasks: blocked.map((t) => ({
          id: t.id,
          title: t.title,
          agent_id: t.agent_id,
          created_at: t.created_at,
        })),
        active_tasks: byStatus.planned + byStatus.in_progress + byStatus.blocked,
      },
    }
  }

  private async organizeEscalations(): Promise<{ content: object }> {
    const tickets = await questionTicketRepository.findForCEO()

    // Categorize all tickets
    const categorized = tickets.map((ticket) => {
      const category = this.analyzeTicketCategory(ticket.question, ticket.context)
      return {
        ...ticket,
        ...category,
      }
    })

    // Sort by urgency
    const high = categorized.filter((t) => t.urgency === 'HIGH')
    const medium = categorized.filter((t) => t.urgency === 'MEDIUM')
    const low = categorized.filter((t) => t.urgency === 'LOW')

    return {
      content: {
        summary: `${tickets.length} escalations require attention. ${high.length} are high priority.`,
        escalations: {
          high_priority: high.map((t) => ({
            id: t.id,
            question: t.question,
            category: t.category,
            created_at: t.created_at,
            recommendation: t.recommendation,
          })),
          medium_priority: medium.map((t) => ({
            id: t.id,
            question: t.question,
            category: t.category,
            created_at: t.created_at,
          })),
          low_priority: low.map((t) => ({
            id: t.id,
            question: t.question,
            category: t.category,
          })),
        },
      },
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private analyzeTicketCategory(question: string, context: string): {
    category: string
    urgency: 'HIGH' | 'MEDIUM' | 'LOW'
    reasoning: string
    recommendation: string
  } {
    const text = (question + ' ' + context).toLowerCase()

    // High priority indicators
    if (
      text.includes('legal') ||
      text.includes('lawsuit') ||
      text.includes('high-risk') ||
      text.includes('urgent')
    ) {
      return {
        category: 'Legal/High-Risk',
        urgency: 'HIGH',
        reasoning: 'Contains legal or high-risk indicators',
        recommendation: 'Review immediately and consult legal if needed',
      }
    }

    if (text.includes('block') || text.includes('critical')) {
      return {
        category: 'Critical Blocker',
        urgency: 'HIGH',
        reasoning: 'Blocking agent progress',
        recommendation: 'Unblock to maintain workflow',
      }
    }

    // Medium priority
    if (text.includes('strategic') || text.includes('decision')) {
      return {
        category: 'Strategic Decision',
        urgency: 'MEDIUM',
        reasoning: 'Requires strategic input',
        recommendation: 'Review when time permits',
      }
    }

    // Low priority
    return {
      category: 'General Question',
      urgency: 'LOW',
      reasoning: 'Informational or low-impact',
      recommendation: 'Can be addressed in batch',
    }
  }
}
