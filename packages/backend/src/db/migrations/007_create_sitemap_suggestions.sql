-- Migration: Create sitemap_suggestions table
-- Description: AI agent suggestions for sitemap improvements

CREATE TABLE IF NOT EXISTS sitemap_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  suggestion_type VARCHAR(50) NOT NULL CHECK (suggestion_type IN ('new_page', 'improve_content', 'add_links', 'update_blueprint')),
  reason TEXT NOT NULL,
  estimated_value VARCHAR(20) NOT NULL CHECK (estimated_value IN ('low', 'medium', 'high')),

  proposed_slug VARCHAR(255),
  keywords TEXT, -- JSON array
  metadata JSONB DEFAULT '{}'::jsonb,

  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'implemented')),
  notes TEXT,

  implemented_at TIMESTAMP,
  implemented_by UUID REFERENCES agents(id) ON DELETE SET NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_sitemap_suggestions_page_id ON sitemap_suggestions(page_id);
CREATE INDEX idx_sitemap_suggestions_agent_id ON sitemap_suggestions(agent_id);
CREATE INDEX idx_sitemap_suggestions_status ON sitemap_suggestions(status);
CREATE INDEX idx_sitemap_suggestions_created_at ON sitemap_suggestions(created_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sitemap_suggestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_sitemap_suggestions_updated_at
  BEFORE UPDATE ON sitemap_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_sitemap_suggestions_updated_at();

-- Comments
COMMENT ON TABLE sitemap_suggestions IS 'AI agent suggestions for sitemap improvements';
COMMENT ON COLUMN sitemap_suggestions.suggestion_type IS 'Type of suggestion: new_page, improve_content, add_links, update_blueprint';
COMMENT ON COLUMN sitemap_suggestions.estimated_value IS 'Estimated value of implementing this suggestion';
COMMENT ON COLUMN sitemap_suggestions.proposed_slug IS 'Suggested slug for new pages';
COMMENT ON COLUMN sitemap_suggestions.keywords IS 'JSON array of suggested keywords';
COMMENT ON COLUMN sitemap_suggestions.metadata IS 'Additional suggestion metadata (flexible JSONB)';
COMMENT ON COLUMN sitemap_suggestions.status IS 'Current status: pending, accepted, rejected, implemented';
