/**
 * Migration 004: Agentic Sitemap Tables
 * Creates tables for graph-driven sitemap architecture
 *
 * New tables:
 * - pages: Sitemap pages with SEO, linking, and agent collaboration
 * - blueprints: Page templates defining component structure
 * - content_models: Atomic design system definitions
 * - graph_positions: React Flow node positions
 */

-- ============================================
-- PAGES TABLE
-- ============================================
-- Evolution of content_items for page-type content
-- Includes SEO profile, internal linking, agent collaboration

CREATE TABLE IF NOT EXISTS pages (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  page_type TEXT NOT NULL,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('planned', 'draft', 'published', 'outdated', 'deprecated')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),

  -- Hierarchy
  parent_id UUID REFERENCES pages(id) ON DELETE SET NULL,
  order_index INTEGER DEFAULT 0,

  -- Blueprint & Model binding
  blueprint_id UUID REFERENCES blueprints(id) ON DELETE SET NULL,
  content_model_id UUID REFERENCES content_models(id) ON DELETE SET NULL,

  -- Topics/Tags
  topics TEXT[] DEFAULT '{}',

  -- SEO Profile (JSONB)
  -- {
  --   primary_keyword: string,
  --   secondary_keywords: string[],
  --   intent: 'informational' | 'transactional' | 'navigational' | 'local',
  --   search_volume: number,
  --   serp_competition: 'low' | 'medium' | 'high',
  --   canonical: string,
  --   meta_description: string,
  --   freshness_score: number (0-100),
  --   requires_update_after: string (e.g., '90d')
  -- }
  seo_profile JSONB DEFAULT '{}'::jsonb,

  -- Internal Links (JSONB)
  -- {
  --   outgoing: [{to: string, anchor: string, location: string, confidence: number}],
  --   incoming: [{from: string, anchor: string}]
  -- }
  internal_links JSONB DEFAULT '{"outgoing": [], "incoming": []}'::jsonb,

  -- Agent Collaboration (JSONB)
  -- {content: agent_id, seo: agent_id, media: agent_id, social: agent_id}
  owners JSONB DEFAULT '{}'::jsonb,

  -- Tasks (JSONB array)
  -- [{type: string, assigned_to: string, status: string, created_at: string, due_at: string}]
  tasks JSONB DEFAULT '[]'::jsonb,

  -- AI Suggestions (JSONB array)
  -- [{suggestion_type: string, reason: string, estimated_value: string, proposed_slug: string, keywords: string[]}]
  suggestions JSONB DEFAULT '[]'::jsonb,

  -- Competitor Intelligence (JSONB array)
  -- [{domain: string, url: string, notes: string}]
  competitors JSONB DEFAULT '[]'::jsonb,

  -- Analytics (JSONB)
  -- {monthly_pageviews: number, bounce_rate: number, avg_read_time: number, last_traffic_update: string}
  analytics JSONB DEFAULT '{}'::jsonb,

  -- Alerts (JSONB array)
  -- [{type: string, value: number, reason: string}]
  alerts JSONB DEFAULT '[]'::jsonb,

  -- Multi-Language (JSONB)
  -- {en: '/path/', it: '/path-it/', de: '/path-de/'}
  translations JSONB DEFAULT '{}'::jsonb,

  -- Multi-Tenant (JSONB)
  -- {siteA: {overrides: {...}, disabled_components: [...]}, siteB: {...}}
  tenants JSONB DEFAULT '{}'::jsonb,

  -- Component Overrides (JSONB)
  -- {Hero: {props: {...}, variant: 'wide'}, Gallery: {max_items: 12}}
  component_overrides JSONB DEFAULT '{}'::jsonb,

  -- History (JSONB array)
  -- [{date: string, change: string, agent: string, details: string}]
  history JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(website_id, slug)
);

-- Indexes for pages
CREATE INDEX idx_pages_website ON pages(website_id);
CREATE INDEX idx_pages_parent ON pages(parent_id);
CREATE INDEX idx_pages_status ON pages(status);
CREATE INDEX idx_pages_priority ON pages(priority);
CREATE INDEX idx_pages_page_type ON pages(page_type);
CREATE INDEX idx_pages_blueprint ON pages(blueprint_id);
CREATE INDEX idx_pages_content_model ON pages(content_model_id);
CREATE INDEX idx_pages_slug ON pages(slug);

-- GIN indexes for JSONB fields
CREATE INDEX idx_pages_seo_profile ON pages USING GIN (seo_profile);
CREATE INDEX idx_pages_topics ON pages USING GIN (topics);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pages_updated_at
  BEFORE UPDATE ON pages
  FOR EACH ROW
  EXECUTE FUNCTION update_pages_updated_at();


-- ============================================
-- BLUEPRINTS TABLE
-- ============================================
-- Page templates defining component structure

