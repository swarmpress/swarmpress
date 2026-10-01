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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { repoUrl, token } = body

    if (!repoUrl || !token) {
      return new Response(
        JSON.stringify({
          message: 'Repository URL and token are required',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const result = await trpc.github.verifyAccess.mutate({
      repoUrl,
      token,
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Error verifying GitHub access:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to verify repository access',
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
