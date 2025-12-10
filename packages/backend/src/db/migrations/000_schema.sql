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

  -- Visual Identity
  avatar_url TEXT,                    -- Small profile picture (thumbnail)
  profile_image_url TEXT,             -- Large profile/hero image

  -- Personality & Style (for content-creating agents)
  hobbies TEXT[],                     -- List of interests/hobbies
  writing_style JSONB,                -- Writing preferences: tone, vocabulary, sentence_length, etc.

  -- Typed Capabilities (structured, not just strings)
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Agent Configuration
  model_config JSONB,                 -- LLM model preferences: model, temperature, max_tokens

  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN agents.avatar_url IS 'Small thumbnail image for agent (e.g., 100x100)';
COMMENT ON COLUMN agents.profile_image_url IS 'Large profile/hero image for agent detail view';
COMMENT ON COLUMN agents.hobbies IS 'Array of interests that shape the agent personality';
COMMENT ON COLUMN agents.writing_style IS 'JSON: {tone, vocabulary_level, sentence_length, formality, humor, emoji_usage}';
COMMENT ON COLUMN agents.capabilities IS 'Array of typed capabilities with metadata';
COMMENT ON COLUMN agents.model_config IS 'JSON: {model, temperature, max_tokens, top_p}';

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
  github_access_token TEXT, -- OAuth access token for this website's repo
  github_connected_at TIMESTAMPTZ,

  -- GitHub Pages Deployment
  github_pages_enabled BOOLEAN DEFAULT FALSE,
  github_pages_url TEXT,                    -- e.g., https://owner.github.io/repo
  github_pages_branch TEXT DEFAULT 'gh-pages',  -- 'gh-pages' or 'main'
  github_pages_path TEXT DEFAULT '/',       -- '/' or '/docs'
  github_pages_custom_domain TEXT,          -- Custom domain if configured
  last_deployed_at TIMESTAMPTZ,
  deployment_status TEXT DEFAULT 'never_deployed', -- 'never_deployed', 'deploying', 'deployed', 'failed'
  deployment_error TEXT,                    -- Error message if deployment failed

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
  slug VARCHAR(500),  -- URL-friendly slug (optional)
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
-- PROMPT ENGINEERING & MANAGEMENT
-- =============================================================================

-- Level 1: Company Prompt Templates (Baseline prompts for all websites)
CREATE TABLE company_prompt_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,  -- 'writer', 'editor', 'seo', 'ceo_assistant', etc.
  capability TEXT NOT NULL,  -- 'write_draft', 'review_content', 'optimize_seo', etc.
  version TEXT NOT NULL,  -- Semantic versioning: "1.0.0", "1.1.0", "2.0.0"

  -- Prompt content (XML format)
  template TEXT NOT NULL,

  -- Examples for multishot prompting
  examples JSONB DEFAULT '[]'::jsonb,

  -- Default variables for this role/capability
  default_variables JSONB DEFAULT '{}'::jsonb,

  -- Metadata
  description TEXT,
  changelog TEXT,  -- What changed in this version
  created_by_user_id UUID,  -- Human who created/approved this
  approved_by_user_id UUID,  -- CEO/CTO approval
  approved_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT FALSE,  -- Must be explicitly activated
  is_deprecated BOOLEAN DEFAULT FALSE,
  deprecation_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(company_id, role_name, capability, version)
);

CREATE INDEX idx_company_prompts_company ON company_prompt_templates(company_id);
CREATE INDEX idx_company_prompts_role ON company_prompt_templates(role_name);
CREATE INDEX idx_company_prompts_capability ON company_prompt_templates(capability);
CREATE INDEX idx_company_prompts_active ON company_prompt_templates(company_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_company_prompts_lookup ON company_prompt_templates(company_id, role_name, capability, is_active);

-- Level 2: Website Prompt Templates (Brand-specific overrides)
CREATE TABLE website_prompt_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  company_prompt_template_id UUID NOT NULL REFERENCES company_prompt_templates(id) ON DELETE RESTRICT,
  version TEXT NOT NULL,  -- Website-specific versioning

  -- Override options (NULL = inherit from company)
  template_override TEXT,  -- Complete replacement (rarely used)
  template_additions TEXT,  -- Appended to company template (common)

  -- Override examples (merged with company examples)
  examples_override JSONB DEFAULT '[]'::jsonb,

  -- Override variables (merged with company defaults)
  variables_override JSONB DEFAULT '{}'::jsonb,

  -- Metadata
  description TEXT,
  changelog TEXT,
  created_by_user_id UUID,
  approved_by_user_id UUID,  -- Chief Editor for this website
  approved_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT FALSE,
  is_deprecated BOOLEAN DEFAULT FALSE,
  deprecation_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(website_id, company_prompt_template_id, version)
);

