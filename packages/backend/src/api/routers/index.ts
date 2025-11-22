/**
 * API Router Index
 * Combines all routers into app router
 */

import { router } from '../trpc'
import { contentRouter } from './content.router'
import { taskRouter } from './task.router'
import { ticketRouter } from './ticket.router'
import { websiteRouter } from './website.router'

/**
 * Main application router
 * Combines all feature routers
 */
export const appRouter = router({
  content: contentRouter,
  task: taskRouter,
  ticket: ticketRouter,
  website: websiteRouter,
})

/**
 * Export type for client-side type safety
 */
export type AppRouter = typeof appRouter
