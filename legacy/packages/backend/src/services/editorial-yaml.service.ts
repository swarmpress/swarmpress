/**
 * Editorial YAML Service
 * Handles serialization/deserialization between YAML files and database
 * YAML is source of truth, PostgreSQL is runtime cache
 */

import yaml from 'js-yaml'
import type { EditorialTask } from '../db/repositories/editorial-task-repository.js'

// YAML structure mirrors editorial.yaml spec
export interface EditorialPlanYAML {
  version: string
  website: {
    id: string
    name: string
  }
  metadata?: {
    last_updated: string
    updated_by?: string
    notes?: string
  }
  tasks: TaskYAML[]
}

export interface TaskYAML {
  id: string
  title: string
  description?: string
  type: 'article' | 'page' | 'update' | 'fix' | 'optimize' | 'research'
  status: 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'blocked' | 'completed' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assignedTo?: {
    agent?: string
    human?: string
  }
  timeline?: {
    created: string
    dueDate?: string
    estimatedHours?: number
    started?: string
    completed?: string
  }
  dependencies?: {
    dependsOn?: string[]
    blocks?: string[]
  }
  sitemap?: {
    targets?: string[]
    newPages?: Array<{
      slug: string
      title: string
      blueprint?: string
    }>
  }
  seo?: {
    primaryKeyword?: string
    secondaryKeywords?: string[]
    targetVolume?: number
    difficulty?: 'easy' | 'medium' | 'hard' | 'very_hard'
  }
  internalLinks?: {
    requiredInbound?: string[]
    requiredOutbound?: string[]
    minCount?: number
    maxCount?: number
  }
  content?: {
    wordCountTarget?: number
    wordCountActual?: number
    type?: string
    templateBlueprint?: string
  }
  collaboration?: {
    tags?: string[]
    labels?: string[]
    notes?: string
    reviewComments?: Array<{
      author: string
      comment: string
      timestamp: string
    }>
  }
  github?: {
    branch?: string
    prUrl?: string
    issueUrl?: string
  }
  phases?: {
    current?: string
    completed?: string[]
  }
}

