-- Simple Cinqueterre.travel Setup Script
-- Matches the actual 001_complete_schema.sql structure
-- Run with: docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress < test/cinqueterre/setup-simple.sql

\set ON_ERROR_STOP on

BEGIN;

-- ============================================================================
-- 1. COMPANY
-- ============================================================================

WITH new_company AS (
  INSERT INTO companies (name, description)
  VALUES (
    'Cinqueterre.travel',
    'Virtual media house for comprehensive Cinque Terre travel information'
  )
  RETURNING id
),

-- ============================================================================
-- 2. DEPARTMENTS
-- ============================================================================

new_dept_editorial AS (
  INSERT INTO departments (company_id, name, description)
  SELECT id, 'Editorial', 'Content strategy and quality management'
  FROM new_company
  RETURNING id
),
new_dept_writers AS (
  INSERT INTO departments (company_id, name, description)
  SELECT id, 'Writers Room', 'Content creation team'
  FROM new_company
  RETURNING id
),
new_dept_seo AS (
  INSERT INTO departments (company_id, name, description)
  SELECT id, 'SEO & Analytics', 'Search optimization and performance'
  FROM new_company
  RETURNING id
),

-- ============================================================================
-- 3. ROLES
-- ============================================================================

new_role_editor_chief AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'Editor-in-Chief', 'Editorial oversight'
  FROM new_dept_editorial
  RETURNING id
),
new_role_writer_travel AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'Travel Writer', 'Destination guides and travel content'
  FROM new_dept_writers
  RETURNING id
),
new_role_seo AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'SEO Specialist', 'Search optimization'
  FROM new_dept_seo
  RETURNING id
),

-- ============================================================================
-- 4. AGENTS
-- ============================================================================

new_agent_sophia AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Sophia',
    r.id,
    d.id,
    'Strategic editorial leader with travel content expertise',
    'sophia@cinqueterre.travel',
    '["editorial_strategy", "content_planning", "quality_assurance"]'::jsonb,
    'active'
  FROM new_role_editor_chief r, new_dept_editorial d
  RETURNING id
),
new_agent_isabella AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Isabella',
    r.id,
    d.id,
    'Adventurous travel writer specializing in Italian Riviera',
    'isabella@cinqueterre.travel',
    '["destination_guides", "travel_tips", "hiking_routes"]'::jsonb,
    'active'
  FROM new_role_writer_travel r, new_dept_writers d
  RETURNING id
),
new_agent_alex AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Alex',
    r.id,
    d.id,
    'Data-driven SEO strategist',
    'alex@cinqueterre.travel',
    '["keyword_research", "on_page_seo", "analytics"]'::jsonb,
    'active'
  FROM new_role_seo r, new_dept_seo d
  RETURNING id
),

-- ============================================================================
-- 5. WEBSITE
-- ============================================================================

new_website AS (
  INSERT INTO websites (company_id, domain, title, description, language, status, metadata)
  SELECT
    id,
    'cinqueterre.travel',
    'Cinqueterre.travel - Your Complete Guide to the Italian Riviera',
    'The ultimate travel resource for Cinque Terre with comprehensive guides',
    'en',
    'active',
    jsonb_build_object(
      'target_audience', 'International travelers',
      'content_focus', 'Cinque Terre travel guides'
    )
  FROM new_company
  RETURNING id
),

-- ============================================================================
-- 6. PAGES (Sitemap Structure)
-- ============================================================================

-- Homepage
new_page_home AS (
  INSERT INTO pages (website_id, slug, title, status, priority, metadata, seo_title, seo_description)
  SELECT
    id,
    '/',
    'Cinqueterre.travel - Your Guide to Paradise',
    'published',
    100,
    '{}'::jsonb,
    'Cinque Terre Travel Guide 2025 | Complete Visitor Information',
    'Plan your perfect Cinque Terre trip with our comprehensive guide.'
  FROM new_website
  RETURNING id
),

-- Section Pages
new_page_villages AS (
  INSERT INTO pages (website_id, slug, title, status, priority, seo_title, seo_description)
  SELECT
    id,
    '/villages',
    'The Five Villages of Cinque Terre',
    'published',
    90,
    'The 5 Villages of Cinque Terre | Complete Guide',
    'Explore all five villages: Monterosso, Vernazza, Corniglia, Manarola, and Riomaggiore.'
  FROM new_website
  RETURNING id
),
new_page_hiking AS (
  INSERT INTO pages (website_id, slug, title, status, priority, seo_title, seo_description)
  SELECT
    id,
    '/hiking',
    'Hiking Trails & Routes',
    'published',
    90,
    'Cinque Terre Hiking Trails Guide | Sentiero Azzurro & More',
    'Complete guide to hiking in Cinque Terre.'
  FROM new_website
  RETURNING id
),
new_page_food AS (
  INSERT INTO pages (website_id, slug, title, status, priority, seo_title, seo_description)
  SELECT
    id,
    '/food-dining',
    'Food & Dining',
    'published',
    80,
    'Cinque Terre Restaurants & Food Guide',
    'Discover the best restaurants and local cuisine.'
  FROM new_website
  RETURNING id
),

