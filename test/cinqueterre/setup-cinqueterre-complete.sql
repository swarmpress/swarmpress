-- Complete Setup Script for Cinqueterre.travel Virtual Media House
-- Run with: docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress < setup-cinqueterre-complete.sql

BEGIN;

-- ============================================================================
-- 1. COMPANY: Cinqueterre.travel Media House
-- ============================================================================

-- Store generated IDs for reference
DO $$
DECLARE
  v_company_id UUID := gen_random_uuid();
  v_dept_editorial UUID := gen_random_uuid();
  v_dept_writers UUID := gen_random_uuid();
  v_dept_seo UUID := gen_random_uuid();
  v_dept_media UUID := gen_random_uuid();
  v_dept_engineering UUID := gen_random_uuid();
  v_dept_governance UUID := gen_random_uuid();
  v_website_id UUID := gen_random_uuid();
BEGIN

-- Create the company
INSERT INTO companies (id, name, description, metadata)
VALUES (
  v_company_id,
  'Cinqueterre.travel',
  'Virtual media house dedicated to providing comprehensive travel information about the Cinque Terre region in Italy',
  jsonb_build_object(
    'founded', '2025',
    'mission', 'To be the definitive guide for travelers exploring the Italian Riviera',
    'headquarters', 'Virtual - Italy',
    'languages', ARRAY['English', 'Italian', 'German', 'French']
  )
);

-- ============================================================================
-- 2. DEPARTMENTS
-- ============================================================================

INSERT INTO departments (id, company_id, name, description) VALUES
  -- Editorial Department
  ('ct-dept-editorial', 'ct-company-001', 'Editorial',
   'Manages content strategy, planning, and quality for all travel content'),

  -- Writers Room
  ('ct-dept-writers', 'ct-company-001', 'Writers Room',
   'Content creation team responsible for articles, guides, and descriptions'),

  -- SEO & Analytics
  ('ct-dept-seo', 'ct-company-001', 'SEO & Analytics',
   'Optimization and performance tracking for search visibility'),

  -- Media Production
  ('ct-dept-media', 'ct-company-001', 'Media Production',
   'Visual content creation including images, maps, and multimedia'),

  -- Engineering
  ('ct-dept-engineering', 'ct-company-001', 'Engineering',
   'Technical infrastructure, site building, and deployment'),

  -- Governance
  ('ct-dept-governance', 'ct-company-001', 'Governance',
   'Strategic oversight and high-level decision making')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- ============================================================================
-- 3. ROLES
-- ============================================================================

INSERT INTO roles (id, department_id, name, description) VALUES
  -- Editorial Roles
  ('ct-role-editor-chief', 'ct-dept-editorial', 'Editor-in-Chief',
   'Oversees all editorial content, strategy, and planning'),
  ('ct-role-editor', 'ct-dept-editorial', 'Senior Editor',
   'Reviews and approves content for publication'),

  -- Writer Roles
  ('ct-role-writer-travel', 'ct-dept-writers', 'Travel Writer',
   'Specializes in destination guides and travel narratives'),
  ('ct-role-writer-culture', 'ct-dept-writers', 'Culture Writer',
   'Focuses on local culture, history, and traditions'),
  ('ct-role-writer-food', 'ct-dept-writers', 'Food & Dining Writer',
   'Covers restaurants, cuisine, and culinary experiences'),

  -- SEO Role
  ('ct-role-seo', 'ct-dept-seo', 'SEO Specialist',
   'Optimizes content for search engines and tracks performance'),

  -- Media Role
  ('ct-role-media', 'ct-dept-media', 'Media Coordinator',
   'Sources and manages visual assets and multimedia content'),

  -- Engineering Role
  ('ct-role-engineer', 'ct-dept-engineering', 'Site Engineer',
   'Builds and maintains the website infrastructure'),

  -- Governance Role
  ('ct-role-ceo', 'ct-dept-governance', 'CEO',
   'Final approval authority and strategic direction')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- ============================================================================
-- 4. AI AGENTS
-- ============================================================================

