-- Complete Setup Script for Cinqueterre.travel Virtual Media House (v2)
-- Multi-language with URL prefixes, external tools, comprehensive page structure
-- Run with: docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress < setup-complete-v2.sql

-- ============================================================================
-- CLEANUP: Remove existing cinqueterre data (using metadata markers)
-- ============================================================================

DELETE FROM agent_activities WHERE agent_id IN (SELECT id FROM agents WHERE name IN ('Sophia', 'Marco', 'Isabella', 'Lorenzo', 'Giulia', 'Alex', 'Francesca', 'Matteo', 'Elena'));
DELETE FROM suggestions WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel');
DELETE FROM task_phases WHERE task_id IN (SELECT id FROM editorial_tasks WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel'));
DELETE FROM editorial_tasks WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel');
DELETE FROM content_items WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel');
DELETE FROM pages WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel');
DELETE FROM content_blueprints WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel');
DELETE FROM website_tools WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel');
DELETE FROM tool_secrets WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel');
DELETE FROM websites WHERE domain = 'cinqueterre.travel';
DELETE FROM agents WHERE virtual_email LIKE '%@cinqueterre.travel';
DELETE FROM roles WHERE department_id IN (SELECT id FROM departments WHERE company_id IN (SELECT id FROM companies WHERE name = 'Cinqueterre.travel'));
DELETE FROM departments WHERE company_id IN (SELECT id FROM companies WHERE name = 'Cinqueterre.travel');
DELETE FROM companies WHERE name = 'Cinqueterre.travel';
DELETE FROM tool_configs WHERE name IN ('google_places', 'openweather', 'pexels', 'unsplash', 'wikidata', 'overpass_osm');

-- ============================================================================
-- 1. COMPANY
-- ============================================================================

DO $$
DECLARE
  v_company_id UUID;
  v_dept_editorial UUID;
  v_dept_writers UUID;
  v_dept_seo UUID;
  v_dept_media UUID;
  v_dept_engineering UUID;
  v_dept_governance UUID;
  v_role_editor_chief UUID;
  v_role_editor UUID;
  v_role_writer_travel UUID;
  v_role_writer_culture UUID;
  v_role_writer_food UUID;
  v_role_seo UUID;
  v_role_media UUID;
  v_role_engineer UUID;
  v_role_ceo UUID;
  v_agent_sophia UUID;
  v_agent_marco UUID;
  v_agent_isabella UUID;
  v_agent_lorenzo UUID;
  v_agent_giulia UUID;
  v_agent_alex UUID;
  v_agent_francesca UUID;
  v_agent_matteo UUID;
  v_agent_elena UUID;
  v_website_id UUID;
  v_tool_google UUID;
  v_tool_weather UUID;
  v_tool_pexels UUID;
  v_tool_unsplash UUID;
  v_tool_wikidata UUID;
  v_tool_overpass UUID;
  v_blueprint_homepage UUID;
  v_blueprint_village UUID;
  v_blueprint_poi UUID;
  v_blueprint_trail UUID;
  v_blueprint_beach UUID;
  v_blueprint_events UUID;
  v_blueprint_faq UUID;
  v_blueprint_utility UUID;
  v_blueprint_blog UUID;
  v_blueprint_insights UUID;
  langs TEXT[] := ARRAY['en', 'de', 'fr', 'it'];
  cities TEXT[] := ARRAY['cinque-terre', 'monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'];
  page_types TEXT[] := ARRAY['overview', 'sights', 'restaurants', 'hotels', 'apartments', 'agriturismi', 'camping', 'hiking', 'beaches', 'boat-tours', 'events', 'things-to-do', 'insights', 'maps', 'blog', 'faq', 'weather', 'getting-here'];
  lang TEXT;
  city TEXT;
  ptype TEXT;
  v_lang_root_id UUID;
  v_city_id UUID;
  v_page_id UUID;
  city_order INTEGER;
  page_order INTEGER;
  title TEXT;
BEGIN
  -- Create Company
  INSERT INTO companies (name, description)
  VALUES (
    'Cinqueterre.travel',
    'Virtual media house dedicated to providing comprehensive travel information about the Cinque Terre region in Italy'
  ) RETURNING id INTO v_company_id;

  -- ============================================================================
  -- 2. DEPARTMENTS
  -- ============================================================================

  INSERT INTO departments (company_id, name, description) VALUES
    (v_company_id, 'Editorial', 'Manages content strategy, planning, and quality for all travel content')
  RETURNING id INTO v_dept_editorial;

  INSERT INTO departments (company_id, name, description) VALUES
    (v_company_id, 'Writers Room', 'Content creation team responsible for articles, guides, and descriptions')
  RETURNING id INTO v_dept_writers;

  INSERT INTO departments (company_id, name, description) VALUES
    (v_company_id, 'SEO & Analytics', 'Optimization and performance tracking for search visibility')
  RETURNING id INTO v_dept_seo;

  INSERT INTO departments (company_id, name, description) VALUES
    (v_company_id, 'Media Production', 'Visual content creation including images, maps, and multimedia')
  RETURNING id INTO v_dept_media;

  INSERT INTO departments (company_id, name, description) VALUES
    (v_company_id, 'Engineering', 'Technical infrastructure, site building, and deployment')
  RETURNING id INTO v_dept_engineering;

  INSERT INTO departments (company_id, name, description) VALUES
    (v_company_id, 'Governance', 'Strategic oversight and high-level decision making')
  RETURNING id INTO v_dept_governance;

  -- ============================================================================
  -- 3. ROLES
  -- ============================================================================

  INSERT INTO roles (department_id, name, description) VALUES
    (v_dept_editorial, 'Editor-in-Chief', 'Oversees all editorial content, strategy, and planning')
  RETURNING id INTO v_role_editor_chief;

  INSERT INTO roles (department_id, name, description) VALUES
    (v_dept_editorial, 'Senior Editor', 'Reviews and approves content for publication')
  RETURNING id INTO v_role_editor;

  INSERT INTO roles (department_id, name, description) VALUES
    (v_dept_writers, 'Travel Writer', 'Specializes in destination guides and travel narratives')
  RETURNING id INTO v_role_writer_travel;

  INSERT INTO roles (department_id, name, description) VALUES
    (v_dept_writers, 'Culture Writer', 'Focuses on local culture, history, and traditions')
  RETURNING id INTO v_role_writer_culture;

  INSERT INTO roles (department_id, name, description) VALUES
    (v_dept_writers, 'Food & Dining Writer', 'Covers restaurants, cuisine, and culinary experiences')
  RETURNING id INTO v_role_writer_food;

  INSERT INTO roles (department_id, name, description) VALUES
    (v_dept_seo, 'SEO Specialist', 'Optimizes content for search engines and tracks performance')
  RETURNING id INTO v_role_seo;

  INSERT INTO roles (department_id, name, description) VALUES
    (v_dept_media, 'Media Coordinator', 'Sources and manages visual assets and multimedia content')
  RETURNING id INTO v_role_media;

  INSERT INTO roles (department_id, name, description) VALUES
    (v_dept_engineering, 'Site Engineer', 'Builds and maintains the website infrastructure')
  RETURNING id INTO v_role_engineer;

  INSERT INTO roles (department_id, name, description) VALUES
    (v_dept_governance, 'CEO', 'Final approval authority and strategic direction')
  RETURNING id INTO v_role_ceo;

  -- ============================================================================
  -- 4. AI AGENTS
  -- ============================================================================

  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
    ('Sophia', v_role_editor_chief, v_dept_editorial,
     'Strategic and detail-oriented editorial leader with deep knowledge of travel content. Passionate about authentic storytelling and reader experience.',
     'sophia@cinqueterre.travel',
     '["editorial_strategy", "content_planning", "quality_assurance", "team_coordination", "workflow_management"]'::jsonb,
     'active')
  RETURNING id INTO v_agent_sophia;

  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
    ('Marco', v_role_editor, v_dept_editorial,
     'Meticulous editor with a keen eye for detail and authentic Italian perspective. Ensures accuracy and engaging narratives.',
     'marco@cinqueterre.travel',
     '["content_review", "fact_checking", "style_editing", "grammar_polish", "cultural_accuracy"]'::jsonb,
     'active')
  RETURNING id INTO v_agent_marco;

  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
    ('Isabella', v_role_writer_travel, v_dept_writers,
     'Adventurous travel writer who has extensively explored the Italian Riviera. Brings destinations to life with vivid descriptions.',
     'isabella@cinqueterre.travel',
     '["destination_guides", "travel_tips", "hiking_routes", "transportation", "itinerary_planning"]'::jsonb,
     'active')
  RETURNING id INTO v_agent_isabella;

  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
    ('Lorenzo', v_role_writer_culture, v_dept_writers,
     'Cultural historian and storyteller passionate about preserving and sharing Italian heritage and traditions.',
     'lorenzo@cinqueterre.travel',
     '["cultural_history", "local_traditions", "architectural_insights", "festival_coverage", "storytelling"]'::jsonb,
     'active')
  RETURNING id INTO v_agent_lorenzo;

  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
    ('Giulia', v_role_writer_food, v_dept_writers,
     'Food enthusiast and culinary expert specializing in Ligurian cuisine. Knows every trattoria and hidden gem.',
     'giulia@cinqueterre.travel',
     '["restaurant_reviews", "recipe_sharing", "wine_coverage", "food_culture", "culinary_tours"]'::jsonb,
     'active')
  RETURNING id INTO v_agent_giulia;

  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
    ('Alex', v_role_seo, v_dept_seo,
     'Data-driven SEO strategist focused on organic growth and user intent. Balances optimization with quality.',
     'alex@cinqueterre.travel',
     '["keyword_research", "on_page_seo", "technical_seo", "analytics", "performance_tracking"]'::jsonb,
     'active')
  RETURNING id INTO v_agent_alex;

  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
    ('Francesca', v_role_media, v_dept_media,
     'Visual storyteller with an eye for capturing the beauty of Cinque Terre through imagery and multimedia.',
     'francesca@cinqueterre.travel',
     '["image_sourcing", "photo_editing", "map_creation", "video_coordination", "visual_storytelling"]'::jsonb,
     'active')
  RETURNING id INTO v_agent_francesca;

  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
    ('Matteo', v_role_engineer, v_dept_engineering,
     'Technical expert ensuring the website is fast, reliable, and delivers exceptional user experience.',
     'matteo@cinqueterre.travel',
     '["site_building", "performance_optimization", "deployment", "technical_troubleshooting", "infrastructure"]'::jsonb,
     'active')
  RETURNING id INTO v_agent_matteo;

  INSERT INTO agents (name, role_id, department_id, persona, virtual_email, capabilities, status) VALUES
    ('Elena', v_role_ceo, v_dept_governance,
     'Visionary leader guiding the strategic direction of Cinqueterre.travel with focus on sustainable growth and quality.',
     'elena@cinqueterre.travel',
     '["strategic_planning", "final_approvals", "partnership_development", "brand_vision", "decision_making"]'::jsonb,
     'active')
  RETURNING id INTO v_agent_elena;

  -- ============================================================================
  -- 5. WEBSITE
  -- ============================================================================

  INSERT INTO websites (company_id, domain, title, description, status, metadata)
  VALUES (
    v_company_id,
    'cinqueterre.travel',
    'Cinqueterre.travel - Your Complete Guide to the Italian Riviera',
    'The ultimate travel resource for Cinque Terre, featuring comprehensive guides to all five villages, hiking trails, restaurants, hotels, weather information, and local culture.',
    'active',
    jsonb_build_object(
      'primary_language', 'en',
      'languages', ARRAY['en', 'de', 'fr', 'it'],
      'language_strategy', 'url_prefix',
      'target_audience', 'International travelers',
      'data_sources', ARRAY['google_places', 'openweather', 'pexels', 'unsplash', 'wikidata', 'overpass_osm']
    )
  ) RETURNING id INTO v_website_id;

  -- ============================================================================
  -- 6. TOOL CONFIGURATIONS
  -- ============================================================================

  INSERT INTO tool_configs (name, display_name, description, type, endpoint_url, config, input_schema) VALUES
    ('google_places', 'Google Places API', 'Search and get details about restaurants, hotels, and POIs', 'rest',
     'https://maps.googleapis.com/maps/api/place',
     '{"auth_type": "api_key", "auth_param": "key", "default_method": "GET", "timeout_ms": 10000}'::jsonb,
     '{"type": "object", "properties": {"path": {"type": "string"}, "query": {"type": "object"}}}'::jsonb)
  RETURNING id INTO v_tool_google;

  INSERT INTO tool_configs (name, display_name, description, type, endpoint_url, config, input_schema) VALUES
    ('openweather', 'OpenWeather API', 'Get current weather, forecasts, and climate data', 'rest',
     'https://api.openweathermap.org/data/3.0/onecall',
     '{"auth_type": "api_key", "auth_param": "appid", "default_method": "GET", "timeout_ms": 5000}'::jsonb,
     '{"type": "object", "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}}}'::jsonb)
  RETURNING id INTO v_tool_weather;

  INSERT INTO tool_configs (name, display_name, description, type, endpoint_url, config, input_schema) VALUES
    ('pexels', 'Pexels Image API', 'Search and retrieve high-quality stock photos', 'rest',
     'https://api.pexels.com/v1',
     '{"auth_type": "api_key", "auth_header": "Authorization", "default_method": "GET"}'::jsonb,
     '{"type": "object", "properties": {"path": {"type": "string"}, "query": {"type": "string"}}}'::jsonb)
  RETURNING id INTO v_tool_pexels;

  INSERT INTO tool_configs (name, display_name, description, type, endpoint_url, config, input_schema) VALUES
    ('unsplash', 'Unsplash Image API', 'Search and retrieve photos from Unsplash', 'rest',
     'https://api.unsplash.com',
     '{"auth_type": "api_key", "auth_header": "Authorization", "auth_prefix": "Client-ID "}'::jsonb,
     '{"type": "object", "properties": {"path": {"type": "string"}, "query": {"type": "string"}}}'::jsonb)
  RETURNING id INTO v_tool_unsplash;

  INSERT INTO tool_configs (name, display_name, description, type, endpoint_url, config, input_schema) VALUES
    ('wikidata', 'Wikidata SPARQL', 'Query Wikidata for structured information', 'rest',
     'https://query.wikidata.org/sparql',
     '{"auth_type": "none", "default_method": "GET", "headers": {"Accept": "application/sparql-results+json"}}'::jsonb,
     '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb)
  RETURNING id INTO v_tool_wikidata;

  INSERT INTO tool_configs (name, display_name, description, type, endpoint_url, config, input_schema) VALUES
    ('overpass_osm', 'Overpass OSM API', 'Query OpenStreetMap for trails and geographic features', 'rest',
     'https://overpass-api.de/api/interpreter',
     '{"auth_type": "none", "default_method": "POST", "timeout_ms": 30000}'::jsonb,
     '{"type": "object", "properties": {"data": {"type": "string"}}}'::jsonb)
  RETURNING id INTO v_tool_overpass;

  -- ============================================================================
  -- 7. WEBSITE TOOL ASSIGNMENTS
  -- ============================================================================

  INSERT INTO website_tools (website_id, tool_config_id, enabled, priority) VALUES
    (v_website_id, v_tool_google, true, 10),
    (v_website_id, v_tool_weather, true, 8),
    (v_website_id, v_tool_pexels, true, 6),
    (v_website_id, v_tool_unsplash, true, 5),
    (v_website_id, v_tool_wikidata, true, 7),
    (v_website_id, v_tool_overpass, true, 7);

  -- ============================================================================
  -- 8. TOOL SECRETS (Placeholders)
  -- ============================================================================

  INSERT INTO tool_secrets (website_id, tool_config_id, secret_key, encrypted_value) VALUES
    (v_website_id, v_tool_google, 'API_KEY', 'PLACEHOLDER_GOOGLE_PLACES_API_KEY'),
    (v_website_id, v_tool_weather, 'API_KEY', 'PLACEHOLDER_OPENWEATHER_API_KEY'),
    (v_website_id, v_tool_pexels, 'API_KEY', 'PLACEHOLDER_PEXELS_API_KEY'),
    (v_website_id, v_tool_unsplash, 'ACCESS_KEY', 'PLACEHOLDER_UNSPLASH_ACCESS_KEY');

  -- ============================================================================
  -- 9. CONTENT BLUEPRINTS
  -- ============================================================================

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'Homepage', 'Main landing page with hero and highlights',
     '{"components": [{"type": "hero", "required": true}, {"type": "paragraph", "required": true}, {"type": "gallery", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_homepage;

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'Village Overview', 'Comprehensive guide to a village',
     '{"components": [{"type": "hero", "required": true}, {"type": "paragraph", "required": true}, {"type": "gallery", "required": true}, {"type": "faq", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_village;

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'POI Listing', 'List of points of interest',
     '{"components": [{"type": "hero", "required": true}, {"type": "paragraph", "required": true}, {"type": "list", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_poi;

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'Trail Guide', 'Hiking trail guide',
     '{"components": [{"type": "hero", "required": true}, {"type": "callout", "required": true}, {"type": "paragraph", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_trail;

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'Beach Guide', 'Beach information',
     '{"components": [{"type": "hero", "required": true}, {"type": "paragraph", "required": true}, {"type": "gallery", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_beach;

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'Events Calendar', 'Local events and festivals',
     '{"components": [{"type": "hero", "required": true}, {"type": "paragraph", "required": true}, {"type": "list", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_events;

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'FAQ Page', 'Frequently asked questions',
     '{"components": [{"type": "hero", "required": true}, {"type": "faq", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_faq;

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'Utility Page', 'Utility pages like maps and weather',
     '{"components": [{"type": "hero", "required": true}, {"type": "embed", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_utility;

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'Blog Post', 'Blog article with rich content',
     '{"components": [{"type": "hero", "required": true}, {"type": "paragraph", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_blog;

  INSERT INTO content_blueprints (website_id, name, description, schema) VALUES
    (v_website_id, 'Insights Article', 'In-depth cultural insights',
     '{"components": [{"type": "hero", "required": true}, {"type": "paragraph", "required": true}, {"type": "gallery", "required": true}]}'::jsonb)
  RETURNING id INTO v_blueprint_insights;

  -- ============================================================================
  -- 10. PAGE HIERARCHY
  -- ============================================================================

  -- Create pages for all 4 languages x 6 cities x 18 page types
  FOREACH lang IN ARRAY langs LOOP
    -- Create language root
    INSERT INTO pages (website_id, slug, title, page_type, status, metadata, order_index)
    VALUES (v_website_id,
            '/' || lang,
            CASE lang
              WHEN 'en' THEN 'Cinque Terre Travel Guide'
              WHEN 'de' THEN 'Cinque Terre Reiseführer'
              WHEN 'fr' THEN 'Guide de Voyage Cinque Terre'
              WHEN 'it' THEN 'Guida Turistica Cinque Terre'
            END,
            'language_root', 'published',
            jsonb_build_object('lang', lang, 'is_default', lang = 'en'),
            CASE lang WHEN 'en' THEN 1 WHEN 'de' THEN 2 WHEN 'fr' THEN 3 WHEN 'it' THEN 4 END)
    RETURNING id INTO v_lang_root_id;

    city_order := 1;
    FOREACH city IN ARRAY cities LOOP
      -- Create city page
      INSERT INTO pages (website_id, parent_id, slug, title, page_type, status, metadata, order_index)
      VALUES (v_website_id, v_lang_root_id,
              '/' || lang || '/' || city,
              CASE city
                WHEN 'cinque-terre' THEN 'Cinque Terre'
                WHEN 'monterosso' THEN 'Monterosso al Mare'
                WHEN 'vernazza' THEN 'Vernazza'
                WHEN 'corniglia' THEN 'Corniglia'
                WHEN 'manarola' THEN 'Manarola'
                WHEN 'riomaggiore' THEN 'Riomaggiore'
              END,
              'city', 'draft',
              jsonb_build_object('lang', lang, 'city', city),
              city_order)
      RETURNING id INTO v_city_id;

      page_order := 1;
      FOREACH ptype IN ARRAY page_types LOOP
        -- Title based on language
        CASE lang
          WHEN 'en' THEN
            title := CASE ptype
              WHEN 'overview' THEN 'Overview'
              WHEN 'sights' THEN 'Sights & Attractions'
              WHEN 'restaurants' THEN 'Restaurants'
              WHEN 'hotels' THEN 'Hotels'
              WHEN 'apartments' THEN 'Apartments'
              WHEN 'agriturismi' THEN 'Agriturismi'
              WHEN 'camping' THEN 'Camping'
              WHEN 'hiking' THEN 'Hiking Trails'
              WHEN 'beaches' THEN 'Beaches'
              WHEN 'boat-tours' THEN 'Boat Tours'
              WHEN 'events' THEN 'Events'
              WHEN 'things-to-do' THEN 'Things to Do'
              WHEN 'insights' THEN 'Local Insights'
              WHEN 'maps' THEN 'Maps'
              WHEN 'blog' THEN 'Blog'
              WHEN 'faq' THEN 'FAQ'
              WHEN 'weather' THEN 'Weather'
              WHEN 'getting-here' THEN 'Getting Here'
            END;
          WHEN 'de' THEN
            title := CASE ptype
              WHEN 'overview' THEN 'Überblick'
              WHEN 'sights' THEN 'Sehenswürdigkeiten'
              WHEN 'restaurants' THEN 'Restaurants'
              WHEN 'hotels' THEN 'Hotels'
              WHEN 'apartments' THEN 'Ferienwohnungen'
              WHEN 'agriturismi' THEN 'Agriturismi'
              WHEN 'camping' THEN 'Camping'
              WHEN 'hiking' THEN 'Wanderwege'
              WHEN 'beaches' THEN 'Strände'
              WHEN 'boat-tours' THEN 'Bootstouren'
              WHEN 'events' THEN 'Veranstaltungen'
              WHEN 'things-to-do' THEN 'Aktivitäten'
              WHEN 'insights' THEN 'Insider-Tipps'
              WHEN 'maps' THEN 'Karten'
              WHEN 'blog' THEN 'Blog'
              WHEN 'faq' THEN 'FAQ'
              WHEN 'weather' THEN 'Wetter'
              WHEN 'getting-here' THEN 'Anreise'
            END;
          WHEN 'fr' THEN
            title := CASE ptype
              WHEN 'overview' THEN 'Aperçu'
              WHEN 'sights' THEN 'Sites & Attractions'
              WHEN 'restaurants' THEN 'Restaurants'
              WHEN 'hotels' THEN 'Hôtels'
              WHEN 'apartments' THEN 'Appartements'
              WHEN 'agriturismi' THEN 'Agriturismi'
              WHEN 'camping' THEN 'Camping'
              WHEN 'hiking' THEN 'Sentiers de Randonnée'
              WHEN 'beaches' THEN 'Plages'
              WHEN 'boat-tours' THEN 'Excursions en Bateau'
              WHEN 'events' THEN 'Événements'
              WHEN 'things-to-do' THEN 'Activités'
              WHEN 'insights' THEN 'Conseils Locaux'
              WHEN 'maps' THEN 'Cartes'
              WHEN 'blog' THEN 'Blog'
              WHEN 'faq' THEN 'FAQ'
              WHEN 'weather' THEN 'Météo'
              WHEN 'getting-here' THEN 'Comment y Aller'
            END;
          WHEN 'it' THEN
            title := CASE ptype
              WHEN 'overview' THEN 'Panoramica'
              WHEN 'sights' THEN 'Attrazioni'
              WHEN 'restaurants' THEN 'Ristoranti'
              WHEN 'hotels' THEN 'Hotel'
              WHEN 'apartments' THEN 'Appartamenti'
              WHEN 'agriturismi' THEN 'Agriturismi'
              WHEN 'camping' THEN 'Campeggi'
              WHEN 'hiking' THEN 'Sentieri'
              WHEN 'beaches' THEN 'Spiagge'
              WHEN 'boat-tours' THEN 'Gite in Barca'
              WHEN 'events' THEN 'Eventi'
              WHEN 'things-to-do' THEN 'Cosa Fare'
              WHEN 'insights' THEN 'Consigli Locali'
              WHEN 'maps' THEN 'Mappe'
              WHEN 'blog' THEN 'Blog'
              WHEN 'faq' THEN 'FAQ'
              WHEN 'weather' THEN 'Meteo'
              WHEN 'getting-here' THEN 'Come Arrivare'
            END;
        END CASE;

        INSERT INTO pages (website_id, parent_id, slug, title, page_type, status, metadata, order_index)
        VALUES (v_website_id, v_city_id,
                '/' || lang || '/' || city || '/' || ptype,
                title, ptype, 'draft',
                jsonb_build_object('lang', lang, 'city', city, 'page_type', ptype),
                page_order);

        page_order := page_order + 1;
      END LOOP;

      city_order := city_order + 1;
    END LOOP;
  END LOOP;

  -- ============================================================================
  -- 11. EDITORIAL TASKS
  -- ============================================================================

  -- Homepage tasks
  INSERT INTO editorial_tasks (website_id, title, description, task_type, status, priority, assigned_agent_id, due_date, estimated_hours, tags, seo_primary_keyword, word_count_target, content_type)
  VALUES
    (v_website_id, 'Homepage - English', 'Create the main English homepage', 'article', 'ready', 'urgent', v_agent_isabella, CURRENT_DATE + 3, 8.0, ARRAY['homepage', 'english'], 'Cinque Terre travel guide', 500, 'homepage'),
    (v_website_id, 'Homepage - Deutsch', 'Deutsche Hauptseite erstellen', 'article', 'backlog', 'urgent', v_agent_isabella, CURRENT_DATE + 5, 8.0, ARRAY['homepage', 'german'], 'Cinque Terre Reiseführer', 500, 'homepage'),
    (v_website_id, 'Homepage - Français', 'Créer la page d''accueil française', 'article', 'backlog', 'urgent', v_agent_isabella, CURRENT_DATE + 5, 8.0, ARRAY['homepage', 'french'], 'Guide Cinque Terre', 500, 'homepage'),
    (v_website_id, 'Homepage - Italiano', 'Creare la homepage italiana', 'article', 'backlog', 'urgent', v_agent_isabella, CURRENT_DATE + 5, 8.0, ARRAY['homepage', 'italian'], 'Guida Cinque Terre', 500, 'homepage');

  -- Village guide tasks
  INSERT INTO editorial_tasks (website_id, title, description, task_type, status, priority, assigned_agent_id, due_date, estimated_hours, tags, seo_primary_keyword, word_count_target, content_type)
  VALUES
    (v_website_id, 'Monterosso al Mare - Complete Guide', 'Comprehensive guide covering beaches, old town, attractions', 'article', 'ready', 'high', v_agent_isabella, CURRENT_DATE + 7, 12.0, ARRAY['monterosso', 'village-guide'], 'Monterosso al Mare', 2500, 'village_overview'),
    (v_website_id, 'Vernazza - Complete Guide', 'In-depth guide to Vernazza harbor and castle', 'article', 'backlog', 'high', v_agent_isabella, CURRENT_DATE + 10, 12.0, ARRAY['vernazza', 'village-guide'], 'Vernazza Cinque Terre', 2500, 'village_overview'),
    (v_website_id, 'Corniglia - Complete Guide', 'Guide to the hilltop village', 'article', 'backlog', 'high', v_agent_isabella, CURRENT_DATE + 12, 10.0, ARRAY['corniglia', 'village-guide'], 'Corniglia Cinque Terre', 2200, 'village_overview'),
    (v_website_id, 'Manarola - Complete Guide', 'Guide with iconic views and wine', 'article', 'backlog', 'high', v_agent_isabella, CURRENT_DATE + 14, 12.0, ARRAY['manarola', 'village-guide'], 'Manarola Cinque Terre', 2500, 'village_overview'),
    (v_website_id, 'Riomaggiore - Complete Guide', 'Guide to the southernmost village', 'article', 'backlog', 'high', v_agent_isabella, CURRENT_DATE + 16, 12.0, ARRAY['riomaggiore', 'village-guide'], 'Riomaggiore Cinque Terre', 2500, 'village_overview');

  -- Hiking and food tasks
  INSERT INTO editorial_tasks (website_id, title, description, task_type, status, priority, assigned_agent_id, due_date, estimated_hours, tags, seo_primary_keyword, word_count_target, content_type)
  VALUES
    (v_website_id, 'Sentiero Azzurro Trail Guide', 'Complete guide to the Blue Trail', 'article', 'in_progress', 'urgent', v_agent_isabella, CURRENT_DATE + 3, 15.0, ARRAY['hiking', 'trails'], 'Sentiero Azzurro', 3000, 'trail_guide'),
    (v_website_id, 'Top 15 Restaurants in Cinque Terre', 'Curated restaurant list', 'article', 'ready', 'high', v_agent_giulia, CURRENT_DATE + 12, 10.0, ARRAY['restaurants', 'food'], 'Cinque Terre restaurants', 2800, 'poi_listing'),
    (v_website_id, 'Ligurian Cuisine: What to Eat', 'Guide to traditional dishes', 'article', 'in_progress', 'high', v_agent_giulia, CURRENT_DATE + 15, 9.0, ARRAY['food', 'cuisine'], 'Ligurian cuisine', 2200, 'food_guide');

  -- Practical info tasks
  INSERT INTO editorial_tasks (website_id, title, description, task_type, status, priority, assigned_agent_id, due_date, estimated_hours, tags, seo_primary_keyword, word_count_target, content_type)
  VALUES
    (v_website_id, 'How to Get to Cinque Terre', 'Transportation guide', 'article', 'backlog', 'medium', v_agent_isabella, CURRENT_DATE + 18, 8.0, ARRAY['transportation'], 'how to get to Cinque Terre', 2000, 'practical_guide'),
    (v_website_id, 'Best Time to Visit Cinque Terre', 'Seasonal guide', 'article', 'ready', 'medium', v_agent_isabella, CURRENT_DATE + 8, 7.0, ARRAY['planning', 'seasonal'], 'best time to visit Cinque Terre', 1800, 'seasonal_guide'),
    (v_website_id, 'Cinque Terre 3-Day Itinerary', 'Detailed three-day itinerary', 'article', 'backlog', 'medium', v_agent_isabella, CURRENT_DATE + 25, 10.0, ARRAY['itinerary'], 'Cinque Terre 3 day itinerary', 2500, 'itinerary');

  -- Cultural tasks
  INSERT INTO editorial_tasks (website_id, title, description, task_type, status, priority, assigned_agent_id, due_date, estimated_hours, tags, seo_primary_keyword, word_count_target, content_type)
  VALUES
    (v_website_id, 'History and Culture of Cinque Terre', 'Historical overview', 'article', 'backlog', 'low', v_agent_lorenzo, CURRENT_DATE + 30, 12.0, ARRAY['culture', 'history'], 'Cinque Terre history', 2300, 'cultural_guide'),
    (v_website_id, 'Local Festivals and Events', 'Annual festival calendar', 'article', 'backlog', 'low', v_agent_lorenzo, CURRENT_DATE + 35, 6.0, ARRAY['events', 'festivals'], 'Cinque Terre festivals', 1500, 'event_guide');

  -- ============================================================================
  -- 12. AGENT ACTIVITIES
  -- ============================================================================

  INSERT INTO agent_activities (agent_id, activity_type, description, related_entity_type, related_entity_id, metadata)
  VALUES
    (v_agent_sophia, 'planning', 'Initial content strategy planning for multi-language rollout', 'website', v_website_id, '{"languages": ["en", "de", "fr", "it"]}'::jsonb),
    (v_agent_alex, 'seo_optimization', 'Initial keyword research for Cinque Terre travel queries', 'website', v_website_id, '{"keywords_identified": 150}'::jsonb),
    (v_agent_francesca, 'media_sourcing', 'Sourcing hero images for village pages', 'website', v_website_id, '{"images_reviewed": 200}'::jsonb);

  -- ============================================================================
  -- 13. SUGGESTIONS
  -- ============================================================================

  INSERT INTO suggestions (website_id, suggested_by_agent_id, title, description, suggestion_type, status, priority)
  VALUES
    (v_website_id, v_agent_alex, 'Create "Cinque Terre on a Budget" Guide', 'Comprehensive budget travel guide', 'new_content', 'pending', 1),
    (v_website_id, v_agent_alex, 'Add FAQ Schema to All Village Pages', 'Implement structured FAQ data', 'seo_optimization', 'approved', 2),
    (v_website_id, v_agent_francesca, 'Add Interactive Trail Map', 'Embed interactive map showing all hiking trails', 'new_feature', 'pending', 3),
    (v_website_id, v_agent_giulia, 'Add Wine Route Content', 'Create dedicated wine route pages', 'content_update', 'pending', 4);

  RAISE NOTICE 'Bootstrap complete!';
  RAISE NOTICE 'Company ID: %', v_company_id;
  RAISE NOTICE 'Website ID: %', v_website_id;

END $$;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

SELECT '=== CINQUETERRE.TRAVEL BOOTSTRAP VERIFICATION ===' as info;

SELECT 'Entity Counts' as section;
SELECT 'Companies' as entity, COUNT(*) as count FROM companies WHERE name = 'Cinqueterre.travel'
UNION ALL SELECT 'Departments', COUNT(*) FROM departments WHERE company_id IN (SELECT id FROM companies WHERE name = 'Cinqueterre.travel')
UNION ALL SELECT 'Roles', COUNT(*) FROM roles WHERE department_id IN (SELECT id FROM departments WHERE company_id IN (SELECT id FROM companies WHERE name = 'Cinqueterre.travel'))
UNION ALL SELECT 'Agents', COUNT(*) FROM agents WHERE virtual_email LIKE '%@cinqueterre.travel'
UNION ALL SELECT 'Websites', COUNT(*) FROM websites WHERE domain = 'cinqueterre.travel'
UNION ALL SELECT 'Tool Configs', COUNT(*) FROM tool_configs WHERE name IN ('google_places', 'openweather', 'pexels', 'unsplash', 'wikidata', 'overpass_osm')
UNION ALL SELECT 'Website Tools', COUNT(*) FROM website_tools WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
UNION ALL SELECT 'Blueprints', COUNT(*) FROM content_blueprints WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
UNION ALL SELECT 'Pages', COUNT(*) FROM pages WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
UNION ALL SELECT 'Editorial Tasks', COUNT(*) FROM editorial_tasks WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
UNION ALL SELECT 'Agent Activities', COUNT(*) FROM agent_activities WHERE agent_id IN (SELECT id FROM agents WHERE virtual_email LIKE '%@cinqueterre.travel')
UNION ALL SELECT 'Suggestions', COUNT(*) FROM suggestions WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
ORDER BY entity;

SELECT 'Page Distribution by Language' as section;
SELECT metadata->>'lang' as language, COUNT(*) as pages
FROM pages
WHERE website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
  AND metadata->>'lang' IS NOT NULL
GROUP BY metadata->>'lang'
ORDER BY language;

SELECT 'Agents by Department' as section;
SELECT d.name as department, COUNT(a.*) as agents
FROM agents a
JOIN departments d ON a.department_id = d.id
WHERE a.virtual_email LIKE '%@cinqueterre.travel'
GROUP BY d.name
ORDER BY d.name;

SELECT 'Tools Assigned' as section;
SELECT tc.display_name, wt.enabled, wt.priority
FROM website_tools wt
JOIN tool_configs tc ON wt.tool_config_id = tc.id
WHERE wt.website_id IN (SELECT id FROM websites WHERE domain = 'cinqueterre.travel')
ORDER BY wt.priority DESC;
