import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { jobId } = body

    if (!jobId) {
      return new Response(
        JSON.stringify({ message: 'Job ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await trpc.contentGeneration.cancelGeneration.mutate({ jobId })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error cancelling generation:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to cancel generation',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
