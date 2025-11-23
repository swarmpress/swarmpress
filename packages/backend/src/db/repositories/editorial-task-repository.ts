/**
 * Editorial Task Repository
 * CRUD operations for content planning tasks
 * Hybrid model: YAML is source of truth, PostgreSQL for runtime queries
 */

import { db } from '../index.js'

// Types (inline to avoid import issues)
export type TaskType = 'article' | 'page' | 'update' | 'fix' | 'optimize' | 'research'
export type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'blocked' | 'completed' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskPhase = 'research' | 'outline' | 'draft' | 'edit' | 'review' | 'publish' | 'optimize'
export type SEODifficulty = 'easy' | 'medium' | 'hard' | 'very_hard'

export interface EditorialTask {
  id: string
  website_id: string

  // Basic Info
  title: string
  description?: string
  task_type: TaskType

  // Status & Priority
  status: TaskStatus
  priority: TaskPriority

  // Assignment
  assigned_agent_id?: string
  assigned_human?: string

  // Timeline
  created_at: string
  updated_at: string
  started_at?: string
  completed_at?: string
  due_date?: string
  estimated_hours?: number
  actual_hours?: number

  // Dependencies
  depends_on?: string[]
  blocks?: string[]

  // Sitemap Integration
  sitemap_targets?: string[]

  // SEO Metadata
  seo_primary_keyword?: string
  seo_secondary_keywords?: string[]
  seo_target_volume?: number
  seo_estimated_difficulty?: SEODifficulty

  // Internal Linking
  internal_links_required_inbound?: string[]
  internal_links_required_outbound?: string[]
  internal_links_min_count?: number
  internal_links_max_count?: number

  // Content Requirements
  word_count_target?: number
  word_count_actual?: number
  content_type?: string
  template_blueprint_id?: string

  // Collaboration
  tags?: string[]
  labels?: string[]
  notes?: string
  review_comments?: Array<{
    author: string
    comment: string
    timestamp: string
  }>

  // GitHub Integration
  github_branch?: string
  github_pr_url?: string
  github_issue_url?: string

  // Phases
  current_phase?: TaskPhase
  phases_completed?: string[]

  // Metadata
  metadata?: Record<string, any>

  // Sync tracking
  yaml_file_path?: string
  yaml_last_synced_at?: string
  yaml_hash?: string
}

export interface CreateTaskInput {
  id: string
  website_id: string
  title: string
  description?: string
  task_type: TaskType
  status?: TaskStatus
  priority?: TaskPriority
  assigned_agent_id?: string
  due_date?: string
  sitemap_targets?: string[]
  seo_primary_keyword?: string
  tags?: string[]
  metadata?: Record<string, any>
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  assigned_agent_id?: string
  due_date?: string
  current_phase?: TaskPhase
  sitemap_targets?: string[]
  tags?: string[]
  notes?: string
  github_branch?: string
  github_pr_url?: string
  github_issue_url?: string
}

export interface TaskFilters {
  website_id: string
  status?: TaskStatus | TaskStatus[]
  priority?: TaskPriority | TaskPriority[]
  assigned_agent_id?: string
  current_phase?: TaskPhase
  tags?: string[]
  overdue?: boolean
  has_blockers?: boolean
}

export interface TaskWithPhases extends EditorialTask {
  phases: Array<{
    id: string
    phase_name: string
    phase_order: number
    status: string
    progress_percentage: number
    started_at?: string
    completed_at?: string
  }>
}

