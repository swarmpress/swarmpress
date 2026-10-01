/**
 * Auth Router
 * Handles authentication via GitHub OAuth
 */

import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { TRPCError } from '@trpc/server';
import { createAuthService } from '../../services/auth.service';

/**
 * Auth Router
 */
export const authRouter = router({
  // ===========================================================================
  // GITHUB OAUTH FLOW
  // ===========================================================================

  /**
   * Get GitHub OAuth authorization URL
   */
  getGitHubAuthUrl: publicProcedure
    .input(
      z.object({
        returnTo: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      // Generate state with return URL encoded
      const state = input.returnTo
        ? Buffer.from(JSON.stringify({ returnTo: input.returnTo })).toString('base64')
        : undefined;

      const url = authService.getGitHubAuthUrl(state);

      return { url };
    }),

  /**
   * Handle GitHub OAuth callback
   */
  handleGitHubCallback: publicProcedure
    .input(
      z.object({
        code: z.string(),
        state: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      try {
        // Get client metadata from headers
        const ipAddress = ctx.req?.headers['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress;
        const userAgent = ctx.req?.headers['user-agent'];

        // Complete OAuth flow
        const { user, session } = await authService.handleGitHubCallback(input.code, {
          ipAddress,
          userAgent,
        });

        // Decode state to get return URL
        let returnTo = '/';
        if (input.state) {
          try {
            const decoded = JSON.parse(Buffer.from(input.state, 'base64').toString());
            returnTo = decoded.returnTo || '/';
          } catch (error) {
            // Invalid state, use default
          }
        }

        return {
          success: true,
          user: {
            id: user.id,
            github_login: user.github_login,
            display_name: user.display_name,
            email: user.email,
            avatar_url: user.avatar_url,
            role: user.role,
          },
          session: {
            token: session.token,
            expires_at: session.expires_at,
          },
          returnTo,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: error instanceof Error ? error.message : 'GitHub OAuth failed',
        });
      }
    }),

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  /**
   * Get current user from session token
   */
  getCurrentUser: publicProcedure
    .input(
      z.object({
        token: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      const sessionWithUser = await authService.getSessionByToken(input.token);

      if (!sessionWithUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired session',
        });
      }

      return {
        user: {
          id: sessionWithUser.user.id,
          github_login: sessionWithUser.user.github_login,
          display_name: sessionWithUser.user.display_name,
          email: sessionWithUser.user.email,
          avatar_url: sessionWithUser.user.avatar_url,
          role: sessionWithUser.user.role,
          permissions: sessionWithUser.user.permissions,
        },
        session: {
          token: sessionWithUser.token,
          expires_at: sessionWithUser.expires_at,
        },
      };
    }),

  /**
   * Refresh session token
   */
  refreshSession: publicProcedure
    .input(
      z.object({
        refreshToken: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      try {
        const session = await authService.refreshSession(input.refreshToken);

        return {
          success: true,
          session: {
            token: session.token,
            refresh_token: session.refresh_token,
            expires_at: session.expires_at,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid refresh token',
        });
      }
    }),

  /**
   * Logout (revoke session)
   */
  logout: publicProcedure
    .input(
      z.object({
        token: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      await authService.revokeSession(input.token, 'user_logout');

      return { success: true };
    }),

  /**
   * Logout from all devices
   */
  logoutAll: publicProcedure
    .input(
      z.object({
        token: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      // Get user from current session
      const sessionWithUser = await authService.getSessionByToken(input.token);

      if (!sessionWithUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid session',
        });
      }

      await authService.revokeAllUserSessions(
        sessionWithUser.user.id,
        'user_logout_all'
      );

      return { success: true };
    }),

  // ===========================================================================
  // USER MANAGEMENT (Admin only)
  // ===========================================================================

  /**
   * Get user by ID
   */
  getUser: publicProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        token: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      // Verify session and check permissions
      const sessionWithUser = await authService.getSessionByToken(input.token);

      if (!sessionWithUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid session',
        });
      }

      if (sessionWithUser.user.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admin access required',
        });
      }

      const user = await authService.getUserById(input.userId);

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      return {
        id: user.id,
        github_login: user.github_login,
        display_name: user.display_name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
        permissions: user.permissions,
        is_active: user.is_active,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
      };
    }),

  /**
   * List all users (Admin only)
   */
  listUsers: publicProcedure
    .input(
      z.object({
        token: z.string(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      // Verify session and check permissions
      const sessionWithUser = await authService.getSessionByToken(input.token);

      if (!sessionWithUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid session',
        });
      }

      if (sessionWithUser.user.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admin access required',
        });
      }

      // Get users
      const result = await ctx.db.query(
        `SELECT
          id, github_login, display_name, email, avatar_url,
          role, permissions, is_active, created_at, last_login_at
         FROM users
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [input.limit, input.offset]
      );

      // Get total count
      const countResult = await ctx.db.query('SELECT COUNT(*) as count FROM users');
      const total = parseInt(countResult.rows[0].count);

      return {
        users: result.rows,
        total,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Update user role (Admin only)
   */
  updateUserRole: publicProcedure
    .input(
      z.object({
        token: z.string(),
        userId: z.string().uuid(),
        role: z.enum(['admin', 'editor', 'viewer']),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      // Verify session and check permissions
      const sessionWithUser = await authService.getSessionByToken(input.token);

      if (!sessionWithUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid session',
        });
      }

      if (sessionWithUser.user.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admin access required',
        });
      }

      // Don't allow users to demote themselves
      if (sessionWithUser.user.id === input.userId && input.role !== 'admin') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot change your own role',
        });
      }

      const user = await authService.updateUserRole(input.userId, input.role);

      return {
        success: true,
        user: {
          id: user.id,
          github_login: user.github_login,
          role: user.role,
        },
      };
    }),

  // ===========================================================================
  // MAINTENANCE
  // ===========================================================================

  /**
   * Clean up expired sessions (Admin only)
   */
  cleanupSessions: publicProcedure
    .input(
      z.object({
        token: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const authService = createAuthService(ctx.db);

      // Verify session and check permissions
      const sessionWithUser = await authService.getSessionByToken(input.token);

      if (!sessionWithUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid session',
        });
      }

      if (sessionWithUser.user.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admin access required',
        });
      }

      const deletedCount = await authService.cleanupExpiredSessions();

      return {
        success: true,
        deleted_count: deletedCount,
      };
    }),
});
