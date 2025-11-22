/**
 * Express + tRPC API Server
 * Main entry point for swarm.press API
 */

import express from 'express'
import cors from 'cors'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { appRouter } from './routers'
import { createContext } from './trpc'
import { eventsRouter } from './events.router'
import { webhooksRouter } from './webhooks.router'
import { db } from '../db/connection'
import { eventBus } from '@swarm-press/event-bus'

/**
 * Create Express app with middleware
 */
export function createApp() {
  const app = express()

  // CORS configuration
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    })
  )

  // JSON body parser
  app.use(express.json())

  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      // Check database connection
      await db.query('SELECT 1')

      // Check event bus connection
      const eventBusHealthy = eventBus.isConnected()

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
          eventBus: eventBusHealthy ? 'connected' : 'disconnected',
        },
      })
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // tRPC API middleware
  app.use(
    '/api/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, type, path, input, ctx }) {
        console.error(`[API Error] ${type} ${path}:`, {
          error: error.message,
          code: error.code,
          input,
          requestId: ctx?.requestId,
        })
      },
    })
  )

  // Event stream endpoints (SSE)
  app.use('/api/events', eventsRouter)

  // GitHub webhooks
  app.use('/api/webhooks', webhooksRouter)

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      path: req.path,
    })
  })

  // Error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[Express Error]:', err)
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
    })
  })

  return app
}

/**
 * Start API server
 */
export async function startServer(port: number = 3000) {
  const app = createApp()

  // Wait for database connection
  console.log('[API] Waiting for database connection...')
  await db.query('SELECT 1')
  console.log('[API] Database connected')

  // Wait for event bus connection
  console.log('[API] Waiting for event bus connection...')
  await eventBus.connect()
  console.log('[API] Event bus connected')

  // Start listening
  const server = app.listen(port, () => {
    console.log(`[API] Server listening on http://localhost:${port}`)
    console.log(`[API] tRPC endpoint: http://localhost:${port}/api/trpc`)
    console.log(`[API] Health check: http://localhost:${port}/health`)
  })

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[API] SIGTERM received, shutting down gracefully...')
    server.close(async () => {
      console.log('[API] HTTP server closed')
      await db.end()
      console.log('[API] Database connection closed')
      process.exit(0)
    })
  })

  return server
}

/**
 * Start server if run directly
 */
if (require.main === module) {
  const port = parseInt(process.env.API_PORT || '3000', 10)
  startServer(port).catch((error) => {
    console.error('[API] Failed to start server:', error)
    process.exit(1)
  })
}
