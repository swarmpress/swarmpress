/**
 * Auth Middleware
 * Protects routes by requiring authentication
 */

import type { AstroGlobal } from 'astro'
import { getAuthToken } from '../lib/session'

export interface AuthUser {
  id: string
  github_login: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
  role: 'admin' | 'editor' | 'viewer'
  permissions: string[]
}

/**
 * Get current authenticated user
 * Returns null if not authenticated or token is invalid
 */
export async function getAuthenticatedUser(
  astro: AstroGlobal
): Promise<AuthUser | null> {
  const token = getAuthToken(astro.cookies)

  if (!token) {
    return null
  }

  try {
    const apiUrl = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'
    const response = await fetch(`${apiUrl}/api/trpc/auth.getCurrentUser?input=${encodeURIComponent(JSON.stringify({ token }))}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()

    if (data.result?.data?.user) {
      return data.result.data.user
    }

    return null
  } catch (error) {
    console.error('Failed to get authenticated user:', error)
    return null
  }
}

/**
 * Require authentication for a page
 * Redirects to login if not authenticated
 */
export async function requireAuth(astro: AstroGlobal): Promise<AuthUser> {
  const user = await getAuthenticatedUser(astro)

  if (!user) {
    // Store return URL
    const returnTo = astro.url.pathname + astro.url.search
    return astro.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`) as any
  }

  return user
}

/**
 * Require specific role
 */
export async function requireRole(
  astro: AstroGlobal,
  requiredRole: 'admin' | 'editor' | 'viewer'
): Promise<AuthUser> {
  const user = await requireAuth(astro)

  const roleHierarchy = { admin: 3, editor: 2, viewer: 1 }

  if (roleHierarchy[user.role] < roleHierarchy[requiredRole]) {
    return astro.redirect('/403') as any
  }

  return user
}

/**
 * Require admin role
 */
export async function requireAdmin(astro: AstroGlobal): Promise<AuthUser> {
  return requireRole(astro, 'admin')
}