INSERT INTO agents (id, name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
  -- Editorial Team
  (
    'ct-agent-sophia',
    'Sophia',
    'ct-role-editor-chief',
    'ct-dept-editorial',
    'Strategic and detail-oriented editorial leader with deep knowledge of travel content. Passionate about authentic storytelling and reader experience.',
    'sophia@cinqueterre.travel',
    '["editorial_strategy", "content_planning", "quality_assurance", "team_coordination", "workflow_management"]'::jsonb,
    'active'
  ),
  (
    'ct-agent-marco',
    'Marco',
    'ct-role-editor',
    'ct-dept-editorial',
    'Meticulous editor with a keen eye for detail and authentic Italian perspective. Ensures accuracy and engaging narratives.',
    'marco@cinqueterre.travel',
    '["content_review", "fact_checking", "style_editing", "grammar_polish", "cultural_accuracy"]'::jsonb,
    'active'
  ),

  -- Writers Team
  (
    'ct-agent-isabella',
    'Isabella',
    'ct-role-writer-travel',
    'ct-dept-writers',
    'Adventurous travel writer who has extensively explored the Italian Riviera. Brings destinations to life with vivid descriptions.',
    'isabella@cinqueterre.travel',
    '["destination_guides", "travel_tips", "hiking_routes", "transportation", "itinerary_planning"]'::jsonb,
    'active'
  ),
  (
    'ct-agent-lorenzo',
    'Lorenzo',
    'ct-role-writer-culture',
    'ct-dept-writers',
    'Cultural historian and storyteller passionate about preserving and sharing Italian heritage and traditions.',
    'lorenzo@cinqueterre.travel',
    '["cultural_history", "local_traditions", "architectural_insights", "festival_coverage", "storytelling"]'::jsonb,
    'active'
  ),
  (
    'ct-agent-giulia',
    'Giulia',
    'ct-role-writer-food',
    'ct-dept-writers',
    'Food enthusiast and culinary expert specializing in Ligurian cuisine. Knows every trattoria and hidden gem.',
    'giulia@cinqueterre.travel',
    '["restaurant_reviews", "recipe_sharing", "wine_coverage", "food_culture", "culinary_tours"]'::jsonb,
    'active'
  ),

  -- SEO Specialist
  (
    'ct-agent-alex',
    'Alex',
    'ct-role-seo',
    'ct-dept-seo',
    'Data-driven SEO strategist focused on organic growth and user intent. Balances optimization with quality.',
    'alex@cinqueterre.travel',
    '["keyword_research", "on_page_seo", "technical_seo", "analytics", "performance_tracking"]'::jsonb,
    'active'
  ),

  -- Media Coordinator
  (
    'ct-agent-francesca',
    'Francesca',
    'ct-role-media',
    'ct-dept-media',
    'Visual storyteller with an eye for capturing the beauty of Cinque Terre through imagery and multimedia.',
    'francesca@cinqueterre.travel',
    '["image_sourcing", "photo_editing", "map_creation", "video_coordination", "visual_storytelling"]'::jsonb,
    'active'
  ),

  -- Site Engineer
  (
    'ct-agent-matteo',
    'Matteo',
    'ct-role-engineer',
    'ct-dept-engineering',
    'Technical expert ensuring the website is fast, reliable, and delivers exceptional user experience.',
    'matteo@cinqueterre.travel',
    '["site_building", "performance_optimization", "deployment", "technical_troubleshooting", "infrastructure"]'::jsonb,
    'active'
  ),

  -- CEO
  (
    'ct-agent-elena',
    'Elena',
    'ct-role-ceo',
    'ct-dept-governance',
    'Visionary leader guiding the strategic direction of Cinqueterre.travel with focus on sustainable growth and quality.',
    'elena@cinqueterre.travel',
    '["strategic_planning", "final_approvals", "partnership_development", "brand_vision", "decision_making"]'::jsonb,
    'active'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  persona = EXCLUDED.persona,
  capabilities = EXCLUDED.capabilities;

-- ============================================================================
-- 5. WEBSITE
-- ============================================================================

INSERT INTO websites (id, company_id, domain, title, description, status, metadata)
VALUES (
  'ct-website-001',
  'ct-company-001',
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
) ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  metadata = EXCLUDED.metadata;

-- ============================================================================
-- 6. SITEMAP PAGES (Core Structure)
-- ============================================================================

INSERT INTO pages (id, website_id, slug, title, page_type, status, metadata, parent_id, display_order) VALUES
  -- Homepage
  ('ct-page-home', 'ct-website-001', '/', 'Cinqueterre.travel - Your Guide to Paradise',
   'homepage', 'published',
   '{"seo_title": "Cinque Terre Travel Guide 2025 | Complete Visitor Information", "meta_description": "Plan your perfect Cinque Terre trip with our comprehensive guide covering all 5 villages, hiking trails, restaurants, hotels, and insider tips."}'::jsonb,
   NULL, 1),

  -- Main Sections
  ('ct-page-villages', 'ct-website-001', '/villages', 'The Five Villages of Cinque Terre',
   'section', 'published',
   '{"seo_title": "The 5 Villages of Cinque Terre | Complete Guide", "meta_description": "Explore all five villages: Monterosso, Vernazza, Corniglia, Manarola, and Riomaggiore. History, attractions, and what makes each unique."}'::jsonb,
   NULL, 2),

  ('ct-page-hiking', 'ct-website-001', '/hiking', 'Hiking Trails & Routes',
   'section', 'published',
   '{"seo_title": "Cinque Terre Hiking Trails Guide | Sentiero Azzurro & More", "meta_description": "Complete guide to hiking in Cinque Terre including Sentiero Azzurro, Via dell Amore, difficulty levels, and trail conditions."}'::jsonb,
   NULL, 3),

  ('ct-page-food', 'ct-website-001', '/food-dining', 'Food & Dining',
   'section', 'published',
   '{"seo_title": "Cinque Terre Restaurants & Food Guide | Ligurian Cuisine", "meta_description": "Discover the best restaurants, trattorias, and local specialties in Cinque Terre. Ligurian cuisine, seafood, pesto, and wine."}'::jsonb,
   NULL, 4),

  ('ct-page-hotels', 'ct-website-001', '/accommodation', 'Where to Stay',
   'section', 'published',
   '{"seo_title": "Cinque Terre Hotels & Accommodation | Where to Stay Guide", "meta_description": "Find the perfect place to stay in Cinque Terre. Hotels, B&Bs, vacation rentals by village with booking tips."}'::jsonb,
   NULL, 5),

  ('ct-page-plan', 'ct-website-001', '/plan-your-trip', 'Plan Your Trip',
   'section', 'published',
   '{"seo_title": "Plan Your Cinque Terre Trip | Itineraries, Tips & Practical Info", "meta_description": "Everything you need to plan your Cinque Terre visit: best time to go, how to get there, itineraries, and practical tips."}'::jsonb,
   NULL, 6),

  -- Village Detail Pages
  ('ct-page-monterosso', 'ct-website-001', '/villages/monterosso', 'Monterosso al Mare',
   'village_detail', 'published',
   '{"seo_title": "Monterosso al Mare Guide | Beaches, Hotels & Things to Do", "meta_description": "Complete guide to Monterosso, the largest Cinque Terre village known for its beaches, old town, and relaxed atmosphere."}'::jsonb,
   'ct-page-villages', 1),

  ('ct-page-vernazza', 'ct-website-001', '/villages/vernazza', 'Vernazza',
   'village_detail', 'published',
   '{"seo_title": "Vernazza Cinque Terre | Harbor, Castle & Visitor Guide", "meta_description": "Discover Vernazza, often called the jewel of Cinque Terre, with its picturesque harbor, medieval castle, and charming piazza."}'::jsonb,
   'ct-page-villages', 2),

  ('ct-page-corniglia', 'ct-website-001', '/villages/corniglia', 'Corniglia',
   'village_detail', 'published',
   '{"seo_title": "Corniglia Guide | The Hilltop Village of Cinque Terre", "meta_description": "Explore Corniglia, the only Cinque Terre village perched high on a cliff, offering stunning views and authentic atmosphere."}'::jsonb,
   'ct-page-villages', 3),

  ('ct-page-manarola', 'ct-website-001', '/villages/manarola', 'Manarola',
   'village_detail', 'published',
   '{"seo_title": "Manarola Cinque Terre | Photography, Wine & Village Guide", "meta_description": "Manarola guide: iconic rainbow houses, Via dell Amore trail, local wine, and the most photographed spot in Cinque Terre."}'::jsonb,
   'ct-page-villages', 4),

  ('ct-page-riomaggiore', 'ct-website-001', '/villages/riomaggiore', 'Riomaggiore',
   'village_detail', 'published',
   '{"seo_title": "Riomaggiore Guide | Main Street, Marina & Things to Do", "meta_description": "Riomaggiore, the southernmost Cinque Terre village, with its steep terraced vineyards, colorful buildings, and vibrant atmosphere."}'::jsonb,
   'ct-page-villages', 5)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  metadata = EXCLUDED.metadata;

-- ============================================================================
-- 7. BLUEPRINTS (Page Templates)
-- ============================================================================

INSERT INTO blueprints (id, website_id, name, description, page_type, status, components, created_by_agent_id) VALUES
  (
    'ct-blueprint-village',
    'ct-website-001',
    'Village Detail Page',
    'Template for individual village guide pages with comprehensive information',
    'village_detail',
    'active',
    '[
      {"type": "hero", "config": {"style": "full-width-image", "height": "large"}},
      {"type": "breadcrumb", "config": {}},
      {"type": "intro", "config": {"columns": 2}},
      {"type": "highlights", "config": {"layout": "grid", "items": 6}},
      {"type": "sections", "config": {"sections": ["history", "attractions", "dining", "accommodation", "getting-there"]}},
      {"type": "photo-gallery", "config": {"layout": "masonry"}},
      {"type": "practical-info", "config": {"sidebar": true}},
      {"type": "related-content", "config": {"max": 4}},
      {"type": "cta", "config": {"type": "plan-trip"}}
    ]'::jsonb,
    'ct-agent-sophia'
  ),
  (
    'ct-blueprint-trail',
    'ct-website-001',
    'Hiking Trail Page',
    'Template for hiking trail guides with difficulty, duration, and practical information',
    'trail_guide',
    'active',
    '[
      {"type": "hero", "config": {"style": "image-overlay"}},
      {"type": "trail-stats", "config": {"display": ["distance", "duration", "difficulty", "elevation"]}},
      {"type": "trail-description", "config": {}},
      {"type": "trail-map", "config": {"interactive": true}},
      {"type": "waypoints", "config": {"numbered": true}},
      {"type": "tips-warnings", "config": {"callout": true}},
      {"type": "photo-gallery", "config": {}},
      {"type": "related-trails", "config": {"max": 3}}
    ]'::jsonb,
    'ct-agent-sophia'
  ),
  (
    'ct-blueprint-restaurant',
    'ct-website-001',
    'Restaurant/Dining Page',
    'Template for restaurant and dining establishment pages',
    'restaurant_detail',
    'active',
    '[
      {"type": "hero", "config": {"style": "image-header"}},
      {"type": "restaurant-info", "config": {"display": ["cuisine", "price", "hours", "contact"]}},
      {"type": "description", "config": {}},
      {"type": "menu-highlights", "config": {"layout": "cards"}},
      {"type": "photos", "config": {"gallery": true}},
      {"type": "practical-details", "config": {"sidebar": true}},
      {"type": "location-map", "config": {"zoom": 16}},
      {"type": "similar-restaurants", "config": {"max": 3}}
    ]'::jsonb,
    'ct-agent-giulia'
  )
