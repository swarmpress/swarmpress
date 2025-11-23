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
})

/**
 * Export type for client-side type safety
 */
export type AppRouter = typeof appRouter
