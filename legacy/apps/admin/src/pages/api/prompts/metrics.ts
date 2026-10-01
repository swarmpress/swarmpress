import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

export const GET: APIRoute = async ({ url }) => {
  try {
    const companyPromptId = url.searchParams.get('company_prompt_id') || undefined
    const websitePromptId = url.searchParams.get('website_prompt_id') || undefined
    const agentId = url.searchParams.get('agent_id') || undefined
    const capability = url.searchParams.get('capability') || undefined
    const days = parseInt(url.searchParams.get('days') || '30')

    const metrics = await trpc.prompt.getPerformanceMetrics.query({
      company_prompt_id: companyPromptId,
      website_prompt_id: websitePromptId,
      agent_id: agentId,
      capability,
      days
    })

    return new Response(JSON.stringify(metrics), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error fetching metrics:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch metrics'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
