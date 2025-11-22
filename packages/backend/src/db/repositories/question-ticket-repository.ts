import { QuestionTicket, QuestionTicketStatus } from '@agent-press/shared'
import { BaseRepository } from '../base-repository'
import { db } from '../connection'

/**
 * Repository for QuestionTicket entities
 */
export class QuestionTicketRepository extends BaseRepository<QuestionTicket> {
  constructor() {
    super('question_tickets')
  }

  /**
   * Find tickets by status
   */
  async findByStatus(status: QuestionTicketStatus): Promise<QuestionTicket[]> {
    return this.findBy('status', status)
  }

  /**
   * Find tickets created by an agent
   */
  async findByCreator(agentId: string): Promise<QuestionTicket[]> {
    return this.findBy('created_by_agent_id', agentId)
  }

  /**
   * Find tickets by target
   */
  async findByTarget(target: string): Promise<QuestionTicket[]> {
    return this.findBy('target', target)
  }

  /**
   * Find open tickets
   */
  async findOpen(): Promise<QuestionTicket[]> {
    return this.findByStatus('open')
  }

  /**
   * Find tickets awaiting CEO response
   */
  async findForCEO(): Promise<QuestionTicket[]> {
    const result = await db.query<QuestionTicket>(
      `SELECT * FROM ${this.tableName}
       WHERE target = 'CEO'
       AND status = 'open'
       ORDER BY created_at ASC`
    )
    return result.rows
  }

  /**
   * Answer a ticket using state machine
   */
  async answer(
    id: string,
    answerAgentId: string,
    answerBody: string,
    actor: string
  ): Promise<{ success: boolean; ticket?: QuestionTicket; error?: string }> {
    // First update the answer fields
    const updatedTicket = await this.update(id, {
      answer_agent_id: answerAgentId,
      answer_body: answerBody,
    } as Partial<QuestionTicket>)

    if (!updatedTicket) {
      return { success: false, error: 'Ticket not found' }
    }

    // Then transition the state
    const { executeTransition } = await import('../../state-machine/engine')
    const { questionTicketStateMachine } = await import('@agent-press/shared/state-machines')

    const result = await executeTransition(questionTicketStateMachine, {
      entityId: id,
      entityType: 'question_ticket',
      currentState: updatedTicket.status,
      event: 'answer_provided' as any,
      actor,
      actorId: answerAgentId,
      metadata: { answer_body: answerBody },
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    const finalTicket = await this.findById(id)
    return { success: true, ticket: finalTicket! }
  }

  /**
   * Close a ticket using state machine
   */
  async close(
    id: string,
    actor: string,
    actorId: string,
    event: 'agent_acknowledged' | 'invalid_ticket' = 'agent_acknowledged'
  ): Promise<{ success: boolean; ticket?: QuestionTicket; error?: string }> {
    const currentTicket = await this.findById(id)
    if (!currentTicket) {
      return { success: false, error: 'Ticket not found' }
    }

    const { executeTransition } = await import('../../state-machine/engine')
    const { questionTicketStateMachine } = await import('@agent-press/shared/state-machines')

    const result = await executeTransition(questionTicketStateMachine, {
      entityId: id,
      entityType: 'question_ticket',
      currentState: currentTicket.status,
      event: event as any,
      actor,
      actorId,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    const finalTicket = await this.findById(id)
    return { success: true, ticket: finalTicket! }
  }

  /**
   * Find all question tickets with optional filters
   */
  async findAll(options?: {
    status?: QuestionTicketStatus
    target?: string
    content_id?: string
    limit?: number
    offset?: number
  }): Promise<QuestionTicket[]> {
    const filters: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (options?.status) {
      filters.push(`status = $${paramIndex++}`)
      params.push(options.status)
    }

    if (options?.target) {
      filters.push(`target = $${paramIndex++}`)
      params.push(options.target)
    }

    if (options?.content_id) {
      filters.push(`content_id = $${paramIndex++}`)
      params.push(options.content_id)
    }

    let query = `SELECT * FROM ${this.tableName}`
    if (filters.length > 0) {
      query += ` WHERE ${filters.join(' AND ')}`
    }
    query += ` ORDER BY created_at DESC`

    if (options?.limit) {
      query += ` LIMIT $${paramIndex++}`
      params.push(options.limit)
    }

    if (options?.offset) {
      query += ` OFFSET $${paramIndex++}`
      params.push(options.offset)
    }

    const result = await db.query<QuestionTicket>(query, params)
    return result.rows
  }
}

export const questionTicketRepository = new QuestionTicketRepository()
