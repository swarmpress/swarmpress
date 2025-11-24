/**
 * Authentication Service
 * Handles GitHub OAuth flow and session management
 */

import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { Octokit } from '@octokit/rest';

// =============================================================================
// TYPES
// =============================================================================

export interface User {
  id: string;
  github_id: number;
  github_login: string;
  github_name: string | null;
  github_email: string | null;
  github_avatar_url: string | null;
  github_access_token: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: 'admin' | 'editor' | 'viewer';
  permissions: string[];
  is_active: boolean;
  is_verified: boolean;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  refresh_token: string | null;
  ip_address: string | null;
  user_agent: string | null;
  device_info: any;
  expires_at: Date;
  last_activity_at: Date;
  is_active: boolean;
  revoked_at: Date | null;
  revoked_reason: string | null;
  created_at: Date;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

// =============================================================================
// AUTH SERVICE
// =============================================================================

export class AuthService {
  private db: Pool;
  private githubClientId: string;
  private githubClientSecret: string;
  private callbackUrl: string;

  constructor(db: Pool, config: {
    githubClientId: string;
    githubClientSecret: string;
    callbackUrl: string;
  }) {
    this.db = db;
    this.githubClientId = config.githubClientId;
    this.githubClientSecret = config.githubClientSecret;
    this.callbackUrl = config.callbackUrl;
  }

  // ===========================================================================
  // GITHUB OAUTH FLOW
  // ===========================================================================

