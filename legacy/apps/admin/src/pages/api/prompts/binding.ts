import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const {
      agent_id,
      capability,
      company_prompt_template_id,
      website_prompt_template_id,
      custom_variables,
      ab_test_group,
      ab_test_weight
    } = body

    if (!agent_id || !capability) {
      return new Response(
        JSON.stringify({ message: 'agent_id and capability are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const binding = await trpc.prompt.binding.create.mutate({
      agent_id,
      capability,
      company_prompt_template_id,
      website_prompt_template_id,
      custom_variables,
      ab_test_group,
      ab_test_weight
    })

    return new Response(JSON.stringify(binding), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error creating binding:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to create binding'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
