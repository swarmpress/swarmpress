import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const {
      company_id,
      role_name,
      capability,
      version,
      template,
      description,
      changelog,
      examples,
      default_variables
    } = body

    if (!company_id || !role_name || !capability || !version || !template) {
      return new Response(
        JSON.stringify({ message: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const prompt = await trpc.prompt.company.create.mutate({
      company_id,
      role_name,
      capability,
      version,
      template,
      description,
      changelog,
      examples,
      default_variables
    })

    return new Response(JSON.stringify(prompt), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error creating company prompt:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to create prompt'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
