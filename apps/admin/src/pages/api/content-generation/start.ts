import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { websiteId, mode, limit, priority } = body

    if (!websiteId) {
      return new Response(
        JSON.stringify({ message: 'Website ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await trpc.contentGeneration.startGeneration.mutate({
      websiteId,
      mode: mode || 'prepare',
      limit,
      priority,
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error starting generation:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to start generation',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
