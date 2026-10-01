/**
 * useEditorialTasks Hook
 * React hook for managing editorial tasks with tRPC
 */

import { useState, useEffect } from 'react'
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@swarm-press/backend'
import superjson from 'superjson'

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'

// Create tRPC client for React components
const trpcClient = createTRPCProxyClient<AppRouter>({
  transformer: superjson,
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      headers() {
        return {
          authorization: 'Bearer ceo:admin@swarm.press',
        }
      },
    }),
  ],
})

export type TaskType = 'article' | 'page' | 'update' | 'fix' | 'optimize' | 'research'
export type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'blocked' | 'completed' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskPhase = 'research' | 'outline' | 'draft' | 'edit' | 'review' | 'publish' | 'optimize'

export interface EditorialTask {
  id: string
  website_id: string
  title: string
  description?: string
  task_type: TaskType
  status: TaskStatus
  priority: TaskPriority
  assigned_agent_id?: string
  assigned_human?: string
  created_at: string
  updated_at: string
  started_at?: string
  completed_at?: string
  due_date?: string
  estimated_hours?: number
  actual_hours?: number
  depends_on?: string[]
  blocks?: string[]
  sitemap_targets?: string[]
  seo_primary_keyword?: string
  seo_secondary_keywords?: string[]
  seo_target_volume?: number
  seo_estimated_difficulty?: 'easy' | 'medium' | 'hard' | 'very_hard'
  internal_links_required_inbound?: string[]
  internal_links_required_outbound?: string[]
  internal_links_min_count?: number
  internal_links_max_count?: number
  word_count_target?: number
  word_count_actual?: number
  content_type?: string
  template_blueprint_id?: string
  tags?: string[]
  labels?: string[]
  notes?: string
  review_comments?: Array<{
    author: string
    comment: string
    timestamp: string
  }>
  github_branch?: string
  github_pr_url?: string
  github_issue_url?: string
  current_phase?: TaskPhase
  phases_completed?: string[]
  phases?: Record<TaskPhase, {
    completed: boolean
    in_progress: boolean
    progress?: number
    started_at?: string
    completed_at?: string
    assigned_agent_id?: string
  }>
  metadata?: Record<string, any>
  yaml_file_path?: string
  yaml_last_synced_at?: string
  yaml_hash?: string
}

export interface TaskStats {
  total: number
  by_status: Record<TaskStatus, number>
  by_priority: Record<TaskPriority, number>
  by_type: Record<TaskType, number>
  overdue_count: number
  blocked_count: number
  avg_completion_hours?: number
}

export interface CreateTaskInput {
  title: string
  description?: string
  taskType: TaskType
  status?: TaskStatus
  priority?: TaskPriority
  assignedAgentId?: string
  assignedHuman?: string
  dueDate?: string
  estimatedHours?: number
  tags?: string[]
  seoPrimaryKeyword?: string
  seoSecondaryKeywords?: string[]
  wordCountTarget?: number
  contentType?: string
  notes?: string
  sitemapTargets?: string[]
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  assignedAgentId?: string
  assignedHuman?: string
  dueDate?: string
  estimatedHours?: number
  currentPhase?: TaskPhase
  tags?: string[]
  notes?: string
  seoPrimaryKeyword?: string
  seoSecondaryKeywords?: string[]
  wordCountTarget?: number
  contentType?: string
  sitemapTargets?: string[]
}

