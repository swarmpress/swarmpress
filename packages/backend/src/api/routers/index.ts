/**
 * API Router Index
 * Combines all routers into app router
 */

import { router } from '../trpc'
import { companyRouter } from './company.router'
import { departmentRouter } from './department.router'
import { roleRouter } from './role.router'
import { agentRouter } from './agent.router'
import { contentRouter } from './content.router'
import { taskRouter } from './task.router'
import { ticketRouter } from './ticket.router'
import { websiteRouter } from './website.router'

// Agentic Sitemap routers
import { sitemapRouter } from './sitemap.router'
import { blueprintRouter } from './blueprint.router'
import { contentModelRouter } from './content-model.router'
import { graphPositionRouter } from './graph-position.router'

// GitHub Integration
import { githubRouter } from './github.router'

// Agent Collaboration
import { suggestionRouter } from './suggestion.router'
import { agentActivityRouter } from './agent-activity.router'

// Analytics
import { analyticsRouter } from './analytics.router'

// Editorial Planning
import { editorialRouter } from './editorial.router'

// Prompt Management
import { promptRouter } from './prompt.router'

// Collections & Media
import { collectionRouter } from './collection.router'
import { mediaRouter } from './media.router'

// Authentication
import { authRouter } from './auth.router'

// Workflow Orchestration
import { workflowRouter } from './workflow.router'

// External Tool System
import { toolsRouter } from './tools.router'

// Content Generation
import { contentGenerationRouter } from './content-generation.router'

// Batch Processing
import { batchRouter } from './batch.router'

/**
 * Main application router
 * Combines all feature routers
 */
export const appRouter = router({
  company: companyRouter,
  department: departmentRouter,
  role: roleRouter,
  agent: agentRouter,
  content: contentRouter,
  task: taskRouter,
  ticket: ticketRouter,
  website: websiteRouter,
  // Agentic Sitemap
  sitemap: sitemapRouter,
  blueprint: blueprintRouter,
  contentModel: contentModelRouter,
  graphPosition: graphPositionRouter,
  // GitHub Integration
  github: githubRouter,
  // Agent Collaboration
  suggestion: suggestionRouter,
  agentActivity: agentActivityRouter,
  // Analytics
  analytics: analyticsRouter,
  // Editorial Planning
  editorial: editorialRouter,
  // Prompt Management
  prompt: promptRouter,
  // Collections & Media
  collection: collectionRouter,
  media: mediaRouter,
  // Authentication
  auth: authRouter,
  // Workflow Orchestration
  workflow: workflowRouter,
  // External Tool System
  tools: toolsRouter,
  // Content Generation
  contentGeneration: contentGenerationRouter,
  // Batch Processing
  batch: batchRouter,
})

/**
 * Export type for client-side type safety
 */
export type AppRouter = typeof appRouter
