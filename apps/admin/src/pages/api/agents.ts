import type { APIRoute } from 'astro'
import { trpc } from '../../lib/trpc'

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { name, roleId, departmentId, persona, virtualEmail, capabilities } = body

    if (!name || !roleId || !departmentId || !persona || !virtualEmail) {
      return new Response(
        JSON.stringify({ message: 'All required fields must be provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const agent = await trpc.agent.create.mutate({
      name,
      roleId,
      departmentId,
      persona,
      virtualEmail,
      capabilities: capabilities || [],
    })

    return new Response(JSON.stringify(agent), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error creating agent:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to create agent',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
