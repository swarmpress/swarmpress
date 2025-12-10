#!/bin/bash
# Start smee.io webhook proxy for local development
# This forwards GitHub webhooks to your local development server

SMEE_URL="${SMEE_WEBHOOK_URL:-https://smee.io/DGG7mVlrWR2zB1M4}"
TARGET_URL="${WEBHOOK_TARGET_URL:-http://localhost:3000/webhooks/github}"

echo "🔗 Starting webhook proxy..."
echo "   Source: $SMEE_URL"
echo "   Target: $TARGET_URL"
echo ""
echo "📝 Configure GitHub webhook:"
echo "   URL: $SMEE_URL"
echo "   Content type: application/json"
echo "   Events: Pull request reviews, Pull requests, Issue comments"
echo ""

npx smee-client --url "$SMEE_URL" --target "$TARGET_URL"
