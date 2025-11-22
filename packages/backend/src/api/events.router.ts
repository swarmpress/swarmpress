/**
 * Event Stream Router
 * Server-Sent Events (SSE) for real-time dashboard updates
 */

import { Router, Request, Response } from 'express'
import { events } from '@swarm-press/event-bus'

const router = Router()

/**
 * SSE endpoint for real-time event stream
 *
 * Usage:
 *   GET /api/events/stream?token=ceo:user@example.com
 *
 * Returns CloudEvents as they occur in the system
 */
router.get('/stream', async (req: Request, res: Response) => {
  // Simple auth check
  const token = req.query.token as string
  if (!token || !token.startsWith('ceo:')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  console.log(`[EventStream] Client connected: ${token}`)

  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`)

  // Event types to subscribe to
  const eventTypes = [
    'content.created',
    'content.submittedForReview',
    'content.needsChanges',
    'content.approved',
    'content.scheduled',
    'content.published',
    'task.created',
    'task.completed',
    'ticket.created',
    'ticket.answered',
    'deploy.success',
    'deploy.failed',
  ]

  // Subscribe to all event types
  const subscriptions: Array<() => void> = []

  for (const eventType of eventTypes) {
    const unsubscribe = await events.subscribe(eventType, async (event) => {
      try {
        // Send CloudEvent to client
        const data = JSON.stringify({
          type: event.type,
          time: event.time,
          data: event.data,
        })
        res.write(`data: ${data}\n\n`)
      } catch (error) {
        console.error('[EventStream] Error sending event:', error)
      }
    })

    subscriptions.push(unsubscribe)
  }

  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`)
  }, 30000)

  // Cleanup on client disconnect
  req.on('close', () => {
    console.log(`[EventStream] Client disconnected: ${token}`)
    clearInterval(heartbeat)

    // Unsubscribe from all events
    for (const unsubscribe of subscriptions) {
      unsubscribe()
    }
  })
})

/**
 * Get recent events (last N events)
 */
router.get('/recent', async (req: Request, res: Response) => {
  // Simple auth check
  const token = req.query.token as string
  if (!token || !token.startsWith('ceo:')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const limit = parseInt(req.query.limit as string) || 50

  try {
    // This would require storing recent events in memory or database
    // For MVP, return empty array - can be enhanced later
    res.json({
      events: [],
      limit,
      message: 'Recent events feature not yet implemented - use /stream for real-time events',
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export const eventsRouter = router
