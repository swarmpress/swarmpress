import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Tool ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const { name, display_name, description, type, endpoint_url, config, input_schema } = body

    const tool = await trpc.tools.update.mutate({
      id,
      data: {
        name,
        display_name,
        description,
        type,
        endpoint_url,
        config,
        input_schema,
      },
    })

    return new Response(JSON.stringify(tool), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error updating tool:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to update tool',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export const DELETE: APIRoute = async ({ params }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Tool ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await trpc.tools.delete.mutate({ id })

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error deleting tool:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to delete tool',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
