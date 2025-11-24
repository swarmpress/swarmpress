-- =============================================================================
-- SWARM.PRESS - COMPLETE DATABASE SCHEMA
-- =============================================================================
--
-- This is the SINGLE SOURCE OF TRUTH for the database schema.
--
-- IMPORTANT: When adding new features, UPDATE THIS FILE FIRST.
--
-- This schema implements the specifications in:
-- - specs/specs.md (core entities)
-- - specs/sitemap-component.md (agentic sitemap features)
-- - specs/agentic_editorial_planning_spec.md (editorial workflow)
--
-- Last Updated: 2025-11-23
-- Schema Version: 1.0.0
--
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- CORE ORGANIZATIONAL ENTITIES
-- =============================================================================

-- Companies (top-level organizations/media houses)
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Departments (organizational units within companies)
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roles (functions within departments)
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agents (AI employees)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  persona TEXT NOT NULL,
  virtual_email VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_department_id ON agents(department_id);
CREATE INDEX idx_agents_role_id ON agents(role_id);
CREATE INDEX idx_agents_status ON agents(status);

-- =============================================================================
-- WEBSITE & CONTENT STRUCTURE
-- =============================================================================

-- Websites (publication surfaces)
CREATE TABLE websites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  domain VARCHAR(255) NOT NULL UNIQUE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  language VARCHAR(10) DEFAULT 'en',
  status VARCHAR(50) NOT NULL DEFAULT 'active',

  -- GitHub Integration
  github_repo_url TEXT,
  github_owner TEXT,
  github_repo TEXT,
  github_installation_id TEXT,
  github_connected_at TIMESTAMPTZ,

  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_websites_company_id ON websites(company_id);
CREATE INDEX idx_websites_status ON websites(status);

-- Pages (sitemap structure with agentic features)
-- Implements: specs/sitemap-component.md
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES pages(id) ON DELETE CASCADE,

  -- Basic Page Info
  slug VARCHAR(500) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',

  -- Template & Type (from sitemap spec)
  template VARCHAR(100),
  page_type VARCHAR(100),  -- village_guide, trail_guide, article, landing_page, etc.

  -- Ordering & Priority
  order_index INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 0,

  -- SEO Fields (separate for easy querying)
  seo_title VARCHAR(500),
  seo_description TEXT,
  seo_keywords TEXT[],

  -- Agentic Features (from sitemap spec)
  internal_links JSONB DEFAULT '{"incoming": [], "outgoing": []}'::jsonb,
  seo_profile JSONB DEFAULT '{}'::jsonb,  -- freshness_score, keyword rankings, intent, etc.
  suggestions JSONB DEFAULT '[]'::jsonb,  -- AI suggestions for this page
  tasks JSONB DEFAULT '[]'::jsonb,        -- Pending tasks for this page

  -- Flexible metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(website_id, slug)
);

CREATE INDEX idx_pages_website_id ON pages(website_id);
CREATE INDEX idx_pages_parent_id ON pages(parent_id);
CREATE INDEX idx_pages_status ON pages(status);
CREATE INDEX idx_pages_slug ON pages(slug);
CREATE INDEX idx_pages_page_type ON pages(page_type);
CREATE INDEX idx_pages_order_index ON pages(order_index);
CREATE INDEX idx_pages_internal_links ON pages USING GIN(internal_links);
CREATE INDEX idx_pages_seo_profile ON pages USING GIN(seo_profile);

COMMENT ON TABLE pages IS 'Sitemap pages with agentic features (internal linking, SEO profiles, AI suggestions)';
COMMENT ON COLUMN pages.page_type IS 'Type of page: village_guide, trail_guide, article, landing_page, etc.';
COMMENT ON COLUMN pages.internal_links IS 'Incoming and outgoing internal links for SEO optimization';
COMMENT ON COLUMN pages.seo_profile IS 'SEO metadata: freshness_score, keyword rankings, search intent, etc.';
COMMENT ON COLUMN pages.suggestions IS 'AI agent suggestions for improving this page';
COMMENT ON COLUMN pages.tasks IS 'Pending editorial tasks for this page';

-- Content Blueprints (page templates)
CREATE TABLE content_blueprints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  schema JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_blueprints_website_id ON content_blueprints(website_id);

