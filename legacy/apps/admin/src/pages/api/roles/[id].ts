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
  try {
    const { id } = params
    if (!id) {
      return new Response(JSON.stringify({ message: 'Role ID is required' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }

    const role = await trpc.role.getById.query({ id })
    return new Response(JSON.stringify(role), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Error fetching role:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch role',
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
  try {
    const { id } = params
    if (!id) {
      return new Response(JSON.stringify({ message: 'Role ID is required' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }

    const body = await request.json()
    const role = await trpc.role.update.mutate({ id, ...body })
    return new Response(JSON.stringify(role), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Error updating role:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to update role',
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
  try {
    const { id } = params
    if (!id) {
      return new Response(JSON.stringify({ message: 'Role ID is required' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }

    await trpc.role.delete.mutate({ id })
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Error deleting role:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to delete role',
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
