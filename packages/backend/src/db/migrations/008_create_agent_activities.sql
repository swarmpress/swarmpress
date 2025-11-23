-- Migration: Create agent_activities table
-- Description: Real-time tracking of agent activities on the sitemap

CREATE TABLE IF NOT EXISTS agent_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL CHECK (activity_type IN ('viewing', 'editing', 'suggesting', 'reviewing', 'analyzing')),

  page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

-- Indexes for efficient queries
CREATE INDEX idx_agent_activities_agent_id ON agent_activities(agent_id);
CREATE INDEX idx_agent_activities_page_id ON agent_activities(page_id);
CREATE INDEX idx_agent_activities_expires_at ON agent_activities(expires_at);
CREATE INDEX idx_agent_activities_created_at ON agent_activities(created_at DESC);

-- Composite index for finding active activities
CREATE INDEX idx_agent_activities_active ON agent_activities(expires_at, page_id) WHERE expires_at > NOW();

-- Comments
COMMENT ON TABLE agent_activities IS 'Real-time tracking of agent activities on the sitemap';
COMMENT ON COLUMN agent_activities.activity_type IS 'Type of activity: viewing, editing, suggesting, reviewing, analyzing';
COMMENT ON COLUMN agent_activities.page_id IS 'Page being worked on (null for website-level activities)';
COMMENT ON COLUMN agent_activities.description IS 'Human-readable description of the activity';
COMMENT ON COLUMN agent_activities.metadata IS 'Additional activity metadata (flexible JSONB)';
COMMENT ON COLUMN agent_activities.expires_at IS 'When this activity record should be considered stale';

-- Auto-cleanup function (can be called periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_agent_activities()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM agent_activities WHERE expires_at <= NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_agent_activities IS 'Deletes expired activity records and returns count deleted';
