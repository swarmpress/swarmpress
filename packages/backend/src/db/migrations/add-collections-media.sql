-- =============================================================================
-- Collections & Media Management Migration
-- Adds support for structured content collections and binary asset management
-- Version: 1.0.0
-- Date: 2024-11-24
-- =============================================================================

BEGIN;

-- =============================================================================
-- COLLECTIONS SYSTEM
-- =============================================================================

-- ============================================================================
-- Collection Definitions (Website-Level)
-- ============================================================================

CREATE TABLE IF NOT EXISTS website_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  collection_type TEXT NOT NULL, -- 'events', 'pois', 'faqs', 'news', etc.

  -- Configuration
  enabled BOOLEAN DEFAULT TRUE,
  display_name TEXT, -- Override plural name
  icon TEXT,
  color TEXT,

  -- Custom fields added by this website
  custom_fields JSONB DEFAULT '[]'::jsonb,
  field_overrides JSONB DEFAULT '{}'::jsonb,

  -- Features
  enable_comments BOOLEAN DEFAULT FALSE,
  enable_ratings BOOLEAN DEFAULT FALSE,
  enable_bookmarks BOOLEAN DEFAULT FALSE,

  -- Sync settings
  github_path TEXT, -- Path in GitHub repo
  auto_sync BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(website_id, collection_type)
);

CREATE INDEX IF NOT EXISTS idx_website_collections_website ON website_collections(website_id);
CREATE INDEX IF NOT EXISTS idx_website_collections_type ON website_collections(collection_type);
CREATE INDEX IF NOT EXISTS idx_website_collections_enabled ON website_collections(enabled) WHERE enabled = TRUE;

-- ============================================================================
-- Collection Items (Actual Content)
-- ============================================================================

CREATE TABLE IF NOT EXISTS collection_items (
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

CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(website_collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_slug ON collection_items(slug);
CREATE INDEX IF NOT EXISTS idx_collection_items_published ON collection_items(published) WHERE published = TRUE;
CREATE INDEX IF NOT EXISTS idx_collection_items_data ON collection_items USING gin(data);
CREATE INDEX IF NOT EXISTS idx_collection_items_github ON collection_items(github_path);

-- Full-text search on collection item data
CREATE INDEX IF NOT EXISTS idx_collection_items_search ON collection_items
  USING gin(to_tsvector('english', data::text));

-- ============================================================================
-- Collection Item Versions (History)
-- ============================================================================

CREATE TABLE IF NOT EXISTS collection_item_versions (
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

CREATE INDEX IF NOT EXISTS idx_collection_versions_item ON collection_item_versions(item_id);

-- =============================================================================
-- MEDIA MANAGEMENT
-- =============================================================================

-- ============================================================================
-- Media Assets Registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,

  -- File information
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,

  -- Storage location
  storage_provider TEXT NOT NULL DEFAULT 'r2', -- 'r2', 's3', 'spaces', etc.
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  storage_region TEXT,

  -- Public access
  url TEXT NOT NULL, -- Primary CDN URL
  cdn_provider TEXT, -- 'cloudflare', 'cloudfront', etc.

  -- Image-specific metadata
  width INTEGER,
  height INTEGER,
  format TEXT, -- 'jpg', 'png', 'webp', etc.

  -- Variants (different sizes/formats)
  variants JSONB DEFAULT '[]'::jsonb,
  /* Example:
  [
    {
      "name": "thumbnail",
      "url": "https://cdn.../thumb.webp",
      "width": 150,
      "height": 150,
      "format": "webp",
      "size_bytes": 8432
    },
    {
      "name": "large",
      "url": "https://cdn.../large.webp",
      "width": 1600,
      "height": 1200,
      "format": "webp",
      "size_bytes": 245678
    }
  ]
  */

  -- SEO & Accessibility
  alt_text TEXT,
  caption TEXT,
  title TEXT,
  seo_filename TEXT, -- SEO-friendly filename

  -- Categorization
  tags TEXT[] DEFAULT '{}',
  category TEXT, -- 'hero', 'gallery', 'thumbnail', 'document', etc.

  -- Usage tracking
  used_in_collections TEXT[], -- Array of collection_item IDs
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  -- Processing status
  processing_status TEXT DEFAULT 'completed', -- 'pending', 'processing', 'completed', 'failed'
  processing_error TEXT,
  variants_generated BOOLEAN DEFAULT FALSE,

  -- Upload information
  uploaded_by_agent_id UUID REFERENCES agents(id),
  uploaded_by_user_id UUID,
  upload_source TEXT, -- 'agent_generated', 'user_uploaded', 'imported', etc.

  -- AI-generated metadata
  ai_description TEXT, -- AI-generated description
  ai_tags TEXT[], -- AI-suggested tags
  ai_alt_text TEXT, -- AI-generated alt text

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(storage_provider, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_media_website ON media(website_id);
CREATE INDEX IF NOT EXISTS idx_media_mime_type ON media(mime_type);
CREATE INDEX IF NOT EXISTS idx_media_tags ON media USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_media_usage ON media USING gin(used_in_collections);
CREATE INDEX IF NOT EXISTS idx_media_status ON media(processing_status);
CREATE INDEX IF NOT EXISTS idx_media_uploaded_at ON media(created_at DESC);

-- Full-text search on media metadata
CREATE INDEX IF NOT EXISTS idx_media_search ON media
  USING gin(to_tsvector('english',
    coalesce(alt_text, '') || ' ' ||
    coalesce(caption, '') || ' ' ||
    coalesce(title, '') || ' ' ||
    coalesce(filename, '')
  ));

-- ============================================================================
-- Media Processing Queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS media_processing_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  media_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,

  -- Processing task
  task_type TEXT NOT NULL, -- 'generate_variants', 'optimize', 'extract_metadata', etc.
  priority INTEGER DEFAULT 5, -- 1-10, higher = more urgent

  -- Status
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Results
  result JSONB,
  error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_queue_status ON media_processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_media_queue_priority ON media_processing_queue(priority DESC);
CREATE INDEX IF NOT EXISTS idx_media_queue_media ON media_processing_queue(media_id);

-- =============================================================================
-- COMMENTS (Documentation)
-- =============================================================================

COMMENT ON TABLE website_collections IS 'Collection type configurations per website';
COMMENT ON TABLE collection_items IS 'Individual items within collections (events, POIs, etc.)';
COMMENT ON TABLE collection_item_versions IS 'Version history for collection items';
COMMENT ON TABLE media IS 'Media assets registry (images, videos, documents)';
COMMENT ON TABLE media_processing_queue IS 'Background processing queue for media assets';

COMMIT;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

\echo ''
\echo '========================================='
\echo 'Collections & Media tables added!'
\echo '========================================='
\echo ''