ON CONFLICT (id) DO UPDATE SET
  components = EXCLUDED.components;

-- ============================================================================
-- 8. EDITORIAL TASKS
-- ============================================================================

-- Village Guide Tasks
INSERT INTO editorial_tasks (
  id, website_id, title, description, task_type, status, priority,
  assigned_agent_id, due_date, estimated_hours, tags,
  seo_primary_keyword, seo_secondary_keywords, word_count_target,
  content_type, sitemap_targets, current_phase
) VALUES
  (
    'ct-task-001',
    'ct-website-001',
    'Complete Guide to Monterosso al Mare',
    'Comprehensive guide covering history, beaches, attractions, restaurants, hotels, and practical information for Monterosso',
    'article',
    'in_progress',
    'high',
    'ct-agent-isabella',
    CURRENT_DATE + INTERVAL '7 days',
    12.0,
    ARRAY['monterosso', 'village-guide', 'beaches'],
    'Monterosso al Mare',
    ARRAY['Monterosso beach', 'Monterosso hotels', 'things to do Monterosso', 'Old Town Monterosso'],
    2500,
    'comprehensive_guide',
    ARRAY['ct-page-monterosso'],
    'draft'
  ),
  (
    'ct-task-002',
    'ct-website-001',
    'Complete Guide to Vernazza',
    'In-depth guide to Vernazza covering harbor, castle, hiking access, dining, and accommodation',
    'article',
    'ready',
    'high',
    'ct-agent-isabella',
    CURRENT_DATE + INTERVAL '10 days',
    12.0,
    ARRAY['vernazza', 'village-guide', 'harbor'],
    'Vernazza Cinque Terre',
    ARRAY['Vernazza harbor', 'Vernazza castle', 'Vernazza restaurants', 'Vernazza Italy'],
    2500,
    'comprehensive_guide',
    ARRAY['ct-page-vernazza'],
    'research'
  ),
  (
    'ct-task-003',
    'ct-website-001',
    'Corniglia: The Hilltop Village Guide',
    'Complete guide to Corniglia with focus on terraces, viewpoints, and authentic atmosphere',
    'article',
    'backlog',
    'high',
    'ct-agent-isabella',
    CURRENT_DATE + INTERVAL '14 days',
    10.0,
    ARRAY['corniglia', 'village-guide', 'hilltop'],
    'Corniglia Cinque Terre',
    ARRAY['Corniglia Italy', 'Corniglia terraces', 'Lardarina steps', 'Corniglia viewpoint'],
    2200,
    'comprehensive_guide',
    ARRAY['ct-page-corniglia'],
    NULL
  ),

  -- Hiking Trail Tasks
  (
    'ct-task-004',
    'ct-website-001',
    'Sentiero Azzurro Trail Guide',
    'Complete guide to the Blue Trail connecting all five villages with practical information, difficulty levels, and booking details',
    'article',
    'in_review',
    'urgent',
    'ct-agent-isabella',
    CURRENT_DATE + INTERVAL '3 days',
    15.0,
    ARRAY['hiking', 'sentiero-azzurro', 'trails'],
    'Sentiero Azzurro',
    ARRAY['Blue Trail Cinque Terre', 'Cinque Terre hiking', 'trail conditions', 'hiking permits'],
    3000,
    'trail_guide',
    ARRAY['ct-page-hiking'],
    'review'
  ),
  (
    'ct-task-005',
    'ct-website-001',
    'Via dell''Amore Trail Guide',
    'Detailed guide to the famous Lovers'' Path between Manarola and Riomaggiore',
    'article',
    'blocked',
    'medium',
    'ct-agent-isabella',
    CURRENT_DATE + INTERVAL '20 days',
    8.0,
    ARRAY['hiking', 'via-dellamore', 'romantic'],
    'Via dell Amore',
    ARRAY['Lovers Path Cinque Terre', 'Via dell Amore trail', 'Manarola to Riomaggiore'],
    1800,
    'trail_guide',
    NULL,
    NULL
  ),

  -- Food & Dining Tasks
  (
    'ct-task-006',
    'ct-website-001',
    'Top 15 Restaurants in Cinque Terre',
    'Curated list of best restaurants across all five villages with specialties and price ranges',
    'article',
    'ready',
    'high',
    'ct-agent-giulia',
    CURRENT_DATE + INTERVAL '12 days',
    10.0,
    ARRAY['restaurants', 'food', 'dining'],
    'Cinque Terre restaurants',
    ARRAY['best restaurants Cinque Terre', 'where to eat Cinque Terre', 'Ligurian cuisine'],
    2800,
    'listicle',
    ARRAY['ct-page-food'],
    'research'
  ),
  (
    'ct-task-007',
    'ct-website-001',
    'Ligurian Cuisine: What to Eat in Cinque Terre',
    'Guide to traditional Ligurian dishes, local specialties, and must-try foods',
    'article',
    'in_progress',
    'medium',
    'ct-agent-giulia',
    CURRENT_DATE + INTERVAL '15 days',
    9.0,
    ARRAY['food', 'cuisine', 'local-specialties'],
    'Ligurian cuisine',
    ARRAY['Cinque Terre food', 'pesto Genovese', 'focaccia', 'Ligurian dishes', 'trofie pasta'],
    2200,
    'food_guide',
    ARRAY['ct-page-food'],
    'outline'
  ),

  -- Practical Information Tasks
  (
    'ct-task-008',
    'ct-website-001',
    'How to Get to Cinque Terre',
    'Complete transportation guide covering trains, cars, airports, and transfer options',
    'article',
    'backlog',
    'high',
    'ct-agent-isabella',
    CURRENT_DATE + INTERVAL '18 days',
    8.0,
    ARRAY['transportation', 'practical-info', 'getting-there'],
    'how to get to Cinque Terre',
    ARRAY['Cinque Terre train', 'La Spezia to Cinque Terre', 'airports near Cinque Terre'],
    2000,
    'practical_guide',
    ARRAY['ct-page-plan'],
    NULL
  ),
  (
    'ct-task-009',
    'ct-website-001',
    'Best Time to Visit Cinque Terre',
    'Seasonal guide covering weather, crowds, prices, and events throughout the year',
    'article',
    'ready',
    'high',
    'ct-agent-isabella',
    CURRENT_DATE + INTERVAL '8 days',
    7.0,
    ARRAY['planning', 'seasonal', 'weather'],
    'best time to visit Cinque Terre',
    ARRAY['Cinque Terre weather', 'Cinque Terre in summer', 'Cinque Terre in winter', 'Cinque Terre seasons'],
    1800,
    'seasonal_guide',
    ARRAY['ct-page-plan'],
    'research'
  ),
  (
    'ct-task-010',
    'ct-website-001',
    'Cinque Terre 3-Day Itinerary',
    'Detailed three-day itinerary for first-time visitors with day-by-day activities',
    'article',
    'backlog',
    'medium',
    'ct-agent-isabella',
    CURRENT_DATE + INTERVAL '25 days',
    10.0,
    ARRAY['itinerary', 'planning', '3-days'],
    'Cinque Terre 3 day itinerary',
    ARRAY['Cinque Terre itinerary', 'what to do in Cinque Terre', '3 days Cinque Terre'],
    2500,
    'itinerary',
    ARRAY['ct-page-plan'],
    NULL
  ),

  -- Cultural Content Tasks
  (
    'ct-task-011',
    'ct-website-001',
    'History and Culture of Cinque Terre',
    'Historical overview covering fishing traditions, terraced vineyards, and UNESCO status',
    'article',
    'backlog',
    'medium',
    'ct-agent-lorenzo',
    CURRENT_DATE + INTERVAL '30 days',
    12.0,
    ARRAY['culture', 'history', 'heritage'],
    'Cinque Terre history',
    ARRAY['Cinque Terre culture', 'Cinque Terre UNESCO', 'Italian Riviera history'],
    2300,
    'cultural_guide',
    NULL,
    NULL
  ),
  (
    'ct-task-012',
    'ct-website-001',
    'Local Festivals and Events',
    'Annual calendar of festivals, celebrations, and cultural events in the five villages',
    'article',
    'backlog',
    'low',
    'ct-agent-lorenzo',
    CURRENT_DATE + INTERVAL '35 days',
    6.0,
    ARRAY['events', 'festivals', 'culture'],
    'Cinque Terre festivals',
    ARRAY['Cinque Terre events', 'local festivals Italy', 'Ligurian traditions'],
    1500,
    'event_guide',
    NULL,
    NULL
  )
