-- Complete Setup Script for Cinqueterre.travel Virtual Media House
-- UUID-based version for new schema
-- Run with: psql -U swarmpress -d swarmpress < setup-cinqueterre-uuids.sql

\set ON_ERROR_STOP on

BEGIN;

-- ============================================================================
-- 1. COMPANY: Cinqueterre.travel Media House
-- ============================================================================

WITH new_company AS (
  INSERT INTO companies (name, description)
  VALUES (
    'Cinqueterre.travel',
    'Virtual media house dedicated to providing comprehensive travel information about the Cinque Terre region in Italy'
  )
  RETURNING id
),

-- ============================================================================
-- 2. DEPARTMENTS
-- ============================================================================

new_dept_editorial AS (
  INSERT INTO departments (company_id, name, description)
  SELECT id, 'Editorial', 'Manages content strategy, planning, and quality for all travel content'
  FROM new_company
  RETURNING id
),
new_dept_writers AS (
  INSERT INTO departments (company_id, name, description)
  SELECT id, 'Writers Room', 'Content creation team responsible for articles, guides, and descriptions'
  FROM new_company
  RETURNING id
),
new_dept_seo AS (
  INSERT INTO departments (company_id, name, description)
  SELECT id, 'SEO & Analytics', 'Optimization and performance tracking for search visibility'
  FROM new_company
  RETURNING id
),
new_dept_media AS (
  INSERT INTO departments (company_id, name, description)
  SELECT id, 'Media Production', 'Visual content creation including images, maps, and multimedia'
  FROM new_company
  RETURNING id
),
new_dept_engineering AS (
  INSERT INTO departments (company_id, name, description)
  SELECT id, 'Engineering', 'Technical infrastructure, site building, and deployment'
  FROM new_company
  RETURNING id
),
new_dept_governance AS (
  INSERT INTO departments (company_id, name, description)
  SELECT id, 'Governance', 'Strategic oversight and high-level decision making'
  FROM new_company
  RETURNING id
),

-- ============================================================================
-- 3. ROLES
-- ============================================================================

new_role_editor_chief AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'Editor-in-Chief', 'Oversees all editorial content, strategy, and planning'
  FROM new_dept_editorial
  RETURNING id
),
new_role_editor AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'Senior Editor', 'Reviews and approves content for publication'
  FROM new_dept_editorial
  RETURNING id
),
new_role_writer_travel AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'Travel Writer', 'Specializes in destination guides and travel narratives'
  FROM new_dept_writers
  RETURNING id
),
new_role_writer_culture AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'Culture Writer', 'Focuses on local culture, history, and traditions'
  FROM new_dept_writers
  RETURNING id
),
new_role_writer_food AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'Food & Dining Writer', 'Covers restaurants, cuisine, and culinary experiences'
  FROM new_dept_writers
  RETURNING id
),
new_role_seo AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'SEO Specialist', 'Optimizes content for search engines and tracks performance'
  FROM new_dept_seo
  RETURNING id
),
new_role_media AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'Media Coordinator', 'Sources and manages visual assets and multimedia content'
  FROM new_dept_media
  RETURNING id
),
new_role_engineer AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'Site Engineer', 'Builds and maintains the website infrastructure'
  FROM new_dept_engineering
  RETURNING id
),
new_role_ceo AS (
  INSERT INTO roles (department_id, name, description)
  SELECT id, 'CEO', 'Final approval authority and strategic direction'
  FROM new_dept_governance
  RETURNING id
),

-- ============================================================================
-- 4. AI AGENTS
-- ============================================================================

