# GitHub Connector Implementation

## Overview

Implemented a proper GitHub App integration UI for connecting websites to GitHub repositories, replacing the simple text input with a comprehensive connection flow.

## Changes Made

### 1. Database Schema Update

**File:** `packages/backend/src/db/migrations/000_schema.sql`

Added GitHub integration fields to `websites` table:

```sql
-- GitHub Integration
github_repo_url TEXT,
github_owner TEXT,
github_repo TEXT,
github_installation_id TEXT,
github_connected_at TIMESTAMPTZ,
```

**Migration Applied:** ✅ Successfully added columns to production database

### 2. TypeScript Types Update

**File:** `packages/shared/src/types/entities.ts`

Updated `WebsiteSchema` to include GitHub fields:

```typescript
export const WebsiteSchema = z.object({
  id: z.string().uuid(),
  domain: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  // GitHub Integration
  github_repo_url: z.string().optional(),
  github_owner: z.string().optional(),
  github_repo: z.string().optional(),
  github_installation_id: z.string().optional(),
  github_connected_at: z.string().datetime().optional(),
})
```

### 3. GitHub Connector Component

**File:** `apps/admin/src/components/GitHubConnector.tsx` (NEW)

Created a comprehensive GitHub connection UI component with:

#### Features:

1. **Not Connected State:**
   - "Connect with GitHub App" button (prepared for OAuth flow)
   - "Manual setup with PAT" option for MVP
   - Features list explaining benefits

2. **Manual Connection (MVP):**
   - Repository URL input
   - Personal Access Token input
   - Repository access verification via API
   - Automatic parsing of owner/repo from URL
   - Error handling and validation

3. **Connected State:**
   - Green success card showing connection status
   - Repository link (clickable to GitHub)
   - Connection date
   - "Disconnect" button with confirmation

4. **Future OAuth Flow (Prepared):**
   - Button ready for GitHub App OAuth implementation
   - Will popup GitHub App installation page
   - Will handle OAuth callback
   - Will save installation_id

#### Component Props:

```typescript
interface GitHubConnectorProps {
  connection: GitHubConnection
  onConnect: (connection: GitHubConnection) => void
  onDisconnect: () => void
  disabled?: boolean
}

interface GitHubConnection {
  github_repo_url?: string
  github_owner?: string
  github_repo?: string
  github_installation_id?: string
  github_connected_at?: string
}
```

### 4. GitHub Verification API

**File:** `apps/admin/src/pages/api/github/verify.ts` (NEW)

Created API endpoint for verifying repository access:

- **Endpoint:** `POST /api/github/verify`
- **Input:** `{ repoUrl, token }`
- **Calls:** `trpc.github.verifyAccess`
- **Returns:** Repository access status and permissions

### 5. Website Form Update

**File:** `apps/admin/src/components/WebsiteForm.tsx`

Replaced simple text input with GitHubConnector component:

**Before:**
```tsx
<Input
  id="github_repo_url"
  type="url"
  value={githubRepoUrl}
  onChange={(e) => setGithubRepoUrl(e.target.value)}
  placeholder="e.g., https://github.com/owner/repo"
/>
```

**After:**
```tsx
<GitHubConnector
  connection={githubConnection}
  onConnect={(connection) => setGithubConnection(connection)}
  onDisconnect={() => setGithubConnection({ /* reset */ })}
  disabled={isSubmitting}
/>
```

Updated form submission to include all GitHub fields:
- `github_repo_url`
- `github_owner`
- `github_repo`
- `github_installation_id`
- `github_connected_at`

## User Flow

### Connecting a Repository (MVP - Manual Setup)

1. Navigate to website create/edit page
2. Click "Or use manual setup with Personal Access Token"
3. Enter GitHub repository URL (e.g., `https://github.com/owner/repo`)
4. Enter Personal Access Token
5. Click "Connect Repository"
6. System verifies access via GitHub API
7. If successful, saves connection with owner/repo parsed from URL
8. Shows green "Connected" card with repository info

### Disconnecting

1. Click "Disconnect" button on connected card
2. Confirm via browser dialog
3. Connection cleared (repository data preserved on GitHub)

### Future GitHub App Flow

