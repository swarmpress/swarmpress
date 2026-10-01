import type { APIRoute } from 'astro'
import { trpc } from '../../lib/trpc'

export const GET: APIRoute = async () => {
  try {
    const result = await trpc.department.list.query({})
    return new Response(JSON.stringify({ items: result.items }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching departments:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch departments',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { name, companyId, description } = body

    if (!name || !companyId) {
      return new Response(
        JSON.stringify({ message: 'Name and company are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const department = await trpc.department.create.mutate({
      name,
      companyId,
      description: description || undefined,
    })

    return new Response(JSON.stringify(department), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error creating department:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to create department',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
