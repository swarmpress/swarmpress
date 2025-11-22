# Database Migrations

This directory contains SQL migration files for the swarm.press PostgreSQL database.

## Structure

Migrations follow a naming convention:
```
{number}_{description}.sql       # Up migration
{number}_{description}_down.sql  # Down migration (rollback)
```

## Running Migrations

### Manually with psql

```bash
# Run migration
psql $DATABASE_URL -f migrations/001_initial_schema.sql

# Rollback migration
psql $DATABASE_URL -f migrations/001_initial_schema_down.sql
```

### Using npm scripts

```bash
# Run all migrations
pnpm --filter @swarm-press/backend run migrate

# Rollback last migration
pnpm --filter @swarm-press/backend run migrate:down
```

## Available Migrations

### 001_initial_schema.sql
Creates all core tables:
- **Organizational**: companies, departments, roles, agents
- **Publishing**: websites, web_pages, content_items
- **Workflow**: tasks, reviews, question_tickets

Features:
- UUID primary keys
- Foreign key constraints
- Check constraints for enums
- JSONB columns for flexible data
- Automatic `updated_at` triggers
- Comprehensive indexes

## Schema Overview

```
companies
  ├── departments
  │     ├── roles
  │     │     └── agents
  │     └── agents
  └── (organizational structure)

websites
  ├── web_pages
  └── content_items
        ├── tasks
        └── reviews

question_tickets (escalations)
```

## Notes

- All timestamps are `TIMESTAMP WITH TIME ZONE`
- JSONB is used for flexible metadata and content blocks
- Enum values are enforced with CHECK constraints
- Foreign keys use appropriate ON DELETE actions
- Indexes are created for common query patterns
