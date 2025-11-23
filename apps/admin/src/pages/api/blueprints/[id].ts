import type { APIRoute } from 'astro'
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@swarm-press/backend'
import SuperJSON from 'superjson'

const trpc = createTRPCProxyClient<AppRouter>({
  transformer: SuperJSON,
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/api/trpc',
    }),
  ],
})

export const GET: APIRoute = async ({ params }) => {
  const { id } = params

  if (!id) {
    return new Response(JSON.stringify({ message: 'Blueprint ID is required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  try {
    const blueprint = await trpc.blueprint.getById.query({ id })
    return new Response(JSON.stringify(blueprint), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Error fetching blueprint:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch blueprint',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  }
}

export const PUT: APIRoute = async ({ params, request }) => {
  const { id } = params

  if (!id) {
    return new Response(JSON.stringify({ message: 'Blueprint ID is required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  try {
    const body = await request.json()
    const blueprint = await trpc.blueprint.update.mutate({ id, ...body })
    return new Response(JSON.stringify(blueprint), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Error updating blueprint:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to update blueprint',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  }
}

export const DELETE: APIRoute = async ({ params }) => {
  const { id } = params

  if (!id) {
    return new Response(JSON.stringify({ message: 'Blueprint ID is required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  try {
    await trpc.blueprint.delete.mutate({ id })
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Error deleting blueprint:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to delete blueprint',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  }
}
