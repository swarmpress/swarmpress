# GitHub OAuth Setup Guide

This guide explains how to set up GitHub OAuth authentication for swarm.press.

## Overview

swarm.press uses GitHub OAuth to authenticate users accessing the admin dashboard. This provides:
- Secure authentication without managing passwords
- Integration with GitHub's user management
- Role-based access control (Admin, Editor, Viewer)
- Audit logging of authentication events

## Prerequisites

- A GitHub account
- Admin access to a GitHub organization (optional, can use personal account)
- swarm.press backend running

## Step 1: Create a GitHub OAuth App

### Option A: Personal Account

1. Go to https://github.com/settings/developers
2. Click **"OAuth Apps"** in the left sidebar
3. Click **"New OAuth App"**

### Option B: Organization Account (Recommended for teams)

1. Go to your organization settings: `https://github.com/organizations/YOUR_ORG/settings/applications`
2. Click **"OAuth Apps"** tab
3. Click **"New OAuth App"**

## Step 2: Configure the OAuth App

Fill in the following details:

### Application name
```
swarm.press Admin (Development)
```
Or any name you prefer. Use different names for dev/staging/production.

### Homepage URL
For local development:
```
http://localhost:4321
```

For production:
```
https://admin.yourdomain.com
```

### Application description (optional)
```
swarm.press autonomous publishing platform admin dashboard
```

### Authorization callback URL
This is **critical** and must match your deployment URL:

**Local development:**
```
http://localhost:4321/auth/github/callback
```

**Production:**
```
https://admin.yourdomain.com/auth/github/callback
```

⚠️ **Important**: The callback URL must exactly match, including the protocol (http/https) and port.

### Enable Device Flow
Leave this **unchecked** (not needed).

## Step 3: Get Your Credentials

After creating the app:

