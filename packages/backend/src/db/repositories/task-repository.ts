import { Task, TaskStatus } from '@agent-press/shared'
import { BaseRepository } from '../base-repository'

/**
 * Repository for Task entities
 */
export class TaskRepository extends BaseRepository<Task> {
  constructor() {
    super('tasks')
  }

  /**
   * Find tasks by agent
   */
  async findByAgent(agentId: string): Promise<Task[]> {
    return this.findBy('agent_id', agentId)
  }

  /**
   * Find tasks by status
   */
  async findByStatus(status: TaskStatus): Promise<Task[]> {
    return this.findBy('status', status)
  }

  /**
   * Find tasks by content
   */
  async findByContent(contentId: string): Promise<Task[]> {
    return this.findBy('content_id', contentId)
  }

  /**
   * Find active tasks for an agent
   */
  async findActiveByAgent(agentId: string): Promise<Task[]> {
    const result = await this.db.query<Task>(
      `SELECT * FROM ${this.tableName}
       WHERE agent_id = $1
       AND status IN ('planned', 'in_progress', 'blocked')
       ORDER BY created_at ASC`,
      [agentId]
    )
    return result.rows
  }

  /**
   * Transition task to a new status using state machine
   */
  async transition(
    id: string,
    event: string,
    actor: string,
    actorId: string,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; task?: Task; error?: string }> {
    // First get current task to check current state
    const currentTask = await this.findById(id)
    if (!currentTask) {
      return { success: false, error: 'Task not found' }
    }

    const { executeTransition } = await import('../../state-machine/engine')
    const { taskStateMachine } = await import('@agent-press/shared/state-machines')

    const result = await executeTransition(taskStateMachine, {
      entityId: id,
      entityType: 'task',
      currentState: currentTask.status,
      event: event as any,
      actor,
      actorId,
      metadata,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    // Fetch updated task
    const updatedTask = await this.findById(id)
    return { success: true, task: updatedTask! }
  }

  /**
   * Find all tasks with optional filters
   */
  async findAll(options?: {
    status?: TaskStatus
    agent_id?: string
    content_id?: string
    limit?: number
    offset?: number
  }): Promise<Task[]> {
    const filters: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (options?.status) {
      filters.push(`status = $${paramIndex++}`)
      params.push(options.status)
    }

    if (options?.agent_id) {
      filters.push(`agent_id = $${paramIndex++}`)
      params.push(options.agent_id)
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

    const result = await this.db.query<Task>(query, params)
    return result.rows
  }

  /**
   * Get state history for a task
   */
  async getStateHistory(id: string): Promise<any[]> {
    const result = await this.db.query(
      `SELECT * FROM state_audit_log
       WHERE entity_id = $1 AND entity_type = 'task'
       ORDER BY created_at DESC`,
      [id]
    )
    return result.rows
  }

  private get db() {
    return require('../connection').db
  }
}

export const taskRepository = new TaskRepository()
