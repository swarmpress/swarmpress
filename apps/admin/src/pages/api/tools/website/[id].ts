import type { APIRoute } from 'astro'
import { trpc } from '../../../../lib/trpc'

export const GET: APIRoute = async ({ params }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Website ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await trpc.tools.getForWebsite.query({ websiteId: id })

    // result already has { items, total } format from the tRPC router
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching website tools:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch website tools',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
