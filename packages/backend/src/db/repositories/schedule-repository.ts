/**
 * Schedule Repository
 * CRUD operations for website schedules and execution history
 */

import { db } from '../index.js'

// Types
export type ScheduleType = 'scheduled-content' | 'media-check' | 'link-validation' | 'stale-content'
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly'
export type ExecutionTriggerType = 'scheduled' | 'manual'
export type ExecutionStatus = 'scheduled' | 'running' | 'completed' | 'failed'

export interface WebsiteSchedule {
  id: string
  website_id: string
  schedule_type: ScheduleType
  frequency: ScheduleFrequency
  temporal_schedule_id: string | null
  cron_expression: string
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export interface ScheduleExecution {
  id: string
  website_id: string
  schedule_id: string | null
  schedule_type: ScheduleType
  workflow_type: string
  workflow_id: string | null
  trigger_type: ExecutionTriggerType
  frequency: ScheduleFrequency | null
  status: ExecutionStatus
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  triggered_by: string | null
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
}

export interface CreateScheduleInput {
  website_id: string
  schedule_type: ScheduleType
  frequency: ScheduleFrequency
  temporal_schedule_id?: string
  cron_expression: string
  enabled?: boolean
  next_run_at?: string
}

export interface UpdateScheduleInput {
  temporal_schedule_id?: string
  cron_expression?: string
  enabled?: boolean
  last_run_at?: string
  next_run_at?: string
}

export interface CreateExecutionInput {
  website_id: string
  schedule_id?: string
  schedule_type: ScheduleType
  workflow_type: string
  workflow_id?: string
  trigger_type: ExecutionTriggerType
  frequency?: ScheduleFrequency
  status: ExecutionStatus
  scheduled_at: string
  triggered_by?: string
}

export interface UpdateExecutionInput {
  workflow_id?: string
  status?: ExecutionStatus
  started_at?: string
  completed_at?: string
  result?: Record<string, unknown>
  error?: string
}

export const scheduleRepository = {
  // ============================================================================
  // Website Schedules
  // ============================================================================

  /**
   * Create a new website schedule
   */
  async createSchedule(input: CreateScheduleInput): Promise<WebsiteSchedule> {
    const result = await db.query<WebsiteSchedule>(
      `INSERT INTO website_schedules (
        website_id, schedule_type, frequency, temporal_schedule_id,
        cron_expression, enabled, next_run_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        input.website_id,
        input.schedule_type,
        input.frequency,
        input.temporal_schedule_id || null,
        input.cron_expression,
        input.enabled ?? true,
        input.next_run_at || null,
      ]
    )

    const schedule = result.rows[0]
    if (!schedule) {
      throw new Error('Failed to create schedule')
    }
    return schedule
  },

  /**
   * Find schedule by ID
   */
  async findScheduleById(id: string): Promise<WebsiteSchedule | null> {
    const result = await db.query<WebsiteSchedule>(
      `SELECT * FROM website_schedules WHERE id = $1`,
      [id]
    )
    return result.rows[0] || null
  },

  /**
   * Find schedule by website and type
   */
  async findScheduleByType(
    websiteId: string,
    scheduleType: ScheduleType
  ): Promise<WebsiteSchedule | null> {
    const result = await db.query<WebsiteSchedule>(
      `SELECT * FROM website_schedules
       WHERE website_id = $1 AND schedule_type = $2`,
      [websiteId, scheduleType]
    )
    return result.rows[0] || null
  },

  /**
   * Find all schedules for a website
   */
  async findSchedulesByWebsite(websiteId: string): Promise<WebsiteSchedule[]> {
    const result = await db.query<WebsiteSchedule>(
      `SELECT * FROM website_schedules
       WHERE website_id = $1
       ORDER BY schedule_type`,
      [websiteId]
    )
    return result.rows
  },

  /**
   * Find all enabled schedules
   */
  async findEnabledSchedules(): Promise<WebsiteSchedule[]> {
    const result = await db.query<WebsiteSchedule>(
      `SELECT * FROM website_schedules
       WHERE enabled = true
       ORDER BY website_id, schedule_type`
    )
    return result.rows
  },

  /**
   * Update schedule
   */
  async updateSchedule(id: string, input: UpdateScheduleInput): Promise<WebsiteSchedule> {
    const fields: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (input.temporal_schedule_id !== undefined) {
      fields.push(`temporal_schedule_id = $${paramIndex}`)
      params.push(input.temporal_schedule_id)
      paramIndex++
    }

    if (input.cron_expression !== undefined) {
      fields.push(`cron_expression = $${paramIndex}`)
      params.push(input.cron_expression)
      paramIndex++
    }

    if (input.enabled !== undefined) {
      fields.push(`enabled = $${paramIndex}`)
      params.push(input.enabled)
      paramIndex++
    }

    if (input.last_run_at !== undefined) {
      fields.push(`last_run_at = $${paramIndex}`)
      params.push(input.last_run_at)
      paramIndex++
    }

    if (input.next_run_at !== undefined) {
      fields.push(`next_run_at = $${paramIndex}`)
      params.push(input.next_run_at)
      paramIndex++
    }

    if (fields.length === 0) {
      throw new Error('No fields to update')
    }

    params.push(id)

    const result = await db.query<WebsiteSchedule>(
      `UPDATE website_schedules
       SET ${fields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      params
    )

    const schedule = result.rows[0]
    if (!schedule) {
      throw new Error(`Schedule ${id} not found`)
    }
    return schedule
  },

  /**
   * Delete schedule
   */
  async deleteSchedule(id: string): Promise<void> {
    await db.query(`DELETE FROM website_schedules WHERE id = $1`, [id])
  },

  /**
   * Delete all schedules for a website
   */
  async deleteSchedulesByWebsite(websiteId: string): Promise<void> {
    await db.query(`DELETE FROM website_schedules WHERE website_id = $1`, [websiteId])
  },

  /**
   * Upsert schedule (create or update)
   */
  async upsertSchedule(input: CreateScheduleInput): Promise<WebsiteSchedule> {
    const result = await db.query<WebsiteSchedule>(
      `INSERT INTO website_schedules (
        website_id, schedule_type, frequency, temporal_schedule_id,
        cron_expression, enabled, next_run_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (website_id, schedule_type) DO UPDATE SET
        frequency = EXCLUDED.frequency,
        temporal_schedule_id = EXCLUDED.temporal_schedule_id,
        cron_expression = EXCLUDED.cron_expression,
        enabled = EXCLUDED.enabled,
        next_run_at = EXCLUDED.next_run_at
      RETURNING *`,
      [
        input.website_id,
        input.schedule_type,
        input.frequency,
        input.temporal_schedule_id || null,
        input.cron_expression,
        input.enabled ?? true,
        input.next_run_at || null,
      ]
    )

    const schedule = result.rows[0]
    if (!schedule) {
      throw new Error('Failed to upsert schedule')
    }
    return schedule
  },

  // ============================================================================
  // Schedule Executions
  // ============================================================================

  /**
   * Create a new execution record
   */
  async createExecution(input: CreateExecutionInput): Promise<ScheduleExecution> {
    const result = await db.query<ScheduleExecution>(
      `INSERT INTO schedule_executions (
        website_id, schedule_id, schedule_type, workflow_type,
        workflow_id, trigger_type, frequency, status, scheduled_at, triggered_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        input.website_id,
        input.schedule_id || null,
        input.schedule_type,
        input.workflow_type,
        input.workflow_id || null,
        input.trigger_type,
        input.frequency || null,
        input.status,
        input.scheduled_at,
        input.triggered_by || null,
      ]
    )

    const execution = result.rows[0]
    if (!execution) {
      throw new Error('Failed to create execution')
    }
    return execution
  },

  /**
   * Find execution by ID
   */
  async findExecutionById(id: string): Promise<ScheduleExecution | null> {
    const result = await db.query<ScheduleExecution>(
      `SELECT * FROM schedule_executions WHERE id = $1`,
      [id]
    )
    return result.rows[0] || null
  },

  /**
   * Find executions by website
   */
  async findExecutionsByWebsite(
    websiteId: string,
    options?: {
      scheduleType?: ScheduleType
      triggerType?: ExecutionTriggerType
      status?: ExecutionStatus
      limit?: number
      offset?: number
      startDate?: string
      endDate?: string
    }
  ): Promise<ScheduleExecution[]> {
    const conditions: string[] = ['website_id = $1']
    const params: unknown[] = [websiteId]
    let paramIndex = 2

    if (options?.scheduleType) {
      conditions.push(`schedule_type = $${paramIndex}`)
      params.push(options.scheduleType)
      paramIndex++
    }

    if (options?.triggerType) {
      conditions.push(`trigger_type = $${paramIndex}`)
      params.push(options.triggerType)
      paramIndex++
    }

    if (options?.status) {
      conditions.push(`status = $${paramIndex}`)
      params.push(options.status)
      paramIndex++
    }

    if (options?.startDate) {
      conditions.push(`scheduled_at >= $${paramIndex}`)
      params.push(options.startDate)
      paramIndex++
    }

    if (options?.endDate) {
      conditions.push(`scheduled_at <= $${paramIndex}`)
      params.push(options.endDate)
      paramIndex++
    }

    const limit = options?.limit || 100
    const offset = options?.offset || 0

    const result = await db.query<ScheduleExecution>(
      `SELECT * FROM schedule_executions
       WHERE ${conditions.join(' AND ')}
       ORDER BY scheduled_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    )
    return result.rows
  },

  /**
   * Find executions by schedule
   */
  async findExecutionsBySchedule(
    scheduleId: string,
    limit: number = 50
  ): Promise<ScheduleExecution[]> {
    const result = await db.query<ScheduleExecution>(
      `SELECT * FROM schedule_executions
       WHERE schedule_id = $1
       ORDER BY scheduled_at DESC
       LIMIT $2`,
      [scheduleId, limit]
    )
    return result.rows
  },

  /**
   * Find executions for calendar view (by date range)
   */
  async findExecutionsForCalendar(
    websiteId: string,
    startDate: string,
    endDate: string
  ): Promise<ScheduleExecution[]> {
    const result = await db.query<ScheduleExecution>(
      `SELECT * FROM schedule_executions
       WHERE website_id = $1
         AND scheduled_at >= $2
         AND scheduled_at <= $3
       ORDER BY scheduled_at ASC`,
      [websiteId, startDate, endDate]
    )
    return result.rows
  },

  /**
   * Update execution
   */
  async updateExecution(id: string, input: UpdateExecutionInput): Promise<ScheduleExecution> {
    const fields: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (input.workflow_id !== undefined) {
      fields.push(`workflow_id = $${paramIndex}`)
      params.push(input.workflow_id)
      paramIndex++
    }

    if (input.status !== undefined) {
      fields.push(`status = $${paramIndex}`)
      params.push(input.status)
      paramIndex++
    }

    if (input.started_at !== undefined) {
      fields.push(`started_at = $${paramIndex}`)
      params.push(input.started_at)
      paramIndex++
    }

    if (input.completed_at !== undefined) {
      fields.push(`completed_at = $${paramIndex}`)
      params.push(input.completed_at)
      paramIndex++
    }

    if (input.result !== undefined) {
      fields.push(`result = $${paramIndex}`)
      params.push(JSON.stringify(input.result))
      paramIndex++
    }

    if (input.error !== undefined) {
      fields.push(`error = $${paramIndex}`)
      params.push(input.error)
      paramIndex++
    }

    if (fields.length === 0) {
      throw new Error('No fields to update')
    }

    params.push(id)

    const result = await db.query<ScheduleExecution>(
      `UPDATE schedule_executions
       SET ${fields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      params
    )

    const execution = result.rows[0]
    if (!execution) {
      throw new Error(`Execution ${id} not found`)
    }
    return execution
  },

  /**
   * Get execution statistics for a website
   */
  async getExecutionStatistics(
    websiteId: string,
    startDate?: string,
    endDate?: string
  ): Promise<{
    total: number
    by_status: Record<ExecutionStatus, number>
    by_trigger_type: Record<ExecutionTriggerType, number>
    by_schedule_type: Record<ScheduleType, number>
    success_rate: number
  }> {
    let dateCondition = ''
    const params: unknown[] = [websiteId]

    if (startDate && endDate) {
      dateCondition = ' AND scheduled_at >= $2 AND scheduled_at <= $3'
      params.push(startDate, endDate)
    }

    const result = await db.query(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'scheduled') AS status_scheduled,
        COUNT(*) FILTER (WHERE status = 'running') AS status_running,
        COUNT(*) FILTER (WHERE status = 'completed') AS status_completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS status_failed,
        COUNT(*) FILTER (WHERE trigger_type = 'scheduled') AS trigger_scheduled,
        COUNT(*) FILTER (WHERE trigger_type = 'manual') AS trigger_manual,
        COUNT(*) FILTER (WHERE schedule_type = 'scheduled-content') AS type_content,
        COUNT(*) FILTER (WHERE schedule_type = 'media-check') AS type_media,
        COUNT(*) FILTER (WHERE schedule_type = 'link-validation') AS type_links,
        COUNT(*) FILTER (WHERE schedule_type = 'stale-content') AS type_stale
       FROM schedule_executions
       WHERE website_id = $1${dateCondition}`,
      params
    )

    const stats = result.rows[0]
    const total = parseInt(stats.total, 10)
    const completed = parseInt(stats.status_completed, 10)
    const failed = parseInt(stats.status_failed, 10)

    return {
      total,
      by_status: {
        scheduled: parseInt(stats.status_scheduled, 10),
        running: parseInt(stats.status_running, 10),
        completed,
        failed,
      },
      by_trigger_type: {
        scheduled: parseInt(stats.trigger_scheduled, 10),
        manual: parseInt(stats.trigger_manual, 10),
      },
      by_schedule_type: {
        'scheduled-content': parseInt(stats.type_content, 10),
        'media-check': parseInt(stats.type_media, 10),
        'link-validation': parseInt(stats.type_links, 10),
        'stale-content': parseInt(stats.type_stale, 10),
      },
      success_rate: completed + failed > 0 ? completed / (completed + failed) : 0,
    }
  },

  /**
   * Delete old execution records
   */
  async cleanupOldExecutions(olderThanDays: number = 90): Promise<number> {
    const result = await db.query(
      `DELETE FROM schedule_executions
       WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'`
    )
    return result.rowCount || 0
  },
}
