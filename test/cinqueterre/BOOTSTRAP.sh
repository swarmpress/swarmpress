#!/bin/bash
#
# Bootstrap Cinqueterre.travel Test Environment (v2)
#
# This script:
# 1. Resets the database to a clean state
# 2. Applies the master schema (000_schema.sql)
# 3. Loads Cinqueterre test data (complete v2 with multi-language)
# 4. Verifies the setup
#
# Usage:
#   ./test/cinqueterre/BOOTSTRAP.sh           # Default: use complete-v2 dataset
#   ./test/cinqueterre/BOOTSTRAP.sh --simple  # Use simple dataset (legacy)
#

set -e  # Exit on error

echo ""
echo "========================================="
echo "Bootstrapping Cinqueterre.travel"
echo "========================================="
echo ""

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "Project root: $PROJECT_ROOT"
echo ""

# Determine which dataset to use
DATASET="setup-complete-v2.sql"
if [ "$1" == "--simple" ]; then
  DATASET="setup-simple.sql"
  echo "Using SIMPLE dataset (legacy)"
else
  echo "Using COMPLETE v2 dataset (multi-language, tools, full pages)"
fi
echo ""

# Check if Docker container is running
if ! docker ps | grep -q swarmpress-postgres; then
  echo "Error: PostgreSQL container 'swarmpress-postgres' is not running"
  echo "Start it with: docker-compose up -d"
  exit 1
fi

echo "PostgreSQL container is running"
echo ""

# Step 1: Reset database
echo "[1/4] Resetting database..."
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO swarmpress; GRANT ALL ON SCHEMA public TO public;" \
  > /dev/null 2>&1
echo "      Database reset complete"
echo ""

# Step 2: Apply schema
echo "[2/4] Applying master schema..."
cat "$PROJECT_ROOT/packages/backend/src/db/migrations/000_schema.sql" | \
  docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress \
  > /dev/null 2>&1
echo "      Schema applied (version 1.0.0)"
echo ""

# Step 3: Load test data
echo "[3/4] Loading Cinqueterre test data ($DATASET)..."
cat "$PROJECT_ROOT/test/cinqueterre/$DATASET" | \
  docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress \
  2>&1 | grep -E "^(ERROR|NOTICE|entity|count|section|info|language|department|display_name)" || true
echo "      Test data loaded"
echo ""

# Step 4: Verify
echo "[4/4] Verifying setup..."
RESULT=$(docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -t -c \
  "SELECT COUNT(*) FROM companies WHERE name = 'Cinqueterre.travel';" 2>/dev/null | tr -d ' \n')

if [ "$RESULT" = "1" ]; then
  echo "      Verification passed"
else
  echo "      Verification failed (expected 1 company, got: $RESULT)"
  exit 1
fi

echo ""
echo "========================================="
echo "Bootstrap complete!"
echo "========================================="
echo ""

# Show summary
echo "Entity Summary:"
echo "---------------"
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -t -c \
  "SELECT 'Companies' as entity, COUNT(*)::text as count FROM companies WHERE name = 'Cinqueterre.travel'
   UNION ALL SELECT 'Departments', COUNT(*)::text FROM departments WHERE company_id IN (SELECT id FROM companies WHERE name = 'Cinqueterre.travel')
   UNION ALL SELECT 'Roles', COUNT(*)::text FROM roles WHERE department_id IN (SELECT id FROM departments WHERE company_id IN (SELECT id FROM companies WHERE name = 'Cinqueterre.travel'))
   UNION ALL SELECT 'Agents', COUNT(*)::text FROM agents WHERE virtual_email LIKE '%@cinqueterre.travel'
   UNION ALL SELECT 'Websites', COUNT(*)::text FROM websites WHERE domain = 'cinqueterre.travel'
   UNION ALL SELECT 'Tool Configs', COUNT(*)::text FROM tool_configs WHERE name IN ('google_places', 'openweather', 'pexels', 'unsplash', 'wikidata', 'overpass_osm')
   UNION ALL SELECT 'Blueprints', COUNT(*)::text FROM content_blueprints WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
   UNION ALL SELECT 'Pages', COUNT(*)::text FROM pages WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
   UNION ALL SELECT 'Editorial Tasks', COUNT(*)::text FROM editorial_tasks WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
   ORDER BY entity;" 2>/dev/null

echo ""
echo "Page Distribution by Language:"
echo "------------------------------"
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -t -c \
  "SELECT COALESCE(metadata->>'lang', 'root') as lang, COUNT(*) as pages
   FROM pages WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
   GROUP BY metadata->>'lang'
   ORDER BY lang;" 2>/dev/null

echo ""
echo "Website: cinqueterre.travel"
echo ""
echo "Agents (9):"
echo "  - Sophia (Editor-in-Chief)"
echo "  - Marco (Senior Editor)"
echo "  - Isabella (Travel Writer)"
echo "  - Lorenzo (Culture Writer)"
echo "  - Giulia (Food Writer)"
echo "  - Alex (SEO Specialist)"
echo "  - Francesca (Media Coordinator)"
echo "  - Matteo (Site Engineer)"
echo "  - Elena (CEO)"
echo ""
echo "Tools (6):"
echo "  - Google Places API"
echo "  - OpenWeather API"
echo "  - Pexels Image API"
echo "  - Unsplash Image API"
echo "  - Wikidata SPARQL"
echo "  - Overpass OSM API"
echo ""
echo "Languages: English, German, French, Italian"
echo ""
echo "Next steps:"
echo "  1. Update API keys in .env (see .env.example)"
echo "  2. Start the backend API: pnpm --filter @swarm-press/backend dev"
echo "  3. Start the admin app: pnpm --filter admin dev"
echo "  4. View in admin: http://localhost:3002"
echo ""