new_agent_sophia AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Sophia',
    r.id,
    d.id,
    'Strategic and detail-oriented editorial leader with deep knowledge of travel content. Passionate about authentic storytelling and reader experience.',
    'sophia@cinqueterre.travel',
    '["editorial_strategy", "content_planning", "quality_assurance", "team_coordination", "workflow_management"]'::jsonb,
    'active'
  FROM new_role_editor_chief r, new_dept_editorial d
  RETURNING id
),
new_agent_marco AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Marco',
    r.id,
    d.id,
    'Meticulous editor with a keen eye for detail and authentic Italian perspective. Ensures accuracy and engaging narratives.',
    'marco@cinqueterre.travel',
    '["content_review", "fact_checking", "style_editing", "grammar_polish", "cultural_accuracy"]'::jsonb,
    'active'
  FROM new_role_editor r, new_dept_editorial d
  RETURNING id
),
new_agent_isabella AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Isabella',
    r.id,
    d.id,
    'Adventurous travel writer who has extensively explored the Italian Riviera. Brings destinations to life with vivid descriptions.',
    'isabella@cinqueterre.travel',
    '["destination_guides", "travel_tips", "hiking_routes", "transportation", "itinerary_planning"]'::jsonb,
    'active'
  FROM new_role_writer_travel r, new_dept_writers d
  RETURNING id
),
new_agent_lorenzo AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Lorenzo',
    r.id,
    d.id,
    'Cultural historian and storyteller passionate about preserving and sharing Italian heritage and traditions.',
    'lorenzo@cinqueterre.travel',
    '["cultural_history", "local_traditions", "architectural_insights", "festival_coverage", "storytelling"]'::jsonb,
    'active'
  FROM new_role_writer_culture r, new_dept_writers d
  RETURNING id
),
new_agent_giulia AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Giulia',
    r.id,
    d.id,
    'Food enthusiast and culinary expert specializing in Ligurian cuisine. Knows every trattoria and hidden gem.',
    'giulia@cinqueterre.travel',
    '["restaurant_reviews", "recipe_sharing", "wine_coverage", "food_culture", "culinary_tours"]'::jsonb,
    'active'
  FROM new_role_writer_food r, new_dept_writers d
  RETURNING id
),
new_agent_alex AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Alex',
    r.id,
    d.id,
    'Data-driven SEO strategist focused on organic growth and user intent. Balances optimization with quality.',
    'alex@cinqueterre.travel',
    '["keyword_research", "on_page_seo", "technical_seo", "analytics", "performance_tracking"]'::jsonb,
    'active'
  FROM new_role_seo r, new_dept_seo d
  RETURNING id
),
new_agent_francesca AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Francesca',
    r.id,
    d.id,
    'Visual storyteller with an eye for capturing the beauty of Cinque Terre through imagery and multimedia.',
    'francesca@cinqueterre.travel',
    '["image_sourcing", "photo_editing", "map_creation", "video_coordination", "visual_storytelling"]'::jsonb,
    'active'
  FROM new_role_media r, new_dept_media d
  RETURNING id
),
new_agent_matteo AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Matteo',
    r.id,
    d.id,
    'Technical expert ensuring the website is fast, reliable, and delivers exceptional user experience.',
    'matteo@cinqueterre.travel',
    '["site_building", "performance_optimization", "deployment", "technical_troubleshooting", "infrastructure"]'::jsonb,
    'active'
  FROM new_role_engineer r, new_dept_engineering d
  RETURNING id
),
new_agent_elena AS (
  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status)
  SELECT
    'Elena',
    r.id,
    d.id,
    'Visionary leader guiding the strategic direction of Cinqueterre.travel with focus on sustainable growth and quality.',
    'elena@cinqueterre.travel',
    '["strategic_planning", "final_approvals", "partnership_development", "brand_vision", "decision_making"]'::jsonb,
    'active'
  FROM new_role_ceo r, new_dept_governance d
  RETURNING id
),

-- ============================================================================
-- 5. WEBSITE
-- ============================================================================

new_website AS (
  INSERT INTO websites (company_id, domain, title, description, status, metadata)
  SELECT
    id,
    'cinqueterre.travel',
    'Cinqueterre.travel - Your Complete Guide to the Italian Riviera',
    'The ultimate travel resource for Cinque Terre, featuring comprehensive guides to all five villages, hiking trails, restaurants, hotels, weather information, and local culture.',
    'active',
    jsonb_build_object(
      'primary_language', 'en',
      'additional_languages', ARRAY['it', 'de', 'fr'],
      'target_audience', 'International travelers planning trips to Cinque Terre',
      'content_types', ARRAY['destination_guides', 'practical_info', 'cultural_insights', 'food_dining'],
      'seo_focus', 'Cinque Terre travel, Italian Riviera, Liguria tourism'
    )
  FROM new_company
  RETURNING id
),

