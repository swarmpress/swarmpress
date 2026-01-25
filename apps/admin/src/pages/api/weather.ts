/**
 * Weather API Routes
 * Provides weather data for Cinque Terre
 */

import type { APIRoute } from 'astro'
import { trpc } from '../../lib/trpc'

// Helper to create JSON response
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Helper to create error response
function errorResponse(message: string, status = 500) {
  return jsonResponse({ message }, status)
}

/**
 * GET /api/weather - Get current weather data
 * Query params:
 *   - type: 'current' | 'forecast' | 'display' | 'full' | 'cache-status' (default: 'current')
 */
export const GET: APIRoute = async ({ url }) => {
  const type = url.searchParams.get('type') || 'current'

  try {
    switch (type) {
      case 'current': {
        const result = await trpc.weather.current.query()
        return jsonResponse(result)
      }
      case 'forecast': {
        const result = await trpc.weather.forecast.query()
        return jsonResponse(result)
      }
      case 'display': {
        const result = await trpc.weather.display.query()
        return jsonResponse(result)
      }
      case 'full': {
        const result = await trpc.weather.full.query()
        return jsonResponse(result)
      }
      case 'cache-status': {
        const result = await trpc.weather.cacheStatus.query()
        return jsonResponse(result)
      }
      default:
        return errorResponse(`Unknown type: ${type}. Available: current, forecast, display, full, cache-status`, 400)
    }
  } catch (error) {
    console.error('[API] Weather error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to get weather data')
  }
}

/**
 * POST /api/weather - Force refresh weather data
 * Clears cache and fetches fresh data
 */
export const POST: APIRoute = async () => {
  try {
    const result = await trpc.weather.refresh.mutate()
    return jsonResponse(result)
  } catch (error) {
    console.error('[API] Weather refresh error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to refresh weather data')
  }
}