-- Content Items (actual content)
CREATE TABLE content_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  page_id UUID REFERENCES pages(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  body JSONB NOT NULL,  -- Structured content blocks
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  author_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX idx_content_items_website_id ON content_items(website_id);
CREATE INDEX idx_content_items_page_id ON content_items(page_id);
CREATE INDEX idx_content_items_status ON content_items(status);
CREATE INDEX idx_content_items_author ON content_items(author_agent_id);

-- =============================================================================
-- EDITORIAL PLANNING SYSTEM
-- Implements: specs/agentic_editorial_planning_spec.md
-- =============================================================================

-- Editorial Tasks (content planning and workflow)
CREATE TABLE editorial_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,

  -- Basic Info
  title TEXT NOT NULL,
  description TEXT,
  task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('article', 'page', 'update', 'fix', 'optimize', 'research')),

  -- Status & Priority
  status VARCHAR(50) NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'ready', 'in_progress', 'in_review', 'blocked', 'completed', 'cancelled')),
  priority VARCHAR(50) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

  -- Assignment
  assigned_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  assigned_human TEXT,

  -- Timeline
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  due_date DATE,
  estimated_hours NUMERIC(5,2),
  actual_hours NUMERIC(5,2),

  -- Dependencies
  depends_on UUID[],  -- Array of task IDs
  blocks UUID[],      -- Array of task IDs

  -- Sitemap Integration
  sitemap_targets UUID[],  -- Array of page IDs

  -- SEO Metadata
  seo_primary_keyword TEXT,
  seo_secondary_keywords TEXT[],
  seo_target_volume INTEGER,
  seo_estimated_difficulty VARCHAR(50) CHECK (seo_estimated_difficulty IN ('easy', 'medium', 'hard', 'very_hard')),

  -- Internal Linking Strategy
  internal_links_required_inbound TEXT[],
  internal_links_required_outbound TEXT[],
  internal_links_min_count INTEGER DEFAULT 0,
  internal_links_max_count INTEGER,

  -- Content Requirements
  word_count_target INTEGER,
  word_count_actual INTEGER,
  content_type TEXT,
  template_blueprint_id UUID REFERENCES content_blueprints(id) ON DELETE SET NULL,

  -- Collaboration
  tags TEXT[],
  labels TEXT[],
  notes TEXT,
  review_comments JSONB,

  -- GitHub Integration
  github_branch TEXT,
  github_pr_url TEXT,
  github_issue_url TEXT,

  -- Phases (denormalized for quick queries)
  current_phase TEXT,
  phases_completed TEXT[],

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_editorial_tasks_website ON editorial_tasks(website_id);
CREATE INDEX idx_editorial_tasks_status ON editorial_tasks(status);
CREATE INDEX idx_editorial_tasks_priority ON editorial_tasks(priority);
CREATE INDEX idx_editorial_tasks_assigned ON editorial_tasks(assigned_agent_id);
CREATE INDEX idx_editorial_tasks_due_date ON editorial_tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_editorial_tasks_current_phase ON editorial_tasks(current_phase);
CREATE INDEX idx_editorial_tasks_sitemap_targets ON editorial_tasks USING GIN(sitemap_targets);
CREATE INDEX idx_editorial_tasks_tags ON editorial_tasks USING GIN(tags);
CREATE INDEX idx_editorial_tasks_depends_on ON editorial_tasks USING GIN(depends_on);

-- Task Phases (detailed phase tracking)
CREATE TABLE task_phases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES editorial_tasks(id) ON DELETE CASCADE,
  phase_name VARCHAR(50) NOT NULL CHECK (phase_name IN ('research', 'outline', 'draft', 'edit', 'review', 'publish', 'optimize')),
  phase_order INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped')),
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  assigned_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(task_id, phase_name)
);

CREATE INDEX idx_task_phases_task_id ON task_phases(task_id);
CREATE INDEX idx_task_phases_status ON task_phases(status);
CREATE INDEX idx_task_phases_phase_order ON task_phases(phase_order);

-- =============================================================================
-- WORKFLOW & COLLABORATION
-- =============================================================================

-- Tasks (general workflow tasks)
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID REFERENCES websites(id) ON DELETE CASCADE,
  content_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
  assigned_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  task_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  payload JSONB DEFAULT '{}'::jsonb,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_tasks_website_id ON tasks(website_id);
CREATE INDEX idx_tasks_assigned_agent_id ON tasks(assigned_agent_id);
CREATE INDEX idx_tasks_status ON tasks(status);

-- Reviews (editorial reviews)
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  reviewer_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  result VARCHAR(50) NOT NULL,
  comments TEXT,
  suggestions JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_content_id ON reviews(content_id);
CREATE INDEX idx_reviews_reviewer ON reviews(reviewer_agent_id);

-- Question Tickets (escalations to humans)
CREATE TABLE question_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  target VARCHAR(100) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  answer TEXT,
  answered_by VARCHAR(255),
  answered_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_question_tickets_status ON question_tickets(status);
CREATE INDEX idx_question_tickets_created_by ON question_tickets(created_by_agent_id);

-- =============================================================================
-- AGENT ACTIVITIES & SUGGESTIONS
-- =============================================================================

-- Agent Activities (activity log)
CREATE TABLE agent_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  activity_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  related_entity_type VARCHAR(100),
  related_entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_activities_agent_id ON agent_activities(agent_id);
