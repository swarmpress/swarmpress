import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const {
      website_id,
      company_prompt_template_id,
      version,
      template_override,
      template_additions,
      variables_override
    } = body

    if (!website_id || !company_prompt_template_id || !version) {
      return new Response(
        JSON.stringify({ message: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const prompt = await trpc.prompt.website.create.mutate({
      website_id,
      company_prompt_template_id,
      version,
      template_override,
      template_additions,
      variables_override
    })

    return new Response(JSON.stringify(prompt), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error creating website prompt:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to create prompt'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