  /**
   * Generate GitHub OAuth authorization URL
   */
  getGitHubAuthUrl(state?: string): string {
    const stateParam = state || this.generateState();
    const params = new URLSearchParams({
      client_id: this.githubClientId,
      redirect_uri: this.callbackUrl,
      scope: 'read:user user:email',
      state: stateParam,
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange OAuth code for access token
   */
  async exchangeCodeForToken(code: string): Promise<string> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.githubClientId,
        client_secret: this.githubClientSecret,
        code,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
    }

    return data.access_token;
  }

  /**
   * Get GitHub user info using access token
   */
  async getGitHubUser(accessToken: string): Promise<GitHubUser> {
    const octokit = new Octokit({ auth: accessToken });

    const { data: user } = await octokit.rest.users.getAuthenticated();

    // Get primary email if not public
    let email = user.email;
    if (!email) {
      const { data: emails } = await octokit.rest.users.listEmailsForAuthenticatedUser();
      const primaryEmail = emails.find(e => e.primary);
      email = primaryEmail?.email || null;
    }

    return {
      id: user.id,
      login: user.login,
      name: user.name,
      email,
      avatar_url: user.avatar_url,
    };
  }

  /**
   * Complete OAuth flow and create/update user
   */
  async handleGitHubCallback(
    code: string,
    metadata?: {
      ipAddress?: string;
      userAgent?: string;
      deviceInfo?: any;
    }
  ): Promise<{ user: User; session: Session }> {
    // Exchange code for access token
    const accessToken = await exchangeCodeForToken(code);

    // Get GitHub user info
    const githubUser = await this.getGitHubUser(accessToken);

    // Create or update user
    const user = await this.upsertUser(githubUser, accessToken);

    // Log auth event
    await this.logAuthEvent({
      userId: user.id,
      eventType: 'login',
      eventData: { method: 'github_oauth', github_login: githubUser.login },
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      success: true,
    });

    // Create session
    const session = await this.createSession(user.id, {
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      deviceInfo: metadata?.deviceInfo,
    });

    // Update last login
    await this.db.query('SELECT update_user_last_login($1)', [user.id]);

    return { user, session };
  }

  // ===========================================================================
  // USER MANAGEMENT
  // ===========================================================================

  /**
   * Create or update user from GitHub info
   */
  private async upsertUser(githubUser: GitHubUser, accessToken: string): Promise<User> {
    const result = await this.db.query<User>(
      `INSERT INTO users (
        github_id, github_login, github_name, github_email,
        github_avatar_url, github_access_token,
        display_name, email, avatar_url, role
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (github_id)
      DO UPDATE SET
        github_login = EXCLUDED.github_login,
        github_name = EXCLUDED.github_name,
        github_email = EXCLUDED.github_email,
        github_avatar_url = EXCLUDED.github_avatar_url,
        github_access_token = EXCLUDED.github_access_token,
        display_name = COALESCE(users.display_name, EXCLUDED.display_name),
        email = COALESCE(users.email, EXCLUDED.email),
        avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url),
        updated_at = NOW()
      RETURNING *`,
      [
        githubUser.id,
        githubUser.login,
        githubUser.name,
        githubUser.email,
        githubUser.avatar_url,
        accessToken,
        githubUser.name || githubUser.login,
        githubUser.email,
        githubUser.avatar_url,
        'viewer', // Default role for new users
      ]
    );

    return result.rows[0];
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    const result = await this.db.query<User>(
      'SELECT * FROM users WHERE id = $1 AND is_active = TRUE',
      [userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Get user by GitHub ID
   */
  async getUserByGitHubId(githubId: number): Promise<User | null> {
    const result = await this.db.query<User>(
      'SELECT * FROM users WHERE github_id = $1 AND is_active = TRUE',
      [githubId]
    );

    return result.rows[0] || null;
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: string, role: 'admin' | 'editor' | 'viewer'): Promise<User> {
    const result = await this.db.query<User>(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [role, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    await this.logAuthEvent({
      userId,
      eventType: 'permission_change',
      eventData: { new_role: role },
      success: true,
    });

    return result.rows[0];
  }

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  /**
   * Create a new session for a user
   */
  async createSession(
    userId: string,
    metadata?: {
      ipAddress?: string;
      userAgent?: string;
      deviceInfo?: any;
    }
  ): Promise<Session> {
    const token = this.generateToken();
    const refreshToken = this.generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    const result = await this.db.query<Session>(
      `INSERT INTO sessions (
        user_id, token, refresh_token,
        ip_address, user_agent, device_info,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        userId,
        token,
        refreshToken,
        metadata?.ipAddress || null,
        metadata?.userAgent || null,
        JSON.stringify(metadata?.deviceInfo || {}),
        expiresAt,
      ]
    );

    return result.rows[0];
  }

  /**
   * Get session by token
   */
  async getSessionByToken(token: string): Promise<(Session & { user: User }) | null> {
    const result = await this.db.query<Session & { user: User }>(
      `SELECT s.*, row_to_json(u.*) as user
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1
         AND s.is_active = TRUE
         AND s.expires_at > NOW()
         AND u.is_active = TRUE`,
      [token]
    );

    if (result.rows.length === 0) {
      return null;
    }

    // Update last activity
    await this.db.query(
      'UPDATE sessions SET last_activity_at = NOW() WHERE id = $1',
      [result.rows[0].id]
    );

    return result.rows[0];
  }

  /**
   * Refresh session (extend expiration)
   */
  async refreshSession(refreshToken: string): Promise<Session> {
    const result = await this.db.query<Session>(
      `SELECT * FROM sessions
       WHERE refresh_token = $1
         AND is_active = TRUE
         AND expires_at > NOW()`,
      [refreshToken]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid refresh token');
    }

    const session = result.rows[0];

    // Generate new tokens
    const newToken = this.generateToken();
    const newRefreshToken = this.generateToken();
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    const updateResult = await this.db.query<Session>(
      `UPDATE sessions
       SET token = $1,
           refresh_token = $2,
           expires_at = $3,
           last_activity_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [newToken, newRefreshToken, newExpiresAt, session.id]
    );

    await this.logAuthEvent({
      userId: session.user_id,
      eventType: 'token_refresh',
      success: true,
    });

    return updateResult.rows[0];
  }

  /**
   * Revoke a session (logout)
   */
  async revokeSession(token: string, reason?: string): Promise<void> {
    const result = await this.db.query<{ user_id: string }>(
      `UPDATE sessions
       SET is_active = FALSE,
           revoked_at = NOW(),
           revoked_reason = $2
       WHERE token = $1
       RETURNING user_id`,
      [token, reason || 'user_logout']
    );

    if (result.rows.length > 0) {
      await this.logAuthEvent({
        userId: result.rows[0].user_id,
        eventType: 'logout',
        eventData: { reason },
        success: true,
      });
    }
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId: string, reason?: string): Promise<void> {
    await this.db.query(
      `UPDATE sessions
       SET is_active = FALSE,
           revoked_at = NOW(),
           revoked_reason = $2
       WHERE user_id = $1 AND is_active = TRUE`,
      [userId, reason || 'revoke_all']
    );

    await this.logAuthEvent({
      userId,
      eventType: 'logout_all',
      eventData: { reason },
      success: true,
    });
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.db.query<{ cleanup_expired_sessions: number }>(
      'SELECT cleanup_expired_sessions()'
    );

    return result.rows[0].cleanup_expired_sessions;
  }

  // ===========================================================================
  // AUDIT LOGGING
  // ===========================================================================

  /**
   * Log an authentication event
   */
  private async logAuthEvent(event: {
    userId?: string;
    eventType: string;
    eventData?: any;
    ipAddress?: string;
    userAgent?: string;
    success: boolean;
    errorMessage?: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO auth_audit_log (
        user_id, event_type, event_data,
        ip_address, user_agent,
        success, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.userId || null,
        event.eventType,
        JSON.stringify(event.eventData || {}),
        event.ipAddress || null,
        event.userAgent || null,
        event.success,
        event.errorMessage || null,
      ]
    );
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Generate a secure random token
   */
  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generate OAuth state parameter
   */
  private generateState(): string {
    return randomBytes(16).toString('hex');
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create auth service from environment variables
 */
export function createAuthService(db: Pool): AuthService {
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const callbackUrl = process.env.GITHUB_CALLBACK_URL || 'http://localhost:3000/auth/github/callback';

  if (!githubClientId || !githubClientSecret) {
    throw new Error('GitHub OAuth configuration is missing. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET');
  }

  return new AuthService(db, {
    githubClientId,
    githubClientSecret,
    callbackUrl,
  });
}

// Helper function for backward compatibility
async function exchangeCodeForToken(code: string): Promise<string> {
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: githubClientId,
      client_secret: githubClientSecret,
      code,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }

  return data.access_token;
}
