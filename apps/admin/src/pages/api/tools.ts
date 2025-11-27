import type { APIRoute } from 'astro'
import { trpc } from '../../lib/trpc'

export const GET: APIRoute = async () => {
  try {
    const result = await trpc.tools.list.query({})
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching tools:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch tools',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { name, display_name, description, type, endpoint_url, config, input_schema } = body

    if (!name || !type) {
      return new Response(
        JSON.stringify({ message: 'Name and type are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const tool = await trpc.tools.create.mutate({
      name,
      display_name,
      description,
      type,
      endpoint_url,
      config: config || {},
      input_schema,
    })

    return new Response(JSON.stringify(tool), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error creating tool:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to create tool',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
