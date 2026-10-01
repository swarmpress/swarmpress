import type { APIRoute } from 'astro'
import { trpc } from '../../lib/trpc'

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { name, description } = body

    if (!name || typeof name !== 'string') {
      return new Response(
        JSON.stringify({ message: 'Name is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const tenant = await trpc.company.create.mutate({
      name,
      description: description || undefined,
    })

    return new Response(JSON.stringify(tenant), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error creating tenant:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to create tenant',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
