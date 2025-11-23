-- Migration 011: Task Phases Table
-- Tracks detailed phase progression for editorial tasks
-- Each task flows through: research → outline → draft → edit → review → publish

CREATE TABLE IF NOT EXISTS task_phases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  task_id TEXT NOT NULL REFERENCES editorial_tasks(id) ON DELETE CASCADE,

  -- Phase Definition
  phase_name TEXT NOT NULL CHECK (phase_name IN ('research', 'outline', 'draft', 'edit', 'review', 'publish', 'optimize')),
  phase_order INTEGER NOT NULL, -- 1, 2, 3, etc.

  -- Status
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped', 'blocked')),

  -- Timeline
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  estimated_duration_hours NUMERIC(5,2),
  actual_duration_hours NUMERIC(5,2),

  -- Assignment (can differ from task assignment)
  assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  assigned_human TEXT,

  -- Progress Tracking
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
  checklist_items JSONB, -- Array of {text, completed, completed_at}
  deliverables JSONB, -- Array of expected outputs

  -- Quality Metrics
  quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 5),
  review_notes TEXT,
  blockers TEXT[], -- Array of blocking issues

  -- Agent Activity
  agent_iterations INTEGER DEFAULT 0, -- Number of times agent has worked on this phase
  human_interventions INTEGER DEFAULT 0, -- Number of times human stepped in

  -- Metadata
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint: one record per task/phase combination
  UNIQUE(task_id, phase_name)
)

-- Indexes
CREATE INDEX idx_task_phases_task ON task_phases(task_id)
CREATE INDEX idx_task_phases_status ON task_phases(status)
CREATE INDEX idx_task_phases_agent ON task_phases(assigned_agent_id)
CREATE INDEX idx_task_phases_order ON task_phases(task_id, phase_order)

-- Partial index for active phases
CREATE INDEX idx_task_phases_active ON task_phases(task_id, phase_name)
  WHERE status IN ('in_progress', 'blocked')

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_task_phases_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW()
  RETURN NEW
END
$$ LANGUAGE plpgsql

CREATE TRIGGER task_phases_update_timestamp
  BEFORE UPDATE ON task_phases
  FOR EACH ROW
  EXECUTE FUNCTION update_task_phases_timestamp()

-- Phase transition trigger
CREATE OR REPLACE FUNCTION handle_phase_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-set started_at when moving to in_progress
  IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at = NOW()
  END IF

  -- Auto-set completed_at when moving to completed
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = NOW()
    NEW.progress_percentage = 100

    -- Calculate actual duration
    IF NEW.started_at IS NOT NULL THEN
      NEW.actual_duration_hours = EXTRACT(EPOCH FROM (NOW() - NEW.started_at)) / 3600.0
    END IF

    -- Update parent task's current_phase to next phase
    UPDATE editorial_tasks
    SET
      current_phase = (
        SELECT phase_name
        FROM task_phases
        WHERE task_id = NEW.task_id
          AND phase_order > NEW.phase_order
          AND status = 'not_started'
        ORDER BY phase_order ASC
        LIMIT 1
      ),
      phases_completed = array_append(
        COALESCE(phases_completed, ARRAY[]::TEXT[]),
        NEW.phase_name
      )
    WHERE id = NEW.task_id
  END IF

  RETURN NEW
END
$$ LANGUAGE plpgsql

CREATE TRIGGER phase_transition_handler
  BEFORE UPDATE ON task_phases
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION handle_phase_transition()

-- View for phase summary per task
CREATE OR REPLACE VIEW task_phase_summary AS
SELECT
  tp.task_id,
  et.title AS task_title,
  et.status AS task_status,
  COUNT(*) AS total_phases,
  COUNT(*) FILTER (WHERE tp.status = 'completed') AS completed_phases,
  COUNT(*) FILTER (WHERE tp.status = 'in_progress') AS in_progress_phases,
  COUNT(*) FILTER (WHERE tp.status = 'blocked') AS blocked_phases,
  ROUND(AVG(tp.progress_percentage), 2) AS avg_progress,
  SUM(tp.estimated_duration_hours) AS total_estimated_hours,
  SUM(tp.actual_duration_hours) AS total_actual_hours,
  ARRAY_AGG(
    jsonb_build_object(
      'phase', tp.phase_name,
      'order', tp.phase_order,
      'status', tp.status,
      'progress', tp.progress_percentage
    ) ORDER BY tp.phase_order
  ) AS phases
FROM task_phases tp
JOIN editorial_tasks et ON et.id = tp.task_id
GROUP BY tp.task_id, et.title, et.status

-- Function to initialize standard phases for a task
CREATE OR REPLACE FUNCTION initialize_task_phases(
  p_task_id TEXT,
  p_task_type TEXT
)
RETURNS void AS $$
DECLARE
  standard_phases TEXT[]
  phase_name TEXT
  phase_idx INTEGER
BEGIN
  -- Define standard phase sequences based on task type
  IF p_task_type = 'article' THEN
    standard_phases := ARRAY['research', 'outline', 'draft', 'edit', 'review', 'publish']
  ELSIF p_task_type = 'page' THEN
    standard_phases := ARRAY['research', 'draft', 'edit', 'review', 'publish']
  ELSIF p_task_type = 'update' THEN
    standard_phases := ARRAY['research', 'edit', 'review', 'publish']
  ELSIF p_task_type = 'fix' THEN
    standard_phases := ARRAY['research', 'edit', 'publish']
  ELSIF p_task_type = 'optimize' THEN
    standard_phases := ARRAY['research', 'optimize', 'review', 'publish']
  ELSE
    standard_phases := ARRAY['draft', 'review', 'publish'] -- Default
  END IF

  -- Insert phase records
  FOREACH phase_name IN ARRAY standard_phases
  LOOP
    phase_idx := array_position(standard_phases, phase_name)

    INSERT INTO task_phases (
      task_id,
      phase_name,
      phase_order,
      status
    ) VALUES (
      p_task_id,
      phase_name,
      phase_idx,
      CASE WHEN phase_idx = 1 THEN 'not_started' ELSE 'not_started' END
    )
    ON CONFLICT (task_id, phase_name) DO NOTHING
  END LOOP
END
$$ LANGUAGE plpgsql

-- Comments
COMMENT ON TABLE task_phases IS 'Detailed phase tracking for editorial tasks'
COMMENT ON COLUMN task_phases.phase_order IS 'Sequential order of phases (1-based)'
COMMENT ON COLUMN task_phases.checklist_items IS 'JSON array of checklist items for this phase'
COMMENT ON COLUMN task_phases.deliverables IS 'Expected outputs from this phase'
COMMENT ON FUNCTION initialize_task_phases IS 'Creates standard phase records for a task based on type'