ON CONFLICT (id) DO NOTHING;

-- Set up task dependencies
UPDATE editorial_tasks SET depends_on = ARRAY['ct-task-001', 'ct-task-002']
WHERE id = 'ct-task-006';

UPDATE editorial_tasks SET depends_on = ARRAY['ct-task-006']
WHERE id = 'ct-task-007';

-- ============================================================================
-- 9. INITIALIZE TASK PHASES
-- ============================================================================

-- Initialize phases for all tasks
SELECT initialize_task_phases('ct-task-001', 'article');
SELECT initialize_task_phases('ct-task-002', 'article');
SELECT initialize_task_phases('ct-task-003', 'article');
SELECT initialize_task_phases('ct-task-004', 'article');
SELECT initialize_task_phases('ct-task-005', 'article');
SELECT initialize_task_phases('ct-task-006', 'article');
SELECT initialize_task_phases('ct-task-007', 'article');
SELECT initialize_task_phases('ct-task-008', 'article');
SELECT initialize_task_phases('ct-task-009', 'article');
SELECT initialize_task_phases('ct-task-010', 'article');
SELECT initialize_task_phases('ct-task-011', 'article');
SELECT initialize_task_phases('ct-task-012', 'article');

-- Update phase status for in-progress tasks
UPDATE task_phases SET status = 'completed', completed_at = NOW() - INTERVAL '3 days'
WHERE task_id = 'ct-task-001' AND phase_name IN ('research', 'outline');

