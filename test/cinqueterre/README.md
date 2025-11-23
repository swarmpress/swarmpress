# Cinqueterre.travel Test Environment

Complete test setup for a virtual travel guide website powered by swarm.press AI agents.

## 🚀 Quick Start

### One-Command Bootstrap

```bash
./test/cinqueterre/BOOTSTRAP.sh
```

This script will:
1. ✅ Reset the database to a clean state
2. ✅ Apply the master schema (`000_schema.sql`)
3. ✅ Load Cinqueterre test data
4. ✅ Verify everything is working

**Result:** A fully functional test environment with:
- 1 Company (Cinqueterre.travel)
- 3 Departments (Editorial, Writers Room, SEO & Analytics)
- 3 Roles (Editor-in-Chief, Travel Writer, SEO Specialist)
- 3 AI Agents (Sophia, Isabella, Alex)
- 1 Website (cinqueterre.travel)
- 6 Pages (homepage + sections + village pages)
- 3 Editorial Tasks (ready to work on)

---

## 📦 What's Included

### Organization Structure

**Company:** Cinqueterre.travel
- Mission: Comprehensive travel information about Cinque Terre, Italy

**Departments:**
1. Editorial - Content strategy and quality management
2. Writers Room - Content creation
3. SEO & Analytics - Search optimization

### AI Agents

| Agent | Role | Email | Capabilities |
|-------|------|-------|--------------|
| **Sophia** | Editor-in-Chief | sophia@cinqueterre.travel | Editorial strategy, content planning, quality assurance |
| **Isabella** | Travel Writer | isabella@cinqueterre.travel | Destination guides, travel tips, hiking routes |
| **Alex** | SEO Specialist | alex@cinqueterre.travel | Keyword research, on-page SEO, analytics |

### Website Structure

**Domain:** cinqueterre.travel

**Pages (Sitemap):**
```
/ (homepage)
├── /villages (section page)
│   ├── /villages/monterosso
│   └── /villages/vernazza
├── /hiking (section page)
└── /food-dining (section page)
```

All pages include:
- ✅ Full SEO fields (title, description, keywords)
- ✅ Agentic features (internal_links, seo_profile)
- ✅ Status tracking
- ✅ Priority ordering

### Editorial Tasks

Three tasks ready for agents to work on:

1. **Complete Guide to Monterosso al Mare**
   - Status: `in_progress`
   - Priority: `high`
   - Assigned: Isabella
   - Target: 2,500 words
   - SEO: "Monterosso al Mare"

2. **Sentiero Azzurro Trail Guide**
   - Status: `ready`
   - Priority: `urgent`
   - Assigned: Isabella
   - Target: 3,000 words
   - SEO: "Sentiero Azzurro"

3. **Best Restaurants in Cinque Terre**
   - Status: `backlog`
   - Priority: `high`
   - Assigned: Isabella
   - Target: 2,800 words
   - SEO: "Cinque Terre restaurants"

---

## 🗂️ Files

| File | Purpose |
|------|---------|
| `BOOTSTRAP.sh` | **Main bootstrap script** - Run this! |
| `setup-simple.sql` | SQL script that loads all test data |
| `setup-cinqueterre.ts` | TypeScript alternative (optional) |
| `setup-cinqueterre-complete.sql` | Legacy file with more comprehensive data |
| `README.md` | This file |

---

## 📖 Manual Bootstrap (Step by Step)

If you prefer to run commands manually:

### Step 1: Reset Database

```bash
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO swarmpress; GRANT ALL ON SCHEMA public TO public;"
```

### Step 2: Apply Master Schema

```bash
cat packages/backend/src/db/migrations/000_schema.sql | \
  docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress
```

### Step 3: Load Test Data

```bash
cat test/cinqueterre/setup-simple.sql | \
  docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress
```

### Step 4: Verify

```bash
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -c \
  "SELECT COUNT(*) FROM agents;"
```

Should return: `3`

---

## 🔍 Exploring the Data

### View All Agents

```bash
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -c \
  "SELECT name, virtual_email, status FROM agents ORDER BY name;"
```

### View Pages

```bash
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -c \
  "SELECT slug, title, status, priority FROM pages ORDER BY priority DESC;"
```

### View Editorial Tasks

```bash
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -c \
  "SELECT title, task_type, status, priority, seo_primary_keyword FROM editorial_tasks ORDER BY priority DESC;"
```

### Check Agentic Features

```bash
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress -c \
  "SELECT slug, page_type, internal_links ? 'incoming' as has_links, seo_profile ? 'freshness_score' as has_seo FROM pages;"
```

---

## 🧪 Testing Scenarios

### Test Agent Assignment

1. Query tasks assigned to Isabella:
   ```sql
   SELECT title, status FROM editorial_tasks WHERE assigned_agent_id = (SELECT id FROM agents WHERE name = 'Isabella');
   ```

### Test Page Hierarchy

2. Get all child pages of /villages:
   ```sql
   SELECT slug, title FROM pages WHERE parent_id = (SELECT id FROM pages WHERE slug = '/villages');
   ```

### Test Editorial Workflow

3. Simulate task progress:
   ```sql
   UPDATE editorial_tasks SET status = 'in_progress', started_at = NOW() WHERE title LIKE '%Sentiero%';
   ```

---

## 🚧 Modifying Test Data

To customize the test data:

1. Edit `setup-simple.sql`
2. Add more agents, pages, or tasks
3. Re-run the bootstrap script

**Important:** The bootstrap script will **reset** the database, so any manual changes will be lost.

---

## 🐛 Troubleshooting

### "PostgreSQL container is not running"
```bash
docker-compose up -d
```

### "Permission denied"
```bash
chmod +x test/cinqueterre/BOOTSTRAP.sh
```

### "Database connection failed"
Check your `.env` file has correct database credentials:
```
DATABASE_URL=postgresql://swarmpress:swarmpress@localhost:5432/swarmpress
```

### Want to start fresh?
Just run the bootstrap script again:
```bash
./test/cinqueterre/BOOTSTRAP.sh
```

---

## 📚 Next Steps

After bootstrapping:

1. **Start the backend API:**
   ```bash
   pnpm --filter @swarm-press/backend dev
   ```

2. **Start the admin dashboard:**
   ```bash
   pnpm --filter admin dev
   ```

3. **View in browser:**
   - Admin: http://localhost:3000
   - Agents: http://localhost:3000/agents
   - Pages: http://localhost:3000/pages

4. **Test API endpoints:**
   ```bash
   curl http://localhost:3000/api/agents
   curl http://localhost:3000/api/pages
   curl http://localhost:3000/api/editorial-tasks
   ```

---

## 📝 Schema Information

This test environment uses **Schema Version 1.0.0** from:
```
packages/backend/src/db/migrations/000_schema.sql
```

The schema implements specifications from:
- `specs/specs.md` (core entities)
- `specs/sitemap-component.md` (agentic sitemap features)
- `specs/agentic_editorial_planning_spec.md` (editorial workflow)

See `CLAUDE.md` for schema development guidelines.

---

**Maintained by:** Swarm.press Team
**Last Updated:** 2025-11-23
**Schema Version:** 1.0.0
