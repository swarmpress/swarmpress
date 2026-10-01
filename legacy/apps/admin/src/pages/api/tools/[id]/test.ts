import type { APIRoute } from 'astro'
import { trpc } from '../../../../lib/trpc'

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Tool ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const { website_id, test_input } = body

    if (!website_id) {
      return new Response(
        JSON.stringify({ message: 'website_id is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await trpc.tools.testJavaScriptTool.mutate({
      tool_id: id,
      website_id,
      test_input: test_input || {},
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error testing tool:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to test tool',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
