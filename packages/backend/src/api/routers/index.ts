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
})

/**
 * Export type for client-side type safety
 */
export type AppRouter = typeof appRouter
