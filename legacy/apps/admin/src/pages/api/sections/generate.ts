import type { APIRoute } from 'astro'
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@swarm-press/backend'
import superjson from 'superjson'

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'

const trpc = createTRPCProxyClient<AppRouter>({
  transformer: superjson,
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      headers() {
        return {
          authorization: 'Bearer ceo:admin@swarm.press',
        }
      },
    }),
  ],
})

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { pageContext, questionnaire, agentId } = body

    const result = await trpc.contentGeneration.generateSections.mutate({
      pageContext,
      questionnaire,
      agentId,
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[API] sections/generate error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to generate sections',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
