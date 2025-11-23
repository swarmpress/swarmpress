/**
 * Editorial tRPC Router
 * API endpoints for editorial planning system
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc.js'
import { editorialTaskRepository } from '../../db/repositories/editorial-task-repository.js'
import { editorialYAMLService } from '../../services/editorial-yaml.service.js'

const taskTypeSchema = z.enum(['article', 'page', 'update', 'fix', 'optimize', 'research'])
const taskStatusSchema = z.enum(['backlog', 'ready', 'in_progress', 'in_review', 'blocked', 'completed', 'cancelled'])
const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
const taskPhaseSchema = z.enum(['research', 'outline', 'draft', 'edit', 'review', 'publish', 'optimize'])

export const editorialRouter = router({
  /**
   * Get all tasks for a website
   */
  getTasks: publicProcedure
    .input(z.object({
      websiteId: z.string(),
    }))
    .query(async ({ input }) => {
      return editorialTaskRepository.findByWebsite(input.websiteId)
    }),

  /**
   * Get tasks with filters
   */
  getFilteredTasks: publicProcedure
    .input(z.object({
      websiteId: z.string(),
      status: z.union([taskStatusSchema, z.array(taskStatusSchema)]).optional(),
      priority: z.union([taskPrioritySchema, z.array(taskPrioritySchema)]).optional(),
      assignedAgentId: z.string().optional(),
      currentPhase: taskPhaseSchema.optional(),
      tags: z.array(z.string()).optional(),
      overdue: z.boolean().optional(),
      hasBlockers: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      return editorialTaskRepository.findWithFilters({
        website_id: input.websiteId,
        status: input.status,
        priority: input.priority,
        assigned_agent_id: input.assignedAgentId,
        current_phase: input.currentPhase,
        tags: input.tags,
        overdue: input.overdue,
        has_blockers: input.hasBlockers,
      })
    }),

  /**
   * Get single task by ID
   */
  getTask: publicProcedure
    .input(z.object({
      id: z.string(),
    }))
    .query(async ({ input }) => {
      const task = await editorialTaskRepository.findById(input.id)
      if (!task) {
        throw new Error(`Task ${input.id} not found`)
      }
      return task
    }),

  /**
   * Get task with phases
   */
  getTaskWithPhases: publicProcedure
    .input(z.object({
      id: z.string(),
    }))
    .query(async ({ input }) => {
      const task = await editorialTaskRepository.findByIdWithPhases(input.id)
      if (!task) {
        throw new Error(`Task ${input.id} not found`)
      }
      return task
    }),

  /**
   * Get task with dependencies
   */
  getTaskWithDependencies: publicProcedure
    .input(z.object({
      id: z.string(),
    }))
    .query(async ({ input }) => {
      return editorialTaskRepository.findWithDependencies(input.id)
    }),

  /**
   * Create new task
   */
  createTask: publicProcedure
    .input(z.object({
      id: z.string(),
      websiteId: z.string(),
      title: z.string().min(1),
      description: z.string().optional(),
      taskType: taskTypeSchema,
      status: taskStatusSchema.optional(),
      priority: taskPrioritySchema.optional(),
      assignedAgentId: z.string().optional(),
      dueDate: z.string().optional(),
      sitemapTargets: z.array(z.string()).optional(),
      seoPrimaryKeyword: z.string().optional(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.any()).optional(),
    }))
    .mutation(async ({ input }) => {
      return editorialTaskRepository.create({
        id: input.id,
        website_id: input.websiteId,
        title: input.title,
        description: input.description,
        task_type: input.taskType,
        status: input.status,
        priority: input.priority,
        assigned_agent_id: input.assignedAgentId,
        due_date: input.dueDate,
        sitemap_targets: input.sitemapTargets,
        seo_primary_keyword: input.seoPrimaryKeyword,
        tags: input.tags,
        metadata: input.metadata,
      })
    }),

  /**
   * Update task
   */
  updateTask: publicProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: taskStatusSchema.optional(),
      priority: taskPrioritySchema.optional(),
      assignedAgentId: z.string().optional(),
      dueDate: z.string().optional(),
      currentPhase: taskPhaseSchema.optional(),
      sitemapTargets: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...updateData } = input
      return editorialTaskRepository.update(id, {
        title: updateData.title,
        description: updateData.description,
        status: updateData.status,
        priority: updateData.priority,
        assigned_agent_id: updateData.assignedAgentId,
        due_date: updateData.dueDate,
        current_phase: updateData.currentPhase,
        sitemap_targets: updateData.sitemapTargets,
        tags: updateData.tags,
        notes: updateData.notes,
      })
    }),

  /**
   * Delete task
   */
  deleteTask: publicProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ input }) => {
      await editorialTaskRepository.delete(input.id)
      return { success: true }
    }),

  /**
   * Get tasks by sitemap page
   */
  getTasksBySitemapPage: publicProcedure
    .input(z.object({
      pageId: z.string(),
    }))
    .query(async ({ input }) => {
      return editorialTaskRepository.findBySitemapPage(input.pageId)
    }),

  /**
   * Get task statistics
   */
  getStatistics: publicProcedure
    .input(z.object({
      websiteId: z.string(),
    }))
    .query(async ({ input }) => {
      return editorialTaskRepository.getStatistics(input.websiteId)
    }),

  /**
   * Export tasks to YAML
   */
  exportToYAML: publicProcedure
    .input(z.object({
      websiteId: z.string(),
      websiteName: z.string(),
    }))
    .query(async ({ input }) => {
      const tasks = await editorialTaskRepository.findByWebsite(input.websiteId)
      const yamlContent = editorialYAMLService.tasksToYAMLString(
        tasks,
        input.websiteId,
        input.websiteName
      )
      return { yaml: yamlContent, taskCount: tasks.length }
    }),

  /**
   * Import tasks from YAML
   */
  importFromYAML: publicProcedure
    .input(z.object({
      yamlContent: z.string(),
    }))
    .mutation(async ({ input }) => {
      // Validate YAML first
      const validation = editorialYAMLService.validateYAML(input.yamlContent)
      if (!validation.valid) {
        throw new Error(`Invalid YAML: ${validation.errors.join(', ')}`)
      }

      // Parse and sync
      const { websiteId, websiteName, tasks } = editorialYAMLService.yamlStringToTasks(input.yamlContent)

      const synced = []
      for (const task of tasks) {
        const syncedTask = await editorialTaskRepository.syncFromYAML(task)
        synced.push(syncedTask)
      }

      return {
        success: true,
        websiteId,
        websiteName,
        taskCount: synced.length,
        tasks: synced,
      }
    }),

  /**
   * Validate YAML content
   */
  validateYAML: publicProcedure
    .input(z.object({
      yamlContent: z.string(),
    }))
    .query(async ({ input }) => {
      return editorialYAMLService.validateYAML(input.yamlContent)
    }),

  /**
   * Generate sample YAML
   */
  generateSampleYAML: publicProcedure
    .input(z.object({
      websiteId: z.string(),
      websiteName: z.string(),
    }))
    .query(async ({ input }) => {
      const yaml = editorialYAMLService.generateSampleYAML(input.websiteId, input.websiteName)
      return { yaml }
    }),

  /**
   * Bulk update task statuses (for Kanban drag-and-drop)
   */
  bulkUpdateStatus: publicProcedure
    .input(z.object({
      updates: z.array(z.object({
        id: z.string(),
        status: taskStatusSchema,
      })),
    }))
    .mutation(async ({ input }) => {
      const updated = []
      for (const update of input.updates) {
        const task = await editorialTaskRepository.update(update.id, {
          status: update.status,
        })
        updated.push(task)
      }
      return { success: true, count: updated.length, tasks: updated }
    }),

  /**
   * Bulk update task priorities
   */
  bulkUpdatePriority: publicProcedure
    .input(z.object({
      updates: z.array(z.object({
        id: z.string(),
        priority: taskPrioritySchema,
      })),
    }))
    .mutation(async ({ input }) => {
      const updated = []
      for (const update of input.updates) {
        const task = await editorialTaskRepository.update(update.id, {
          priority: update.priority,
        })
        updated.push(task)
      }
      return { success: true, count: updated.length, tasks: updated }
    }),

  /**
   * Reassign tasks
   */
  reassignTasks: publicProcedure
    .input(z.object({
      taskIds: z.array(z.string()),
      agentId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const updated = []
      for (const taskId of input.taskIds) {
        const task = await editorialTaskRepository.update(taskId, {
          assigned_agent_id: input.agentId,
        })
        updated.push(task)
      }
      return { success: true, count: updated.length, tasks: updated }
    }),

  /**
   * Create GitHub Issue from task
   */
  createGitHubIssue: publicProcedure
    .input(z.object({
      taskId: z.string(),
      websiteId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const task = await editorialTaskRepository.findById(input.taskId)
      if (!task) {
        throw new Error(`Task ${input.taskId} not found`)
      }

      const { websiteRepository } = await import('../../db/repositories/index.js')
      const website = await websiteRepository.findById(input.websiteId)

      if (!website?.github_repo_url) {
        throw new Error('Website does not have GitHub repository configured')
      }

      const { parseGitHubUrl } = await import('../../services/github.service.js')
      const { GitHubService } = await import('../../services/github.service.js')

      const parsed = parseGitHubUrl(website.github_repo_url)
      if (!parsed) {
        throw new Error('Invalid GitHub repository URL')
      }

      const token = process.env.GITHUB_TOKEN
      if (!token) {
        throw new Error('GitHub token not configured')
      }

      const github = new GitHubService({
        owner: parsed.owner,
        repo: parsed.repo,
        token,
      })

      // Build issue body
      const bodyParts = []
      if (task.description) {
        bodyParts.push(task.description)
        bodyParts.push('')
      }

      bodyParts.push('## Task Details')
      bodyParts.push(`- **Type**: ${task.task_type}`)
      bodyParts.push(`- **Priority**: ${task.priority}`)
      if (task.assigned_agent_id) {
        bodyParts.push(`- **Assigned Agent**: ${task.assigned_agent_id}`)
      }
      if (task.due_date) {
        bodyParts.push(`- **Due Date**: ${task.due_date}`)
      }
      if (task.estimated_hours) {
        bodyParts.push(`- **Estimated Hours**: ${task.estimated_hours}`)
      }

      if (task.seo_primary_keyword) {
        bodyParts.push('')
        bodyParts.push('## SEO')
        bodyParts.push(`- **Primary Keyword**: ${task.seo_primary_keyword}`)
        if (task.seo_secondary_keywords && task.seo_secondary_keywords.length > 0) {
          bodyParts.push(`- **Secondary Keywords**: ${task.seo_secondary_keywords.join(', ')}`)
        }
      }

      if (task.word_count_target) {
        bodyParts.push('')
        bodyParts.push('## Content Requirements')
        bodyParts.push(`- **Target Word Count**: ${task.word_count_target}`)
        if (task.content_type) {
          bodyParts.push(`- **Content Type**: ${task.content_type}`)
        }
      }

      bodyParts.push('')
      bodyParts.push(`---`)
      bodyParts.push(`*Created from swarm.press Editorial System*`)
      bodyParts.push(`Task ID: ${task.id}`)

      const labels = ['editorial', `type:${task.task_type}`, `priority:${task.priority}`]
      if (task.tags) {
        labels.push(...task.tags)
      }

      const issue = await github.createIssue({
        title: task.title,
        body: bodyParts.join('\n'),
        labels,
      })

      // Update task with GitHub issue URL
      await editorialTaskRepository.update(task.id, {
        github_issue_url: issue.url,
      })

      return {
        success: true,
        issueNumber: issue.number,
        issueUrl: issue.url,
      }
    }),

  /**
   * Create GitHub PR from task
   */
  createGitHubPR: publicProcedure
    .input(z.object({
      taskId: z.string(),
      websiteId: z.string(),
      branchName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const task = await editorialTaskRepository.findById(input.taskId)
      if (!task) {
        throw new Error(`Task ${input.taskId} not found`)
      }

      const { websiteRepository } = await import('../../db/repositories/index.js')
      const website = await websiteRepository.findById(input.websiteId)

      if (!website?.github_repo_url) {
        throw new Error('Website does not have GitHub repository configured')
      }

      const { parseGitHubUrl } = await import('../../services/github.service.js')
      const { GitHubService } = await import('../../services/github.service.js')

      const parsed = parseGitHubUrl(website.github_repo_url)
      if (!parsed) {
        throw new Error('Invalid GitHub repository URL')
      }

      const token = process.env.GITHUB_TOKEN
      if (!token) {
        throw new Error('GitHub token not configured')
      }

      const github = new GitHubService({
        owner: parsed.owner,
        repo: parsed.repo,
        token,
      })

      // Get repository info for default branch
      const repoInfo = await github.getRepositoryInfo()

      // Generate branch name
      const branchName = input.branchName || `editorial/${task.task_type}/${task.id}`

      // Create branch if it doesn't exist
      const exists = await github.branchExists(branchName)
      if (!exists) {
        await github.createBranch(branchName, repoInfo.defaultBranch)
      }

      // Build PR body
      const bodyParts = []
      if (task.description) {
        bodyParts.push(task.description)
        bodyParts.push('')
      }

      bodyParts.push('## Task Details')
      bodyParts.push(`- **Type**: ${task.task_type}`)
      bodyParts.push(`- **Status**: ${task.status}`)
      bodyParts.push(`- **Priority**: ${task.priority}`)

      if (task.current_phase) {
        bodyParts.push(`- **Current Phase**: ${task.current_phase}`)
      }
      if (task.phases_completed && task.phases_completed.length > 0) {
        bodyParts.push(`- **Completed Phases**: ${task.phases_completed.join(', ')}`)
      }

      bodyParts.push('')
      bodyParts.push('## Checklist')
      bodyParts.push('- [ ] Content written')
      bodyParts.push('- [ ] SEO optimized')
      bodyParts.push('- [ ] Links verified')
      bodyParts.push('- [ ] Images added')
      bodyParts.push('- [ ] Editorial review completed')

      bodyParts.push('')
      bodyParts.push(`---`)
      bodyParts.push(`*Created from swarm.press Editorial System*`)
      bodyParts.push(`Task ID: ${task.id}`)

      const pr = await github.createPullRequest({
        title: `[Editorial] ${task.title}`,
        body: bodyParts.join('\n'),
        head: branchName,
        base: repoInfo.defaultBranch,
      })

      // Update task with GitHub PR URL and branch
      await editorialTaskRepository.update(task.id, {
        github_pr_url: pr.url,
        github_branch: branchName,
      })

      return {
        success: true,
        prNumber: pr.number,
        prUrl: pr.url,
        branch: branchName,
      }
    }),

  /**
   * Sync task status from GitHub PR
   */
  syncFromGitHubPR: publicProcedure
    .input(z.object({
      taskId: z.string(),
      websiteId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const task = await editorialTaskRepository.findById(input.taskId)
      if (!task || !task.github_pr_url) {
        throw new Error('Task does not have a GitHub PR')
      }

      const { websiteRepository } = await import('../../db/repositories/index.js')
      const website = await websiteRepository.findById(input.websiteId)

      if (!website?.github_repo_url) {
        throw new Error('Website does not have GitHub repository configured')
      }

      const { parseGitHubUrl } = await import('../../services/github.service.js')
      const { GitHubService } = await import('../../services/github.service.js')

      const parsed = parseGitHubUrl(website.github_repo_url)
      if (!parsed) {
        throw new Error('Invalid GitHub repository URL')
      }

      const token = process.env.GITHUB_TOKEN
      if (!token) {
        throw new Error('GitHub token not configured')
      }

      const github = new GitHubService({
        owner: parsed.owner,
        repo: parsed.repo,
        token,
      })

      // Extract PR number from URL
      const prMatch = task.github_pr_url!.match(/\/pull\/(\d+)/)
      if (!prMatch || !prMatch[1]) {
        throw new Error('Invalid GitHub PR URL')
      }
      const prNumber = parseInt(prMatch[1]!, 10)

      const pr = await github.getPullRequest(prNumber)

      // Update task status based on PR state
      let newStatus: any = task.status
      if (pr.merged) {
        newStatus = 'completed'
      } else if (pr.state === 'closed') {
        newStatus = 'cancelled'
      } else if (pr.state === 'open') {
        // Keep existing status if PR is still open
        newStatus = task.status === 'backlog' ? 'in_progress' : task.status
      }

      if (newStatus !== task.status) {
        await editorialTaskRepository.update(task.id, {
          status: newStatus,
        })
      }

      return {
        success: true,
        prState: pr.state,
        prMerged: pr.merged || false,
        taskStatus: newStatus,
        updated: newStatus !== task.status,
      }
    }),
})
