import type { APIRoute } from 'astro'
import { trpc } from '../../../../../lib/trpc'

export const POST: APIRoute = async ({ params }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Prompt ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await trpc.prompt.company.activate.mutate({ id })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error activating prompt:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to activate prompt'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
