import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params

    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Department ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const { name, description } = body

    const department = await trpc.department.update.mutate({
      id,
      name,
      description,
    })

    return new Response(JSON.stringify(department), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error updating department:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to update department',
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
        JSON.stringify({ message: 'Department ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await trpc.department.delete.mutate({ id })

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error deleting department:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to delete department',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
