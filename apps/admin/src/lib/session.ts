/**
 * Session Management
 * Handles tenant and product (website) context for the admin interface
 */

import type { AstroCookies } from 'astro'

export interface SessionContext {
  tenantId: string | null
  productId: string | null // website_id
}

const TENANT_COOKIE = 'swarmpress_tenant_id'
const PRODUCT_COOKIE = 'swarmpress_product_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/**
 * Get current session context from cookies
 * Also checks old cookie names for backwards compatibility
 */
export function getSessionContext(cookies: AstroCookies): SessionContext {
  // Check new cookie names first, fallback to old names
  const tenantId =
    cookies.get(TENANT_COOKIE)?.value ||
    cookies.get('tenant_id')?.value || // old name
    null

  const productId =
    cookies.get(PRODUCT_COOKIE)?.value ||
    cookies.get('product_id')?.value || // old name
    null

  return { tenantId, productId }
}

/**
 * Set tenant in session
 * Clears product when tenant changes
 */
export function setSessionTenant(cookies: AstroCookies, tenantId: string) {
  cookies.set(TENANT_COOKIE, tenantId, {
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    httpOnly: false, // Allow client-side access
    sameSite: 'lax',
  })

  // Clear product when tenant changes
  cookies.delete(PRODUCT_COOKIE, { path: '/' })
}

/**
 * Set product (website) in session
 */
export function setSessionProduct(cookies: AstroCookies, productId: string) {
  cookies.set(PRODUCT_COOKIE, productId, {
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    httpOnly: false, // Allow client-side access
    sameSite: 'lax',
  })
}

/**
 * Clear session
 */
export function clearSession(cookies: AstroCookies) {
  cookies.delete(TENANT_COOKIE, { path: '/' })
  cookies.delete(PRODUCT_COOKIE, { path: '/' })
}

/**
 * Check if tenant is selected
 */
export function hasTenant(cookies: AstroCookies): boolean {
  return !!cookies.get(TENANT_COOKIE)?.value
}

/**
 * Check if product is selected
 */
export function hasProduct(cookies: AstroCookies): boolean {
  return !!cookies.get(PRODUCT_COOKIE)?.value
}

/**
 * Require tenant to be selected, redirect to setup if not
 */
export function requireTenant(cookies: AstroCookies): string {
  const tenantId = cookies.get(TENANT_COOKIE)?.value
  if (!tenantId) {
    throw new Error('REDIRECT:/setup/tenant')
  }
  return tenantId
}

/**
 * Require product to be selected, redirect to setup if not
 */
export function requireProduct(cookies: AstroCookies): string {
  const productId = cookies.get(PRODUCT_COOKIE)?.value
  if (!productId) {
    throw new Error('REDIRECT:/setup/product')
  }
  return productId
}

/**
 * Require both tenant and product
 */
export function requireSession(cookies: AstroCookies): { tenantId: string; productId: string } {
  const tenantId = requireTenant(cookies)
  const productId = requireProduct(cookies)
  return { tenantId, productId }
}