UPDATE task_phases SET status = 'in_progress', started_at = NOW() - INTERVAL '2 days', progress_percentage = 60
WHERE task_id = 'ct-task-001' AND phase_name = 'draft';

UPDATE task_phases SET status = 'completed', completed_at = NOW() - INTERVAL '1 day'
WHERE task_id = 'ct-task-004' AND phase_name IN ('research', 'outline', 'draft', 'edit');

UPDATE task_phases SET status = 'in_progress', started_at = NOW(), progress_percentage = 30
WHERE task_id = 'ct-task-004' AND phase_name = 'review';

UPDATE task_phases SET status = 'completed', completed_at = NOW() - INTERVAL '4 days'
WHERE task_id = 'ct-task-007' AND phase_name = 'research';

UPDATE task_phases SET status = 'in_progress', started_at = NOW() - INTERVAL '1 day', progress_percentage = 40
WHERE task_id = 'ct-task-007' AND phase_name = 'outline';

-- ============================================================================
-- 10. AGENT ACTIVITIES
-- ============================================================================

INSERT INTO agent_activities (id, agent_id, activity_type, target_type, target_id, description, metadata)
VALUES
  (
    gen_random_uuid()::text,
    'ct-agent-isabella',
    'task_started',
    'editorial_task',
    'ct-task-001',
    'Started working on Monterosso guide - researching beaches and accommodation',
    '{"estimated_completion": "2025-11-30"}'::jsonb
  ),
  (
    gen_random_uuid()::text,
    'ct-agent-giulia',
    'task_started',
    'editorial_task',
    'ct-task-007',
    'Began outline for Ligurian cuisine guide',
    '{"focus_areas": ["pesto", "focaccia", "seafood", "wine"]}'::jsonb
  ),
  (
    gen_random_uuid()::text,
    'ct-agent-marco',
    'task_review',
    'editorial_task',
    'ct-task-004',
    'Reviewing Sentiero Azzurro trail guide for accuracy and completeness',
    '{"review_focus": ["trail_conditions", "practical_info", "safety"]}'::jsonb
  ),
  (
    gen_random_uuid()::text,
    'ct-agent-alex',
    'seo_optimization',
    'page',
    'ct-page-monterosso',
    'Optimizing Monterosso page for target keywords',
    '{"keywords_added": 5, "meta_updated": true}'::jsonb
  ),
  (
    gen_random_uuid()::text,
    'ct-agent-sophia',
    'planning',
    'website',
    'ct-website-001',
    'Quarterly content strategy review and Q1 2026 planning',
    '{"priority_topics": ["seasonal_guides", "hidden_gems", "sustainability"]}'::jsonb
  )
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 11. SUGGESTIONS (AI-Generated Content Ideas)
-- ============================================================================

