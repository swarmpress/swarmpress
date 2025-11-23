-- Setup script for cinqueterre.travel virtual media house
-- Run with: docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress < setup-cinqueterre.sql

BEGIN;

-- 1. Create Company
INSERT INTO companies (id, name, description)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Cinqueterre.travel',
  'Virtual media house for the Cinque Terre travel portal'
);

-- 2. Create Departments
INSERT INTO departments (id, company_id, name, description) VALUES
  ('10000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Editorial', 'Content creation and editorial oversight'),
  ('10000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Engineering', 'Technical operations and infrastructure'),
  ('10000000-0000-0000-0000-000000000003'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Governance', 'Strategic leadership and oversight');

-- 3. Create Roles
INSERT INTO roles (id, department_id, name, description) VALUES
  ('20000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'Writer', 'Creates content drafts and articles'),
  ('20000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'Editor', 'Reviews and approves content'),
  ('20000000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000002'::uuid, 'Engineer', 'Manages technical infrastructure'),
  ('20000000-0000-0000-0000-000000000004'::uuid, '10000000-0000-0000-0000-000000000003'::uuid, 'CEO Assistant', 'Handles high-level decisions and strategy');

-- 4. Create Agents
INSERT INTO agents (id, name, role_id, department_id, persona, virtual_email, capabilities) VALUES
  (
    '30000000-0000-0000-0000-000000000001'::uuid,
    'Alex',
    '20000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    'Creative and detail-oriented content writer specializing in travel and lifestyle content',
    'alex@cinqueterre.travel',
    '["content_creation", "research", "seo_optimization", "storytelling"]'::jsonb
  ),
  (
    '30000000-0000-0000-0000-000000000002'::uuid,
    'Jordan',
    '20000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    'Experienced editor focused on quality, clarity, and engaging storytelling',
    'jordan@cinqueterre.travel',
    '["editorial_review", "content_improvement", "quality_assurance", "fact_checking"]'::jsonb
  ),
  (
    '30000000-0000-0000-0000-000000000003'::uuid,
    'Morgan',
    '20000000-0000-0000-0000-000000000003'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid,
    'Technical expert managing site building, deployment, and infrastructure',
    'morgan@cinqueterre.travel',
    '["site_building", "deployment", "technical_optimization", "troubleshooting"]'::jsonb
  ),
  (
    '30000000-0000-0000-0000-000000000004'::uuid,
    'Casey',
    '20000000-0000-0000-0000-000000000004'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid,
    'Strategic thinker handling high-level decisions, planning, and coordination',
    'casey@cinqueterre.travel',
    '["strategy", "planning", "coordination", "decision_making"]'::jsonb
  );

-- 5. Create Website
INSERT INTO websites (id, domain, title, description)
VALUES (
  '40000000-0000-0000-0000-000000000001'::uuid,
  'cinqueterre.travel',
  'Cinqueterre.travel - Your Guide to the Italian Riviera',
  'The ultimate travel guide to Cinque Terre, featuring village guides, hiking trails, local cuisine, and insider tips for exploring this stunning Italian coastal region.'
);

-- 6. Create Initial Content Items
INSERT INTO content_items (id, website_id, type, body, metadata, author_agent_id, status) VALUES
  (
    '50000000-0000-0000-0000-000000000001'::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    'article',
    '[]'::jsonb,
    '{"title": "Ultimate Guide to Visiting Cinque Terre", "description": "Comprehensive guide covering all five villages, best times to visit, and essential travel tips"}'::jsonb,
    '30000000-0000-0000-0000-000000000001'::uuid,
    'idea'
  ),
  (
    '50000000-0000-0000-0000-000000000002'::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    'article',
    '[]'::jsonb,
    '{"title": "The Five Villages of Cinque Terre Explained", "description": "Detailed exploration of Monterosso, Vernazza, Corniglia, Manarola, and Riomaggiore"}'::jsonb,
    '30000000-0000-0000-0000-000000000001'::uuid,
    'idea'
  ),
  (
    '50000000-0000-0000-0000-000000000003'::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    'article',
    '[]'::jsonb,
    '{"title": "Best Hiking Trails in Cinque Terre", "description": "Complete guide to hiking trails including Sentiero Azzurro and Via dell Amore"}'::jsonb,
    '30000000-0000-0000-0000-000000000001'::uuid,
    'idea'
  ),
  (
    '50000000-0000-0000-0000-000000000004'::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    'article',
    '[]'::jsonb,
    '{"title": "Where to Eat in Cinque Terre: Local Food Guide", "description": "Best restaurants, trattorias, and local specialties"}'::jsonb,
    '30000000-0000-0000-0000-000000000001'::uuid,
    'idea'
  ),
  (
    '50000000-0000-0000-0000-000000000005'::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    'article',
    '[]'::jsonb,
    '{"title": "Best Time to Visit Cinque Terre", "description": "Seasonal guide with weather, crowds, and events"}'::jsonb,
    '30000000-0000-0000-0000-000000000001'::uuid,
    'idea'
  );

-- 7. Create Initial Tasks
INSERT INTO tasks (id, type, agent_id, content_id, website_id, status, notes) VALUES
  (
    '60000000-0000-0000-0000-000000000001'::uuid,
    'create_brief',
    '30000000-0000-0000-0000-000000000001'::uuid,
    '50000000-0000-0000-0000-000000000001'::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    'planned',
    'Create a detailed content brief for the Ultimate Guide to Visiting Cinque Terre'
  ),
  (
    '60000000-0000-0000-0000-000000000002'::uuid,
    'create_brief',
    '30000000-0000-0000-0000-000000000001'::uuid,
    '50000000-0000-0000-0000-000000000002'::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    'planned',
    'Create a detailed content brief for The Five Villages of Cinque Terre'
  );

COMMIT;

-- Display summary
SELECT 'Setup complete!' AS status;
SELECT 'Company: Cinqueterre.travel' AS info;
SELECT 'Agents: ' || COUNT(*) || ' created' AS info FROM agents;
SELECT 'Content items: ' || COUNT(*) || ' created' AS info FROM content_items;
SELECT 'Tasks: ' || COUNT(*) || ' created' AS info FROM tasks;
