/**
 * General tRPC Proxy
 * Forwards all tRPC requests to the backend server
 */
import type { APIRoute } from 'astro'

const BACKEND_URL = 'http://localhost:3000/api/trpc'

export const ALL: APIRoute = async ({ request, params }) => {
  const trpcPath = params.trpc || ''

  // Build the backend URL with query params
  const url = new URL(request.url)
  const backendUrl = `${BACKEND_URL}/${trpcPath}${url.search}`

  try {
    // Forward the request to the backend
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        // Forward relevant headers
        ...(request.headers.get('authorization') && {
          'authorization': request.headers.get('authorization')!
        }),
      },
      body: request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.text()
        : undefined,
    })

    // Get the response body
    const data = await response.text()

    // Return the response with the same status and headers
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    })
  } catch (error) {
    console.error('tRPC proxy error:', error)
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Proxy error',
        },
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