export const editorialTaskRepository = {
  /**
   * Create a new editorial task
   */
  async create(input: CreateTaskInput): Promise<EditorialTask> {
    const result = await db.query<EditorialTask>(
      `INSERT INTO editorial_tasks (
        id, website_id, title, description, task_type,
        status, priority, assigned_agent_id, due_date,
        sitemap_targets, seo_primary_keyword, tags, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
      RETURNING *`,
      [
        input.id,
        input.website_id,
        input.title,
        input.description,
        input.task_type,
        input.status || 'backlog',
        input.priority || 'medium',
        input.assigned_agent_id,
        input.due_date,
        input.sitemap_targets,
        input.seo_primary_keyword,
        input.tags,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    )

    const task = result.rows[0]
    if (!task) {
      throw new Error('Failed to create task')
    }

    // Initialize standard phases for this task type
    await db.query(
      `SELECT initialize_task_phases($1, $2)`,
      [task.id, task.task_type]
    )

    return task
  },

  /**
   * Find task by ID
   */
  async findById(id: string): Promise<EditorialTask | null> {
    const result = await db.query<EditorialTask>(
      `SELECT * FROM editorial_tasks WHERE id = $1`,
      [id]
    )
    return result.rows[0] || null
  },

  /**
   * Find task with phases
   */
  async findByIdWithPhases(id: string): Promise<TaskWithPhases | null> {
    const result = await db.query<EditorialTask>(
      `SELECT * FROM editorial_tasks WHERE id = $1`,
      [id]
    )

    const task = result.rows[0]
    if (!task) return null

    const phasesResult = await db.query(
      `SELECT id, phase_name, phase_order, status, progress_percentage,
              started_at, completed_at
       FROM task_phases
       WHERE task_id = $1
       ORDER BY phase_order ASC`,
      [id]
    )

    return { ...task, phases: phasesResult.rows }
  },

  /**
   * Find all tasks for a website
   */
  async findByWebsite(websiteId: string): Promise<EditorialTask[]> {
    const result = await db.query<EditorialTask>(
      `SELECT * FROM editorial_tasks
       WHERE website_id = $1
       ORDER BY priority DESC, due_date ASC NULLS LAST, created_at DESC`,
      [websiteId]
    )
    return result.rows
  },

  /**
   * Find tasks with filters
   */
  async findWithFilters(filters: TaskFilters): Promise<EditorialTask[]> {
    const conditions: string[] = ['website_id = $1']
    const params: any[] = [filters.website_id]
    let paramIndex = 2

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(`status = ANY($${paramIndex})`)
        params.push(filters.status)
      } else {
        conditions.push(`status = $${paramIndex}`)
        params.push(filters.status)
      }
      paramIndex++
    }

    if (filters.priority) {
      if (Array.isArray(filters.priority)) {
        conditions.push(`priority = ANY($${paramIndex})`)
        params.push(filters.priority)
      } else {
        conditions.push(`priority = $${paramIndex}`)
        params.push(filters.priority)
      }
      paramIndex++
    }

    if (filters.assigned_agent_id) {
      conditions.push(`assigned_agent_id = $${paramIndex}`)
      params.push(filters.assigned_agent_id)
      paramIndex++
    }

    if (filters.current_phase) {
      conditions.push(`current_phase = $${paramIndex}`)
      params.push(filters.current_phase)
      paramIndex++
    }

    if (filters.tags && filters.tags.length > 0) {
      conditions.push(`tags && $${paramIndex}`)
      params.push(filters.tags)
      paramIndex++
    }

    if (filters.overdue) {
      conditions.push(`due_date < CURRENT_DATE`)
      conditions.push(`status NOT IN ('completed', 'cancelled')`)
    }

    if (filters.has_blockers) {
      conditions.push(`status = 'blocked'`)
    }

    const query = `
      SELECT * FROM editorial_tasks
      WHERE ${conditions.join(' AND ')}
      ORDER BY priority DESC, due_date ASC NULLS LAST, created_at DESC
    `

    const result = await db.query<EditorialTask>(query, params)
    return result.rows
  },

  /**
   * Update task
   */
  async update(id: string, input: UpdateTaskInput): Promise<EditorialTask> {
    const fields: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (input.title !== undefined) {
      fields.push(`title = $${paramIndex}`)
      params.push(input.title)
      paramIndex++
    }

    if (input.description !== undefined) {
      fields.push(`description = $${paramIndex}`)
      params.push(input.description)
      paramIndex++
    }

    if (input.status !== undefined) {
      fields.push(`status = $${paramIndex}`)
      params.push(input.status)
      paramIndex++
    }

    if (input.priority !== undefined) {
      fields.push(`priority = $${paramIndex}`)
      params.push(input.priority)
      paramIndex++
    }

    if (input.assigned_agent_id !== undefined) {
      fields.push(`assigned_agent_id = $${paramIndex}`)
      params.push(input.assigned_agent_id)
      paramIndex++
    }

    if (input.due_date !== undefined) {
      fields.push(`due_date = $${paramIndex}`)
      params.push(input.due_date)
      paramIndex++
    }

    if (input.current_phase !== undefined) {
      fields.push(`current_phase = $${paramIndex}`)
      params.push(input.current_phase)
      paramIndex++
    }

    if (input.sitemap_targets !== undefined) {
      fields.push(`sitemap_targets = $${paramIndex}`)
      params.push(input.sitemap_targets)
      paramIndex++
    }

    if (input.tags !== undefined) {
      fields.push(`tags = $${paramIndex}`)
      params.push(input.tags)
      paramIndex++
    }

    if (input.notes !== undefined) {
      fields.push(`notes = $${paramIndex}`)
      params.push(input.notes)
      paramIndex++
    }

    if (input.github_branch !== undefined) {
      fields.push(`github_branch = $${paramIndex}`)
      params.push(input.github_branch)
      paramIndex++
    }

    if (input.github_pr_url !== undefined) {
      fields.push(`github_pr_url = $${paramIndex}`)
      params.push(input.github_pr_url)
      paramIndex++
    }

    if (input.github_issue_url !== undefined) {
      fields.push(`github_issue_url = $${paramIndex}`)
      params.push(input.github_issue_url)
      paramIndex++
    }

    if (fields.length === 0) {
      throw new Error('No fields to update')
    }

    params.push(id)

    const query = `
      UPDATE editorial_tasks
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `

    const result = await db.query<EditorialTask>(query, params)
    const task = result.rows[0]
    if (!task) {
      throw new Error(`Task ${id} not found`)
    }
    return task
  },

  /**
   * Delete task
   */
  async delete(id: string): Promise<void> {
    await db.query(`DELETE FROM editorial_tasks WHERE id = $1`, [id])
  },

  /**
   * Get tasks by sitemap page
   */
  async findBySitemapPage(pageId: string): Promise<EditorialTask[]> {
    const result = await db.query<EditorialTask>(
      `SELECT * FROM editorial_tasks
       WHERE $1 = ANY(sitemap_targets)
       ORDER BY priority DESC, created_at DESC`,
      [pageId]
    )
    return result.rows
  },

  /**
   * Get tasks with dependencies
   */
  async findWithDependencies(taskId: string): Promise<{
    task: EditorialTask
    dependencies: EditorialTask[]
    blockedBy: EditorialTask[]
  }> {
    const taskResult = await db.query<EditorialTask>(
      `SELECT * FROM editorial_tasks WHERE id = $1`,
      [taskId]
    )

    const task = taskResult.rows[0]
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    let dependencies: EditorialTask[] = []
    if (task.depends_on && task.depends_on.length > 0) {
      const depsResult = await db.query<EditorialTask>(
        `SELECT * FROM editorial_tasks WHERE id = ANY($1)`,
        [task.depends_on]
      )
      dependencies = depsResult.rows
    }

    let blockedBy: EditorialTask[] = []
    if (task.blocks && task.blocks.length > 0) {
      const blocksResult = await db.query<EditorialTask>(
        `SELECT * FROM editorial_tasks WHERE id = ANY($1)`,
        [task.blocks]
      )
      blockedBy = blocksResult.rows
    }

    return { task, dependencies, blockedBy }
  },

  /**
   * Get task statistics for a website
   */
  async getStatistics(websiteId: string): Promise<{
    total: number
    by_status: Record<TaskStatus, number>
    by_priority: Record<TaskPriority, number>
    by_type: Record<TaskType, number>
    overdue_count: number
    blocked_count: number
    avg_completion_hours?: number
  }> {
    const result = await db.query(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'backlog') AS backlog,
        COUNT(*) FILTER (WHERE status = 'ready') AS ready,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'in_review') AS in_review,
        COUNT(*) FILTER (WHERE status = 'blocked') AS blocked,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        COUNT(*) FILTER (WHERE priority = 'low') AS priority_low,
        COUNT(*) FILTER (WHERE priority = 'medium') AS priority_medium,
        COUNT(*) FILTER (WHERE priority = 'high') AS priority_high,
        COUNT(*) FILTER (WHERE priority = 'urgent') AS priority_urgent,
        COUNT(*) FILTER (WHERE task_type = 'article') AS type_article,
        COUNT(*) FILTER (WHERE task_type = 'page') AS type_page,
        COUNT(*) FILTER (WHERE task_type = 'update') AS type_update,
        COUNT(*) FILTER (WHERE task_type = 'fix') AS type_fix,
        COUNT(*) FILTER (WHERE task_type = 'optimize') AS type_optimize,
        COUNT(*) FILTER (WHERE task_type = 'research') AS type_research,
        COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('completed', 'cancelled')) AS overdue,
        COUNT(*) FILTER (WHERE status = 'blocked') AS blocked_count,
        AVG(actual_hours) FILTER (WHERE status = 'completed' AND actual_hours IS NOT NULL) AS avg_completion_hours
       FROM editorial_tasks
       WHERE website_id = $1`,
      [websiteId]
    )

    const stats = result.rows[0]

    return {
      total: parseInt(stats.total, 10),
      by_status: {
        backlog: parseInt(stats.backlog, 10),
        ready: parseInt(stats.ready, 10),
        in_progress: parseInt(stats.in_progress, 10),
        in_review: parseInt(stats.in_review, 10),
        blocked: parseInt(stats.blocked, 10),
        completed: parseInt(stats.completed, 10),
        cancelled: parseInt(stats.cancelled, 10),
      },
      by_priority: {
        low: parseInt(stats.priority_low, 10),
        medium: parseInt(stats.priority_medium, 10),
        high: parseInt(stats.priority_high, 10),
        urgent: parseInt(stats.priority_urgent, 10),
      },
      by_type: {
        article: parseInt(stats.type_article, 10),
        page: parseInt(stats.type_page, 10),
        update: parseInt(stats.type_update, 10),
        fix: parseInt(stats.type_fix, 10),
        optimize: parseInt(stats.type_optimize, 10),
        research: parseInt(stats.type_research, 10),
      },
      overdue_count: parseInt(stats.overdue, 10),
      blocked_count: parseInt(stats.blocked_count, 10),
      avg_completion_hours: stats.avg_completion_hours
        ? parseFloat(stats.avg_completion_hours)
        : undefined,
    }
  },

  /**
   * Sync task from YAML
   * Upsert operation for syncing from GitHub
   */
  async syncFromYAML(task: EditorialTask): Promise<EditorialTask> {
    const result = await db.query<EditorialTask>(
      `INSERT INTO editorial_tasks (
        id, website_id, title, description, task_type, status, priority,
        assigned_agent_id, assigned_human, due_date, estimated_hours,
        depends_on, blocks, sitemap_targets,
        seo_primary_keyword, seo_secondary_keywords, seo_target_volume, seo_estimated_difficulty,
        internal_links_required_inbound, internal_links_required_outbound,
        internal_links_min_count, internal_links_max_count,
        word_count_target, content_type, template_blueprint_id,
        tags, labels, notes, review_comments,
        github_branch, github_pr_url, github_issue_url,
        current_phase, phases_completed, metadata,
        yaml_file_path, yaml_last_synced_at, yaml_hash
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
        $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        assigned_agent_id = EXCLUDED.assigned_agent_id,
        due_date = EXCLUDED.due_date,
        sitemap_targets = EXCLUDED.sitemap_targets,
        tags = EXCLUDED.tags,
        yaml_last_synced_at = EXCLUDED.yaml_last_synced_at,
        yaml_hash = EXCLUDED.yaml_hash
      RETURNING *`,
      [
        task.id,
        task.website_id,
        task.title,
        task.description,
        task.task_type,
        task.status,
        task.priority,
        task.assigned_agent_id,
        task.assigned_human,
        task.due_date,
        task.estimated_hours,
        task.depends_on,
        task.blocks,
        task.sitemap_targets,
        task.seo_primary_keyword,
        task.seo_secondary_keywords,
        task.seo_target_volume,
        task.seo_estimated_difficulty,
        task.internal_links_required_inbound,
        task.internal_links_required_outbound,
        task.internal_links_min_count,
        task.internal_links_max_count,
        task.word_count_target,
        task.content_type,
        task.template_blueprint_id,
        task.tags,
        task.labels,
        task.notes,
        task.review_comments ? JSON.stringify(task.review_comments) : null,
        task.github_branch,
        task.github_pr_url,
        task.github_issue_url,
        task.current_phase,
        task.phases_completed,
        task.metadata ? JSON.stringify(task.metadata) : null,
        task.yaml_file_path,
        new Date().toISOString(),
        task.yaml_hash,
      ]
    )
    const syncedTask = result.rows[0]
    if (!syncedTask) {
      throw new Error(`Failed to sync task ${task.id}`)
    }
    return syncedTask
  },
}
