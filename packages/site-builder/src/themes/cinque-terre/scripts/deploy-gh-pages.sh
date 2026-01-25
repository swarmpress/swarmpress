#!/bin/bash
# Deploy Cinque Terre site to GitHub Pages
# This script ensures a clean deployment process

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME_DIR="$(dirname "$SCRIPT_DIR")"
MONOREPO_ROOT="$(cd "$THEME_DIR/../../../../../.." && pwd)"
CONTENT_REPO="$MONOREPO_ROOT/cinqueterre.travel"
DIST_DIR="$CONTENT_REPO/dist"
TEMP_DEPLOY_DIR="/tmp/gh-pages-deploy-$$"

echo "=== Cinque Terre GitHub Pages Deployment ==="
echo "Theme directory: $THEME_DIR"
echo "Monorepo root: $MONOREPO_ROOT"
echo "Content repo: $CONTENT_REPO"
echo "Dist directory: $DIST_DIR"
echo ""

# Step 1: Build the site
echo "Step 1: Building the Astro site..."
cd "$THEME_DIR"
pnpm astro build --outDir "$DIST_DIR"

# Step 2: Verify build output
echo ""
echo "Step 2: Verifying build output..."
if [ ! -d "$DIST_DIR/de" ] || [ ! -d "$DIST_DIR/en" ] || [ ! -d "$DIST_DIR/fr" ] || [ ! -d "$DIST_DIR/it" ]; then
    echo "ERROR: Language folders not found in dist. Build may have failed."
    exit 1
fi

PAGE_COUNT=$(find "$DIST_DIR" -name "*.html" | wc -l | tr -d ' ')
echo "Found $PAGE_COUNT HTML pages in build output."

if [ "$PAGE_COUNT" -lt 100 ]; then
    echo "ERROR: Expected at least 100 pages, found only $PAGE_COUNT. Build may have failed."
    exit 1
fi

# Step 3: Ensure required files exist
echo ""
echo "Step 3: Ensuring required files..."
echo "cinqueterre.travel" > "$DIST_DIR/CNAME"
touch "$DIST_DIR/.nojekyll"

# Step 4: Clone gh-pages branch to temp directory
echo ""
echo "Step 4: Cloning gh-pages branch..."
rm -rf "$TEMP_DEPLOY_DIR"
git clone --branch gh-pages --single-branch https://github.com/swarmpress/cinqueterre.travel.git "$TEMP_DEPLOY_DIR"

# Step 5: Clear old content (keep .git)
echo ""
echo "Step 5: Clearing old content..."
cd "$TEMP_DEPLOY_DIR"
find . -maxdepth 1 -not -name '.git' -not -name '.' -exec rm -rf {} \;

# Step 6: Copy new build
echo ""
echo "Step 6: Copying new build..."
cp -R "$DIST_DIR"/* "$TEMP_DEPLOY_DIR/"
cp "$DIST_DIR/.nojekyll" "$TEMP_DEPLOY_DIR/"

# Step 7: Configure git for commit
echo ""
echo "Step 7: Configuring git..."
cd "$TEMP_DEPLOY_DIR"
git config user.email "deploy@cinqueterre.travel"
git config user.name "Deployment Script"

# Step 8: Commit and push
echo ""
echo "Step 8: Committing and pushing..."
git add -A
COMMIT_MSG="Deploy: $(date -u '+%Y-%m-%d %H:%M:%S UTC') - $PAGE_COUNT pages"
git commit -m "$COMMIT_MSG" || echo "No changes to commit"
git push origin gh-pages

# Step 9: Cleanup
echo ""
echo "Step 9: Cleaning up..."
rm -rf "$TEMP_DEPLOY_DIR"

echo ""
echo "=== Deployment Complete ==="
echo "Site will be available at https://cinqueterre.travel/ in a few minutes."
echo "Check deployment status at: https://github.com/swarmpress/cinqueterre.travel/deployments"
