import type { APIRoute } from 'astro'
import { trpc } from '../../../../../lib/trpc'

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Tool ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const { website_id, enabled } = body

    if (typeof enabled !== 'boolean') {
      return new Response(
        JSON.stringify({ message: 'enabled must be a boolean' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await trpc.tools.setEnabled.mutate({
      websiteId: website_id,
      toolConfigId: id,
      enabled,
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error toggling assignment:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to toggle assignment',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
