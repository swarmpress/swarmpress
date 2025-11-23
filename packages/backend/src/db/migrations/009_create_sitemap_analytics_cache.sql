-- Migration: Create sitemap_analytics_cache table
-- Description: Caches computed analytics to avoid expensive recalculation

CREATE TABLE IF NOT EXISTS sitemap_analytics_cache (
  website_id UUID PRIMARY KEY REFERENCES websites(id) ON DELETE CASCADE,
  analytics JSONB NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX idx_sitemap_analytics_cache_computed_at ON sitemap_analytics_cache(computed_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sitemap_analytics_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_sitemap_analytics_cache_updated_at
  BEFORE UPDATE ON sitemap_analytics_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_sitemap_analytics_cache_updated_at();

-- Comments
COMMENT ON TABLE sitemap_analytics_cache IS 'Caches computed sitemap analytics to improve performance';
COMMENT ON COLUMN sitemap_analytics_cache.analytics IS 'Full analytics JSON object with all metrics';
COMMENT ON COLUMN sitemap_analytics_cache.computed_at IS 'When the analytics were last computed';