1. You'll see your **Client ID** - copy this
2. Click **"Generate a new client secret"**
3. Copy the client secret immediately (you won't be able to see it again)

## Step 4: Configure Environment Variables

Add these to your `.env` file:

```bash
# GitHub OAuth (for user authentication)
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_CALLBACK_URL=http://localhost:4321/auth/github/callback
```

### Environment-Specific Configuration

**Development:**
```bash
GITHUB_CLIENT_ID=Iv1.abc123def456
GITHUB_CLIENT_SECRET=1234567890abcdef1234567890abcdef12345678
GITHUB_CALLBACK_URL=http://localhost:4321/auth/github/callback
```

**Production:**
```bash
GITHUB_CLIENT_ID=Iv1.xyz789ghi012
GITHUB_CLIENT_SECRET=9876543210fedcba9876543210fedcba98765432
GITHUB_CALLBACK_URL=https://admin.yourdomain.com/auth/github/callback
```

⚠️ **Security Note**: Never commit `.env` files to version control. Use `.env.example` as a template.

## Step 5: Restart the Backend

```bash
# Stop the backend
# (Ctrl+C in the terminal running the backend)

# Start it again
cd packages/backend
pnpm dev
```

The backend will now use the GitHub OAuth credentials.

## Step 6: Test the Authentication Flow

1. Navigate to http://localhost:4321/login
2. Click **"Sign in with GitHub"**
3. You'll be redirected to GitHub for authorization
4. Approve the access request
5. You'll be redirected back to the admin dashboard

## User Roles and Permissions

### Default Role
New users are automatically assigned the **Viewer** role on first login.

### Role Hierarchy
- **Viewer**: Read-only access
- **Editor**: Can create and edit content
- **Admin**: Full access including user management

### Changing User Roles

Admins can change user roles:

1. Navigate to `/users` in the admin dashboard
2. Find the user
3. Change their role

Or via API:
```bash
curl -X POST http://localhost:3000/api/trpc/auth.updateUserRole \
  -H "Content-Type: application/json" \
  -d '{
    "token": "your_admin_token",
    "userId": "user_id_here",
    "role": "admin"
  }'
```

## Database Schema

The following tables are created for authentication:

- **users**: Stores user accounts with GitHub info
- **sessions**: Active user sessions with tokens
- **auth_audit_log**: Audit log of authentication events

## Security Considerations

### Production Checklist

✅ Use HTTPS in production (required for secure cookies)
✅ Set different OAuth apps for dev/staging/production
✅ Enable CORS properly (don't use `*` in production)
✅ Rotate client secrets periodically
✅ Monitor auth_audit_log for suspicious activity
✅ Set up session expiration (30 days default)
✅ Use httpOnly cookies (enabled by default)
✅ Review user permissions regularly

### Environment Variables Security

- Never commit `.env` files
- Use secret management services in production (AWS Secrets Manager, HashiCorp Vault, etc.)
- Rotate secrets regularly
- Use different OAuth apps per environment

## Troubleshooting

### "Authorization callback URL mismatch" error

**Problem**: GitHub shows this error after clicking "Sign in with GitHub"

**Solution**:
1. Check your `GITHUB_CALLBACK_URL` in `.env`
2. Verify it exactly matches the callback URL in GitHub OAuth app settings
3. Include the protocol (`http://` or `https://`) and port if needed

### "Invalid client_id" error

**Problem**: Backend returns this error

**Solution**:
1. Verify `GITHUB_CLIENT_ID` is correct in `.env`
2. Make sure you copied it correctly from GitHub
3. Restart the backend after changing `.env`

### "Auth failed" on callback

**Problem**: Redirected to `/login?error=auth_failed`

**Solution**:
1. Check backend logs for detailed error
2. Verify `GITHUB_CLIENT_SECRET` is correct
3. Ensure the OAuth app is not disabled on GitHub
4. Check if your IP/domain is allowed (if restrictions are set)

### Session expires immediately

**Problem**: Logged in but immediately logged out

**Solution**:
1. Check cookie settings in your browser (must allow cookies)
2. Verify the backend and admin app are on the same domain (or localhost)
3. Check for CORS issues in browser console

### Can't access admin features after login

**Problem**: Logged in as Viewer but need Admin access

**Solution**:
1. Have an existing admin promote you
2. Or manually update the database:
```sql
UPDATE users SET role = 'admin' WHERE github_login = 'your_github_username';
```

## API Endpoints

The auth router provides these endpoints:

- `GET /api/trpc/auth.getGitHubAuthUrl` - Get OAuth URL
- `POST /api/trpc/auth.handleGitHubCallback` - Handle OAuth callback
- `GET /api/trpc/auth.getCurrentUser` - Get current user
- `POST /api/trpc/auth.refreshSession` - Refresh session token
- `POST /api/trpc/auth.logout` - Logout
- `POST /api/trpc/auth.logoutAll` - Logout from all devices
- `GET /api/trpc/auth.listUsers` - List all users (admin only)
- `POST /api/trpc/auth.updateUserRole` - Update user role (admin only)

## Session Management

### Session Duration
- Default: 30 days
- Configurable in `auth.service.ts`

### Session Storage
- Tokens stored in httpOnly cookies
- Session data in PostgreSQL
- Automatic cleanup of expired sessions

### Logout
- Single device: `/logout`
- All devices: Use `logoutAll` API endpoint

## Audit Logging

All authentication events are logged in `auth_audit_log`:
- User logins
- Logouts
- Token refreshes
- Permission changes
- Failed authentication attempts

Query recent auth events:
```sql
SELECT * FROM auth_audit_log
ORDER BY created_at DESC
LIMIT 100;
```

## Advanced Configuration

### Custom Session Duration

Edit `packages/backend/src/services/auth.service.ts`:

```typescript
// Change from 30 days to 7 days
expiresAt.setDate(expiresAt.getDate() + 7);
```

### Custom Redirect After Login

The login page accepts a `returnTo` parameter:
```
/login?returnTo=/content/edit/123
```

After successful authentication, users are redirected to this URL.

### Multiple OAuth Providers (Future)

The architecture supports multiple OAuth providers. To add more:
1. Create a new OAuth service (e.g., `GoogleOAuthService`)
2. Add routes to `auth.router.ts`
3. Update the login page UI

## Support

For issues with GitHub OAuth setup:
1. Check this guide first
2. Review backend logs
3. Check browser console for errors
4. Open an issue on the swarm.press repository

## Links

- [GitHub OAuth Documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps)
- [OAuth App Settings](https://github.com/settings/developers)
- [OAuth Security Best Practices](https://datatracker.ietf.org/doc/html/rfc6749#section-10)