CREATE INDEX idx_website_prompts_website ON website_prompt_templates(website_id);
CREATE INDEX idx_website_prompts_company ON website_prompt_templates(company_prompt_template_id);
CREATE INDEX idx_website_prompts_active ON website_prompt_templates(website_id, is_active) WHERE is_active = TRUE;

-- Level 3: Agent Prompt Bindings (Individual agent assignments)
CREATE TABLE agent_prompt_bindings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,  -- Must match agent's capabilities array

  -- Bind to EITHER company or website prompt (not both)
  company_prompt_template_id UUID REFERENCES company_prompt_templates(id) ON DELETE RESTRICT,
  website_prompt_template_id UUID REFERENCES website_prompt_templates(id) ON DELETE RESTRICT,

  -- Agent-level variable customizations (lightweight)
  custom_variables JSONB DEFAULT '{}'::jsonb,

  -- A/B testing support
  ab_test_group TEXT,  -- 'control', 'variant_a', 'variant_b', etc.
  ab_test_weight DECIMAL(3,2) DEFAULT 1.0,  -- 0.0 to 1.0 (probability of selection)

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(agent_id, capability),

  -- Must bind to exactly one prompt source
  CONSTRAINT binding_source_check CHECK (
    (company_prompt_template_id IS NOT NULL AND website_prompt_template_id IS NULL) OR
    (company_prompt_template_id IS NULL AND website_prompt_template_id IS NOT NULL)
  ),

  -- A/B test weight must be valid
  CONSTRAINT ab_test_weight_check CHECK (ab_test_weight >= 0.0 AND ab_test_weight <= 1.0)
);

CREATE INDEX idx_agent_bindings_agent ON agent_prompt_bindings(agent_id);
CREATE INDEX idx_agent_bindings_capability ON agent_prompt_bindings(capability);
CREATE INDEX idx_agent_bindings_company_prompt ON agent_prompt_bindings(company_prompt_template_id);
CREATE INDEX idx_agent_bindings_website_prompt ON agent_prompt_bindings(website_prompt_template_id);
CREATE INDEX idx_agent_bindings_lookup ON agent_prompt_bindings(agent_id, capability, is_active);

-- Prompt Execution Logging (Performance tracking)
CREATE TABLE prompt_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Context
  agent_id UUID NOT NULL REFERENCES agents(id),
  capability TEXT NOT NULL,
  company_prompt_template_id UUID REFERENCES company_prompt_templates(id),
  website_prompt_template_id UUID REFERENCES website_prompt_templates(id),

  -- Input/Output
  input_variables JSONB NOT NULL,
  final_prompt_hash TEXT,  -- Hash of final rendered prompt (for cache/dedup)
  output TEXT,

  -- Performance metrics
  tokens_used INTEGER,
  latency_ms INTEGER,
  claude_model TEXT,  -- 'claude-sonnet-4-5', etc.

  -- Quality metrics (filled in later by human or automated review)
  quality_score DECIMAL(3,2),  -- 0.0 to 5.0
  quality_rated_by TEXT,  -- 'human', 'ai_review', 'editor_approval'
  quality_rated_at TIMESTAMPTZ,
  quality_feedback TEXT,

  -- Content outcomes (filled in during workflow)
  content_id UUID REFERENCES content_items(id),
  content_status TEXT,  -- 'draft', 'approved', 'published', 'rejected'
  revision_count INTEGER DEFAULT 0,  -- How many revisions needed

  -- Error tracking
  error_occurred BOOLEAN DEFAULT FALSE,
  error_message TEXT,

  -- A/B testing
  ab_test_group TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prompt_executions_agent ON prompt_executions(agent_id);
