import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const GET: APIRoute = async ({ url }) => {
  try {
    const websiteId = url.searchParams.get('websiteId')
    if (!websiteId) {
      return new Response(
        JSON.stringify({ message: 'Website ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await trpc.contentGeneration.getStatus.query({ websiteId })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching generation status:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch status',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
