-- Migration 012: Editorial Events Table
-- Event log for editorial system activity (complements CloudEvents on NATS)
-- Provides queryable history and audit trail

CREATE TABLE IF NOT EXISTS editorial_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,

  -- CloudEvents Standard Fields
  event_type TEXT NOT NULL, -- e.g., task.created, task.completed, phase.started
  event_source TEXT NOT NULL, -- Agent ID, human user, or system component
  event_subject TEXT, -- Resource affected (task ID, phase ID, etc.)
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Editorial-Specific Context
  task_id TEXT REFERENCES editorial_tasks(id) ON DELETE SET NULL,
  phase_id TEXT REFERENCES task_phases(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  human_user TEXT, -- Username/email if triggered by human

  -- Event Payload
  event_data JSONB NOT NULL, -- Full event payload
  previous_state JSONB, -- State before event (for audit)
  new_state JSONB, -- State after event

  -- Integration
  sitemap_page_ids TEXT[], -- Related sitemap pages
  github_ref TEXT, -- Branch, PR, or commit SHA
  nats_subject TEXT, -- NATS subject where event was published
  nats_message_id TEXT, -- NATS message ID for correlation

  -- Categorization
  category TEXT CHECK (category IN ('task', 'phase', 'assignment', 'dependency', 'review', 'publish', 'sync', 'system')),
  severity TEXT DEFAULT 'info' CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
  tags TEXT[],

  -- Metadata
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

-- Indexes for common queries
CREATE INDEX idx_editorial_events_website ON editorial_events(website_id)
CREATE INDEX idx_editorial_events_task ON editorial_events(task_id) WHERE task_id IS NOT NULL
CREATE INDEX idx_editorial_events_phase ON editorial_events(phase_id) WHERE phase_id IS NOT NULL
CREATE INDEX idx_editorial_events_agent ON editorial_events(agent_id) WHERE agent_id IS NOT NULL
CREATE INDEX idx_editorial_events_type ON editorial_events(event_type)
CREATE INDEX idx_editorial_events_time ON editorial_events(event_time DESC)
CREATE INDEX idx_editorial_events_category ON editorial_events(category)
CREATE INDEX idx_editorial_events_severity ON editorial_events(severity)
CREATE INDEX idx_editorial_events_tags ON editorial_events USING GIN(tags)

-- Composite index for common filtered queries
CREATE INDEX idx_editorial_events_website_time ON editorial_events(website_id, event_time DESC)
CREATE INDEX idx_editorial_events_task_time ON editorial_events(task_id, event_time DESC)
  WHERE task_id IS NOT NULL

-- Partial indexes for high-priority events
CREATE INDEX idx_editorial_events_errors ON editorial_events(event_time DESC)
  WHERE severity IN ('error', 'critical')

-- JSONB indexes for querying event data
CREATE INDEX idx_editorial_events_data ON editorial_events USING GIN(event_data)

-- View for recent events per task
CREATE OR REPLACE VIEW task_recent_events AS
SELECT
  ee.task_id,
  et.title AS task_title,
  ee.event_type,
  ee.event_time,
  ee.event_source,
  ee.category,
  ee.severity,
  ee.event_data,
  a.name AS agent_name
FROM editorial_events ee
JOIN editorial_tasks et ON et.id = ee.task_id
LEFT JOIN agents a ON a.id = ee.agent_id
WHERE ee.task_id IS NOT NULL
ORDER BY ee.event_time DESC

-- View for event timeline
CREATE OR REPLACE VIEW editorial_event_timeline AS
SELECT
  DATE_TRUNC('hour', event_time) AS time_bucket,
  website_id,
  category,
  event_type,
  COUNT(*) AS event_count,
  COUNT(*) FILTER (WHERE severity IN ('error', 'critical')) AS error_count,
  ARRAY_AGG(DISTINCT agent_id) FILTER (WHERE agent_id IS NOT NULL) AS active_agents
FROM editorial_events
GROUP BY time_bucket, website_id, category, event_type
ORDER BY time_bucket DESC

-- Function to log editorial events
CREATE OR REPLACE FUNCTION log_editorial_event(
  p_website_id TEXT,
  p_event_type TEXT,
  p_event_source TEXT,
  p_event_data JSONB,
  p_task_id TEXT DEFAULT NULL,
  p_phase_id TEXT DEFAULT NULL,
  p_agent_id TEXT DEFAULT NULL,
  p_category TEXT DEFAULT 'system',
  p_severity TEXT DEFAULT 'info',
  p_tags TEXT[] DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
  event_id TEXT
BEGIN
  INSERT INTO editorial_events (
    website_id,
    event_type,
    event_source,
    event_data,
    task_id,
    phase_id,
    agent_id,
    category,
    severity,
    tags
  ) VALUES (
    p_website_id,
    p_event_type,
    p_event_source,
    p_event_data,
    p_task_id,
    p_phase_id,
    p_agent_id,
    p_category,
    p_severity,
    p_tags
  )
  RETURNING id INTO event_id

  RETURN event_id
END
$$ LANGUAGE plpgsql

-- Trigger to auto-log task status changes
CREATE OR REPLACE FUNCTION auto_log_task_change()
RETURNS TRIGGER AS $$
DECLARE
  event_type TEXT
  event_category TEXT
BEGIN
  -- Determine event type based on what changed
  IF TG_OP = 'INSERT' THEN
    event_type := 'task.created'
    event_category := 'task'
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    event_type := 'task.status_changed'
    event_category := 'task'
  ELSIF OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id THEN
    event_type := 'task.reassigned'
    event_category := 'assignment'
  ELSIF OLD.current_phase IS DISTINCT FROM NEW.current_phase THEN
    event_type := 'task.phase_changed'
    event_category := 'phase'
  ELSE
    event_type := 'task.updated'
    event_category := 'task'
  END IF

  -- Log the event
  PERFORM log_editorial_event(
    p_website_id := NEW.website_id,
    p_event_type := event_type,
    p_event_source := COALESCE(NEW.assigned_agent_id, 'system'),
    p_event_data := jsonb_build_object(
      'task_id', NEW.id,
      'title', NEW.title,
      'status', NEW.status,
      'phase', NEW.current_phase
    ),
    p_task_id := NEW.id,
    p_agent_id := NEW.assigned_agent_id,
    p_category := event_category,
    p_severity := 'info'
  )

  RETURN NEW
END
$$ LANGUAGE plpgsql

CREATE TRIGGER log_task_changes
  AFTER INSERT OR UPDATE ON editorial_tasks
  FOR EACH ROW
  EXECUTE FUNCTION auto_log_task_change()

-- Trigger to auto-log phase transitions
CREATE OR REPLACE FUNCTION auto_log_phase_change()
RETURNS TRIGGER AS $$
DECLARE
  task_website_id TEXT
BEGIN
  -- Get website_id from parent task
  SELECT website_id INTO task_website_id
  FROM editorial_tasks
  WHERE id = NEW.task_id

  -- Log the event
  PERFORM log_editorial_event(
    p_website_id := task_website_id,
    p_event_type := CASE
      WHEN TG_OP = 'INSERT' THEN 'phase.created'
      WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'phase.status_changed'
      ELSE 'phase.updated'
    END,
    p_event_source := COALESCE(NEW.assigned_agent_id, 'system'),
    p_event_data := jsonb_build_object(
      'phase_id', NEW.id,
      'phase_name', NEW.phase_name,
      'status', NEW.status,
      'progress', NEW.progress_percentage
    ),
    p_task_id := NEW.task_id,
    p_phase_id := NEW.id,
    p_agent_id := NEW.assigned_agent_id,
    p_category := 'phase',
    p_severity := 'info'
  )

  RETURN NEW
END
$$ LANGUAGE plpgsql

CREATE TRIGGER log_phase_changes
  AFTER INSERT OR UPDATE ON task_phases
  FOR EACH ROW
  EXECUTE FUNCTION auto_log_phase_change()

-- Function to clean up old events (data retention)
CREATE OR REPLACE FUNCTION cleanup_old_editorial_events(
  retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER
BEGIN
  DELETE FROM editorial_events
  WHERE event_time < NOW() - MAKE_INTERVAL(days := retention_days)
    AND severity NOT IN ('error', 'critical') -- Keep errors longer

  GET DIAGNOSTICS deleted_count = ROW_COUNT
  RETURN deleted_count
END
$$ LANGUAGE plpgsql

-- Comments
COMMENT ON TABLE editorial_events IS 'Event log for editorial system activity and audit trail'
COMMENT ON COLUMN editorial_events.event_type IS 'CloudEvents-compatible event type (e.g., task.created)'
COMMENT ON COLUMN editorial_events.nats_message_id IS 'Correlation ID for NATS CloudEvent message'
COMMENT ON COLUMN editorial_events.previous_state IS 'Snapshot of state before event for audit'
COMMENT ON FUNCTION log_editorial_event IS 'Helper function to insert editorial events with standard fields'
COMMENT ON FUNCTION cleanup_old_editorial_events IS 'Remove events older than retention period (default 90 days)'
