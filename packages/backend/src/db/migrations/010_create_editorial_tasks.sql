-- Migration 010: Editorial Tasks Table
-- Stores content planning tasks from editorial.yaml
-- Hybrid model: YAML is source of truth, PostgreSQL for runtime queries

CREATE TABLE IF NOT EXISTS editorial_tasks (
  id TEXT PRIMARY KEY, -- Matches YAML task ID
  website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,

  -- Basic Info
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('article', 'page', 'update', 'fix', 'optimize', 'research')),

  -- Status & Priority
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'ready', 'in_progress', 'in_review', 'blocked', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

  -- Assignment
  assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  assigned_human TEXT, -- Human editor name if assigned

  -- Timeline
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  due_date DATE,
  estimated_hours NUMERIC(5,2),
  actual_hours NUMERIC(5,2),

  -- Dependencies
  depends_on TEXT[], -- Array of task IDs this task depends on
  blocks TEXT[], -- Array of task IDs this task blocks

  -- Sitemap Integration
  sitemap_targets TEXT[], -- Array of page IDs this task relates to

  -- SEO Metadata
  seo_primary_keyword TEXT,
  seo_secondary_keywords TEXT[],
  seo_target_volume INTEGER,
  seo_estimated_difficulty TEXT CHECK (seo_estimated_difficulty IN ('easy', 'medium', 'hard', 'very_hard')),

  -- Internal Linking
  internal_links_required_inbound TEXT[], -- Page slugs that should link TO this content
  internal_links_required_outbound TEXT[], -- Page slugs this content should link TO
  internal_links_min_count INTEGER DEFAULT 0,
  internal_links_max_count INTEGER,

  -- Content Requirements
  word_count_target INTEGER,
  word_count_actual INTEGER,
  content_type TEXT, -- article, landing_page, pillar_content, etc.
  template_blueprint_id TEXT, -- Reference to blueprint if applicable

  -- Collaboration
  tags TEXT[],
  labels TEXT[],
  notes TEXT,
  review_comments JSONB, -- Array of {author, comment, timestamp}

  -- GitHub Integration
  github_branch TEXT,
  github_pr_url TEXT,
  github_issue_url TEXT,

  -- Phases (denormalized for quick queries)
  current_phase TEXT, -- research, outline, draft, edit, review, publish
  phases_completed TEXT[],

  -- Metadata
  metadata JSONB, -- Flexible storage for task-specific data

  -- Sync tracking
  yaml_file_path TEXT, -- Path in GitHub repo
  yaml_last_synced_at TIMESTAMPTZ,
  yaml_hash TEXT -- SHA of YAML content for change detection
)

-- Indexes for common queries
CREATE INDEX idx_editorial_tasks_website ON editorial_tasks(website_id)
CREATE INDEX idx_editorial_tasks_status ON editorial_tasks(status)
CREATE INDEX idx_editorial_tasks_priority ON editorial_tasks(priority)
CREATE INDEX idx_editorial_tasks_assigned ON editorial_tasks(assigned_agent_id)
CREATE INDEX idx_editorial_tasks_due_date ON editorial_tasks(due_date) WHERE due_date IS NOT NULL
CREATE INDEX idx_editorial_tasks_current_phase ON editorial_tasks(current_phase)
CREATE INDEX idx_editorial_tasks_sitemap_targets ON editorial_tasks USING GIN(sitemap_targets)
CREATE INDEX idx_editorial_tasks_tags ON editorial_tasks USING GIN(tags)
CREATE INDEX idx_editorial_tasks_depends_on ON editorial_tasks USING GIN(depends_on)

-- Partial indexes for common filtered queries
CREATE INDEX idx_editorial_tasks_active ON editorial_tasks(website_id, status, priority)
  WHERE status IN ('backlog', 'ready', 'in_progress', 'in_review', 'blocked')

CREATE INDEX idx_editorial_tasks_overdue ON editorial_tasks(due_date, status)
  WHERE status NOT IN ('completed', 'cancelled') AND due_date < CURRENT_DATE

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_editorial_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW()
  RETURN NEW
END
$$ LANGUAGE plpgsql

CREATE TRIGGER editorial_tasks_update_timestamp
  BEFORE UPDATE ON editorial_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_editorial_tasks_timestamp()

-- Validation trigger for phase transitions
CREATE OR REPLACE FUNCTION validate_editorial_task_phase()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-set started_at when moving to in_progress
  IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at = NOW()
  END IF

  -- Auto-set completed_at when moving to completed
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at = NOW()
  END IF

  -- Validate dependencies (basic check - complex validation in application layer)
  IF NEW.status = 'in_progress' AND NEW.depends_on IS NOT NULL AND array_length(NEW.depends_on, 1) > 0 THEN
    -- Check if any dependencies are not completed (simplified check)
    DECLARE
      incomplete_deps INTEGER
    BEGIN
      SELECT COUNT(*) INTO incomplete_deps
      FROM editorial_tasks
      WHERE id = ANY(NEW.depends_on) AND status NOT IN ('completed', 'cancelled')

      IF incomplete_deps > 0 THEN
        RAISE WARNING 'Task % has incomplete dependencies', NEW.id
        -- Note: We only warn, not block, as dependencies might be managed differently
      END IF
    END
  END IF

  RETURN NEW
END
$$ LANGUAGE plpgsql

CREATE TRIGGER editorial_task_phase_validation
  BEFORE INSERT OR UPDATE ON editorial_tasks
  FOR EACH ROW
  EXECUTE FUNCTION validate_editorial_task_phase()

-- Comments for documentation
COMMENT ON TABLE editorial_tasks IS 'Content planning tasks synced from editorial.yaml in GitHub'
COMMENT ON COLUMN editorial_tasks.id IS 'Matches task ID in YAML file'
COMMENT ON COLUMN editorial_tasks.sitemap_targets IS 'Array of page IDs from sitemap this task affects'
COMMENT ON COLUMN editorial_tasks.yaml_hash IS 'SHA-256 hash of YAML content for change detection'
COMMENT ON COLUMN editorial_tasks.metadata IS 'Flexible JSON storage for task-specific extensions'
