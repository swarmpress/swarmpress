# Collections & Binary Asset Management Specification

> **Version:** 1.0.0
> **Date:** 2024-11-24
> **Status:** Draft
> **Author:** System Architecture

---

## Executive Summary

This specification defines the architecture for managing **structured content collections** (Events, POIs, FAQs, News, etc.) and **binary assets** (images, videos, documents) in swarm.press.

**Key Decisions:**
- **Collections**: Schema-first approach with Zod validation
- **Storage**: Hybrid GitHub (metadata) + S3-compatible (binaries)
- **Provider**: Cloudflare R2 (recommended) for zero-egress costs
- **Architecture**: Three-layer system (Database Registry → Object Storage → CDN)

**Why This Matters:**
- Collections provide structured data for agents to work with
- Binary management enables performant media delivery
- Schema validation ensures data consistency
- CDN integration provides fast global delivery

---

## Table of Contents

1. [Collections Architecture](#1-collections-architecture)
2. [Collection Schema System](#2-collection-schema-system)
3. [Binary Asset Management](#3-binary-asset-management)
4. [Storage Architecture](#4-storage-architecture)
5. [Database Schema](#5-database-schema)
6. [API Design](#6-api-design)
7. [Agent Integration](#7-agent-integration)
8. [Admin UI](#8-admin-ui)
9. [GitHub Structure](#9-github-structure)
10. [Implementation Plan](#10-implementation-plan)

---

## 1. Collections Architecture

### 1.1 What Are Collections?

**Collections** are typed sets of structured content that share a common schema.

**Examples:**
- **Events**: Festivals, concerts, markets (title, date, location, price)
- **POIs**: Points of Interest (name, coordinates, category, hours)
- **FAQs**: Frequently Asked Questions (question, answer, category)
- **News**: News articles (headline, date, author, body)
- **Weather**: Weather data (date, temperature, conditions)
- **Hiking Trails**: Trail information (difficulty, distance, elevation)

### 1.2 Design Principles

1. **Schema-First**: Define structure before creating content
2. **Type-Safe**: Zod schemas for TypeScript validation
3. **Agent-Friendly**: Schemas guide agent content generation
4. **Extensible**: Websites can add custom fields
5. **Validated**: All content validated before storage
6. **Versioned**: Schemas support versioning

### 1.3 Three-Level Collection Architecture

```
Level 1: Global Collection Types (System-Wide)
   ↓
Level 2: Website Collection Instances (Per Website)
   ↓
Level 3: Collection Items (Individual Records)
```

**Example:**

```
Global: "Event" collection type definition
   ↓
Cinqueterre Website: "Events" collection (enabled)
   ↓
Individual Items:
   - Summer Wine Festival 2024
   - Vernazza Market Day
   - Monterosso Beach Concert
```

---

## 2. Collection Schema System

### 2.1 Schema Definition Format

Collections are defined using **Zod schemas** (TypeScript) with **JSON Schema** export for storage.

**Example: Event Collection Schema**

```typescript
// packages/shared/src/content/collections/event.ts

import { z } from 'zod'

export const EventSchema = z.object({
  // Core fields
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/),

  // Event details
  description: z.string(),
  date: z.string().datetime(),
  end_date: z.string().datetime().optional(),

  // Location
  location: z.object({
    name: z.string(),
    address: z.string().optional(),
    coordinates: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180)
    }).optional(),
    venue_type: z.enum(['indoor', 'outdoor', 'mixed']).optional()
  }),

  // Categorization
  category: z.enum([
    'festival',
    'concert',
    'market',
    'sports',
    'cultural',
    'food_wine',
    'art',
    'religious',
    'other'
  ]),
  tags: z.array(z.string()).default([]),

  // Pricing
  price: z.object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
    currency: z.string().length(3).default('EUR'),
    free: z.boolean().default(false),
    pricing_note: z.string().optional()
  }).optional(),

  // Media
  hero_image: z.object({
    media_id: z.string().uuid(),
    url: z.string().url(),
    alt: z.string(),
    variants: z.record(z.string().url()).optional()
  }).optional(),

  gallery: z.array(z.object({
    media_id: z.string().uuid(),
    url: z.string().url(),
    alt: z.string(),
    caption: z.string().optional()
  })).optional(),

  // Booking/Contact
  booking_url: z.string().url().optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().optional(),

  // Metadata
  featured: z.boolean().default(false),
  published: z.boolean().default(false),
  published_at: z.string().datetime().optional(),

  // SEO
  seo_title: z.string().max(60).optional(),
  seo_description: z.string().max(160).optional(),

  // Timestamps
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  created_by: z.string().uuid(),
  updated_by: z.string().uuid()
})

export type Event = z.infer<typeof EventSchema>

// Input schema for creating events (without auto-generated fields)
export const CreateEventSchema = EventSchema.omit({
  id: true,
  slug: true, // Auto-generated from title
  created_at: true,
  updated_at: true
})

export type CreateEvent = z.infer<typeof CreateEventSchema>
```

### 2.2 Collection Registry

**Central registry of all collection types:**

```typescript
// packages/shared/src/content/collections/registry.ts

import { EventSchema, CreateEventSchema } from './event'
import { POISchema, CreatePOISchema } from './poi'
import { FAQSchema, CreateFAQSchema } from './faq'
import { NewsSchema, CreateNewsSchema } from './news'

export interface CollectionDefinition {
  name: string
  pluralName: string
  description: string
  schema: z.ZodSchema
  createSchema: z.ZodSchema
  icon: string
  color: string

  // Field metadata for UI generation
  fields: CollectionFieldMetadata[]

  // Display options
  titleField: string
  summaryField?: string
  imageField?: string
  dateField?: string

  // Features
  features: {
    hasMedia: boolean
    hasSEO: boolean
    hasLocation: boolean
    hasPublishing: boolean
  }
}

export const CollectionRegistry: Record<string, CollectionDefinition> = {
  events: {
    name: 'Event',
    pluralName: 'Events',
    description: 'Festivals, concerts, markets, and other happenings',
    schema: EventSchema,
    createSchema: CreateEventSchema,
    icon: 'calendar',
    color: 'purple',

    fields: [
      {
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Summer Wine Festival'
      },
      {
        name: 'date',
        label: 'Date',
        type: 'datetime',
        required: true
      },
      {
        name: 'location.name',
        label: 'Location',
        type: 'text',
        required: true,
        placeholder: 'Vernazza Town Square'
      },
      {
        name: 'category',
        label: 'Category',
        type: 'select',
        required: true,
        options: [
          { value: 'festival', label: 'Festival' },
          { value: 'concert', label: 'Concert' },
          { value: 'market', label: 'Market' },
          // ... more options
        ]
      },
      // ... more field definitions
    ],

    titleField: 'title',
    summaryField: 'description',
    imageField: 'hero_image',
    dateField: 'date',

    features: {
      hasMedia: true,
      hasSEO: true,
      hasLocation: true,
      hasPublishing: true
    }
  },

  pois: {
    name: 'Point of Interest',
    pluralName: 'Points of Interest',
    description: 'Beaches, viewpoints, restaurants, and attractions',
    schema: POISchema,
    createSchema: CreatePOISchema,
    icon: 'map-pin',
    color: 'blue',
    // ... similar structure
  },

  faqs: {
    name: 'FAQ',
    pluralName: 'FAQs',
    description: 'Frequently asked questions',
    schema: FAQSchema,
    createSchema: CreateFAQSchema,
    icon: 'help-circle',
    color: 'green',
    // ... similar structure
  },

  news: {
    name: 'News Article',
    pluralName: 'News',
    description: 'News articles and updates',
    schema: NewsSchema,
    createSchema: CreateNewsSchema,
    icon: 'newspaper',
    color: 'orange',
    // ... similar structure
  }
}
```

### 2.3 Website-Specific Collections

Each website can enable/disable collections and add custom fields:

```typescript
// Stored in database: website_collections table

export interface WebsiteCollection {
  id: string
  website_id: string
  collection_type: string // 'events', 'pois', etc.
  enabled: boolean

  // Custom configuration
  custom_fields: CustomField[]
  field_overrides: Record<string, FieldOverride>

  // Display settings
  display_name?: string // Override plural name
  icon?: string
  color?: string

  // Features
  enable_comments?: boolean
  enable_ratings?: boolean
  enable_bookmarks?: boolean

  created_at: string
  updated_at: string
}

// Example: Cinqueterre adds custom field to Events
{
  website_id: 'cinqueterre-uuid',
  collection_type: 'events',
  enabled: true,
  custom_fields: [
    {
      name: 'vineyard_partner',
      label: 'Partner Vineyard',
      type: 'text',
      required: false,
      help_text: 'Name of the participating vineyard'
    },
    {
      name: 'hiking_difficulty',
      label: 'Hiking Difficulty',
      type: 'select',
      options: ['easy', 'moderate', 'challenging'],
      required: false
    }
  ]
}
```

---

## 3. Binary Asset Management

### 3.1 Storage Strategy

**Hybrid Approach:**

| Asset Type | Storage Location | Why |
|------------|------------------|-----|
| **Small assets** (< 50KB) | GitHub | Icons, logos, design system |
| **Images** (> 50KB) | S3-compatible | Optimized delivery, variants |
| **Videos** | S3-compatible | Large files, streaming |
| **PDFs** | S3-compatible | Documents, guides |
| **Content metadata** | GitHub | Version controlled |
| **Media registry** | PostgreSQL | Searchable, relational |

### 3.2 Storage Provider Comparison

| Provider | Cost/GB/month | Egress Cost | CDN | Best For |
|----------|---------------|-------------|-----|----------|
| **Cloudflare R2** ⭐ | $0.015 | **FREE** | Included | **Recommended** |
| AWS S3 | $0.023 | $0.09/GB | Extra | Enterprise |
| Backblaze B2 | $0.005 | $0.01/GB | Extra | Archives |
| DigitalOcean Spaces | $5/250GB | $0.01/GB | Included | Small sites |
| MinIO (self-hosted) | Server costs | None | Self-managed | Full control |

**Recommendation: Cloudflare R2**
- Zero egress fees (unlimited bandwidth)
- Global CDN included
- S3-compatible API
- $0.015/GB storage
- Best TCO for content-heavy sites

### 3.3 Asset Lifecycle

```
1. Upload Request
   ↓
2. Direct Upload to S3 (Signed URL)
   ↓
3. Process & Generate Variants
   ↓
4. Register in Database
   ↓
5. Reference in Content (GitHub)
   ↓
6. Deliver via CDN
```

### 3.4 Image Variants Strategy

**Automatic variant generation:**

```typescript
const VARIANT_CONFIGS = {
  thumbnail: { width: 150, height: 150, fit: 'cover' },
  small: { width: 400, height: 300, fit: 'cover' },
  medium: { width: 800, height: 600, fit: 'inside' },
  large: { width: 1600, height: 1200, fit: 'inside' },
  hero: { width: 1920, height: 1080, fit: 'cover' },
  original: { preserve: true } // Original file
}

const FORMATS = {
  modern: 'webp', // WebP for modern browsers
  fallback: 'jpg', // JPEG fallback
  lossless: 'png' // PNG for graphics
}
```

**Generated URLs:**
```
Original: https://cdn.example.com/cinqueterre/images/event-123/hero.jpg
Variants:
  - hero.webp (1920x1080, WebP)
  - hero-large.webp (1600x1200, WebP)
  - hero-medium.webp (800x600, WebP)
  - hero-small.webp (400x300, WebP)
  - hero-thumbnail.webp (150x150, WebP)
Fallbacks:
  - hero.jpg (original JPEG)
  - hero-large.jpg
  - hero-medium.jpg
  - hero-small.jpg
  - hero-thumbnail.jpg
```

---

## 4. Storage Architecture

### 4.1 Three-Layer Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Layer 1: GitHub                    │
│              (Content + Media References)            │
│  ┌────────────────────────────────────────────────┐  │
│  │ cinqueterre/.content/                          │  │
│  │   events/                                      │  │
│  │     schema.json                                │  │
│  │     summer-festival-2024.json                  │  │
│  │     {                                          │  │
│  │       "title": "Summer Wine Festival",         │  │
│  │       "hero_image": {                          │  │
│  │         "media_id": "abc-123",                 │  │
│  │         "url": "https://cdn.../hero.jpg"       │  │
│  │       }                                        │  │
│  │     }                                          │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                         │
                         │ media_id reference
                         ▼
┌─────────────────────────────────────────────────────┐
│               Layer 2: PostgreSQL                    │
│                (Media Registry)                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ media table:                                   │  │
│  │ {                                              │  │
│  │   id: "abc-123",                               │  │
│  │   website_id: "cinqueterre",                   │  │
│  │   filename: "summer-festival-hero.jpg",        │  │
│  │   storage_path: "cinqueterre/images/2024/...", │  │
│  │   url: "https://cdn.example.com/...",          │  │
│  │   variants: [...],                             │  │
│  │   size_bytes: 245678,                          │  │
│  │   width: 1920,                                 │  │
│  │   height: 1080                                 │  │
│  │ }                                              │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                         │
                         │ storage_path
                         ▼
┌─────────────────────────────────────────────────────┐
│           Layer 3: S3-Compatible Storage             │
│              (Cloudflare R2 / AWS S3)                │
│  ┌────────────────────────────────────────────────┐  │
│  │ Bucket: swarmpress-media                       │  │
│  │   cinqueterre/                                 │  │
│  │     images/                                    │  │
│  │       2024/                                    │  │
│  │         11/                                    │  │
│  │           abc-123/                             │  │
│  │             original.jpg      (2.1 MB)         │  │
│  │             hero.webp         (850 KB)         │  │
│  │             large.webp        (420 KB)         │  │
│  │             medium.webp       (180 KB)         │  │
│  │             thumbnail.webp    (45 KB)          │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                         │
                         │ CDN delivery
                         ▼
┌─────────────────────────────────────────────────────┐
│                      CloudFlare CDN                  │
│                (Global Edge Network)                 │
│         Fast delivery + automatic caching            │
└─────────────────────────────────────────────────────┘
```

### 4.2 GitHub Directory Structure

```
cinqueterre-website/
├── .swarmpress/
│   ├── config.json              # Website configuration
│   └── collections.json         # Enabled collections config
├── .content/
│   ├── events/
│   │   ├── schema.json          # Event schema (optional override)
│   │   ├── summer-festival.json
│   │   ├── wine-tasting.json
│   │   └── beach-concert.json
│   ├── pois/
│   │   ├── schema.json
│   │   ├── vernazza-beach.json
│   │   ├── manarola-harbor.json
│   │   └── riomaggiore-viewpoint.json
│   ├── faqs/
│   │   ├── getting-there.json
│   │   ├── best-time-visit.json
│   │   └── hiking-tips.json
│   └── news/
│       ├── trail-closure-update.json
│       └── new-ferry-schedule.json
├── .pages/
│   ├── index.json               # Homepage
│   ├── about.json               # About page
│   └── events/
│       └── [slug].json          # Dynamic event pages
└── README.md
```

---

## 5. Database Schema

### 5.1 Collections Tables

```sql
-- ============================================================================
-- Collection Definitions (Website-Level)
-- ============================================================================

CREATE TABLE website_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  collection_type TEXT NOT NULL, -- 'events', 'pois', 'faqs', etc.

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

CREATE INDEX idx_website_collections_website ON website_collections(website_id);
CREATE INDEX idx_website_collections_type ON website_collections(collection_type);
CREATE INDEX idx_website_collections_enabled ON website_collections(enabled) WHERE enabled = TRUE;

-- ============================================================================
-- Collection Items (Actual Content)
-- ============================================================================

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

-- ============================================================================
-- Collection Item Versions (History)
-- ============================================================================

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
```

### 5.2 Media Management Tables

```sql
-- ============================================================================
-- Media Assets Registry
-- ============================================================================

CREATE TABLE media (
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

CREATE INDEX idx_media_website ON media(website_id);
CREATE INDEX idx_media_mime_type ON media(mime_type);
CREATE INDEX idx_media_tags ON media USING gin(tags);
CREATE INDEX idx_media_usage ON media USING gin(used_in_collections);
CREATE INDEX idx_media_status ON media(processing_status);
CREATE INDEX idx_media_uploaded_at ON media(created_at DESC);

-- Full-text search on media metadata
CREATE INDEX idx_media_search ON media
  USING gin(to_tsvector('english',
    coalesce(alt_text, '') || ' ' ||
    coalesce(caption, '') || ' ' ||
    coalesce(title, '') || ' ' ||
    coalesce(filename, '')
  ));

-- ============================================================================
-- Media Processing Queue
-- ============================================================================

CREATE TABLE media_processing_queue (
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

CREATE INDEX idx_media_queue_status ON media_processing_queue(status);
CREATE INDEX idx_media_queue_priority ON media_processing_queue(priority DESC);
CREATE INDEX idx_media_queue_media ON media_processing_queue(media_id);
```

---

## 6. API Design

### 6.1 Collection API (tRPC)

```typescript
// packages/backend/src/api/routers/collection.router.ts

export const collectionRouter = router({

  // ========================================================================
  // Website Collection Management
  // ========================================================================

  /**
   * List collections for a website
   */
  list: publicProcedure
    .input(z.object({
      website_id: z.string().uuid(),
      enabled_only: z.boolean().optional()
    }))
    .query(async ({ input }) => {
      // Returns list of enabled collection types with config
    }),

  /**
   * Enable a collection type for a website
   */
  enable: ceoProcedure
    .input(z.object({
      website_id: z.string().uuid(),
      collection_type: z.string(),
      config: z.object({
        display_name: z.string().optional(),
        custom_fields: z.array(z.any()).optional()
      }).optional()
    }))
    .mutation(async ({ input }) => {
      // Creates website_collection record
    }),

  // ========================================================================
  // Collection Items (CRUD)
  // ========================================================================

  /**
   * List items in a collection
   */
  items: {
    list: publicProcedure
      .input(z.object({
        website_id: z.string().uuid(),
        collection_type: z.string(),
        published_only: z.boolean().optional(),
        search: z.string().optional(),
        page: z.number().default(1),
        limit: z.number().default(20)
      }))
      .query(async ({ input }) => {
        // Returns paginated list of collection items
      }),

    get: publicProcedure
      .input(z.object({
        website_id: z.string().uuid(),
        collection_type: z.string(),
        slug: z.string()
      }))
      .query(async ({ input }) => {
        // Returns single collection item
      }),

    create: protectedProcedure
      .input(z.object({
        website_id: z.string().uuid(),
        collection_type: z.string(),
        data: z.record(z.any()) // Validated against collection schema
      }))
      .mutation(async ({ input, ctx }) => {
        // 1. Load collection schema
        // 2. Validate data against schema
        // 3. Create collection item
        // 4. Sync to GitHub
        // 5. Return created item
      }),

    update: protectedProcedure
      .input(z.object({
        item_id: z.string().uuid(),
        data: z.record(z.any())
      }))
      .mutation(async ({ input, ctx }) => {
        // Update item with validation
      }),

    delete: ceoProcedure
      .input(z.object({ item_id: z.string().uuid() }))
      .mutation(async ({ input }) => {
        // Soft delete or hard delete based on config
      }),

    publish: protectedProcedure
      .input(z.object({
        item_id: z.string().uuid(),
        publish: z.boolean()
      }))
      .mutation(async ({ input }) => {
        // Toggle published status
      })
  },

  // ========================================================================
  // Schema & Validation
  // ========================================================================

  /**
   * Get schema for a collection type
   */
  getSchema: publicProcedure
    .input(z.object({
      collection_type: z.string(),
      website_id: z.string().uuid().optional() // For website-specific overrides
    }))
    .query(async ({ input }) => {
      // Returns JSON Schema for collection
    }),

  /**
   * Validate data against collection schema
   */
  validate: publicProcedure
    .input(z.object({
      collection_type: z.string(),
      data: z.record(z.any())
    }))
    .mutation(async ({ input }) => {
      // Validates and returns errors if invalid
    })
})
```

### 6.2 Media API (tRPC)

```typescript
// packages/backend/src/api/routers/media.router.ts

export const mediaRouter = router({

  // ========================================================================
  // Upload & Processing
  // ========================================================================

  /**
   * Request signed upload URL (direct browser → S3)
   */
  requestUpload: protectedProcedure
    .input(z.object({
      website_id: z.string().uuid(),
      filename: z.string(),
      mime_type: z.string(),
      size_bytes: z.number(),
      generate_variants: z.boolean().default(true)
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Generate unique storage path
      // 2. Create presigned upload URL
      // 3. Create media record (status: 'pending')
      // 4. Return { upload_url, media_id, fields }
    }),

  /**
   * Confirm upload completed
   */
  confirmUpload: protectedProcedure
    .input(z.object({
      media_id: z.string().uuid()
    }))
    .mutation(async ({ input }) => {
      // 1. Update media status to 'processing'
      // 2. Queue variant generation
      // 3. Extract metadata (dimensions, etc.)
      // 4. Generate AI alt text
    }),

  /**
   * Upload via base64 (for agent-generated images)
   */
  uploadBase64: protectedProcedure
    .input(z.object({
      website_id: z.string().uuid(),
      filename: z.string(),
      mime_type: z.string(),
      base64_data: z.string(),
      metadata: z.object({
        alt_text: z.string().optional(),
        caption: z.string().optional(),
        tags: z.array(z.string()).optional()
      }).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Decode base64
      // 2. Upload to S3
      // 3. Generate variants
      // 4. Create media record
      // 5. Return media object
    }),

  // ========================================================================
  // Media Library
  // ========================================================================

  /**
   * List media for a website
   */
  list: publicProcedure
    .input(z.object({
      website_id: z.string().uuid(),
      mime_type_prefix: z.string().optional(), // 'image/', 'video/', etc.
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      page: z.number().default(1),
      limit: z.number().default(30)
    }))
    .query(async ({ input }) => {
      // Returns paginated media list with thumbnails
    }),

  /**
   * Get single media item
   */
  get: publicProcedure
    .input(z.object({ media_id: z.string().uuid() }))
    .query(async ({ input }) => {
      // Returns full media object with all variants
    }),

  /**
   * Update media metadata
   */
  update: protectedProcedure
    .input(z.object({
      media_id: z.string().uuid(),
      alt_text: z.string().optional(),
      caption: z.string().optional(),
      title: z.string().optional(),
      tags: z.array(z.string()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      // Updates media metadata
    }),

  /**
   * Delete media
   */
  delete: ceoProcedure
    .input(z.object({
      media_id: z.string().uuid(),
      delete_from_storage: z.boolean().default(true)
    }))
    .mutation(async ({ input }) => {
      // 1. Check if media is in use
      // 2. Delete from S3
      // 3. Delete database record
    }),

  // ========================================================================
  // Variants & Processing
  // ========================================================================

  /**
   * Generate variants for existing media
   */
  generateVariants: protectedProcedure
    .input(z.object({
      media_id: z.string().uuid(),
      variants: z.array(z.string()).optional() // Specific variants or all
    }))
    .mutation(async ({ input }) => {
      // Queue variant generation
    }),

  /**
   * Get processing status
   */
  getProcessingStatus: publicProcedure
    .input(z.object({ media_id: z.string().uuid() }))
    .query(async ({ input }) => {
      // Returns processing status and progress
    })
})
```

---

## 7. Agent Integration

### 7.1 Agent Tools for Collections

```typescript
// Agent tool: Create collection item

async function createCollectionItem({
  website_id,
  collection_type,
  data
}: {
  website_id: string
  collection_type: string
  data: Record<string, any>
}) {
  // 1. Load collection schema
  const schema = await collectionService.getSchema(collection_type, website_id)

  // 2. Validate data
  const validated = schema.parse(data)

  // 3. Create item
  const item = await trpc.collection.items.create.mutate({
    website_id,
    collection_type,
    data: validated
  })

  // 4. Log execution
  await logAgentAction({
    agent_id: 'current-agent',
    action: 'create_collection_item',
    result: item
  })

  return item
}
```

### 7.2 Agent Prompts with Schema Awareness

```typescript
// When agent creates event content

const eventSchema = await loadCollectionSchema('events')

const prompt = `
You are creating an Event for the Cinque Terre tourism website.

Event Schema:
${JSON.stringify(eventSchema, null, 2)}

Required fields:
- title (string, 1-200 chars)
- date (ISO datetime)
- location.name (string)
- category (festival|concert|market|sports|cultural|food_wine|art|religious|other)

Task: Create an event for "Summer Wine Festival in Vernazza on July 15, 2024"

Generate valid JSON that matches the Event schema. Include:
- Compelling title and description
- Accurate location details
- Appropriate category
- Estimated pricing if applicable
- Suggest 3-5 relevant tags

Output only valid JSON, no markdown formatting.
`

const response = await claudeAPI.generate(prompt)
const eventData = JSON.parse(response)

// Validate before saving
const validatedEvent = EventSchema.parse(eventData)
```

### 7.3 Agent Media Tools

```typescript
// Agent tool: Request image for content

async function requestImage({
  description,
  purpose,
  dimensions = { width: 1920, height: 1080 }
}: {
  description: string
  purpose: 'hero' | 'gallery' | 'thumbnail'
  dimensions?: { width: number; height: number }
}) {
  // Option A: Generate via AI image service
  const generatedImage = await imageGenerationService.generate({
    prompt: description,
    size: dimensions,
    style: 'photorealistic'
  })

  // Upload to S3
  const media = await trpc.media.uploadBase64.mutate({
    website_id: 'current-website',
    filename: slugify(description) + '.jpg',
    mime_type: 'image/jpeg',
    base64_data: generatedImage.base64,
    metadata: {
      alt_text: description,
      tags: extractTags(description)
    }
  })

  return {
    media_id: media.id,
    url: media.url,
    alt: media.alt_text,
    variants: media.variants
  }
}

// Usage in agent workflow
const heroImage = await requestImage({
  description: "Sunset over Vernazza harbor with colorful fishing boats",
  purpose: 'hero'
})

const event = {
  title: "Summer Wine Festival",
  hero_image: heroImage,
  // ... other fields
}
```

---

## 8. Admin UI

### 8.1 Collections Management UI

**Collection List Page:**
```
┌─────────────────────────────────────────────────────┐
│  Collections - Cinque Terre                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [+ Enable Collection]                              │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ 📅 Events                          [Enabled ✓] │ │
│  │ Festivals, concerts, and happenings             │ │
│  │ 47 items  •  12 published  •  Last: 2h ago      │ │
│  │ [Manage Items] [Settings]                       │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ 📍 Points of Interest              [Enabled ✓] │ │
│  │ Beaches, viewpoints, restaurants                │ │
│  │ 83 items  •  78 published  •  Last: 1d ago      │ │
│  │ [Manage Items] [Settings]                       │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ ❓ FAQs                            [Enabled ✓] │ │
│  │ Frequently asked questions                      │ │
│  │ 28 items  •  28 published  •  Last: 3d ago      │ │
│  │ [Manage Items] [Settings]                       │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ 📰 News                             [Disabled] │ │
│  │ News articles and updates                       │ │
│  │ [Enable]                                        │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Collection Items List:**
```
┌─────────────────────────────────────────────────────┐
│  Events - Cinque Terre                [+ New Event] │
├─────────────────────────────────────────────────────┤
│  [Search events...]        [Filter ▼]  [Sort ▼]    │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ 🖼️  Summer Wine Festival           [Published] │ │
│  │     Jul 15, 2024 • Vernazza                     │ │
│  │     Festival celebrating local wines            │ │
│  │     [Edit] [Duplicate] [Delete]                 │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ 🖼️  Beach Concert Series             [Draft]   │ │
│  │     Aug 5-12, 2024 • Monterosso                 │ │
│  │     Weekly concerts on the beach                │ │
│  │     [Edit] [Publish] [Delete]                   │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  Showing 2 of 47 events                             │
│  [← Previous]  [Page 1 of 5]  [Next →]             │
└─────────────────────────────────────────────────────┘
```

**Item Edit Form:**
```
┌─────────────────────────────────────────────────────┐
│  Edit Event: Summer Wine Festival      [Save Draft] │
│                                         [Publish]    │
├─────────────────────────────────────────────────────┤
│  Basic Information                                  │
│  ┌─────────────────────────────────────────────┐   │
│  │ Title *                                      │   │
│  │ [Summer Wine Festival                     ]  │   │
│  │                                              │   │
│  │ Description *                                │   │
│  │ [A celebration of Cinque Terre's finest...]  │   │
│  │                                              │   │
│  │ Date * [📅 07/15/2024  ⏰ 18:00]            │   │
│  │ End Date [📅 07/15/2024  ⏰ 23:00]          │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Location                                           │
│  ┌─────────────────────────────────────────────┐   │
│  │ Venue Name * [Vernazza Town Square       ]   │   │
│  │ Address [Piazza Marconi, Vernazza        ]   │   │
│  │ Coordinates [44.1354, 9.6854] [📍 Map]      │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Media                                              │
│  ┌─────────────────────────────────────────────┐   │
│  │ Hero Image                                   │   │
│  │ [🖼️ Current: sunset-vernazza.jpg]           │   │
│  │ [Change Image] [Remove]                      │   │
│  │                                              │   │
│  │ Gallery (3 images)                           │   │
│  │ [🖼️] [🖼️] [🖼️] [+ Add]                     │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Categorization                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Category * [Festival ▼]                      │   │
│  │ Tags [wine] [summer] [vernazza] [+ Add]      │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [Cancel]                         [Save & Publish] │
└─────────────────────────────────────────────────────┘
```

### 8.2 Media Library UI

```
┌─────────────────────────────────────────────────────┐
│  Media Library                        [⬆️ Upload]    │
├─────────────────────────────────────────────────────┤
│  [Search media...]  [Type ▼]  [Tags ▼]  [Sort ▼]   │
│                                                     │
│  [Grid View] [List View]                            │
│                                                     │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  │
│  │ 🖼️  │ │ 🖼️  │ │ 🖼️  │ │ 🖼️  │ │ 🎥  │ │ 🖼️  │  │
│  │     │ │     │ │     │ │     │ │     │ │     │  │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘  │
│  sunset  beach   harbor  festival video   food     │
│  .jpg    .jpg    .jpg    .jpg     .mp4    .jpg     │
│  245 KB  180 KB  320 KB  156 KB   12 MB   98 KB    │
│                                                     │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  │
│  │ 🖼️  │ │ 📄  │ │ 🖼️  │ │ 🖼️  │ │ 🖼️  │ │ 🖼️  │  │
│  │     │ │     │ │     │ │     │ │     │ │     │  │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘  │
│                                                     │
│  Showing 12 of 487 items                            │
│  [← Previous]  [Page 1 of 41]  [Next →]            │
└─────────────────────────────────────────────────────┘
```

**Media Details Modal:**
```
┌─────────────────────────────────────────────────────┐
│  Media Details                              [✕]     │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┐   │
│  │                                              │   │
│  │          [Large Preview Image]              │   │
│  │                                              │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  sunset-vernazza.jpg                                │
│  1920 × 1080 • 245 KB • JPEG                        │
│                                                     │
│  URL                                                │
│  [https://cdn.example.com/cinqueterre/images...]   │
│  [📋 Copy]                                          │
│                                                     │
│  Variants                                           │
│  • Original (1920×1080) - 245 KB                    │
│  • Large (1600×1200) - 180 KB [📋 Copy URL]         │
│  • Medium (800×600) - 85 KB [📋 Copy URL]           │
│  • Thumbnail (150×150) - 12 KB [📋 Copy URL]        │
│                                                     │
│  Metadata                                           │
│  Alt Text: [Sunset over Vernazza harbor]            │
│  Caption: [Golden hour in Vernazza]                 │
│  Tags: [sunset] [vernazza] [harbor] [+ Add]         │
│                                                     │
│  Usage                                              │
│  Used in 3 items:                                   │
│  • Event: Summer Wine Festival                      │
│  • POI: Vernazza Harbor                             │
│  • Page: Homepage Hero                              │
│                                                     │
│  Uploaded by Writer Agent on Nov 24, 2024           │
│                                                     │
│  [Delete Media]                      [Save Changes] │
└─────────────────────────────────────────────────────┘
```

---

## 9. GitHub Structure

### 9.1 Repository Organization

```
cinqueterre-website/
├── .swarmpress/
│   ├── config.json
│   │   {
│   │     "website_id": "uuid",
│   │     "name": "Cinque Terre Tourism",
│   │     "domain": "cinqueterre.com"
│   │   }
│   │
│   ├── collections.json
│   │   {
│   │     "enabled": ["events", "pois", "faqs", "news"],
│   │     "custom_fields": {
│   │       "events": [
│   │         {
│   │           "name": "vineyard_partner",
│   │           "type": "text",
│   │           "required": false
│   │         }
│   │       ]
│   │     }
│   │   }
│   │
│   └── schemas/
│       ├── event.schema.json      # Optional: Website-specific schema override
│       └── poi.schema.json
│
├── .content/
│   ├── events/
│   │   ├── summer-wine-festival-2024.json
│   │   │   {
│   │   │     "id": "uuid",
│   │   │     "title": "Summer Wine Festival",
│   │   │     "slug": "summer-wine-festival-2024",
│   │   │     "date": "2024-07-15T18:00:00Z",
│   │   │     "location": {
│   │   │       "name": "Vernazza Town Square",
│   │   │       "coordinates": {
│   │   │         "lat": 44.1354,
│   │   │         "lng": 9.6854
│   │   │       }
│   │   │     },
│   │   │     "category": "festival",
│   │   │     "hero_image": {
│   │   │       "media_id": "abc-123",
│   │   │       "url": "https://cdn.example.com/.../hero.jpg",
│   │   │       "alt": "Sunset over Vernazza during festival",
│   │   │       "variants": {
│   │   │         "large": "https://cdn.../hero-large.webp",
│   │   │         "medium": "https://cdn.../hero-medium.webp",
│   │   │         "thumbnail": "https://cdn.../hero-thumb.webp"
│   │   │       }
│   │   │     },
│   │   │     "published": true,
│   │   │     "_metadata": {
│   │   │       "created_at": "2024-11-24T10:00:00Z",
│   │   │       "created_by": "agent-writer-01",
│   │   │       "updated_at": "2024-11-24T12:00:00Z",
│   │   │       "synced_from_db": true
│   │   │     }
│   │   │   }
│   │   │
│   │   ├── beach-concert-series-2024.json
│   │   └── vernazza-market-day.json
│   │
│   ├── pois/
│   │   ├── vernazza-beach.json
│   │   ├── manarola-harbor.json
│   │   └── riomaggiore-viewpoint.json
│   │
│   ├── faqs/
│   │   ├── getting-there.json
│   │   ├── best-time-visit.json
│   │   └── hiking-tips.json
│   │
│   └── news/
│       ├── trail-closure-update.json
│       └── new-ferry-schedule.json
│
├── .pages/
│   ├── index.json               # Homepage
│   ├── about.json
│   ├── events.json              # Events listing page
│   └── events/
│       └── [slug].json          # Dynamic event detail page template
│
└── README.md
```

### 9.2 Sync Strategy

**Bidirectional Sync:**

```
Database (Source of Truth) ←→ GitHub (Content Store)
```

**Sync Triggers:**

1. **Database → GitHub** (Export):
   - When collection item is created/updated via API
   - Manual "Sync to GitHub" button in admin
   - Scheduled sync (every 15 minutes)

2. **GitHub → Database** (Import):
   - Webhook on GitHub push
   - Manual "Import from GitHub" button
   - On deployment

**Conflict Resolution:**
- Last-write-wins (timestamp-based)
- Manual conflict resolution UI for simultaneous edits
- Version history maintained in database

---

## 10. Implementation Plan

### Phase 1: Foundation (Week 1-2)

**Database Schema:**
- [ ] Create `website_collections` table
- [ ] Create `collection_items` table
- [ ] Create `collection_item_versions` table
- [ ] Create `media` table
- [ ] Create `media_processing_queue` table
- [ ] Apply migrations

**Collection System:**
- [ ] Define core collection schemas (Event, POI, FAQ, News)
- [ ] Create collection registry
- [ ] Build schema validation service
- [ ] Collection type system in TypeScript

### Phase 2: Storage Infrastructure (Week 2-3)

**S3/R2 Integration:**
- [ ] Set up Cloudflare R2 bucket (or alternative)
- [ ] Configure CORS and access policies
- [ ] CDN domain setup (cdn.example.com)
- [ ] Presigned URL generation service

**Media Service:**
- [ ] Upload service (direct upload)
- [ ] Image processing pipeline (Sharp.js)
- [ ] Variant generation (thumbnail, small, medium, large)
- [ ] Metadata extraction (dimensions, EXIF)
- [ ] Media registry CRUD

### Phase 3: API Layer (Week 3-4)

**Collection API:**
- [ ] Collection management endpoints
- [ ] Collection item CRUD
- [ ] Schema retrieval and validation
- [ ] Search and filtering
- [ ] Pagination

**Media API:**
- [ ] Upload endpoints (presigned URLs)
- [ ] Media library endpoints
- [ ] Metadata management
- [ ] Usage tracking
- [ ] Processing status

### Phase 4: GitHub Integration (Week 4-5)

**Sync System:**
- [ ] Collection → GitHub export
- [ ] GitHub → Collection import
- [ ] Webhook handlers
- [ ] Conflict detection and resolution
- [ ] Version tracking

**Media References:**
- [ ] Media reference format in JSON
- [ ] Media URL resolution
- [ ] Broken link detection

### Phase 5: Admin UI (Week 5-6)

**Collections UI:**
- [ ] Collection list view
- [ ] Enable/disable collections
- [ ] Collection item list
- [ ] Item create/edit forms (auto-generated from schema)
- [ ] Bulk operations
- [ ] Search and filters

**Media Library UI:**
- [ ] Media grid/list view
- [ ] Upload interface (drag-drop)
- [ ] Media details modal
- [ ] Media picker component (for forms)
- [ ] Usage tracking display

### Phase 6: Agent Integration (Week 6-7)

**Agent Tools:**
- [ ] Collection schema loading
- [ ] Collection item creation
- [ ] Media request/upload
- [ ] Content validation

**Prompt Updates:**
- [ ] Schema-aware prompts
- [ ] Example generation for collections
- [ ] Media description generation

### Phase 7: Optimization & Polish (Week 7-8)

**Performance:**
- [ ] CDN caching configuration
- [ ] Database query optimization
- [ ] Image lazy loading
- [ ] Responsive image srcset

**Features:**
- [ ] AI-generated alt text
- [ ] Automatic tagging
- [ ] Duplicate detection
- [ ] Unused media cleanup
- [ ] Bulk import/export

**Testing:**
- [ ] Unit tests (schema validation)
- [ ] Integration tests (API endpoints)
- [ ] E2E tests (admin UI flows)
- [ ] Performance testing

---

## Appendix A: Example Schemas

### A.1 Point of Interest (POI) Schema

```typescript
export const POISchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  slug: z.string(),

  // Details
  description: z.string(),
  category: z.enum([
    'beach',
    'viewpoint',
    'restaurant',
    'hotel',
    'shop',
    'historic_site',
    'church',
    'museum',
    'hiking_trail',
    'transportation',
    'other'
  ]),

  // Location (required for POIs)
  location: z.object({
    name: z.string(),
    address: z.string().optional(),
    coordinates: z.object({
      lat: z.number(),
      lng: z.number()
    }),
    village: z.enum([
      'monterosso',
      'vernazza',
      'corniglia',
      'manarola',
      'riomaggiore'
    ])
  }),

  // Hours & Availability
  hours: z.object({
    monday: z.string().optional(),
    tuesday: z.string().optional(),
    wednesday: z.string().optional(),
    thursday: z.string().optional(),
    friday: z.string().optional(),
    saturday: z.string().optional(),
    sunday: z.string().optional(),
    notes: z.string().optional()
  }).optional(),

  seasonal: z.boolean().default(false),
  season_start: z.string().optional(), // MM-DD format
  season_end: z.string().optional(),

  // Contact
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),

  // Media
  hero_image: z.object({
    media_id: z.string().uuid(),
    url: z.string().url(),
    alt: z.string()
  }).optional(),

  gallery: z.array(z.object({
    media_id: z.string().uuid(),
    url: z.string().url(),
    alt: z.string()
  })).optional(),

  // Features
  features: z.array(z.string()).default([]),
  accessibility: z.array(z.string()).default([]),

  // Ratings & Reviews
  rating: z.number().min(0).max(5).optional(),
  review_count: z.number().optional(),

  // Metadata
  featured: z.boolean().default(false),
  published: z.boolean().default(false),
  tags: z.array(z.string()).default([]),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
})
```

### A.2 FAQ Schema

```typescript
export const FAQSchema = z.object({
  id: z.string().uuid(),

  // Question & Answer
  question: z.string().min(10).max(300),
  answer: z.string().min(20),

  // Categorization
  category: z.enum([
    'getting_there',
    'accommodation',
    'hiking',
    'beaches',
    'food_drink',
    'activities',
    'weather',
    'tickets',
    'general'
  ]),

  // Ordering
  order: z.number().default(0),

  // Related content
  related_pois: z.array(z.string().uuid()).optional(),
  related_events: z.array(z.string().uuid()).optional(),

  // Metadata
  featured: z.boolean().default(false),
  published: z.boolean().default(true),
  helpful_count: z.number().default(0),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
})
```

### A.3 News Article Schema

```typescript
export const NewsSchema = z.object({
  id: z.string().uuid(),

  // Article content
  headline: z.string().min(10).max(150),
  slug: z.string(),
  summary: z.string().max(300),
  body: z.string(), // Markdown or JSON blocks

  // Publishing
  published_date: z.string().datetime(),
  author: z.string().optional(),

  // Categorization
  category: z.enum([
    'announcement',
    'event',
    'weather',
    'transportation',
    'safety',
    'tips',
    'culture'
  ]),
  tags: z.array(z.string()).default([]),

  // Media
  featured_image: z.object({
    media_id: z.string().uuid(),
    url: z.string().url(),
    alt: z.string()
  }).optional(),

  // Urgency
  urgent: z.boolean().default(false),
  expires_at: z.string().datetime().optional(),

  // SEO
  seo_title: z.string().max(60).optional(),
  seo_description: z.string().max(160).optional(),

  // Metadata
  published: z.boolean().default(false),
  featured: z.boolean().default(false),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
})
```

---

## Appendix B: Storage Cost Analysis

### Example Website: Cinque Terre

**Content Estimate:**
- Events: 100 items × 2 images = 200 images
- POIs: 150 items × 3 images = 450 images
- News: 50 items × 1 image = 50 images
- Pages: 20 pages × 1 hero = 20 images
- **Total: 720 images**

**Storage Calculation:**

| Variant | Size per Image | Total per Image | Count | Total Storage |
|---------|----------------|-----------------|-------|---------------|
| Original | 800 KB | 800 KB | 720 | 576 MB |
| Hero | 350 KB | 350 KB | 720 | 252 MB |
| Large | 200 KB | 200 KB | 720 | 144 MB |
| Medium | 100 KB | 100 KB | 720 | 72 MB |
| Thumbnail | 30 KB | 30 KB | 720 | 21.6 MB |
| **Total** | | **1.48 MB** | 720 | **1,065 MB (1.04 GB)** |

**Monthly Costs:**

| Provider | Storage | Egress (10 GB/month) | CDN | Total |
|----------|---------|----------------------|-----|-------|
| **Cloudflare R2** | $0.016 | **$0** (FREE) | FREE | **$0.016** |
| AWS S3 | $0.024 | $0.90 | $10+ | **$10.92+** |
| Backblaze B2 | $0.005 | $0.10 | - | **$0.11** |
| DO Spaces | $5.00 (flat 250GB) | Included | Included | **$5.00** |

**Winner: Cloudflare R2** - Only $0.016/month for storage, zero egress costs

**Growth Projection (Year 1):**
- Month 1: 1 GB
- Month 6: 3 GB (adding content regularly)
- Month 12: 5 GB (fully populated)

**Year 1 Total Cost with R2:** ~$0.50

---

## Appendix C: Image Processing Pipeline

```typescript
// Image processing workflow

async function processUploadedImage(mediaId: string) {
  const media = await db.media.findById(mediaId)

  // 1. Download original from S3
  const originalBuffer = await s3.getObject({
    Bucket: media.storage_bucket,
    Key: media.storage_path
  })

  // 2. Extract metadata
  const metadata = await sharp(originalBuffer).metadata()
  await db.media.update(mediaId, {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format
  })

  // 3. Generate variants
  const variants = []

  for (const [variantName, config] of Object.entries(VARIANT_CONFIGS)) {
    // Generate WebP version
    const webpBuffer = await sharp(originalBuffer)
      .resize(config.width, config.height, { fit: config.fit })
      .webp({ quality: 85 })
      .toBuffer()

    // Upload to S3
    const webpKey = `${media.storage_path}-${variantName}.webp`
    await s3.putObject({
      Bucket: media.storage_bucket,
      Key: webpKey,
      Body: webpBuffer,
      ContentType: 'image/webp'
    })

    // Generate JPEG fallback
    const jpegBuffer = await sharp(originalBuffer)
      .resize(config.width, config.height, { fit: config.fit })
      .jpeg({ quality: 85 })
      .toBuffer()

    const jpegKey = `${media.storage_path}-${variantName}.jpg`
    await s3.putObject({
      Bucket: media.storage_bucket,
      Key: jpegKey,
      Body: jpegBuffer,
      ContentType: 'image/jpeg'
    })

    variants.push({
      name: variantName,
      url: `${CDN_BASE_URL}/${webpKey}`,
      fallback_url: `${CDN_BASE_URL}/${jpegKey}`,
      width: config.width,
      height: config.height,
      format: 'webp',
      size_bytes: webpBuffer.length
    })
  }

  // 4. Update media record with variants
  await db.media.update(mediaId, {
    variants,
    variants_generated: true,
    processing_status: 'completed'
  })

  // 5. Generate AI alt text if not provided
  if (!media.alt_text) {
    const altText = await generateAltText(originalBuffer)
    await db.media.update(mediaId, { ai_alt_text: altText })
  }
}
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-24 | Initial specification |

---

**End of Specification**
