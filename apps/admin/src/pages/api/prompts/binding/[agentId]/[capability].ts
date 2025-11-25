import type { APIRoute } from 'astro'
import { trpc } from '../../../../../lib/trpc'

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const { agentId, capability } = params
    if (!agentId || !capability) {
      return new Response(
        JSON.stringify({ message: 'Agent ID and capability are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const { custom_variables, ab_test_group, ab_test_weight, is_active } = body

    const binding = await trpc.prompt.binding.update.mutate({
      agent_id: agentId,
      capability: decodeURIComponent(capability),
      custom_variables,
      ab_test_group,
      ab_test_weight,
      is_active
    })

    return new Response(JSON.stringify(binding), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error updating binding:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to update binding'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export const DELETE: APIRoute = async ({ params }) => {
  try {
    const { agentId, capability } = params
    if (!agentId || !capability) {
      return new Response(
        JSON.stringify({ message: 'Agent ID and capability are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await trpc.prompt.binding.delete.mutate({
      agent_id: agentId,
      capability: decodeURIComponent(capability)
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error deleting binding:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to delete binding'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
