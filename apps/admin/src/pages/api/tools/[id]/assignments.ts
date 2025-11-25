import type { APIRoute } from 'astro'
import { trpc } from '../../../../lib/trpc'

export const GET: APIRoute = async ({ params }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Tool ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await trpc.tools.getAssignmentsForTool.query({ toolConfigId: id })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching assignments:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch assignments',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

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
    const { website_id } = body

    const result = await trpc.tools.addToWebsite.mutate({
      websiteId: website_id,
      toolConfigId: id,
      enabled: true,
    })

    return new Response(JSON.stringify(result), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error adding assignment:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to add assignment',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export const DELETE: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Tool ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const { website_id } = body

    await trpc.tools.removeFromWebsite.mutate({
      websiteId: website_id,
      toolConfigId: id,
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error removing assignment:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to remove assignment',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
