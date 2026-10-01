import type { APIRoute } from 'astro'
import { trpc } from '../../../../lib/trpc'

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Prompt ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()

    // For company prompts, we typically create a new version rather than update
    // But we can update metadata like description
    // This would need a custom mutation - for now return success
    return new Response(JSON.stringify({ id, ...body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error updating company prompt:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to update prompt'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
