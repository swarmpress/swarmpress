/**
 * tRPC Client for Admin App
 * Type-safe API client with server-side and client-side support
 */

import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@swarm-press/backend'
import superjson from 'superjson'

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'

/**
 * tRPC client for server-side rendering (Astro pages)
 * Uses httpBatchLink for efficient request batching
 */
export const trpc = createTRPCProxyClient<AppRouter>({
  transformer: superjson,
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      // Add authentication headers if needed
      headers() {
        return {
          // For MVP: Simple CEO authentication
          // In production: Use proper JWT or session tokens
          authorization: 'Bearer ceo:admin@swarm.press',
        }
      },
    }),
  ],
})

/**
 * Helper function to handle tRPC errors
 */
export function handleTRPCError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  return 'An unknown error occurred'
}
