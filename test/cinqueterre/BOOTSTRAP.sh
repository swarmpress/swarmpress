#!/bin/bash
#
# Bootstrap Cinqueterre.travel Test Environment
#
# This script:
# 1. Resets the database to a clean state
# 2. Applies the master schema (000_schema.sql)
# 3. Loads Cinqueterre test data
# 4. Verifies the setup
#

set -e  # Exit on error

echo "🏖️  Bootstrapping Cinqueterre.travel test environment..."
echo ""

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "📍 Project root: $PROJECT_ROOT"
echo ""

# Check if Docker container is running
if ! docker ps | grep -q swarmpress-postgres; then
  echo "❌ Error: PostgreSQL container 'swarmpress-postgres' is not running"
  echo "   Start it with: docker-compose up -d"
  exit 1
fi

echo "✅ PostgreSQL container is running"
echo ""

# Step 1: Reset database
echo "🗑️  Step 1/4: Resetting database..."
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO swarmpress; GRANT ALL ON SCHEMA public TO public;" \
  > /dev/null 2>&1
echo "   ✅ Database reset complete"
echo ""

# Step 2: Apply schema
echo "🏗️  Step 2/4: Applying master schema..."
cat "$PROJECT_ROOT/packages/backend/src/db/migrations/000_schema.sql" | \
  docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress \
  > /dev/null 2>&1
echo "   ✅ Schema applied (version 1.0.0)"
echo ""

# Step 3: Load test data
echo "📝 Step 3/4: Loading Cinqueterre test data..."
cat "$PROJECT_ROOT/test/cinqueterre/setup-simple.sql" | \
  docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress \
  > /dev/null 2>&1
echo "   ✅ Test data loaded"
echo ""

# Step 4: Verify
echo "🔍 Step 4/4: Verifying setup..."
RESULT=$(docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -t -c \
  "SELECT COUNT(*) FROM companies;" 2>/dev/null | tr -d ' ')

if [ "$RESULT" -eq "1" ]; then
  echo "   ✅ Verification passed"
else
  echo "   ❌ Verification failed"
  exit 1
fi

echo ""
echo "========================================="
echo "🎉 Bootstrap complete!"
echo "========================================="
echo ""
echo "📊 Summary:"
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -c \
  "SELECT 'Companies' as entity, COUNT(*)::text as count FROM companies
   UNION ALL SELECT 'Departments', COUNT(*)::text FROM departments
   UNION ALL SELECT 'Roles', COUNT(*)::text FROM roles
   UNION ALL SELECT 'Agents', COUNT(*)::text FROM agents
   UNION ALL SELECT 'Websites', COUNT(*)::text FROM websites
   UNION ALL SELECT 'Pages', COUNT(*)::text FROM pages
   UNION ALL SELECT 'Editorial Tasks', COUNT(*)::text FROM editorial_tasks
   ORDER BY entity;" 2>/dev/null

echo ""
echo "🌐 Website: cinqueterre.travel"
echo "👥 Agents: Sophia (Editor), Isabella (Writer), Alex (SEO)"
echo "📄 Pages: 6 (homepage + 5 section/village pages)"
echo "📋 Tasks: 3 editorial tasks ready to work on"
echo ""
echo "💡 Next steps:"
echo "   - Start the backend API: pnpm --filter @swarm-press/backend dev"
echo "   - Start the admin app: pnpm --filter admin dev"
echo "   - View agents in admin: http://localhost:3000/agents"
echo ""
