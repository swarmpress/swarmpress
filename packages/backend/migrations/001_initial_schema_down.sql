-- Migration 001 Rollback: Drop Initial Schema
-- Run: psql $DATABASE_URL -f 001_initial_schema_down.sql

BEGIN;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS question_tickets CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS content_items CASCADE;
DROP TABLE IF EXISTS web_pages CASCADE;
DROP TABLE IF EXISTS websites CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- Drop function
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;

COMMIT;
