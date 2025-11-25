-- =============================================================================
-- ADD GITHUB PAGES DEPLOYMENT COLUMNS TO WEBSITES TABLE
-- =============================================================================
-- Migration: add-github-pages-deployment
-- Date: 2025-11-25
-- Description: Adds columns to support GitHub Pages deployment for websites
-- =============================================================================

-- Add GitHub Pages deployment columns to websites table
ALTER TABLE websites ADD COLUMN IF NOT EXISTS github_pages_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE websites ADD COLUMN IF NOT EXISTS github_pages_url TEXT;
ALTER TABLE websites ADD COLUMN IF NOT EXISTS github_pages_branch TEXT DEFAULT 'gh-pages';
ALTER TABLE websites ADD COLUMN IF NOT EXISTS github_pages_path TEXT DEFAULT '/';
ALTER TABLE websites ADD COLUMN IF NOT EXISTS github_pages_custom_domain TEXT;
ALTER TABLE websites ADD COLUMN IF NOT EXISTS last_deployed_at TIMESTAMPTZ;
ALTER TABLE websites ADD COLUMN IF NOT EXISTS deployment_status TEXT DEFAULT 'never_deployed';
ALTER TABLE websites ADD COLUMN IF NOT EXISTS deployment_error TEXT;

-- Add index for deployment status queries
CREATE INDEX IF NOT EXISTS idx_websites_deployment_status ON websites(deployment_status);

-- Add comments
COMMENT ON COLUMN websites.github_pages_enabled IS 'Whether GitHub Pages is enabled for this website';
COMMENT ON COLUMN websites.github_pages_url IS 'The GitHub Pages URL (e.g., https://owner.github.io/repo)';
COMMENT ON COLUMN websites.github_pages_branch IS 'Branch used for GitHub Pages (gh-pages or main)';
COMMENT ON COLUMN websites.github_pages_path IS 'Path for GitHub Pages (/ or /docs)';
COMMENT ON COLUMN websites.github_pages_custom_domain IS 'Custom domain configured for GitHub Pages';
COMMENT ON COLUMN websites.last_deployed_at IS 'Timestamp of last successful deployment';
COMMENT ON COLUMN websites.deployment_status IS 'Current deployment status: never_deployed, deploying, deployed, failed';
COMMENT ON COLUMN websites.deployment_error IS 'Error message if deployment failed';

\echo 'GitHub Pages deployment columns added to websites table'
