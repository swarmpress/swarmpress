import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params

    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Agent ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const {
      name,
      roleId,
      departmentId,
      persona,
      virtualEmail,
      description,
      avatarUrl,
      profileImageUrl,
      hobbies,
      writingStyle,
      capabilities,
      modelConfig,
      status,
    } = body

    const agent = await trpc.agent.update.mutate({
      id,
      name,
      roleId,
      departmentId,
      persona,
      virtualEmail,
      description,
      avatarUrl,
      profileImageUrl,
      hobbies,
      writingStyle,
      capabilities,
      modelConfig,
      status,
    })

    return new Response(JSON.stringify(agent), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error updating agent:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to update agent',
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
        JSON.stringify({ message: 'Agent ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await trpc.agent.delete.mutate({ id })

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error deleting agent:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to delete agent',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
