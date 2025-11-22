/**
 * tRPC Configuration
 * Type-safe API setup with context and middleware
 */

import { initTRPC, TRPCError } from '@trpc/server'
import { CreateExpressContextOptions } from '@trpc/server/adapters/express'
import superjson from 'superjson'
import { z } from 'zod'

/**
 * Context for each request
 * Contains user authentication info and request metadata
 */
export interface Context {
  user?: {
    id: string
    email: string
    role: 'ceo' | 'system'
  }
  requestId: string
}

/**
 * Create context from Express request
 */
export async function createContext({
  req,
  res,
}: CreateExpressContextOptions): Promise<Context> {
  // For MVP: Simple authentication via header
  // In production: Use proper JWT or session tokens
  const authHeader = req.headers.authorization

  let user: Context['user'] | undefined

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)

    // Simple token validation for MVP
    // Format: "ceo:{email}" or "system"
    if (token.startsWith('ceo:')) {
      const email = token.substring(4)
      user = {
        id: 'ceo-001', // Fixed ID for MVP single tenant
        email,
        role: 'ceo',
      }
    } else if (token === 'system') {
      user = {
        id: 'system',
        email: 'system@swarm-press.internal',
        role: 'system',
      }
    }
  }

  return {
    user,
    requestId: `req-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  }
}

/**
 * Initialize tRPC with context
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof z.ZodError ? error.cause.flatten() : null,
      },
    }
  },
})

/**
 * Reusable router and procedure helpers
 */
export const router = t.router
export const publicProcedure = t.procedure

/**
 * Protected procedure - requires authentication
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    })
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user, // Type narrowing: user is now guaranteed
    },
  })
})

/**
 * CEO-only procedure - requires CEO role
 */
export const ceoProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== 'ceo') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'CEO access required',
    })
  }

  return next({ ctx })
})

/**
 * System-only procedure - for internal service calls
 */
export const systemProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== 'system') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'System access required',
    })
  }

  return next({ ctx })
})

/**
 * Middleware for logging requests
 */
export const loggerMiddleware = t.middleware(async ({ path, type, next, ctx }) => {
  const start = Date.now()

  console.log(`[API] ${type} ${path} - ${ctx.requestId}`)

  const result = await next()

  const duration = Date.now() - start
  console.log(`[API] ${type} ${path} - ${ctx.requestId} - ${duration}ms`)

  return result
})