export function useEditorialTasks(websiteId: string) {
  const [tasks, setTasks] = useState<EditorialTask[]>([])
  const [stats, setStats] = useState<TaskStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch tasks
  const fetchTasks = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const [tasksData, statsData] = await Promise.all([
        trpcClient.editorial.getTasks.query({ websiteId }),
        trpcClient.editorial.getStatistics.query({ websiteId }),
      ])

      // Fetch phases for each task
      const tasksWithPhases = await Promise.all(
        (tasksData as EditorialTask[]).map(async (task) => {
          try {
            const phases = await trpcClient.editorial.getTaskPhases.query({ taskId: task.id })
            return { ...task, phases }
          } catch (err) {
            // If phases fetch fails, return task without phases
            console.warn(`Failed to fetch phases for task ${task.id}:`, err)
            return task
          }
        })
      )

      setTasks(tasksWithPhases)
      setStats(statsData as TaskStats)
    } catch (err) {
      console.error('Failed to fetch tasks:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks')
    } finally {
      setIsLoading(false)
    }
  }

  // Load tasks on mount
  useEffect(() => {
    fetchTasks()
  }, [websiteId])

  // Create task
  const createTask = async (input: CreateTaskInput) => {
    try {
      const id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const newTask = await trpcClient.editorial.createTask.mutate({
        id,
        websiteId,
        title: input.title,
        description: input.description,
        taskType: input.taskType,
        status: input.status,
        priority: input.priority,
        assignedAgentId: input.assignedAgentId,
        dueDate: input.dueDate,
        tags: input.tags,
        seoPrimaryKeyword: input.seoPrimaryKeyword,
        sitemapTargets: input.sitemapTargets,
        metadata: {
          assignedHuman: input.assignedHuman,
          estimatedHours: input.estimatedHours,
          seoSecondaryKeywords: input.seoSecondaryKeywords,
          wordCountTarget: input.wordCountTarget,
          contentType: input.contentType,
          notes: input.notes,
        },
      })

      // Optimistic update
      setTasks((prev) => [...prev, newTask as EditorialTask])
      await fetchTasks() // Refresh to get updated stats
      return newTask
    } catch (err) {
      console.error('Failed to create task:', err)
      throw err
    }
  }

  // Update task
  const updateTask = async (id: string, input: UpdateTaskInput) => {
    try {
      // Optimistic update
      setTasks((prev) =>
        prev.map((task) =>
          task.id === id ? { ...task, ...input, updated_at: new Date().toISOString() } : task
        )
      )

      const updatedTask = await trpcClient.editorial.updateTask.mutate({
        id,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        assignedAgentId: input.assignedAgentId,
        dueDate: input.dueDate,
        currentPhase: input.currentPhase,
        tags: input.tags,
        notes: input.notes,
        sitemapTargets: input.sitemapTargets,
      })

      // Update with server response
      setTasks((prev) =>
        prev.map((task) => (task.id === id ? (updatedTask as EditorialTask) : task))
      )
      await fetchTasks() // Refresh to get updated stats
      return updatedTask
    } catch (err) {
      console.error('Failed to update task:', err)
      await fetchTasks() // Revert optimistic update
      throw err
    }
  }

  // Update task status (for drag-and-drop)
  const updateTaskStatus = async (taskId: string, newStatus: TaskStatus) => {
    return updateTask(taskId, { status: newStatus })
  }

  // Delete task
  const deleteTask = async (id: string) => {
    try {
      // Optimistic update
      setTasks((prev) => prev.filter((task) => task.id !== id))

      await trpcClient.editorial.deleteTask.mutate({ id })
      await fetchTasks() // Refresh to get updated stats
    } catch (err) {
      console.error('Failed to delete task:', err)
      await fetchTasks() // Revert optimistic update
      throw err
    }
  }

  // Refresh tasks
  const refresh = fetchTasks

  // Create GitHub Issue from task
  const createGitHubIssue = async (taskId: string, websiteId: string) => {
    try {
      const result = await trpcClient.editorial.createGitHubIssue.mutate({
        taskId,
        websiteId,
      })
      await fetchTasks() // Refresh to get updated task with github_issue_url
      return result
    } catch (err) {
      console.error('Failed to create GitHub Issue:', err)
      throw err
    }
  }

  // Create GitHub PR from task
  const createGitHubPR = async (taskId: string, websiteId: string, branchName?: string) => {
    try {
      const result = await trpcClient.editorial.createGitHubPR.mutate({
        taskId,
        websiteId,
        branchName,
      })
      await fetchTasks() // Refresh to get updated task with github_pr_url
      return result
    } catch (err) {
      console.error('Failed to create GitHub PR:', err)
      throw err
    }
  }

  // Sync task status from GitHub PR
  const syncFromGitHubPR = async (taskId: string, websiteId: string) => {
    try {
      const result = await trpcClient.editorial.syncFromGitHubPR.mutate({
        taskId,
        websiteId,
      })
      await fetchTasks() // Refresh to get updated task status
      return result
    } catch (err) {
      console.error('Failed to sync from GitHub PR:', err)
      throw err
    }
  }

  return {
    tasks,
    stats,
    isLoading,
    error,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask,
    refresh,
    createGitHubIssue,
    createGitHubPR,
    syncFromGitHubPR,
  }
}
