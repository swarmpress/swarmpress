import type { APIRoute } from 'astro'
import { trpc } from '../../../../lib/trpc'

export const GET: APIRoute = async ({ params, url }) => {
  try {
    const { id } = params
    const websiteId = url.searchParams.get('website_id')

    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Tool ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!websiteId) {
      return new Response(
        JSON.stringify({ message: 'Website ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await trpc.tools.listSecrets.query({
      toolConfigId: id,
      websiteId,
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching secrets:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to fetch secrets',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

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
    const { website_id, secret_key, value } = body

    if (!website_id || !secret_key || !value) {
      return new Response(
        JSON.stringify({ message: 'website_id, secret_key, and value are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await trpc.tools.setSecret.mutate({
      toolConfigId: id,
      websiteId: website_id,
      secretKey: secret_key,
      value,
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error setting secret:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to set secret',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export const DELETE: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params
    if (!id) {
      return new Response(
        JSON.stringify({ message: 'Tool ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const { website_id, secret_key } = body

    if (!website_id || !secret_key) {
      return new Response(
        JSON.stringify({ message: 'website_id and secret_key are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await trpc.tools.deleteSecret.mutate({
      toolConfigId: id,
      websiteId: website_id,
      secretKey: secret_key,
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error deleting secret:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to delete secret',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