INSERT INTO suggestions (id, website_id, created_by_agent_id, suggestion_type, target_type, target_id, title, description, rationale, priority, status)
VALUES
  (
    gen_random_uuid()::text,
    'ct-website-001',
    'ct-agent-alex',
    'new_content',
    'page',
    NULL,
    'Create "Cinque Terre on a Budget" Guide',
    'Comprehensive budget travel guide covering free activities, affordable dining, and money-saving tips',
    'High search volume for "Cinque Terre budget" (2,400/mo) with low competition. Gap in current content.',
    'high',
    'pending'
  ),
  (
    gen_random_uuid()::text,
    'ct-website-001',
    'ct-agent-alex',
    'seo_optimization',
    'page',
    'ct-page-hiking',
    'Add FAQ section to Hiking page',
    'Add structured FAQ covering common questions: permits, difficulty, best season, what to bring',
    'Opportunity for featured snippet. Competitors ranking with FAQ schema. Improves user experience.',
    'medium',
    'pending'
  ),
  (
    gen_random_uuid()::text,
    'ct-website-001',
    'ct-agent-giulia',
    'content_update',
    'page',
    'ct-page-food',
    'Update restaurant listings with 2025 data',
    'Verify all restaurant information, update hours, add new openings, remove closures',
    'Content accuracy is crucial for user trust. Several restaurants have changed since last update.',
    'high',
    'approved'
  ),
  (
    gen_random_uuid()::text,
    'ct-website-001',
    'ct-agent-francesca',
    'new_feature',
    'website',
    'ct-website-001',
    'Add Interactive Trail Map',
    'Embed interactive map showing all hiking trails with difficulty levels and real-time conditions',
    'Enhances user experience and increases time on site. Differentiates from competitors.',
    'medium',
    'pending'
  ),
  (
    gen_random_uuid()::text,
    'ct-website-001',
    'ct-agent-lorenzo',
    'new_content',
    'page',
    NULL,
    'Monthly Photo Contest: "My Cinque Terre Moment"',
    'User-generated content campaign encouraging visitors to share photos with specific hashtag',
    'Builds community, generates social proof, creates authentic content, increases social media engagement.',
    'low',
    'pending'
  )
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Count everything created
SELECT 'Companies' as entity, COUNT(*) as count FROM companies WHERE id LIKE 'ct-%'
UNION ALL
SELECT 'Departments', COUNT(*) FROM departments WHERE id LIKE 'ct-%'
UNION ALL
SELECT 'Roles', COUNT(*) FROM roles WHERE id LIKE 'ct-%'
UNION ALL
SELECT 'Agents', COUNT(*) FROM agents WHERE id LIKE 'ct-%'
UNION ALL
SELECT 'Websites', COUNT(*) FROM websites WHERE id LIKE 'ct-%'
UNION ALL
SELECT 'Pages', COUNT(*) FROM pages WHERE id LIKE 'ct-%'
UNION ALL
SELECT 'Blueprints', COUNT(*) FROM blueprints WHERE id LIKE 'ct-%'
UNION ALL
SELECT 'Editorial Tasks', COUNT(*) FROM editorial_tasks WHERE id LIKE 'ct-%'
UNION ALL
SELECT 'Task Phases', COUNT(*) FROM task_phases WHERE task_id LIKE 'ct-%'
UNION ALL
SELECT 'Agent Activities', COUNT(*) FROM agent_activities WHERE agent_id LIKE 'ct-%'
UNION ALL
SELECT 'Suggestions', COUNT(*) FROM suggestions WHERE website_id LIKE 'ct-%';