-- Village Detail Pages (children of /villages)
new_page_monterosso AS (
  INSERT INTO pages (website_id, parent_id, slug, title, status, priority, seo_title, seo_description)
  SELECT
    w.id,
    p.id,
    '/villages/monterosso',
    'Monterosso al Mare',
    'published',
    85,
    'Monterosso al Mare Guide | Beaches & Things to Do',
    'Complete guide to Monterosso, the largest Cinque Terre village.'
  FROM new_website w, new_page_villages p
  RETURNING id
),
new_page_vernazza AS (
  INSERT INTO pages (website_id, parent_id, slug, title, status, priority, seo_title, seo_description)
  SELECT
    w.id,
    p.id,
    '/villages/vernazza',
    'Vernazza',
    'published',
    85,
    'Vernazza Cinque Terre | Harbor & Castle Guide',
    'Discover Vernazza, the jewel of Cinque Terre.'
  FROM new_website w, new_page_villages p
  RETURNING id
),

-- ============================================================================
-- 7. EDITORIAL TASKS
-- ============================================================================

new_task_001 AS (
  INSERT INTO editorial_tasks (
    website_id, title, description, task_type, status, priority,
    assigned_agent_id, due_date, estimated_hours, tags,
    seo_primary_keyword, seo_secondary_keywords, word_count_target,
    content_type, sitemap_targets, current_phase
  )
  SELECT
    w.id,
    'Complete Guide to Monterosso al Mare',
    'Comprehensive guide covering beaches, attractions, restaurants, and hotels',
    'article',
    'in_progress',
    'high',
    a.id,
    CURRENT_DATE + INTERVAL '7 days',
    12.0,
    ARRAY['monterosso', 'village-guide', 'beaches'],
    'Monterosso al Mare',
    ARRAY['Monterosso beach', 'Monterosso hotels', 'things to do Monterosso'],
    2500,
    'comprehensive_guide',
    ARRAY[p.id],
    'draft'
  FROM new_website w, new_agent_isabella a, new_page_monterosso p
  RETURNING id
),
new_task_002 AS (
  INSERT INTO editorial_tasks (
    website_id, title, description, task_type, status, priority,
    assigned_agent_id, due_date, estimated_hours, tags,
    seo_primary_keyword, seo_secondary_keywords, word_count_target,
    content_type, sitemap_targets, current_phase
  )
  SELECT
    w.id,
    'Sentiero Azzurro Trail Guide',
    'Complete guide to the Blue Trail connecting all five villages',
    'article',
    'ready',
    'urgent',
    a.id,
    CURRENT_DATE + INTERVAL '3 days',
    15.0,
    ARRAY['hiking', 'sentiero-azzurro', 'trails'],
    'Sentiero Azzurro',
    ARRAY['Blue Trail Cinque Terre', 'Cinque Terre hiking', 'trail conditions'],
    3000,
    'trail_guide',
    ARRAY[p.id],
    'research'
  FROM new_website w, new_agent_isabella a, new_page_hiking p
  RETURNING id
),
new_task_003 AS (
  INSERT INTO editorial_tasks (
    website_id, title, description, task_type, status, priority,
    assigned_agent_id, due_date, estimated_hours, tags,
    seo_primary_keyword, seo_secondary_keywords, word_count_target,
    content_type, sitemap_targets, current_phase
  )
  SELECT
    w.id,
    'Best Restaurants in Cinque Terre',
    'Curated list of top restaurants across all five villages',
    'article',
    'backlog',
    'high',
    a.id,
    CURRENT_DATE + INTERVAL '12 days',
    10.0,
    ARRAY['restaurants', 'food', 'dining'],
    'Cinque Terre restaurants',
    ARRAY['best restaurants Cinque Terre', 'where to eat'],
    2800,
    'listicle',
    ARRAY[p.id],
    NULL
  FROM new_website w, new_agent_isabella a, new_page_food p
  RETURNING id
)

-- Final output
SELECT 'Cinqueterre.travel setup complete!' as status;

COMMIT;

-- Verification
\echo ''
\echo '=== Setup Summary ==='

SELECT 'Companies' as entity, COUNT(*) as count FROM companies
UNION ALL
SELECT 'Departments', COUNT(*) FROM departments
UNION ALL
SELECT 'Roles', COUNT(*) FROM roles
UNION ALL
SELECT 'Agents', COUNT(*) FROM agents
UNION ALL
SELECT 'Websites', COUNT(*) FROM websites
UNION ALL
SELECT 'Pages', COUNT(*) FROM pages
UNION ALL
SELECT 'Editorial Tasks', COUNT(*) FROM editorial_tasks;
