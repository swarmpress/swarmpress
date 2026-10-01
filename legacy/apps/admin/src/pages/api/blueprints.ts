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

export const GET: APIRoute = async () => {
  try {
    const result = await trpc.blueprint.listOrdered.query()
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Error fetching blueprints:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch blueprints',
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const blueprint = await trpc.blueprint.create.mutate(body)
    return new Response(JSON.stringify(blueprint), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Error creating blueprint:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to create blueprint',
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
