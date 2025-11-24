-- Add Prompt Management Tables
-- Adds the three-level prompt hierarchy: Company → Website → Agent

-- ============================================================================
-- Level 1: Company Prompt Templates (Baseline prompts for all websites)
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_prompt_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,
  capability TEXT NOT NULL,
  version TEXT NOT NULL,

  -- Prompt content
  template TEXT NOT NULL,
  examples JSONB DEFAULT '[]'::jsonb,
  default_variables JSONB DEFAULT '{}'::jsonb,

  -- Metadata
  description TEXT,
  changelog TEXT,
  created_by_user_id UUID,
  approved_by_user_id UUID,
  approved_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT FALSE,
  is_deprecated BOOLEAN DEFAULT FALSE,
  deprecation_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(company_id, role_name, capability, version)
);

CREATE INDEX IF NOT EXISTS idx_company_prompts_company ON company_prompt_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_company_prompts_role_capability ON company_prompt_templates(role_name, capability);
CREATE INDEX IF NOT EXISTS idx_company_prompts_active ON company_prompt_templates(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- Level 2: Website Prompt Templates (Brand-specific overrides)
-- ============================================================================

CREATE TABLE IF NOT EXISTS website_prompt_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  company_prompt_template_id UUID NOT NULL REFERENCES company_prompt_templates(id) ON DELETE RESTRICT,
  version TEXT NOT NULL,

  -- Override options
  template_override TEXT,
  template_additions TEXT,
  examples_override JSONB DEFAULT '[]'::jsonb,
  variables_override JSONB DEFAULT '{}'::jsonb,

  -- Metadata
  description TEXT,
  changelog TEXT,
  created_by_user_id UUID,
  approved_by_user_id UUID,
  approved_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT FALSE,
  is_deprecated BOOLEAN DEFAULT FALSE,
  deprecation_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(website_id, company_prompt_template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_website_prompts_website ON website_prompt_templates(website_id);
CREATE INDEX IF NOT EXISTS idx_website_prompts_company_template ON website_prompt_templates(company_prompt_template_id);
CREATE INDEX IF NOT EXISTS idx_website_prompts_active ON website_prompt_templates(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- Level 3: Agent Prompt Bindings (Individual agent assignments)
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_prompt_bindings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,

  -- Bind to either company or website prompt (exactly one)
  company_prompt_template_id UUID REFERENCES company_prompt_templates(id) ON DELETE RESTRICT,
  website_prompt_template_id UUID REFERENCES website_prompt_templates(id) ON DELETE RESTRICT,

  -- Agent customizations
  custom_variables JSONB DEFAULT '{}'::jsonb,

  -- A/B testing
  ab_test_group TEXT,
  ab_test_weight DECIMAL(3,2) DEFAULT 1.0,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(agent_id, capability),
  CONSTRAINT binding_source_check CHECK (
    (company_prompt_template_id IS NOT NULL AND website_prompt_template_id IS NULL) OR
    (company_prompt_template_id IS NULL AND website_prompt_template_id IS NOT NULL)
  ),
  CONSTRAINT ab_test_weight_check CHECK (ab_test_weight >= 0.0 AND ab_test_weight <= 1.0)
);

CREATE INDEX IF NOT EXISTS idx_agent_bindings_agent ON agent_prompt_bindings(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_bindings_capability ON agent_prompt_bindings(capability);
CREATE INDEX IF NOT EXISTS idx_agent_bindings_company_template ON agent_prompt_bindings(company_prompt_template_id);
CREATE INDEX IF NOT EXISTS idx_agent_bindings_website_template ON agent_prompt_bindings(website_prompt_template_id);

-- ============================================================================
-- Prompt Execution Logging (Performance tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS prompt_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Context
  agent_id UUID NOT NULL REFERENCES agents(id),
  capability TEXT NOT NULL,
  company_prompt_template_id UUID REFERENCES company_prompt_templates(id),
  website_prompt_template_id UUID REFERENCES website_prompt_templates(id),

  -- Input/Output
  input_variables JSONB NOT NULL,
  final_prompt_hash TEXT,
  output TEXT,

  -- Performance metrics
  tokens_used INTEGER,
  latency_ms INTEGER,
  claude_model TEXT,

  -- Quality metrics
  quality_score DECIMAL(3,2),
  quality_rated_by TEXT,
  quality_rated_at TIMESTAMPTZ,
  quality_feedback TEXT,

  -- Content outcomes
  content_id UUID REFERENCES content_items(id),
  content_status TEXT,
  revision_count INTEGER DEFAULT 0,

  -- Error tracking
  error_occurred BOOLEAN DEFAULT FALSE,
  error_message TEXT,

  -- A/B testing
  ab_test_group TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT quality_score_range CHECK (quality_score >= 0.0 AND quality_score <= 5.0)
);

CREATE INDEX IF NOT EXISTS idx_prompt_executions_agent ON prompt_executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_prompt_executions_capability ON prompt_executions(capability);
CREATE INDEX IF NOT EXISTS idx_prompt_executions_company_template ON prompt_executions(company_prompt_template_id);
CREATE INDEX IF NOT EXISTS idx_prompt_executions_website_template ON prompt_executions(website_prompt_template_id);
CREATE INDEX IF NOT EXISTS idx_prompt_executions_created_at ON prompt_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_executions_quality ON prompt_executions(quality_score) WHERE quality_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prompt_executions_errors ON prompt_executions(error_occurred) WHERE error_occurred = TRUE;