export const editorialYAMLService = {
  /**
   * Parse YAML string to EditorialPlanYAML
   */
  parseYAML(yamlContent: string): EditorialPlanYAML {
    try {
      const parsed = yaml.load(yamlContent) as EditorialPlanYAML

      if (!parsed.version) {
        throw new Error('Missing version field in editorial.yaml')
      }

      if (!parsed.website?.id) {
        throw new Error('Missing website.id in editorial.yaml')
      }

      if (!Array.isArray(parsed.tasks)) {
        throw new Error('Missing or invalid tasks array in editorial.yaml')
      }

      return parsed
    } catch (error) {
      throw new Error(`Failed to parse editorial YAML: ${error}`)
    }
  },

  /**
   * Convert EditorialPlanYAML to database tasks
   */
  yamlToTasks(plan: EditorialPlanYAML): EditorialTask[] {
    return plan.tasks.map((taskYAML) => this.yamlTaskToDBTask(taskYAML, plan.website.id))
  },

  /**
   * Convert single YAML task to database task
   */
  yamlTaskToDBTask(taskYAML: TaskYAML, websiteId: string): EditorialTask {
    return {
      id: taskYAML.id,
      website_id: websiteId,
      title: taskYAML.title,
      description: taskYAML.description,
      task_type: taskYAML.type,
      status: taskYAML.status,
      priority: taskYAML.priority,
      assigned_agent_id: taskYAML.assignedTo?.agent,
      assigned_human: taskYAML.assignedTo?.human,
      created_at: taskYAML.timeline?.created || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: taskYAML.timeline?.started,
      completed_at: taskYAML.timeline?.completed,
      due_date: taskYAML.timeline?.dueDate,
      estimated_hours: taskYAML.timeline?.estimatedHours,
      depends_on: taskYAML.dependencies?.dependsOn,
      blocks: taskYAML.dependencies?.blocks,
      sitemap_targets: taskYAML.sitemap?.targets,
      seo_primary_keyword: taskYAML.seo?.primaryKeyword,
      seo_secondary_keywords: taskYAML.seo?.secondaryKeywords,
      seo_target_volume: taskYAML.seo?.targetVolume,
      seo_estimated_difficulty: taskYAML.seo?.difficulty,
      internal_links_required_inbound: taskYAML.internalLinks?.requiredInbound,
      internal_links_required_outbound: taskYAML.internalLinks?.requiredOutbound,
      internal_links_min_count: taskYAML.internalLinks?.minCount,
      internal_links_max_count: taskYAML.internalLinks?.maxCount,
      word_count_target: taskYAML.content?.wordCountTarget,
      word_count_actual: taskYAML.content?.wordCountActual,
      content_type: taskYAML.content?.type,
      template_blueprint_id: taskYAML.content?.templateBlueprint,
      tags: taskYAML.collaboration?.tags,
      labels: taskYAML.collaboration?.labels,
      notes: taskYAML.collaboration?.notes,
      review_comments: taskYAML.collaboration?.reviewComments,
      github_branch: taskYAML.github?.branch,
      github_pr_url: taskYAML.github?.prUrl,
      github_issue_url: taskYAML.github?.issueUrl,
      current_phase: taskYAML.phases?.current as any,
      phases_completed: taskYAML.phases?.completed,
      yaml_file_path: 'editorial.yaml',
    }
  },

  /**
   * Convert database tasks to EditorialPlanYAML
   */
  tasksToYAML(tasks: EditorialTask[], websiteId: string, websiteName: string): EditorialPlanYAML {
    return {
      version: '1.0',
      website: {
        id: websiteId,
        name: websiteName,
      },
      metadata: {
        last_updated: new Date().toISOString(),
        notes: 'Auto-generated from swarm.press database',
      },
      tasks: tasks.map((task) => this.dbTaskToYAMLTask(task)),
    }
  },

  /**
   * Convert single database task to YAML task
   */
  dbTaskToYAMLTask(task: EditorialTask): TaskYAML {
    const yamlTask: TaskYAML = {
      id: task.id,
      title: task.title,
      type: task.task_type,
      status: task.status,
      priority: task.priority,
    }

    if (task.description) {
      yamlTask.description = task.description
    }

    if (task.assigned_agent_id || task.assigned_human) {
      yamlTask.assignedTo = {
        agent: task.assigned_agent_id,
        human: task.assigned_human,
      }
    }

    if (task.created_at || task.due_date || task.estimated_hours || task.started_at || task.completed_at) {
      yamlTask.timeline = {
        created: task.created_at,
        dueDate: task.due_date,
        estimatedHours: task.estimated_hours,
        started: task.started_at,
        completed: task.completed_at,
      }
    }

    if (task.depends_on || task.blocks) {
      yamlTask.dependencies = {
        dependsOn: task.depends_on,
        blocks: task.blocks,
      }
    }

    if (task.sitemap_targets) {
      yamlTask.sitemap = {
        targets: task.sitemap_targets,
      }
    }

    if (task.seo_primary_keyword || task.seo_secondary_keywords || task.seo_target_volume || task.seo_estimated_difficulty) {
      yamlTask.seo = {
        primaryKeyword: task.seo_primary_keyword,
        secondaryKeywords: task.seo_secondary_keywords,
        targetVolume: task.seo_target_volume,
        difficulty: task.seo_estimated_difficulty,
      }
    }

    if (task.internal_links_required_inbound || task.internal_links_required_outbound || task.internal_links_min_count || task.internal_links_max_count) {
      yamlTask.internalLinks = {
        requiredInbound: task.internal_links_required_inbound,
        requiredOutbound: task.internal_links_required_outbound,
        minCount: task.internal_links_min_count,
        maxCount: task.internal_links_max_count,
      }
    }

    if (task.word_count_target || task.word_count_actual || task.content_type || task.template_blueprint_id) {
      yamlTask.content = {
        wordCountTarget: task.word_count_target,
        wordCountActual: task.word_count_actual,
        type: task.content_type,
        templateBlueprint: task.template_blueprint_id,
      }
    }

    if (task.tags || task.labels || task.notes || task.review_comments) {
      yamlTask.collaboration = {
        tags: task.tags,
        labels: task.labels,
        notes: task.notes,
        reviewComments: task.review_comments,
      }
    }

    if (task.github_branch || task.github_pr_url || task.github_issue_url) {
      yamlTask.github = {
        branch: task.github_branch,
        prUrl: task.github_pr_url,
        issueUrl: task.github_issue_url,
      }
    }

    if (task.current_phase || task.phases_completed) {
      yamlTask.phases = {
        current: task.current_phase,
        completed: task.phases_completed,
      }
    }

    return yamlTask
  },

  /**
   * Serialize EditorialPlanYAML to YAML string
   */
  serializeYAML(plan: EditorialPlanYAML): string {
    return yaml.dump(plan, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    })
  },

  /**
   * Full round-trip: tasks → YAML string
   */
  tasksToYAMLString(tasks: EditorialTask[], websiteId: string, websiteName: string): string {
    const plan = this.tasksToYAML(tasks, websiteId, websiteName)
    return this.serializeYAML(plan)
  },

  /**
   * Full round-trip: YAML string → tasks
   */
  yamlStringToTasks(yamlContent: string): {
    websiteId: string
    websiteName: string
    tasks: EditorialTask[]
  } {
    const plan = this.parseYAML(yamlContent)
    const tasks = this.yamlToTasks(plan)

    return {
      websiteId: plan.website.id,
      websiteName: plan.website.name,
      tasks,
    }
  },

  /**
   * Validate YAML structure
   */
  validateYAML(yamlContent: string): {
    valid: boolean
    errors: string[]
  } {
    const errors: string[] = []

    try {
      const plan = this.parseYAML(yamlContent)

      // Validate version
      if (plan.version !== '1.0') {
        errors.push(`Unsupported version: ${plan.version}. Expected 1.0`)
      }

      // Validate tasks
      plan.tasks.forEach((task, index) => {
        if (!task.id) {
          errors.push(`Task at index ${index} missing id`)
        }

        if (!task.title) {
          errors.push(`Task ${task.id || index} missing title`)
        }

        const validTypes = ['article', 'page', 'update', 'fix', 'optimize', 'research']
        if (!validTypes.includes(task.type)) {
          errors.push(`Task ${task.id} has invalid type: ${task.type}`)
        }

        const validStatuses = ['backlog', 'ready', 'in_progress', 'in_review', 'blocked', 'completed', 'cancelled']
        if (!validStatuses.includes(task.status)) {
          errors.push(`Task ${task.id} has invalid status: ${task.status}`)
        }

        const validPriorities = ['low', 'medium', 'high', 'urgent']
        if (!validPriorities.includes(task.priority)) {
          errors.push(`Task ${task.id} has invalid priority: ${task.priority}`)
        }

        // Validate dependencies exist
        if (task.dependencies?.dependsOn) {
          task.dependencies.dependsOn.forEach((depId) => {
            const exists = plan.tasks.some((t) => t.id === depId)
            if (!exists) {
              errors.push(`Task ${task.id} depends on non-existent task: ${depId}`)
            }
          })
        }
      })

      return { valid: errors.length === 0, errors }
    } catch (error) {
      return {
        valid: false,
        errors: [`Parse error: ${error}`],
      }
    }
  },

  /**
   * Generate sample editorial.yaml for documentation
   */
  generateSampleYAML(websiteId: string, websiteName: string): string {
    const samplePlan: EditorialPlanYAML = {
      version: '1.0',
      website: {
        id: websiteId,
        name: websiteName,
      },
      metadata: {
        last_updated: new Date().toISOString(),
        notes: 'Sample editorial plan',
      },
      tasks: [
        {
          id: 'task-001',
          title: 'Write comprehensive guide to React hooks',
          description: 'Create in-depth tutorial covering useState, useEffect, useContext, and custom hooks',
          type: 'article',
          status: 'in_progress',
          priority: 'high',
          assignedTo: {
            agent: 'writer-01',
          },
          timeline: {
            created: new Date().toISOString(),
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            estimatedHours: 8,
          },
          sitemap: {
            targets: ['page-hooks-guide'],
          },
          seo: {
            primaryKeyword: 'react hooks tutorial',
            secondaryKeywords: ['useState', 'useEffect', 'custom hooks'],
            targetVolume: 12000,
            difficulty: 'medium',
          },
          internalLinks: {
            requiredOutbound: ['/react-fundamentals', '/component-lifecycle'],
            minCount: 3,
            maxCount: 8,
          },
          content: {
            wordCountTarget: 3500,
            type: 'tutorial',
            templateBlueprint: 'blueprint-tutorial',
          },
          collaboration: {
            tags: ['react', 'tutorial', 'hooks'],
            labels: ['high-priority'],
          },
          phases: {
            current: 'draft',
            completed: ['research', 'outline'],
          },
        },
        {
          id: 'task-002',
          title: 'Update SEO metadata for landing page',
          description: 'Refresh meta descriptions and add structured data',
          type: 'optimize',
          status: 'backlog',
          priority: 'medium',
          timeline: {
            created: new Date().toISOString(),
            estimatedHours: 2,
          },
          sitemap: {
            targets: ['page-home'],
          },
          seo: {
            primaryKeyword: 'react development platform',
          },
        },
      ],
    }

    return this.serializeYAML(samplePlan)
  },
}