-- ============================================================================
-- 6. SITEMAP PAGES (Core Structure)
-- ============================================================================

new_page_home AS (
  INSERT INTO pages (website_id, slug, title, status, metadata, priority, seo_title, seo_description)
  SELECT
    id,
    '/',
    'Cinqueterre.travel - Your Guide to Paradise',
    'published',
    '{}'::jsonb,
    1,
    'Cinque Terre Travel Guide 2025 | Complete Visitor Information',
    'Plan your perfect Cinque Terre trip with our comprehensive guide covering all 5 villages, hiking trails, restaurants, hotels, and insider tips.'
  FROM new_website
  RETURNING id
),
new_page_villages AS (
  INSERT INTO pages (website_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    id,
    '/villages',
    'The Five Villages of Cinque Terre',
    'section',
    'published',
    '{"seo_title": "The 5 Villages of Cinque Terre | Complete Guide", "meta_description": "Explore all five villages: Monterosso, Vernazza, Corniglia, Manarola, and Riomaggiore. History, attractions, and what makes each unique."}'::jsonb,
    2
  FROM new_website
  RETURNING id
),
new_page_hiking AS (
  INSERT INTO pages (website_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    id,
    '/hiking',
    'Hiking Trails & Routes',
    'section',
    'published',
    '{"seo_title": "Cinque Terre Hiking Trails Guide | Sentiero Azzurro & More", "meta_description": "Complete guide to hiking in Cinque Terre including Sentiero Azzurro, Via dell Amore, difficulty levels, and trail conditions."}'::jsonb,
    3
  FROM new_website
  RETURNING id
),
new_page_food AS (
  INSERT INTO pages (website_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    id,
    '/food-dining',
    'Food & Dining',
    'section',
    'published',
    '{"seo_title": "Cinque Terre Restaurants & Food Guide | Ligurian Cuisine", "meta_description": "Discover the best restaurants, trattorias, and local specialties in Cinque Terre. Ligurian cuisine, seafood, pesto, and wine."}'::jsonb,
    4
  FROM new_website
  RETURNING id
),
new_page_hotels AS (
  INSERT INTO pages (website_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    id,
    '/accommodation',
    'Where to Stay',
    'section',
    'published',
    '{"seo_title": "Cinque Terre Hotels & Accommodation | Where to Stay Guide", "meta_description": "Find the perfect place to stay in Cinque Terre. Hotels, B&Bs, vacation rentals by village with booking tips."}'::jsonb,
    5
  FROM new_website
  RETURNING id
),
new_page_plan AS (
  INSERT INTO pages (website_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    id,
    '/plan-your-trip',
    'Plan Your Trip',
    'section',
    'published',
    '{"seo_title": "Plan Your Cinque Terre Trip | Itineraries, Tips & Practical Info", "meta_description": "Everything you need to plan your Cinque Terre visit: best time to go, how to get there, itineraries, and practical tips."}'::jsonb,
    6
  FROM new_website
  RETURNING id
),

-- Village Detail Pages
new_page_monterosso AS (
  INSERT INTO pages (website_id, parent_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    w.id,
    p.id,
    '/villages/monterosso',
    'Monterosso al Mare',
    'village_detail',
    'published',
    '{"seo_title": "Monterosso al Mare Guide | Beaches, Hotels & Things to Do", "meta_description": "Complete guide to Monterosso, the largest Cinque Terre village known for its beaches, old town, and relaxed atmosphere."}'::jsonb,
    1
  FROM new_website w, new_page_villages p
  RETURNING id
),
new_page_vernazza AS (
  INSERT INTO pages (website_id, parent_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    w.id,
    p.id,
    '/villages/vernazza',
    'Vernazza',
    'village_detail',
    'published',
    '{"seo_title": "Vernazza Cinque Terre | Harbor, Castle & Visitor Guide", "meta_description": "Discover Vernazza, often called the jewel of Cinque Terre, with its picturesque harbor, medieval castle, and charming piazza."}'::jsonb,
    2
  FROM new_website w, new_page_villages p
  RETURNING id
),
new_page_corniglia AS (
  INSERT INTO pages (website_id, parent_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    w.id,
    p.id,
    '/villages/corniglia',
    'Corniglia',
    'village_detail',
    'published',
    '{"seo_title": "Corniglia Guide | The Hilltop Village of Cinque Terre", "meta_description": "Explore Corniglia, the only Cinque Terre village perched high on a cliff, offering stunning views and authentic atmosphere."}'::jsonb,
    3
  FROM new_website w, new_page_villages p
  RETURNING id
),
new_page_manarola AS (
  INSERT INTO pages (website_id, parent_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    w.id,
    p.id,
    '/villages/manarola',
    'Manarola',
    'village_detail',
    'published',
    '{"seo_title": "Manarola Cinque Terre | Photography, Wine & Village Guide", "meta_description": "Manarola guide: iconic rainbow houses, Via dell Amore trail, local wine, and the most photographed spot in Cinque Terre."}'::jsonb,
    4
  FROM new_website w, new_page_villages p
  RETURNING id
),
new_page_riomaggiore AS (
  INSERT INTO pages (website_id, parent_id, slug, title, page_type, status, metadata, display_order)
  SELECT
    w.id,
    p.id,
    '/villages/riomaggiore',
    'Riomaggiore',
    'village_detail',
    'published',
    '{"seo_title": "Riomaggiore Guide | Main Street, Marina & Things to Do", "meta_description": "Riomaggiore, the southernmost Cinque Terre village, with its steep terraced vineyards, colorful buildings, and vibrant atmosphere."}'::jsonb,
    5
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
    'Comprehensive guide covering history, beaches, attractions, restaurants, hotels, and practical information for Monterosso',
    'article',
    'in_progress',
    'high',
    a.id,
    CURRENT_DATE + INTERVAL '7 days',
    12.0,
    ARRAY['monterosso', 'village-guide', 'beaches'],
    'Monterosso al Mare',
    ARRAY['Monterosso beach', 'Monterosso hotels', 'things to do Monterosso', 'Old Town Monterosso'],
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
    'Complete Guide to Vernazza',
    'In-depth guide to Vernazza covering harbor, castle, hiking access, dining, and accommodation',
    'article',
    'ready',
    'high',
    a.id,
    CURRENT_DATE + INTERVAL '10 days',
    12.0,
    ARRAY['vernazza', 'village-guide', 'harbor'],
    'Vernazza Cinque Terre',
    ARRAY['Vernazza harbor', 'Vernazza castle', 'Vernazza restaurants', 'Vernazza Italy'],
    2500,
    'comprehensive_guide',
    ARRAY[p.id],
    'research'
  FROM new_website w, new_agent_isabella a, new_page_vernazza p
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
    'Sentiero Azzurro Trail Guide',
    'Complete guide to the Blue Trail connecting all five villages with practical information, difficulty levels, and booking details',
    'article',
    'in_review',
    'urgent',
    a.id,
    CURRENT_DATE + INTERVAL '3 days',
    15.0,
    ARRAY['hiking', 'sentiero-azzurro', 'trails'],
    'Sentiero Azzurro',
    ARRAY['Blue Trail Cinque Terre', 'Cinque Terre hiking', 'trail conditions', 'hiking permits'],
    3000,
    'trail_guide',
    ARRAY[p.id],
    'review'
  FROM new_website w, new_agent_isabella a, new_page_hiking p
  RETURNING id
),
new_task_004 AS (
  INSERT INTO editorial_tasks (
    website_id, title, description, task_type, status, priority,
    assigned_agent_id, due_date, estimated_hours, tags,
    seo_primary_keyword, seo_secondary_keywords, word_count_target,
    content_type, sitemap_targets, current_phase
  )
  SELECT
    w.id,
    'Top 15 Restaurants in Cinque Terre',
    'Curated list of best restaurants across all five villages with specialties and price ranges',
    'article',
    'ready',
    'high',
    a.id,
    CURRENT_DATE + INTERVAL '12 days',
    10.0,
    ARRAY['restaurants', 'food', 'dining'],
    'Cinque Terre restaurants',
    ARRAY['best restaurants Cinque Terre', 'where to eat Cinque Terre', 'Ligurian cuisine'],
    2800,
    'listicle',
    ARRAY[p.id],
    'research'
  FROM new_website w, new_agent_giulia a, new_page_food p
  RETURNING id
),
new_task_005 AS (
  INSERT INTO editorial_tasks (
    website_id, title, description, task_type, status, priority,
    assigned_agent_id, due_date, estimated_hours, tags,
    seo_primary_keyword, seo_secondary_keywords, word_count_target,
    content_type, sitemap_targets, current_phase
  )
  SELECT
    w.id,
    'Best Time to Visit Cinque Terre',
    'Seasonal guide covering weather, crowds, prices, and events throughout the year',
    'article',
    'ready',
    'high',
    a.id,
    CURRENT_DATE + INTERVAL '8 days',
    7.0,
    ARRAY['planning', 'seasonal', 'weather'],
    'best time to visit Cinque Terre',
    ARRAY['Cinque Terre weather', 'Cinque Terre in summer', 'Cinque Terre in winter', 'Cinque Terre seasons'],
    1800,
    'seasonal_guide',
    ARRAY[p.id],
    'research'
  FROM new_website w, new_agent_isabella a, new_page_plan p
  RETURNING id
)

-- Final SELECT to show what was created
SELECT
  'Setup complete!' as message,
  (SELECT id FROM new_company) as company_id,
  (SELECT id FROM new_website) as website_id,
  (SELECT COUNT(*) FROM new_agent_sophia UNION ALL
   SELECT COUNT(*) FROM new_agent_marco UNION ALL
   SELECT COUNT(*) FROM new_agent_isabella UNION ALL
   SELECT COUNT(*) FROM new_agent_lorenzo UNION ALL
   SELECT COUNT(*) FROM new_agent_giulia UNION ALL
   SELECT COUNT(*) FROM new_agent_alex UNION ALL
   SELECT COUNT(*) FROM new_agent_francesca UNION ALL
   SELECT COUNT(*) FROM new_agent_matteo UNION ALL
   SELECT COUNT(*) FROM new_agent_elena) as agents_created;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

\echo '\n=== Cinqueterre.travel Setup Complete ==='
\echo ''

SELECT 'Companies' as entity, COUNT(*) as count FROM companies WHERE name = 'Cinqueterre.travel'
UNION ALL
SELECT 'Departments', COUNT(*) FROM departments d
  JOIN companies c ON d.company_id = c.id
  WHERE c.name = 'Cinqueterre.travel'
UNION ALL
SELECT 'Roles', COUNT(*) FROM roles r
  JOIN departments d ON r.department_id = d.id
  JOIN companies c ON d.company_id = c.id
  WHERE c.name = 'Cinqueterre.travel'
UNION ALL
SELECT 'Agents', COUNT(*) FROM agents a
  JOIN departments d ON a.department_id = d.id
  JOIN companies c ON d.company_id = c.id
  WHERE c.name = 'Cinqueterre.travel'
UNION ALL
SELECT 'Websites', COUNT(*) FROM websites WHERE domain = 'cinqueterre.travel'
UNION ALL
SELECT 'Pages', COUNT(*) FROM pages p
  JOIN websites w ON p.website_id = w.id
  WHERE w.domain = 'cinqueterre.travel'
UNION ALL
SELECT 'Editorial Tasks', COUNT(*) FROM editorial_tasks t
  JOIN websites w ON t.website_id = w.id
  WHERE w.domain = 'cinqueterre.travel';