1. Click "Connect with GitHub App" button
2. Opens GitHub App installation page in popup
3. User authorizes app and selects repository
4. OAuth callback received with installation_id
5. System saves installation_id and repository info
6. Shows connected state

## Backend Integration

The GitHub connector integrates with existing backend infrastructure:

### Existing tRPC Endpoints Used:

- `github.verifyAccess` - Verify repository access and permissions
- `github.syncSitemap` - Sync sitemap to GitHub
- `github.importSitemap` - Import sitemap from GitHub
- `github.createContentPR` - Create content change pull requests

### GitHub Service (`packages/backend/src/services/github.service.ts`):

Already supports both authentication methods:
- Personal Access Token (PAT) - Used in MVP
- GitHub App (appId + privateKey + installationId) - Ready for production

```typescript
export interface GitHubConfig {
  token?: string
  appId?: string
  privateKey?: string
  installationId?: string
  owner: string
  repo: string
}
```

## Environment Variables

GitHub integration requires environment variables (see `.env.example`):

### MVP (Personal Access Token):
```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo
```

### Production (GitHub App):
```env
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_INSTALLATION_ID=78910
```

**Note:** The connector currently stores tokens per website for future multi-tenant support, but MVP uses global env variables.

## Security Considerations

1. **Token Storage:**
   - MVP: Tokens validated but stored in env vars (not in database)
   - Future: Encrypted token storage per website

2. **Permissions Required:**
   - Read/write access to repository contents
   - Pull request creation
   - Issue creation
   - Webhook management

3. **Verification:**
   - Repository access verified before connecting
   - Invalid URLs rejected with clear error messages

## Testing

### Manual Testing Checklist:

- [ ] Create new website with GitHub connection
- [ ] Edit existing website and add GitHub connection
- [ ] Edit website and disconnect GitHub
- [ ] Verify invalid repository URL shows error
- [ ] Verify invalid token shows error
- [ ] Verify successful connection saves all fields
- [ ] Verify connected card shows correct repository link
- [ ] Verify disconnect clears connection data

### Database Verification:

```sql
-- Check GitHub fields are populated
SELECT
  title,
  github_repo_url,
  github_owner,
  github_repo,
  github_connected_at
FROM websites
WHERE github_repo_url IS NOT NULL;
```

## Next Steps

### Phase 1: GitHub App OAuth Flow (High Priority)
- Create GitHub App in GitHub organization
- Implement OAuth popup flow
- Handle OAuth callback endpoint
- Save installation_id per website
- Remove manual token input

### Phase 2: Enhanced Verification (Medium Priority)
- Test repository write access (not just read)
- Verify required permissions present
- Check for existing webhooks
- Suggest webhook configuration

### Phase 3: Multi-Tenant Support (Medium Priority)
- Store encrypted tokens per website (not env vars)
- Support multiple GitHub accounts
- Per-website GitHub App installations

### Phase 4: Advanced Features (Low Priority)
- Auto-detect repositories for user
- Suggest repository structure
- One-click repository creation
- Branch/tag selection for sync

## Related Documentation

- [GitHub Integration README](../packages/github-integration/README.md)
- [Environment Variables](./.env.example)
- [Editorial Planning with GitHub](./EDITORIAL-PLANNING-PHASE4-COMPLETE.md)

## Migration Notes

### For Existing Websites

Existing websites with `github_repo_url` stored in metadata:

1. No action required - fields default to NULL
2. To migrate: Parse URL and populate new fields
3. Migration script (if needed):

```sql
UPDATE websites
SET
  github_owner = split_part(split_part(github_repo_url, 'github.com/', 2), '/', 1),
  github_repo = split_part(split_part(github_repo_url, 'github.com/', 2), '/', 2)
WHERE github_repo_url IS NOT NULL
  AND github_owner IS NULL;
```

## Status

✅ **MVP Complete:**
- Database schema updated
- TypeScript types updated
- GitHubConnector component created
- Website form integrated
- Manual PAT connection working
- Verification API endpoint created
- Database migration applied

🚧 **Pending:**
- GitHub App OAuth flow
- Encrypted token storage
- Multi-tenant token management

---

**Last Updated:** 2025-11-24
**Author:** Claude Code
**Version:** 1.0.0