CREATE INDEX idx_agent_activities_created_at ON agent_activities(created_at);
CREATE INDEX idx_agent_activities_type ON agent_activities(activity_type);

-- Content Suggestions (AI-generated ideas)
CREATE TABLE suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  suggested_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  suggestion_type VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suggestions_website_id ON suggestions(website_id);
CREATE INDEX idx_suggestions_agent_id ON suggestions(suggested_by_agent_id);
CREATE INDEX idx_suggestions_status ON suggestions(status);

-- =============================================================================
-- AUDIT & STATE MANAGEMENT
-- =============================================================================

-- State Audit Log (state machine transitions)
CREATE TABLE state_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  from_state VARCHAR(100),
  to_state VARCHAR(100) NOT NULL,
  actor_type VARCHAR(100),
  actor_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_state_audit_entity ON state_audit_log(entity_type, entity_id);
CREATE INDEX idx_state_audit_created_at ON state_audit_log(created_at);

-- =============================================================================
-- ANALYTICS & CACHING
-- =============================================================================

-- Sitemap Analytics Cache
CREATE TABLE sitemap_analytics_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sitemap_analytics_website ON sitemap_analytics_cache(website_id);

-- Graph Positions (for visual editor)
CREATE TABLE graph_positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  x NUMERIC NOT NULL,
  y NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(website_id, page_id)
);

CREATE INDEX idx_graph_positions_website ON graph_positions(website_id);
CREATE INDEX idx_graph_positions_page ON graph_positions(page_id);

-- =============================================================================
-- TRIGGERS & FUNCTIONS
-- =============================================================================

-- Auto-update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_websites_updated_at BEFORE UPDATE ON websites FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pages_updated_at BEFORE UPDATE ON pages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_content_blueprints_updated_at BEFORE UPDATE ON content_blueprints FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_content_items_updated_at BEFORE UPDATE ON content_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_editorial_tasks_updated_at BEFORE UPDATE ON editorial_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_task_phases_updated_at BEFORE UPDATE ON task_phases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_question_tickets_updated_at BEFORE UPDATE ON question_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_suggestions_updated_at BEFORE UPDATE ON suggestions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sitemap_analytics_cache_updated_at BEFORE UPDATE ON sitemap_analytics_cache FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_graph_positions_updated_at BEFORE UPDATE ON graph_positions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Phase transition handler (keeps editorial_tasks.current_phase in sync)
CREATE OR REPLACE FUNCTION handle_phase_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    -- Update parent task's phases_completed
    UPDATE editorial_tasks
    SET
      phases_completed = array_append(
        COALESCE(phases_completed, ARRAY[]::TEXT[]),
        NEW.phase_name
      ),
      current_phase = (
        SELECT phase_name FROM task_phases
        WHERE task_id = NEW.task_id
          AND status = 'in_progress'
        ORDER BY phase_order
        LIMIT 1
      )
    WHERE id = NEW.task_id;
  ELSIF NEW.status = 'in_progress' THEN
    -- Update current_phase
    UPDATE editorial_tasks
    SET current_phase = NEW.phase_name
    WHERE id = NEW.task_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase_transition_handler
  AFTER UPDATE ON task_phases
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION handle_phase_transition();

-- =============================================================================
-- COMMENTS (Documentation)
-- =============================================================================

COMMENT ON TABLE companies IS 'Top-level organizations (media houses)';
COMMENT ON TABLE departments IS 'Organizational units within companies';
COMMENT ON TABLE roles IS 'Functions/roles within departments';
COMMENT ON TABLE agents IS 'AI agents (virtual employees)';
COMMENT ON TABLE websites IS 'Publication surfaces (domains)';
COMMENT ON TABLE content_blueprints IS 'Templates for structured content';
COMMENT ON TABLE content_items IS 'Actual content (articles, pages, etc.)';
COMMENT ON TABLE editorial_tasks IS 'Content planning and editorial workflow tasks';
COMMENT ON TABLE task_phases IS 'Detailed phase tracking for editorial tasks';
COMMENT ON TABLE tasks IS 'General workflow tasks';
COMMENT ON TABLE reviews IS 'Editorial reviews and feedback';
COMMENT ON TABLE question_tickets IS 'Escalations to human decision-makers';
COMMENT ON TABLE agent_activities IS 'Activity log for agent actions';
COMMENT ON TABLE suggestions IS 'AI-generated content ideas';
COMMENT ON TABLE state_audit_log IS 'Audit trail for state transitions';
COMMENT ON TABLE sitemap_analytics_cache IS 'Cached analytics for sitemap';
COMMENT ON TABLE graph_positions IS 'Visual editor node positions';

COMMIT;

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================

\echo ''
\echo '========================================='
\echo 'Swarm.press schema created successfully!'
\echo '========================================='
\echo ''
\echo 'Schema Version: 1.0.0'
\echo 'Based on specifications in specs/'
\echo ''