CREATE INDEX idx_prompt_executions_capability ON prompt_executions(capability);
CREATE INDEX idx_prompt_executions_company_prompt ON prompt_executions(company_prompt_template_id);
CREATE INDEX idx_prompt_executions_website_prompt ON prompt_executions(website_prompt_template_id);
CREATE INDEX idx_prompt_executions_quality ON prompt_executions(quality_score) WHERE quality_score IS NOT NULL;
CREATE INDEX idx_prompt_executions_date ON prompt_executions(created_at DESC);
CREATE INDEX idx_prompt_executions_content ON prompt_executions(content_id);
CREATE INDEX idx_prompt_executions_error ON prompt_executions(error_occurred) WHERE error_occurred = TRUE;

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
-- EXTENSIBLE TOOL SYSTEM
-- =============================================================================

-- Tool Configurations (REST, GraphQL, MCP, JavaScript endpoints)
CREATE TABLE tool_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(200),
  description TEXT,
  type VARCHAR(20) NOT NULL CHECK (type IN ('rest', 'graphql', 'mcp', 'builtin', 'javascript')),
  endpoint_url TEXT,
  config JSONB DEFAULT '{}'::jsonb,  -- headers, auth type, query templates, JS code+manifest, etc.
  input_schema JSONB,                 -- JSON Schema for tool inputs
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_configs_name ON tool_configs(name);
CREATE INDEX idx_tool_configs_type ON tool_configs(type);

-- Scope tools to websites (NULL website_id = global/all websites)
CREATE TABLE website_tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID REFERENCES websites(id) ON DELETE CASCADE,
  tool_config_id UUID NOT NULL REFERENCES tool_configs(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,  -- Higher = preferred when conflicts
  custom_config JSONB DEFAULT '{}'::jsonb,  -- Website-specific overrides
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(website_id, tool_config_id)
);

CREATE INDEX idx_website_tools_website ON website_tools(website_id);
CREATE INDEX idx_website_tools_tool ON website_tools(tool_config_id);
CREATE INDEX idx_website_tools_enabled ON website_tools(enabled) WHERE enabled = TRUE;

-- Per-website secrets for tools (API keys, tokens, etc.)
CREATE TABLE tool_secrets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  tool_config_id UUID NOT NULL REFERENCES tool_configs(id) ON DELETE CASCADE,
  secret_key VARCHAR(100) NOT NULL,
  encrypted_value TEXT NOT NULL,  -- Encrypted with app secret
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(website_id, tool_config_id, secret_key)
);

CREATE INDEX idx_tool_secrets_lookup ON tool_secrets(website_id, tool_config_id);

-- Triggers for updated_at
CREATE TRIGGER update_tool_configs_updated_at BEFORE UPDATE ON tool_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tool_secrets_updated_at BEFORE UPDATE ON tool_secrets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE tool_configs IS 'External tool configurations (REST, GraphQL, MCP endpoints)';
COMMENT ON TABLE website_tools IS 'Tool assignments to websites (NULL website_id = global)';
COMMENT ON TABLE tool_secrets IS 'Per-website encrypted secrets for tools (API keys, tokens)';

-- =============================================================================
-- WEBSITE COLLECTIONS SYSTEM (Database-driven schemas)
-- =============================================================================

-- Collection Definitions (Website-Level)
-- Stores collection type configurations per website, including JSON Schema
CREATE TABLE website_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  collection_type TEXT NOT NULL, -- e.g., 'restaurants', 'hikes', 'events', 'cinqueterre_villages'

  -- Schema Definition (JSON Schema format)
  json_schema JSONB NOT NULL,    -- The complete JSON Schema for this collection type
  create_schema JSONB,           -- Optional: Schema for creating items (subset of fields)

  -- Display Configuration
  display_name TEXT NOT NULL,    -- Human-readable name: "Restaurants"
  singular_name TEXT,            -- Singular form: "Restaurant"
  description TEXT,              -- Description of the collection
  icon TEXT,                     -- Icon identifier (emoji or icon name)
  color TEXT,                    -- Color for UI (hex code or name)

  -- Field Metadata (for UI generation and search)
  field_metadata JSONB DEFAULT '{}'::jsonb, -- Field display hints, search config, etc.
  title_field TEXT DEFAULT 'name',          -- Which field to use as title
  summary_field TEXT,                       -- Which field to use as summary
  image_field TEXT,                         -- Which field contains main image
  date_field TEXT,                          -- Which field contains date (for sorting)

  -- Feature Flags
  enable_search BOOLEAN DEFAULT TRUE,
  enable_filtering BOOLEAN DEFAULT TRUE,
  enable_versioning BOOLEAN DEFAULT TRUE,
  enable_github_sync BOOLEAN DEFAULT TRUE,

  -- Custom fields added by this website (extends base schema)
  custom_fields JSONB DEFAULT '[]'::jsonb,
  field_overrides JSONB DEFAULT '{}'::jsonb,

  -- Status
  enabled BOOLEAN DEFAULT TRUE,

  -- Sync settings
  github_path TEXT, -- Path in GitHub repo: '.content/restaurants/'

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(website_id, collection_type)
);