CREATE TABLE IF NOT EXISTS blueprints (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT DEFAULT '1.0',

  -- Layout
  layout TEXT,

  -- Components (JSONB array)
  -- [{
  --   type: string,
  --   variant: string,
  --   props: object,
  --   data_source: string,
  --   required_fields: string[],
  --   optional_fields: string[],
  --   show_if: object,
  --   linking_rules: object,
  --   ai_hints: object,
  --   tenant_overrides: object
  -- }]
  components JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Global Linking Rules (JSONB)
  -- {min_total_links: number, max_total_links: number, must_link_to_topical_cluster: boolean}
  global_linking_rules JSONB DEFAULT '{}'::jsonb,

  -- Multi-Tenant Overrides (JSONB)
  -- {siteA: {layout: string, components: [], css_overrides: {}}}
  tenants JSONB DEFAULT '{}'::jsonb,

  -- Validation (JSONB)
  -- {schema_version: string, strict: boolean, allow_fallbacks: boolean}
  validation JSONB DEFAULT '{}'::jsonb,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for blueprints
CREATE INDEX idx_blueprints_page_type ON blueprints(page_type);

-- Trigger to update updated_at
CREATE TRIGGER blueprints_updated_at
  BEFORE UPDATE ON blueprints
  FOR EACH ROW
  EXECUTE FUNCTION update_pages_updated_at();


-- ============================================
-- CONTENT MODELS TABLE
-- ============================================
-- Atomic design system definitions

CREATE TABLE IF NOT EXISTS content_models (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('atom', 'molecule', 'organism', 'template')),
  description TEXT,
  version TEXT DEFAULT '1.0',

  -- Fields (JSONB array)
  -- [{
  --   id: string,
  --   label: string,
  --   type: string,
  --   description: string,
  --   required: boolean,
  --   localized: boolean,
  --   unique: boolean,
  --   default: any,
  --   validations: object,
  --   reference: object,
  --   items: object,
  --   ai_hints: object,
  --   ui: object
  -- }]
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Relations (JSONB array)
  -- [{name: string, target_model: string, type: string, via_field: string}]
  relations JSONB DEFAULT '[]'::jsonb,

  -- Computed Fields (JSONB array)
  -- [{id: string, label: string, source: string, type: string, cached: boolean}]
  computed_fields JSONB DEFAULT '[]'::jsonb,

  -- Data Sources (JSONB array)
  -- [{id: string, type: string, description: string, config: object}]
  data_sources JSONB DEFAULT '[]'::jsonb,

  -- AI Guidance (JSONB)
  -- {persona: string, tone: string, style: string, content_strategy: string, crosslink_strategy: string}
  ai_guidance JSONB DEFAULT '{}'::jsonb,

  -- Multi-Tenant Overrides (JSONB)
  -- {siteA: {fields: [], ui: {}}}
  tenants JSONB DEFAULT '{}'::jsonb,

  -- Validation (JSONB)
  -- {strict: boolean, allow_unknown_fields: boolean, schema_version: string}
  validation JSONB DEFAULT '{}'::jsonb,

  -- Lifecycle (JSONB)
  -- {review_after_days: number, expire_after_days: number, archivable: boolean}
  lifecycle JSONB DEFAULT '{}'::jsonb,

  -- History (JSONB array)
  -- [{version: string, date: string, change: string, agent: string, details: string}]
  history JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for content_models
CREATE INDEX idx_content_models_model_id ON content_models(model_id);
CREATE INDEX idx_content_models_kind ON content_models(kind);

-- Trigger to update updated_at
CREATE TRIGGER content_models_updated_at
  BEFORE UPDATE ON content_models
  FOR EACH ROW
  EXECUTE FUNCTION update_pages_updated_at();


-- ============================================
-- GRAPH POSITIONS TABLE
-- ============================================
-- React Flow node positions for visual graph

CREATE TABLE IF NOT EXISTS graph_positions (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  node_id UUID NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'page',

  -- React Flow position
  position_x FLOAT NOT NULL DEFAULT 0,
  position_y FLOAT NOT NULL DEFAULT 0,

  -- Visual state
  collapsed BOOLEAN DEFAULT false,
  hidden BOOLEAN DEFAULT false,

  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(website_id, node_id, node_type)
);

-- Indexes for graph_positions
CREATE INDEX idx_graph_positions_website ON graph_positions(website_id);
CREATE INDEX idx_graph_positions_node ON graph_positions(node_id);
CREATE INDEX idx_graph_positions_type ON graph_positions(node_type);

-- Trigger to update updated_at
CREATE TRIGGER graph_positions_updated_at
  BEFORE UPDATE ON graph_positions
  FOR EACH ROW
  EXECUTE FUNCTION update_pages_updated_at();


-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE pages IS 'Sitemap pages with SEO, linking intelligence, and agent collaboration features';
COMMENT ON TABLE blueprints IS 'Page templates defining component structure and layout';
COMMENT ON TABLE content_models IS 'Atomic design system content model definitions';
COMMENT ON TABLE graph_positions IS 'React Flow graph node positions for visual sitemap editor';

COMMENT ON COLUMN pages.seo_profile IS 'SEO metadata including keywords, intent, freshness score';
COMMENT ON COLUMN pages.internal_links IS 'Outgoing and incoming internal link structure';
COMMENT ON COLUMN pages.owners IS 'Agent ownership assignments (content, seo, media, social)';
COMMENT ON COLUMN pages.tasks IS 'Pending tasks assigned to agents for this page';
COMMENT ON COLUMN pages.suggestions IS 'AI-generated suggestions for improvements';
COMMENT ON COLUMN pages.analytics IS 'Traffic and engagement metrics';
COMMENT ON COLUMN pages.alerts IS 'Automated anomaly detections (traffic spikes/drops)';

COMMENT ON COLUMN blueprints.components IS 'Ordered list of components used in this page template';
COMMENT ON COLUMN blueprints.global_linking_rules IS 'Internal linking constraints for the entire page';

COMMENT ON COLUMN content_models.fields IS 'Field definitions with validation and AI hints';
COMMENT ON COLUMN content_models.relations IS 'Relationships to other content models';
COMMENT ON COLUMN content_models.ai_guidance IS 'Model-level AI content generation guidance';
