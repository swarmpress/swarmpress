/**
 * Content Calendar API Routes
 * Provides seasonal content planning data
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

// Seasonal content topics for Cinque Terre
// This would typically come from a database or content configuration
const SEASONAL_TOPICS = {
  spring: [
    { id: 'spring-wildflowers', title: 'Spring Wildflowers on the Hiking Trails', priority: 'high', category: 'nature' },
    { id: 'spring-festivals', title: 'Easter & Spring Festivals Guide', priority: 'high', category: 'events' },
    { id: 'spring-fishing', title: 'Traditional Spring Fishing Season', priority: 'medium', category: 'culture' },
    { id: 'spring-weather', title: 'Spring Weather Guide & What to Pack', priority: 'medium', category: 'travel' },
    { id: 'spring-crowds', title: 'Visiting Before Peak Season', priority: 'high', category: 'travel' },
  ],
  summer: [
    { id: 'summer-beaches', title: 'Best Beaches & Swimming Spots', priority: 'critical', category: 'beaches' },
    { id: 'summer-heat', title: 'Surviving the Summer Heat', priority: 'high', category: 'travel' },
    { id: 'summer-crowds', title: 'Navigating Peak Season Crowds', priority: 'critical', category: 'travel' },
    { id: 'summer-nightlife', title: 'Summer Nightlife & Evening Activities', priority: 'medium', category: 'entertainment' },
    { id: 'summer-ferries', title: 'Ferry Services & Day Trips', priority: 'high', category: 'transport' },
    { id: 'summer-gelato', title: 'Best Gelato Spots in Each Village', priority: 'medium', category: 'food' },
  ],
  fall: [
    { id: 'fall-harvest', title: 'Grape Harvest & Wine Season', priority: 'critical', category: 'food' },
    { id: 'fall-hiking', title: 'Perfect Fall Hiking Weather', priority: 'high', category: 'nature' },
    { id: 'fall-crowds', title: 'Enjoying Quieter Villages', priority: 'high', category: 'travel' },
    { id: 'fall-mushrooms', title: 'Mushroom Foraging Season', priority: 'medium', category: 'food' },
    { id: 'fall-photography', title: 'Fall Colors Photography Guide', priority: 'medium', category: 'nature' },
  ],
  winter: [
    { id: 'winter-christmas', title: 'Christmas Markets & Traditions', priority: 'high', category: 'events' },
    { id: 'winter-local-life', title: 'Experience Authentic Local Life', priority: 'high', category: 'culture' },
    { id: 'winter-restaurants', title: 'Cozy Winter Restaurants', priority: 'medium', category: 'food' },
    { id: 'winter-trails', title: 'Winter Trail Conditions', priority: 'high', category: 'nature' },
    { id: 'winter-deals', title: 'Off-Season Accommodation Deals', priority: 'medium', category: 'travel' },
  ],
}

type Season = keyof typeof SEASONAL_TOPICS

/**
 * GET /api/content-calendar - Get content calendar with season info
 * Query params:
 *   - season: 'spring' | 'summer' | 'fall' | 'winter' | 'current' | 'all' (default: 'current')
 *   - priority: 'all' | 'high' | 'critical' (default: 'all')
 */
export const GET: APIRoute = async ({ url }) => {
  const seasonParam = url.searchParams.get('season') || 'current'
  const priorityFilter = url.searchParams.get('priority') || 'all'

  try {
    // Get current season info from backend
    const seasonInfo = await trpc.workflow.getSeasonInfo.query()

    let topics: Array<{
      id: string
      title: string
      priority: string
      category: string
      season: string
    }> = []

    if (seasonParam === 'all') {
      // Return all seasons
      for (const [season, seasonTopics] of Object.entries(SEASONAL_TOPICS)) {
        topics.push(...seasonTopics.map(t => ({ ...t, season })))
      }
    } else {
      // Get specific season or current
      const targetSeason = seasonParam === 'current' ? seasonInfo.currentSeason : seasonParam
      const seasonTopics = SEASONAL_TOPICS[targetSeason as Season] || []
      topics = seasonTopics.map(t => ({ ...t, season: targetSeason }))
    }

    // Apply priority filter
    if (priorityFilter !== 'all') {
      if (priorityFilter === 'high') {
        topics = topics.filter(t => t.priority === 'high' || t.priority === 'critical')
      } else if (priorityFilter === 'critical') {
        topics = topics.filter(t => t.priority === 'critical')
      }
    }

    return jsonResponse({
      seasonInfo,
      topics,
      totalTopics: topics.length,
      filters: {
        season: seasonParam,
        priority: priorityFilter,
      },
    })
  } catch (error) {
    console.error('[API] Content calendar error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to get content calendar')
  }
}

/**
 * POST /api/content-calendar - Trigger content generation for specific topic
 * Body:
 *   - websiteId: string (required)
 *   - topicId: string (required)
 *   - dryRun: boolean (optional, default: false)
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { websiteId, topicId, dryRun } = body as {
      websiteId?: string
      topicId?: string
      dryRun?: boolean
    }

    if (!websiteId) {
      return errorResponse('websiteId is required', 400)
    }

    if (!topicId) {
      return errorResponse('topicId is required', 400)
    }

    // Find the topic
    let foundTopic: { id: string; title: string; priority: string; category: string; season: string } | null = null
    for (const [season, topics] of Object.entries(SEASONAL_TOPICS)) {
      const topic = topics.find(t => t.id === topicId)
      if (topic) {
        foundTopic = { ...topic, season }
        break
      }
    }

    if (!foundTopic) {
      return errorResponse(`Topic not found: ${topicId}`, 404)
    }

    // Start the scheduled content workflow with the specific topic
    // The workflow will need to be extended to support specific topic generation
    const result = await trpc.workflow.startScheduledContent.mutate({
      websiteId,
      dryRun: dryRun ?? false,
    })

    return jsonResponse({
      ...result,
      topic: foundTopic,
      message: dryRun
        ? `Would generate content for: ${foundTopic.title}`
        : `Started content generation for: ${foundTopic.title}`,
    })
  } catch (error) {
    console.error('[API] Content calendar generation error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to start content generation')
  }
}