CREATE INDEX idx_website_collections_website ON website_collections(website_id);
CREATE INDEX idx_website_collections_type ON website_collections(collection_type);
CREATE INDEX idx_website_collections_enabled ON website_collections(enabled) WHERE enabled = TRUE;

-- Collection Items (Actual Content)
CREATE TABLE collection_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_collection_id UUID NOT NULL REFERENCES website_collections(id) ON DELETE CASCADE,

  -- Content
  slug TEXT NOT NULL,
  data JSONB NOT NULL, -- The actual content following collection schema

  -- Metadata
  published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  featured BOOLEAN DEFAULT FALSE,

  -- GitHub sync
  github_path TEXT, -- Path in GitHub repo
  github_sha TEXT, -- Git commit SHA
  synced_at TIMESTAMPTZ,

  -- Authorship
  created_by_agent_id UUID REFERENCES agents(id),
  created_by_user_id UUID,
  updated_by_agent_id UUID REFERENCES agents(id),
  updated_by_user_id UUID,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(website_collection_id, slug)
);

CREATE INDEX idx_collection_items_collection ON collection_items(website_collection_id);
CREATE INDEX idx_collection_items_slug ON collection_items(slug);
CREATE INDEX idx_collection_items_published ON collection_items(published) WHERE published = TRUE;
CREATE INDEX idx_collection_items_data ON collection_items USING gin(data);
CREATE INDEX idx_collection_items_github ON collection_items(github_path);

-- Full-text search on collection item data
CREATE INDEX idx_collection_items_search ON collection_items
  USING gin(to_tsvector('english', data::text));

-- Collection Item Versions (History)
CREATE TABLE collection_item_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,

  -- Snapshot
  data JSONB NOT NULL,

  -- Version metadata
  created_by_agent_id UUID REFERENCES agents(id),
  created_by_user_id UUID,
  change_summary TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(item_id, version_number)
);

CREATE INDEX idx_collection_versions_item ON collection_item_versions(item_id);

-- Collection Research Configuration
-- Stores research settings per collection (search prompts, extraction hints, etc.)
CREATE TABLE collection_research_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  collection_id UUID NOT NULL REFERENCES website_collections(id) ON DELETE CASCADE,

  -- Status
  enabled BOOLEAN DEFAULT true,

  -- Search Configuration
  search_prompt TEXT,                    -- Custom prompt for enhancing web search queries
  default_queries JSONB DEFAULT '[]',    -- Pre-built search queries for this collection
  search_domains TEXT[],                 -- Whitelist domains for search results

  -- Extraction Configuration
  extraction_prompt TEXT,                -- Custom prompt for data extraction from search results
  extraction_hints JSONB,                -- Field-specific extraction guidance

  -- Validation Configuration
  validation_rules JSONB,                -- Additional validation beyond JSON Schema
  require_source_urls BOOLEAN DEFAULT true,
  min_confidence_score REAL DEFAULT 0.7,

  -- Storage Configuration
  auto_publish BOOLEAN DEFAULT false,
  dedup_strategy TEXT DEFAULT 'name',    -- 'name', 'location', 'composite'

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(collection_id)
);

CREATE INDEX idx_collection_research_enabled ON collection_research_config(collection_id) WHERE enabled = true;

-- Triggers for updated_at
CREATE TRIGGER update_website_collections_updated_at BEFORE UPDATE ON website_collections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_collection_items_updated_at BEFORE UPDATE ON collection_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_collection_research_config_updated_at BEFORE UPDATE ON collection_research_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE website_collections IS 'Collection type definitions per website with JSON Schema';
COMMENT ON TABLE collection_items IS 'Collection items (records) following website collection schemas';
COMMENT ON TABLE collection_item_versions IS 'Version history for collection items';
COMMENT ON TABLE collection_research_config IS 'Research configuration per collection (search prompts, extraction hints)';

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
