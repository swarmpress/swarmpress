import type { APIRoute } from 'astro'
import * as path from 'path'

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}))
    const { contentRepoPath } = body as { contentRepoPath?: string }

    // Default to cinqueterre.travel in the workspace root
    const repoPath = contentRepoPath || path.join(process.cwd(), 'cinqueterre.travel')

    // Dynamic import to avoid build-time issues
    const { buildWKI } = await import('@swarm-press/backend')
    const startTime = Date.now()
    const result = await buildWKI(repoPath)
    const duration = Date.now() - startTime

    return new Response(
      JSON.stringify({
        ...result,
        duration,
        contentRepoPath: repoPath,
      }),
      {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error building WKI:', error)
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to build WKI',
        errors: [error instanceof Error ? error.message : String(error)],
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
