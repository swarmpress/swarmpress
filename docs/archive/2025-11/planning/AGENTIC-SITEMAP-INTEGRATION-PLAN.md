# Agentic Sitemap Integration Plan
## Evolution from Current swarm.press to Graph-Driven Platform

**Document Version:** 1.0
**Date:** 2025-11-23
**Status:** Planning
**Estimated Timeline:** 8-12 weeks

---

## Executive Summary

This plan outlines how to evolve the current swarm.press admin interface from a traditional CRUD system into a **graph-driven, agentic content orchestration platform**. The transformation will happen incrementally, maintaining backward compatibility while introducing powerful new capabilities.

**Key Goals:**
1. Introduce React Flow-based visual graph editing
2. Enhance sitemap with agent intelligence layers
3. Enable GitHub-backed content workflow
4. Build visual blueprint and content model editors
5. Create agent-native collaboration interfaces

---

## Current State Assessment

### What We Have Today

#### ✅ Solid Foundation
```
swarm.press/
├── PostgreSQL Database
│   ├── Companies (tenants)
│   ├── Departments, Roles, Agents
│   ├── Websites
│   ├── ContentItems (JSON block-based)
│   ├── Tasks
│   └── QuestionTickets
│
├── Backend (tRPC API)
│   ├── CRUD routers for all entities
│   ├── State machine validation
│   ├── Repository pattern
│   └── Event bus (NATS)
│
├── Admin App (Astro + React SSR)
│   ├── Table-based CRUD interfaces
│   ├── shadcn/ui components
│   ├── Type-safe tRPC integration
│   └── Navigation structure
│
└── Agents (Planned/Partial)
    ├── WriterAgent
    ├── EditorAgent
    ├── EngineeringAgent
    └── CEOAssistantAgent
```

#### ✅ Architectural Strengths
- **Type-safe API** with tRPC
- **Event-driven** architecture with NATS
- **State machine** validation for workflows
- **JSON block content** model (flexible, LLM-friendly)
- **Multi-tenant** structure (companies → websites)
- **Agent-aware** task system

#### ⚠️ Current Limitations
- No visual graph representation
- No sitemap concept (pages are flat ContentItems)
- No internal linking intelligence
- No page blueprint system
- No content model definitions
- No GitHub integration for content
- Limited agent collaboration features
- No SEO intelligence layer

---

## Architecture Evolution

### Phase-by-Phase Transformation

```
Current: PostgreSQL-Centric CRUD
    ↓
Phase 1: Hybrid (PostgreSQL + YAML)
    ↓
Phase 2: Graph Visualization Layer
    ↓
Phase 3: Agent-Native Features
    ↓
Final: Full Agentic Platform
```

---

## Detailed Implementation Plan

### Phase 0: Foundation & Setup (Week 1)

**Goal:** Prepare infrastructure for graph-based architecture

#### 0.1 Database Schema Enhancements

Add new tables to support graph concepts:

```sql
-- Sitemap pages (evolution of ContentItems for page-type content)
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES websites(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  page_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'draft', 'published', 'outdated', 'deprecated')),
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'critical')),

  -- Graph positioning
  parent_id UUID REFERENCES pages(id),
  order_index INTEGER,

  -- Blueprint binding
  blueprint_id UUID REFERENCES blueprints(id),
  content_model_id UUID REFERENCES content_models(id),

  -- SEO profile (JSONB)
  seo_profile JSONB DEFAULT '{}'::jsonb,

  -- Internal linking (JSONB)
  internal_links JSONB DEFAULT '{"outgoing": [], "incoming": []}'::jsonb,

  -- Agent collaboration (JSONB)
  owners JSONB DEFAULT '{}'::jsonb,
  tasks JSONB DEFAULT '[]'::jsonb,

  -- AI suggestions (JSONB)
  suggestions JSONB DEFAULT '[]'::jsonb,

  -- Analytics (JSONB)
  analytics JSONB DEFAULT '{}'::jsonb,
  alerts JSONB DEFAULT '[]'::jsonb,

  -- Multi-tenant (JSONB)
  translations JSONB DEFAULT '{}'::jsonb,
  tenants JSONB DEFAULT '{}'::jsonb,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(website_id, slug)
);

-- Blueprints (page templates)
CREATE TABLE blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT DEFAULT '1.0',

  -- Component structure (JSONB)
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  layout TEXT,

  -- Linking rules (JSONB)
  global_linking_rules JSONB DEFAULT '{}'::jsonb,

  -- Multi-tenant (JSONB)
  tenants JSONB DEFAULT '{}'::jsonb,

  -- Validation (JSONB)
  validation JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content Models (atomic design system)
CREATE TABLE content_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('atom', 'molecule', 'organism', 'template')),
  description TEXT,
  version TEXT DEFAULT '1.0',

  -- Fields definition (JSONB)
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Relations (JSONB)
  relations JSONB DEFAULT '[]'::jsonb,

  -- Computed fields (JSONB)
  computed_fields JSONB DEFAULT '[]'::jsonb,

  -- AI guidance (JSONB)
  ai_guidance JSONB DEFAULT '{}'::jsonb,

  -- Multi-tenant (JSONB)
  tenants JSONB DEFAULT '{}'::jsonb,

  -- Lifecycle (JSONB)
  lifecycle JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Graph positions (for React Flow)
CREATE TABLE graph_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES websites(id),
  node_id UUID NOT NULL, -- references pages.id
  node_type TEXT NOT NULL DEFAULT 'page',

  -- React Flow position
  position_x FLOAT NOT NULL DEFAULT 0,
  position_y FLOAT NOT NULL DEFAULT 0,

  -- Visual state
  collapsed BOOLEAN DEFAULT false,
  hidden BOOLEAN DEFAULT false,

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(website_id, node_id, node_type)
);

-- Create indexes
CREATE INDEX idx_pages_website ON pages(website_id);
CREATE INDEX idx_pages_parent ON pages(parent_id);
CREATE INDEX idx_pages_status ON pages(status);
CREATE INDEX idx_pages_blueprint ON pages(blueprint_id);
CREATE INDEX idx_graph_positions_website ON graph_positions(website_id);
```

#### 0.2 Shared Package Updates

Create new TypeScript types in `packages/shared`:

```typescript
// packages/shared/src/types/sitemap.ts

export interface SitemapPage {
  id: string
  website_id: string
  slug: string
  title: string
  page_type: string
  status: 'planned' | 'draft' | 'published' | 'outdated' | 'deprecated'
  priority?: 'low' | 'medium' | 'high' | 'critical'

  parent_id?: string
  order_index?: number

  blueprint_id?: string
  content_model_id?: string

  seo_profile: SEOProfile
  internal_links: InternalLinks
  owners: PageOwners
  tasks: PageTask[]
  suggestions: AISuggestion[]
  analytics: PageAnalytics
  alerts: PageAlert[]

  translations: Record<string, string>
  tenants: Record<string, TenantOverride>

  created_at: string
  updated_at: string
}

export interface SEOProfile {
  primary_keyword?: string
  secondary_keywords?: string[]
  intent?: 'informational' | 'transactional' | 'navigational' | 'local'
  search_volume?: number
  serp_competition?: 'low' | 'medium' | 'high'
  canonical?: string
  meta_description?: string
  freshness_score?: number // 0-100
  requires_update_after?: string // e.g., "90d"
}

export interface InternalLinks {
  outgoing: OutgoingLink[]
  incoming: IncomingLink[]
}

export interface OutgoingLink {
  to: string // target page slug
  anchor: string
  location?: string // component ID
  confidence?: number // AI confidence 0-1
}

export interface IncomingLink {
  from: string // source page slug
  anchor: string
}

export interface PageOwners {
  content?: string // agent ID
  seo?: string
  media?: string
  social?: string
}

export interface PageTask {
  type: string
  assigned_to: string
  status: 'open' | 'in-progress' | 'done'
  created_at: string
  due_at?: string
}

export interface AISuggestion {
  suggestion_type: 'new_page' | 'improve_content' | 'add_links' | 'update_blueprint'
  reason: string
  estimated_value: 'low' | 'medium' | 'high'
  proposed_slug?: string
  keywords?: string[]
}

export interface PageAnalytics {
  monthly_pageviews?: number
  bounce_rate?: number
  avg_read_time?: number
  last_traffic_update?: string
}

export interface PageAlert {
  type: 'traffic_increase' | 'traffic_drop' | 'serp_change' | 'anomaly'
  value?: number
  reason?: string
}

export interface TenantOverride {
  overrides?: any
  disabled_components?: string[]
}

// Blueprint types
export interface Blueprint {
  id: string
  page_type: string
  name: string
  description?: string
  version: string

  components: BlueprintComponent[]
  layout?: string

  global_linking_rules: LinkingRules
  tenants: Record<string, any>
  validation: ValidationConfig

  created_at: string
  updated_at: string
}

export interface BlueprintComponent {
  type: string
  variant?: string
  props?: Record<string, any>
  data_source?: string
  required_fields?: string[]
  optional_fields?: string[]
  show_if?: ConditionalRules
  linking_rules?: LinkingRules
  ai_hints?: AIHints
  tenant_overrides?: Record<string, any>
}

export interface LinkingRules {
  min_links?: number
  max_links?: number
  must_link_to_page_type?: string[]
  forbidden_slugs?: string[]
  min_total_links?: number
  max_total_links?: number
  must_link_to_topical_cluster?: boolean
  must_link_to_parent_section?: boolean
}

export interface AIHints {
  purpose?: string
  tone?: string
  include_keywords?: string[]
  avoid_phrases?: string[]
  word_count?: number
  structure?: string
}

export interface ConditionalRules {
  equals?: Record<string, any>
  not_equals?: Record<string, any>
  exists?: string[]
}

export interface ValidationConfig {
  schema_version?: string
  strict?: boolean
  allow_fallbacks?: boolean
}

// Content Model types
export interface ContentModel {
  id: string
  model_id: string
  name: string
  kind: 'atom' | 'molecule' | 'organism' | 'template'
  description?: string
  version: string

  fields: ModelField[]
  relations: ModelRelation[]
  computed_fields: ComputedField[]
  ai_guidance: AIGuidance
  tenants: Record<string, any>
  lifecycle: LifecycleConfig

  created_at: string
  updated_at: string
}

export interface ModelField {
  id: string
  label: string
  type: 'string' | 'text' | 'markdown' | 'number' | 'boolean' | 'date' | 'datetime' | 'image' | 'media' | 'reference' | 'list' | 'object'
  description?: string
  required?: boolean
  localized?: boolean
  unique?: boolean
  default?: any
  validations?: FieldValidations
  reference?: ReferenceConfig
  items?: any
  ai_hints?: AIHints
  ui?: UIConfig
}

export interface FieldValidations {
  min?: number
  max?: number
  min_length?: number
  max_length?: number
  regex?: string
  in?: any[]
  not_in?: any[]
  required_if?: Record<string, any>
}

export interface ReferenceConfig {
  model: string
  multiple?: boolean
  relation_type?: 'one-to-one' | 'one-to-many' | 'many-to-many'
}

export interface UIConfig {
  widget?: string
  group?: string
  order?: number
  help_text?: string
}

export interface ModelRelation {
  name: string
  target_model: string
  type: 'one-to-one' | 'one-to-many' | 'many-to-many'
  via_field?: string
}

export interface ComputedField {
  id: string
  label: string
  source: string
  type: string
  cached?: boolean
}

export interface AIGuidance {
  persona?: string
  tone?: string
  style?: string
  content_strategy?: string
  crosslink_strategy?: string
}

export interface LifecycleConfig {
  review_after_days?: number
  expire_after_days?: number
  archivable?: boolean
}

// Graph positioning
export interface GraphPosition {
  id: string
  website_id: string
  node_id: string
  node_type: string
  position_x: number
  position_y: number
  collapsed: boolean
  hidden: boolean
  updated_at: string
}
```

#### 0.3 Migration Scripts

Create migration to convert existing ContentItems to Pages:

```typescript
// packages/backend/src/migrations/004_convert_content_to_pages.ts

export async function migrateContentToPages(db: Database) {
  console.log('Migrating ContentItems to Pages...')

  // Get all article/page-type content
  const contentItems = await db.query(`
    SELECT * FROM content_items
    WHERE type IN ('article', 'page', 'guide')
  `)

  for (const item of contentItems.rows) {
    // Extract slug from metadata or generate from title
    const slug = item.metadata?.slug || generateSlug(item.title || 'untitled')

    // Determine page type
    const page_type = item.type || 'article'

    // Map content status to page status
    const status = mapContentStatusToPageStatus(item.status)

    // Insert as page
    await db.query(`
      INSERT INTO pages (
        id, website_id, slug, title, page_type, status,
        seo_profile, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (website_id, slug) DO NOTHING
    `, [
      item.id,
      item.website_id,
      slug,
      item.title || 'Untitled',
      page_type,
      status,
      JSON.stringify({
        primary_keyword: item.metadata?.primary_keyword,
        meta_description: item.metadata?.description
      }),
      item.created_at,
      item.updated_at
    ])
  }

  console.log(`Migrated ${contentItems.rows.length} content items to pages`)
}

function mapContentStatusToPageStatus(contentStatus: string): string {
  const mapping: Record<string, string> = {
    'idea': 'planned',
    'brief_created': 'planned',
    'draft': 'draft',
    'in_editorial_review': 'draft',
    'needs_changes': 'draft',
    'approved': 'published',
    'scheduled': 'published',
    'published': 'published',
    'archived': 'deprecated'
  }
  return mapping[contentStatus] || 'draft'
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}
```

**Deliverables:**
- ✅ Database migrations
- ✅ TypeScript types in shared package
- ✅ Migration script for existing data
- ✅ Update repositories to support new tables

---

### Phase 1: Backend API Layer (Week 2)

**Goal:** Create tRPC routers for sitemap, blueprints, and content models

#### 1.1 Sitemap Router

```typescript
// packages/backend/src/api/routers/sitemap.router.ts

export const sitemapRouter = router({
  // Get sitemap for a website
  getByWebsite: publicProcedure
    .input(z.object({ website_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const pages = await pageRepository.findByWebsite(input.website_id)
      const positions = await graphPositionRepository.findByWebsite(input.website_id)

      return {
        pages,
        positions,
        graph: buildGraphStructure(pages, positions)
      }
    }),

  // Create new page
  createPage: ceoProcedure
    .input(createPageSchema)
    .mutation(async ({ input }) => {
      const page = await pageRepository.create(input)
      await eventBus.publish('page.created', { page_id: page.id })
      return page
    }),

  // Update page
  updatePage: ceoProcedure
    .input(updatePageSchema)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input
      const page = await pageRepository.update(id, updates)
      await eventBus.publish('page.updated', { page_id: page.id })
      return page
    }),

  // Update graph positions (bulk)
  updatePositions: ceoProcedure
    .input(z.object({
      website_id: z.string().uuid(),
      positions: z.array(positionSchema)
    }))
    .mutation(async ({ input }) => {
      await graphPositionRepository.bulkUpdate(input.positions)
      return { success: true }
    }),

  // Update internal links
  updateInternalLinks: ceoProcedure
    .input(z.object({
      page_id: z.string().uuid(),
      outgoing: z.array(outgoingLinkSchema),
      incoming: z.array(incomingLinkSchema)
    }))
    .mutation(async ({ input }) => {
      const page = await pageRepository.updateLinks(input.page_id, {
        outgoing: input.outgoing,
        incoming: input.incoming
      })
      return page
    }),

  // AI: Suggest new pages
  suggestPages: publicProcedure
    .input(z.object({ website_id: z.string().uuid() }))
    .query(async ({ input }) => {
      // This would call an AI agent to analyze gaps
      const suggestions = await aiAgentService.suggestPages(input.website_id)
      return suggestions
    }),

  // AI: Suggest internal links
  suggestLinks: publicProcedure
    .input(z.object({ page_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const page = await pageRepository.findById(input.page_id)
      const suggestions = await aiAgentService.suggestInternalLinks(page)
      return suggestions
    })
})
```

#### 1.2 Blueprint Router

```typescript
// packages/backend/src/api/routers/blueprint.router.ts

export const blueprintRouter = router({
  // List all blueprints
  list: publicProcedure.query(async () => {
    return await blueprintRepository.findAll()
  }),

  // Get blueprint by ID
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return await blueprintRepository.findById(input.id)
    }),

  // Get blueprint by page type
  getByPageType: publicProcedure
    .input(z.object({ page_type: z.string() }))
    .query(async ({ input }) => {
      return await blueprintRepository.findByPageType(input.page_type)
    }),

  // Create blueprint
  create: ceoProcedure
    .input(createBlueprintSchema)
    .mutation(async ({ input }) => {
      const blueprint = await blueprintRepository.create(input)
      await eventBus.publish('blueprint.created', { blueprint_id: blueprint.id })
      return blueprint
    }),

  // Update blueprint
  update: ceoProcedure
    .input(updateBlueprintSchema)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input
      const blueprint = await blueprintRepository.update(id, updates)
      await eventBus.publish('blueprint.updated', { blueprint_id: blueprint.id })
      return blueprint
    }),

  // Validate page against blueprint
  validatePage: publicProcedure
    .input(z.object({
      page_id: z.string().uuid(),
      blueprint_id: z.string().uuid()
    }))
    .query(async ({ input }) => {
      const page = await pageRepository.findById(input.page_id)
      const blueprint = await blueprintRepository.findById(input.blueprint_id)
      return validatePageAgainstBlueprint(page, blueprint)
    })
})
```

#### 1.3 Content Model Router

```typescript
// packages/backend/src/api/routers/content-model.router.ts

export const contentModelRouter = router({
  // List all models
  list: publicProcedure.query(async () => {
    return await contentModelRepository.findAll()
  }),

  // Get model by ID
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return await contentModelRepository.findById(input.id)
    }),

  // Get model by model_id
  getByModelId: publicProcedure
    .input(z.object({ model_id: z.string() }))
    .query(async ({ input }) => {
      return await contentModelRepository.findByModelId(input.model_id)
    }),

  // Create model
  create: ceoProcedure
    .input(createContentModelSchema)
    .mutation(async ({ input }) => {
      const model = await contentModelRepository.create(input)
      await eventBus.publish('content_model.created', { model_id: model.id })
      return model
    }),

  // Update model
  update: ceoProcedure
    .input(updateContentModelSchema)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input
      const model = await contentModelRepository.update(id, updates)
      await eventBus.publish('content_model.updated', { model_id: model.id })
      return model
    }),

  // Get graph of model relationships
  getRelationshipGraph: publicProcedure.query(async () => {
    const models = await contentModelRepository.findAll()
    return buildModelRelationshipGraph(models)
  })
})
```

**Deliverables:**
- ✅ Sitemap router with CRUD + AI features
- ✅ Blueprint router
- ✅ Content model router
- ✅ Repositories for new tables
- ✅ Validation utilities
- ✅ Export routers in main app router

---

### Phase 2: React Flow Graph Foundation (Weeks 3-4)

**Goal:** Build the visual graph editing interface

#### 2.1 Install Dependencies

```bash
cd apps/admin
pnpm add reactflow zustand @xyflow/react
pnpm add -D @types/react-flow
```

#### 2.2 Zustand Store for Graph State

```typescript
// apps/admin/src/stores/graph-store.ts

import { create } from 'zustand'
import { Node, Edge } from 'reactflow'

interface GraphState {
  // Active graph type
  activeGraph: 'sitemap' | 'blueprint' | 'models'
  setActiveGraph: (graph: GraphState['activeGraph']) => void

  // Sitemap graph
  sitemapNodes: Node[]
  sitemapEdges: Edge[]
  setSitemapGraph: (nodes: Node[], edges: Edge[]) => void
  updateSitemapNode: (nodeId: string, data: any) => void

  // Blueprint graph
  blueprintNodes: Node[]
  blueprintEdges: Edge[]
  setBlueprintGraph: (nodes: Node[], edges: Edge[]) => void

  // Models graph
  modelsNodes: Node[]
  modelsEdges: Edge[]
  setModelsGraph: (nodes: Node[], edges: Edge[]) => void

  // Selected node
  selectedNode: Node | null
  setSelectedNode: (node: Node | null) => void

  // UI state
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void

  // Filters
  filters: {
    status?: string[]
    pageType?: string[]
    priority?: string[]
  }
  setFilters: (filters: GraphState['filters']) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  activeGraph: 'sitemap',
  setActiveGraph: (graph) => set({ activeGraph: graph }),

  sitemapNodes: [],
  sitemapEdges: [],
  setSitemapGraph: (nodes, edges) => set({ sitemapNodes: nodes, sitemapEdges: edges }),
  updateSitemapNode: (nodeId, data) => set((state) => ({
    sitemapNodes: state.sitemapNodes.map(node =>
      node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
    )
  })),

  blueprintNodes: [],
  blueprintEdges: [],
  setBlueprintGraph: (nodes, edges) => set({ blueprintNodes: nodes, blueprintEdges: edges }),

  modelsNodes: [],
  modelsEdges: [],
  setModelsGraph: (nodes, edges) => set({ modelsNodes: nodes, modelsEdges: edges }),

  selectedNode: null,
  setSelectedNode: (node) => set({ selectedNode: node }),

  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  filters: {},
  setFilters: (filters) => set({ filters })
}))
```

#### 2.3 Custom React Flow Nodes

```typescript
// apps/admin/src/components/graph/SitemapNode.tsx

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import type { SitemapPage } from '@swarm-press/shared'

interface SitemapNodeData {
  page: SitemapPage
}

export const SitemapNode = memo(({ data }: { data: SitemapNodeData }) => {
  const { page } = data

  const statusColor = {
    planned: 'bg-gray-500',
    draft: 'bg-yellow-500',
    published: 'bg-green-500',
    outdated: 'bg-orange-500',
    deprecated: 'bg-red-500'
  }[page.status]

  const priorityIcon = {
    low: '○',
    medium: '◐',
    high: '●',
    critical: '⚠️'
  }[page.priority || 'medium']

  return (
    <Card className="min-w-[200px] p-3 shadow-md hover:shadow-lg transition-shadow">
      <Handle type="target" position={Position.Top} />

      <div className="space-y-2">
        {/* Status indicator */}
        <div className="flex items-center justify-between">
          <Badge className={statusColor}>
            {page.status}
          </Badge>
          <span className="text-lg">{priorityIcon}</span>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-sm">{page.title}</h3>

        {/* Slug */}
        <code className="text-xs text-muted-foreground block truncate">
          {page.slug}
        </code>

        {/* Metrics */}
        <div className="flex gap-2 text-xs">
          {page.seo_profile.freshness_score && (
            <Badge variant="outline">
              Fresh: {page.seo_profile.freshness_score}%
            </Badge>
          )}
          {page.analytics.monthly_pageviews && (
            <Badge variant="outline">
              {(page.analytics.monthly_pageviews / 1000).toFixed(1)}k views
            </Badge>
          )}
        </div>

        {/* Tasks count */}
        {page.tasks.length > 0 && (
          <Badge variant="secondary">
            {page.tasks.length} tasks
          </Badge>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} />
    </Card>
  )
})

SitemapNode.displayName = 'SitemapNode'
```

#### 2.4 Main Graph Component

```typescript
// apps/admin/src/components/graph/SitemapGraph.tsx

import { useCallback, useEffect } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Panel
} from 'reactflow'
import 'reactflow/dist/style.css'

import { SitemapNode } from './SitemapNode'
import { useGraphStore } from '../../stores/graph-store'
import { trpc } from '../../lib/trpc'

const nodeTypes = {
  sitemap: SitemapNode
}

interface SitemapGraphProps {
  websiteId: string
}

export function SitemapGraph({ websiteId }: SitemapGraphProps) {
  const { sitemapNodes, sitemapEdges, setSitemapGraph, setSelectedNode } = useGraphStore()

  const [nodes, setNodes, onNodesChange] = useNodesState(sitemapNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(sitemapEdges)

  // Fetch sitemap data
  const { data: sitemapData } = trpc.sitemap.getByWebsite.useQuery({ website_id: websiteId })

  useEffect(() => {
    if (sitemapData) {
      const graphNodes = sitemapData.pages.map(page => {
        const position = sitemapData.positions.find(p => p.node_id === page.id)

        return {
          id: page.id,
          type: 'sitemap',
          position: {
            x: position?.position_x || 0,
            y: position?.position_y || 0
          },
          data: { page }
        }
      })

      // Build edges from parent relationships
      const graphEdges = sitemapData.pages
        .filter(page => page.parent_id)
        .map(page => ({
          id: `${page.parent_id}-${page.id}`,
          source: page.parent_id!,
          target: page.id,
          type: 'smoothstep'
        }))

      setNodes(graphNodes)
      setEdges(graphEdges)
      setSitemapGraph(graphNodes, graphEdges)
    }
  }, [sitemapData, setNodes, setEdges, setSitemapGraph])

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  )

  const onNodeClick = useCallback((event: any, node: any) => {
    setSelectedNode(node)
  }, [setSelectedNode])

  // Save positions when dragging stops
  const updatePositions = trpc.sitemap.updatePositions.useMutation()

  const onNodeDragStop = useCallback((event: any, node: any) => {
    const positions = nodes.map(n => ({
      website_id: websiteId,
      node_id: n.id,
      node_type: 'page',
      position_x: n.position.x,
      position_y: n.position.y
    }))

    updatePositions.mutate({ website_id: websiteId, positions })
  }, [nodes, websiteId, updatePositions])

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />

        <Panel position="top-left">
          <div className="bg-white p-2 rounded shadow-md">
            <h2 className="font-semibold">Sitemap Graph</h2>
            <p className="text-xs text-muted-foreground">
              {nodes.length} pages
            </p>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
```

#### 2.5 Main Graph Page

```typescript
// apps/admin/src/pages/graph/index.astro

---
import Layout from '../../layouts/Layout.astro'
import { trpc } from '../../lib/trpc'

// Get websites for selector
const websites = await trpc.website.list.query()
const defaultWebsite = websites.items[0]
---

<Layout title="Graph Editor">
  <div class="h-screen flex flex-col">
    <div class="border-b p-4 flex items-center justify-between">
      <h1 class="text-2xl font-bold">Graph Editor</h1>

      <!-- Website selector -->
      <select id="website-selector" class="border rounded px-3 py-2">
        {websites.items.map(site => (
          <option value={site.id} selected={site.id === defaultWebsite?.id}>
            {site.title}
          </option>
        ))}
      </select>

      <!-- View toggle -->
      <div class="flex gap-2">
        <button class="px-3 py-2 bg-blue-500 text-white rounded" data-view="sitemap">
          Sitemap
        </button>
        <button class="px-3 py-2 bg-gray-200 rounded" data-view="blueprints">
          Blueprints
        </button>
        <button class="px-3 py-2 bg-gray-200 rounded" data-view="models">
          Models
        </button>
      </div>
    </div>

    <div class="flex-1 flex">
      <!-- Graph canvas -->
      <div class="flex-1">
        <div id="graph-container" class="w-full h-full" />
      </div>

      <!-- Sidebar -->
      <aside class="w-80 border-l p-4 overflow-y-auto">
        <div id="node-details">
          <p class="text-muted-foreground text-sm">
            Select a node to view details
          </p>
        </div>
      </aside>
    </div>
  </div>

  <script>
    import { SitemapGraph } from '../../components/graph/SitemapGraph'
    import { createRoot } from 'react-dom/client'

    const container = document.getElementById('graph-container')
    const root = createRoot(container!)

    const websiteSelector = document.getElementById('website-selector') as HTMLSelectElement
    const websiteId = websiteSelector.value

    root.render(<SitemapGraph websiteId={websiteId} />)

    // Handle website change
    websiteSelector.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement
      root.render(<SitemapGraph websiteId={target.value} />)
    })
  </script>
</Layout>
```

**Deliverables:**
- ✅ React Flow integration
- ✅ Zustand store for graph state
- ✅ Custom sitemap node component
- ✅ Main graph page with controls
- ✅ Position persistence
- ✅ Node selection and sidebar

---

### Phase 3: Node Details & Editing (Week 5)

**Goal:** Enable editing page properties from the graph

#### 3.1 Node Details Sidebar

```typescript
// apps/admin/src/components/graph/NodeDetailsSidebar.tsx

import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Label } from '../ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { useGraphStore } from '../../stores/graph-store'
import { trpc } from '../../lib/trpc'
import type { SitemapPage } from '@swarm-press/shared'

export function NodeDetailsSidebar() {
  const { selectedNode } = useGraphStore()

  if (!selectedNode) {
    return (
      <div className="text-muted-foreground text-sm">
        Select a node to view details
      </div>
    )
  }

  const page: SitemapPage = selectedNode.data.page
  const updatePage = trpc.sitemap.updatePage.useMutation()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{page.title}</h2>
        <code className="text-xs text-muted-foreground">{page.slug}</code>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input
              defaultValue={page.title}
              onBlur={(e) => updatePage.mutate({
                id: page.id,
                title: e.target.value
              })}
            />
          </div>

          <div>
            <Label>Status</Label>
            <select
              className="w-full border rounded px-3 py-2"
              defaultValue={page.status}
              onChange={(e) => updatePage.mutate({
                id: page.id,
                status: e.target.value as any
              })}
            >
              <option value="planned">Planned</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="outdated">Outdated</option>
              <option value="deprecated">Deprecated</option>
            </select>
          </div>

          <div>
            <Label>Priority</Label>
            <select
              className="w-full border rounded px-3 py-2"
              defaultValue={page.priority || 'medium'}
              onChange={(e) => updatePage.mutate({
                id: page.id,
                priority: e.target.value as any
              })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div>
            <Label>Page Type</Label>
            <Input defaultValue={page.page_type} disabled />
          </div>
        </TabsContent>

        <TabsContent value="seo" className="space-y-4">
          <div>
            <Label>Primary Keyword</Label>
            <Input
              defaultValue={page.seo_profile.primary_keyword}
              placeholder="main keyword phrase"
              onBlur={(e) => updatePage.mutate({
                id: page.id,
                seo_profile: {
                  ...page.seo_profile,
                  primary_keyword: e.target.value
                }
              })}
            />
          </div>

          <div>
            <Label>Meta Description</Label>
            <Textarea
              defaultValue={page.seo_profile.meta_description}
              rows={3}
              onBlur={(e) => updatePage.mutate({
                id: page.id,
                seo_profile: {
                  ...page.seo_profile,
                  meta_description: e.target.value
                }
              })}
            />
          </div>

          <div>
            <Label>Freshness Score</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{ width: `${page.seo_profile.freshness_score || 0}%` }}
                />
              </div>
              <span className="text-sm font-semibold">
                {page.seo_profile.freshness_score || 0}%
              </span>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="links" className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Outgoing Links ({page.internal_links.outgoing.length})</h3>
            <div className="space-y-2">
              {page.internal_links.outgoing.map((link, i) => (
                <div key={i} className="p-2 border rounded">
                  <div className="font-mono text-xs">{link.to}</div>
                  <div className="text-sm text-muted-foreground">{link.anchor}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Incoming Links ({page.internal_links.incoming.length})</h3>
            <div className="space-y-2">
              {page.internal_links.incoming.map((link, i) => (
                <div key={i} className="p-2 border rounded">
                  <div className="font-mono text-xs">{link.from}</div>
                  <div className="text-sm text-muted-foreground">{link.anchor}</div>
                </div>
              ))}
            </div>
          </div>

          <Button variant="outline" className="w-full">
            🤖 Suggest Internal Links
          </Button>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <div className="space-y-2">
            {page.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks</p>
            ) : (
              page.tasks.map((task, i) => (
                <div key={i} className="p-3 border rounded">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">{task.type}</span>
                    <Badge>{task.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Assigned to: {task.assigned_to}
                  </div>
                </div>
              ))
            )}
          </div>

          <Button variant="outline" className="w-full">
            + Add Task
          </Button>
        </TabsContent>
      </Tabs>

      <div className="pt-4 border-t space-y-2">
        <Button className="w-full">
          Edit Full Page
        </Button>
        <Button variant="outline" className="w-full">
          View on Website →
        </Button>
      </div>
    </div>
  )
}
```

**Deliverables:**
- ✅ Tabbed sidebar with page details
- ✅ Inline editing of key properties
- ✅ SEO profile display and editing
- ✅ Internal links visualization
- ✅ Tasks list
- ✅ Quick actions

---

### Phase 4: GitHub Integration (Weeks 6-7)

**Goal:** Enable YAML-based content workflow with GitHub

#### 4.1 YAML Export/Import

```typescript
// packages/backend/src/services/sitemap-yaml.service.ts

import * as yaml from 'js-yaml'
import type { SitemapPage } from '@swarm-press/shared'

export class SitemapYAMLService {
  /**
   * Export sitemap to YAML format
   */
  async exportToYAML(websiteId: string): Promise<string> {
    const pages = await pageRepository.findByWebsite(websiteId)

    const sitemapData = pages.map(page => ({
      slug: page.slug,
      title: page.title,
      status: page.status,
      page_type: page.page_type,
      priority: page.priority,
      topics: page.topics,

      internal_links: page.internal_links,
      seo_profile: page.seo_profile,
      owners: page.owners,
      tasks: page.tasks,
      suggestions: page.suggestions,
      analytics: page.analytics,

      translations: page.translations,
      tenants: page.tenants,

      created_at: page.created_at,
      updated_at: page.updated_at
    }))

    return yaml.dump(sitemapData, {
      indent: 2,
      lineWidth: 120,
      noRefs: true
    })
  }

  /**
   * Import sitemap from YAML
   */
  async importFromYAML(websiteId: string, yamlContent: string): Promise<void> {
    const sitemapData = yaml.load(yamlContent) as any[]

    for (const pageData of sitemapData) {
      // Check if page exists
      const existing = await pageRepository.findBySlug(websiteId, pageData.slug)

      if (existing) {
        // Update existing page
        await pageRepository.update(existing.id, pageData)
      } else {
        // Create new page
        await pageRepository.create({
          ...pageData,
          website_id: websiteId
        })
      }
    }
  }

  /**
   * Generate YAML for a single page
   */
  pageToYAML(page: SitemapPage): string {
    return yaml.dump({
      slug: page.slug,
      title: page.title,
      status: page.status,
      page_type: page.page_type,
      priority: page.priority,

      internal_links: page.internal_links,
      seo_profile: page.seo_profile,
      owners: page.owners,
      tasks: page.tasks
    }, {
      indent: 2,
      lineWidth: 120,
      noRefs: true
    })
  }
}

export const sitemapYAMLService = new SitemapYAMLService()
```

#### 4.2 GitHub Service

```typescript
// packages/backend/src/services/github.service.ts

import { Octokit } from '@octokit/rest'
import type { Website } from '@swarm-press/shared'

export class GitHubService {
  private octokit: Octokit

  constructor() {
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    })
  }

  /**
   * Create a PR with sitemap changes
   */
  async createSitemapPR(website: Website, yamlContent: string): Promise<string> {
    const [owner, repo] = this.parseGitHubUrl(website.github_repo_url!)

    // Create a new branch
    const branchName = `sitemap-update-${Date.now()}`
    const mainBranch = await this.getDefaultBranch(owner, repo)
    await this.createBranch(owner, repo, branchName, mainBranch)

    // Commit the YAML file
    await this.commitFile(
      owner,
      repo,
      branchName,
      'sitemap.yaml',
      yamlContent,
      'Update sitemap via swarm.press admin'
    )

    // Create PR
    const pr = await this.octokit.pulls.create({
      owner,
      repo,
      title: '🗺️ Update sitemap',
      head: branchName,
      base: mainBranch,
      body: `
## Sitemap Update

This PR updates the sitemap structure.

**Generated by:** swarm.press Admin
**Date:** ${new Date().toISOString()}

### Changes
- Updated page hierarchy
- Modified SEO profiles
- Adjusted internal linking

---
🤖 Generated with [swarm.press](https://swarm.press)
      `.trim()
    })

    return pr.data.html_url
  }

  /**
   * Sync sitemap from GitHub
   */
  async fetchSitemap(website: Website): Promise<string | null> {
    const [owner, repo] = this.parseGitHubUrl(website.github_repo_url!)

    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: 'sitemap.yaml'
      })

      if ('content' in data) {
        return Buffer.from(data.content, 'base64').toString('utf-8')
      }
    } catch (error) {
      return null
    }

    return null
  }

  private parseGitHubUrl(url: string): [string, string] {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)/)
    if (!match) throw new Error('Invalid GitHub URL')
    return [match[1], match[2]]
  }

  private async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const { data } = await this.octokit.repos.get({ owner, repo })
    return data.default_branch
  }

  private async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    baseBranch: string
  ): Promise<void> {
    const { data: ref } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`
    })

    await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha
    })
  }

  private async commitFile(
    owner: string,
    repo: string,
    branch: string,
    path: string,
    content: string,
    message: string
  ): Promise<void> {
    // Get current file SHA if it exists
    let sha: string | undefined
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch
      })
      if ('sha' in data) {
        sha = data.sha
      }
    } catch (error) {
      // File doesn't exist
    }

    await this.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      sha
    })
  }
}

export const githubService = new GitHubService()
```

#### 4.3 GitHub Sync Router

```typescript
// packages/backend/src/api/routers/github.router.ts

export const githubRouter = router({
  // Export sitemap to GitHub PR
  exportSitemap: ceoProcedure
    .input(z.object({ website_id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const website = await websiteRepository.findById(input.website_id)
      if (!website || !website.github_repo_url) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Website does not have a GitHub repository configured'
        })
      }

      // Export to YAML
      const yamlContent = await sitemapYAMLService.exportToYAML(input.website_id)

      // Create PR
      const prUrl = await githubService.createSitemapPR(website, yamlContent)

      return { pr_url: prUrl }
    }),

  // Import sitemap from GitHub
  importSitemap: ceoProcedure
    .input(z.object({ website_id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const website = await websiteRepository.findById(input.website_id)
      if (!website || !website.github_repo_url) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Website does not have a GitHub repository configured'
        })
      }

      // Fetch from GitHub
      const yamlContent = await githubService.fetchSitemap(website)
      if (!yamlContent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'sitemap.yaml not found in repository'
        })
      }

      // Import
      await sitemapYAMLService.importFromYAML(input.website_id, yamlContent)

      return { success: true }
    }),

  // Preview YAML for a website
  previewYAML: publicProcedure
    .input(z.object({ website_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const yamlContent = await sitemapYAMLService.exportToYAML(input.website_id)
      return { yaml: yamlContent }
    })
})
```

**Deliverables:**
- ✅ YAML export/import service
- ✅ GitHub integration service
- ✅ GitHub router for sync operations
- ✅ UI buttons for "Export to GitHub" and "Import from GitHub"
- ✅ YAML preview modal

---

### Phase 5: Blueprint Visual Editor (Week 8)

**Goal:** Build visual blueprint editor with component drag-and-drop

#### 5.1 Blueprint Graph Component

```typescript
// apps/admin/src/components/graph/BlueprintGraph.tsx

import { useCallback } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Panel,
  useNodesState,
  useEdgesState
} from 'reactflow'

import { ComponentNode } from './ComponentNode'
import type { Blueprint } from '@swarm-press/shared'

const nodeTypes = {
  component: ComponentNode
}

interface BlueprintGraphProps {
  blueprint: Blueprint
  onUpdate: (blueprint: Blueprint) => void
}

export function BlueprintGraph({ blueprint, onUpdate }: BlueprintGraphProps) {
  // Convert blueprint components to React Flow nodes
  const initialNodes = blueprint.components.map((comp, index) => ({
    id: `${comp.type}-${index}`,
    type: 'component',
    position: { x: 100, y: index * 120 },
    data: { component: comp }
  }))

  // Create edges showing component order
  const initialEdges = blueprint.components.slice(0, -1).map((_, index) => ({
    id: `edge-${index}`,
    source: `${blueprint.components[index].type}-${index}`,
    target: `${blueprint.components[index + 1].type}-${index + 1}`,
    type: 'smoothstep',
    animated: true
  }))

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />

        <Panel position="top-left">
          <div className="bg-white p-2 rounded shadow-md">
            <h3 className="font-semibold">{blueprint.name}</h3>
            <p className="text-xs text-muted-foreground">
              {blueprint.page_type}
            </p>
          </div>
        </Panel>

        <Panel position="top-right">
          <div className="bg-white p-2 rounded shadow-md">
            <button className="text-sm font-semibold text-blue-600">
              + Add Component
            </button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
```

**Deliverables:**
- ✅ Blueprint graph visualization
- ✅ Component node representation
- ✅ Drag-and-drop component ordering
- ✅ Component library panel
- ✅ Props editor
- ✅ Blueprint save/publish

---

### Phase 6: AI Agent Integration (Weeks 9-10)

**Goal:** Enable agents to work with the graph

#### 6.1 Agent MCP Server Tools

Create MCP tools for agents to interact with the sitemap:

```typescript
// packages/agents/src/tools/sitemap-tools.ts

export const sitemapTools = {
  /**
   * Get current sitemap for a website
   */
  get_sitemap: {
    description: 'Get the current sitemap structure for a website',
    parameters: {
      website_id: { type: 'string', description: 'Website ID' }
    },
    handler: async ({ website_id }: { website_id: string }) => {
      const pages = await pageRepository.findByWebsite(website_id)
      return { pages }
    }
  },

  /**
   * Suggest new pages based on gaps
   */
  suggest_pages: {
    description: 'Analyze sitemap and suggest new pages to create',
    parameters: {
      website_id: { type: 'string', description: 'Website ID' }
    },
    handler: async ({ website_id }: { website_id: string }) => {
      // AI analyzes existing pages and suggests gaps
      const pages = await pageRepository.findByWebsite(website_id)

      // Example logic (would use actual AI)
      const suggestions = [
        {
          proposed_slug: '/complete-guide/',
          reason: 'Hub page missing for topical cluster',
          keywords: ['comprehensive guide', 'complete information'],
          estimated_value: 'high'
        }
      ]

      return { suggestions }
    }
  },

  /**
   * Suggest internal links for a page
   */
  suggest_internal_links: {
    description: 'Suggest relevant internal links for a page',
    parameters: {
      page_id: { type: 'string', description: 'Page ID' }
    },
    handler: async ({ page_id }: { page_id: string }) => {
      const page = await pageRepository.findById(page_id)
      const allPages = await pageRepository.findByWebsite(page.website_id)

      // AI determines relevant pages to link to
      const suggestions = allPages
        .filter(p => p.id !== page_id)
        .slice(0, 5)
        .map(p => ({
          to: p.slug,
          anchor: p.title,
          confidence: 0.8
        }))

      return { suggestions }
    }
  },

  /**
   * Update page SEO profile
   */
  update_seo_profile: {
    description: 'Update the SEO profile for a page',
    parameters: {
      page_id: { type: 'string' },
      seo_profile: { type: 'object' }
    },
    handler: async ({ page_id, seo_profile }: any) => {
      const page = await pageRepository.update(page_id, {
        seo_profile
      })
      return { success: true, page }
    }
  },

  /**
   * Calculate freshness score
   */
  calculate_freshness: {
    description: 'Calculate content freshness score for a page',
    parameters: {
      page_id: { type: 'string' }
    },
    handler: async ({ page_id }: { page_id: string }) => {
      const page = await pageRepository.findById(page_id)

      // Calculate based on last update, traffic trends, etc.
      const daysSinceUpdate = Math.floor(
        (Date.now() - new Date(page.updated_at).getTime()) / (1000 * 60 * 60 * 24)
      )

      const freshness_score = Math.max(0, 100 - (daysSinceUpdate * 0.5))

      await pageRepository.update(page_id, {
        seo_profile: {
          ...page.seo_profile,
          freshness_score
        }
      })

      return { freshness_score }
    }
  }
}
```

#### 6.2 Scheduled Agent Tasks

```typescript
// packages/backend/src/services/agent-scheduler.service.ts

import { CronJob } from 'cron'
import { agentService } from './agent.service'

export class AgentSchedulerService {
  private jobs: CronJob[] = []

  start() {
    // Daily freshness scan
    this.jobs.push(new CronJob('0 2 * * *', async () => {
      console.log('[AgentScheduler] Running daily freshness scan...')
      await agentService.invoke('SEOAgent', 'calculate_all_freshness_scores', {})
    }))

    // Weekly content gap analysis
    this.jobs.push(new CronJob('0 3 * * 0', async () => {
      console.log('[AgentScheduler] Running weekly content gap analysis...')
      const websites = await websiteRepository.findAll()

      for (const website of websites) {
        await agentService.invoke('ContentPlannerAgent', 'analyze_gaps', {
          website_id: website.id
        })
      }
    }))

    // Hourly link audit
    this.jobs.push(new CronJob('0 * * * *', async () => {
      console.log('[AgentScheduler] Running link audit...')
      await agentService.invoke('SEOAgent', 'audit_internal_links', {})
    }))

    this.jobs.forEach(job => job.start())
  }

  stop() {
    this.jobs.forEach(job => job.stop())
  }
}

export const agentSchedulerService = new AgentSchedulerService()
```

**Deliverables:**
- ✅ MCP tools for sitemap interaction
- ✅ Agent scheduler for automated tasks
- ✅ Freshness score calculation
- ✅ Content gap analysis
- ✅ Internal link suggestions
- ✅ Display agent suggestions in UI

---

### Phase 7: Analytics & Intelligence (Week 11)

**Goal:** Add analytics feedback loop and traffic visualization

#### 7.1 Analytics Integration

```typescript
// packages/backend/src/services/analytics.service.ts

export class AnalyticsService {
  /**
   * Update page analytics from external source
   */
  async updatePageAnalytics(pageId: string, data: {
    monthly_pageviews: number
    bounce_rate: number
    avg_read_time: number
  }) {
    const page = await pageRepository.update(pageId, {
      analytics: {
        ...data,
        last_traffic_update: new Date().toISOString()
      }
    })

    // Check for anomalies
    await this.detectAnomalies(page)

    return page
  }

  /**
   * Detect traffic anomalies
   */
  private async detectAnomalies(page: SitemapPage) {
    // Get historical data (simplified)
    const previousViews = page.analytics.monthly_pageviews || 0
    const currentViews = page.analytics.monthly_pageviews || 0

    if (currentViews === 0) return

    const percentChange = ((currentViews - previousViews) / previousViews) * 100

    const alerts: PageAlert[] = []

    if (percentChange > 50) {
      alerts.push({
        type: 'traffic_increase',
        value: percentChange,
        reason: 'Possible viral content or new backlink'
      })
    } else if (percentChange < -30) {
      alerts.push({
        type: 'traffic_drop',
        value: percentChange,
        reason: 'Possible SERP position drop or seasonal'
      })
    }

    if (alerts.length > 0) {
      await pageRepository.update(page.id, { alerts })

      // Create task for agent to investigate
      await taskRepository.create({
        type: 'investigate_traffic_anomaly',
        status: 'planned',
        agent_id: null,
        content_id: page.id,
        payload: { alerts }
      })
    }
  }
}

export const analyticsService = new AnalyticsService()
```

#### 7.2 Traffic Heatmap Overlay

```typescript
// apps/admin/src/components/graph/TrafficHeatmap.tsx

import { useMemo } from 'react'
import { useGraphStore } from '../../stores/graph-store'

export function TrafficHeatmap() {
  const { sitemapNodes } = useGraphStore()

  const maxPageviews = useMemo(() => {
    return Math.max(...sitemapNodes.map(n => n.data.page.analytics.monthly_pageviews || 0))
  }, [sitemapNodes])

  return (
    <div className="absolute top-4 right-4 bg-white p-4 rounded shadow-md">
      <h3 className="font-semibold mb-2">Traffic Heatmap</h3>

      <div className="flex items-center gap-2 text-xs">
        <div className="w-4 h-4 bg-blue-100" />
        <span>Low</span>

        <div className="w-4 h-4 bg-blue-300" />
        <span>Medium</span>

        <div className="w-4 h-4 bg-blue-600" />
        <span>High</span>
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        Max: {maxPageviews.toLocaleString()} views/month
      </p>
    </div>
  )
}

// Update SitemapNode to show traffic color
function getTrafficColor(pageviews: number, maxPageviews: number): string {
  const ratio = pageviews / maxPageviews
  if (ratio > 0.7) return 'bg-blue-600'
  if (ratio > 0.4) return 'bg-blue-400'
  if (ratio > 0.1) return 'bg-blue-200'
  return 'bg-blue-50'
}
```

**Deliverables:**
- ✅ Analytics service with anomaly detection
- ✅ Traffic heatmap overlay on graph
- ✅ Alert system for anomalies
- ✅ Automated task creation for agents

---

### Phase 8: Polish & Production (Week 12)

**Goal:** Production-ready features and documentation

#### 8.1 Command Palette

```typescript
// apps/admin/src/components/CommandPalette.tsx

import { Command } from 'cmdk'
import { useState, useEffect } from 'react'
import { Dialog, DialogContent } from './ui/dialog'

export function CommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0">
        <Command className="rounded-lg border shadow-md">
          <Command.Input placeholder="Type a command or search..." />
          <Command.List>
            <Command.Empty>No results found.</Command.Empty>

            <Command.Group heading="Pages">
              <Command.Item>Create new page</Command.Item>
              <Command.Item>Search pages</Command.Item>
            </Command.Group>

            <Command.Group heading="AI Actions">
              <Command.Item>🤖 Suggest new pages</Command.Item>
              <Command.Item>🔗 Generate internal links</Command.Item>
              <Command.Item>📊 Analyze content gaps</Command.Item>
              <Command.Item>🎯 Optimize SEO profiles</Command.Item>
            </Command.Group>

            <Command.Group heading="Layout">
              <Command.Item>Auto-organize graph</Command.Item>
              <Command.Item>Reset zoom</Command.Item>
              <Command.Item>Toggle minimap</Command.Item>
            </Command.Group>

            <Command.Group heading="GitHub">
              <Command.Item>Export sitemap to PR</Command.Item>
              <Command.Item>Import from GitHub</Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
```

#### 8.2 Auto-Layout Algorithm

```typescript
// apps/admin/src/lib/auto-layout.ts

import { Node, Edge } from 'reactflow'
import dagre from 'dagre'

export function autoLayoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 150 })

  // Add nodes to dagre
  nodes.forEach(node => {
    dagreGraph.setNode(node.id, { width: 200, height: 100 })
  })

  // Add edges to dagre
  edges.forEach(edge => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  // Calculate layout
  dagre.layout(dagreGraph)

  // Update node positions
  return nodes.map(node => {
    const position = dagreGraph.node(node.id)
    return {
      ...node,
      position: {
        x: position.x - 100,
        y: position.y - 50
      }
    }
  })
}
```

#### 8.3 Documentation

Create comprehensive docs:

```markdown
# Agentic Sitemap Editor - User Guide

## Getting Started

### Creating Your First Page

1. Open the Graph Editor
2. Click "+" or use `Cmd+K` → "Create new page"
3. Fill in:
   - Slug (URL path)
   - Title
   - Page Type (selects blueprint)
   - Priority
4. Save

### Organizing Your Sitemap

**Drag and Drop:**
- Drag pages to reposition
- Connect parent → child relationships
- Auto-layout: `Cmd+K` → "Auto-organize graph"

**Filters:**
- Filter by status, priority, page type
- Show/hide completed pages
- Highlight orphan pages

### Working with Internal Links

**View Links:**
- Click any page node
- Navigate to "Links" tab
- See incoming/outgoing links

**AI Suggestions:**
- Click "Suggest Internal Links"
- Review AI recommendations
- Accept/reject suggestions

### SEO Intelligence

**Freshness Score:**
- Shows how up-to-date content is (0-100%)
- Calculated based on last update + traffic trends
- Agents auto-flag pages < 70% for review

**Keyword Tracking:**
- Set primary/secondary keywords
- Track SERP positions
- Monitor search volume

### GitHub Workflow

**Export to PR:**
1. Make changes in graph editor
2. Click "Export to GitHub"
3. Review generated PR
4. Merge when ready

**Import from GitHub:**
1. Agents commit YAML changes
2. Click "Import from GitHub"
3. Review diff in UI
4. Accept changes

### Agent Collaboration

**Task Assignment:**
- Agents create tasks on pages
- Tasks show in node badges
- Click to see task details

**Ownership:**
- Assign content/SEO/media owners
- Agents respect ownership boundaries
- PR approvals route to owners

## Advanced Features

### Blueprint System

Create page templates that define:
- Component order
- Required fields
- Linking rules
- AI hints

### Content Models

Define structured content with:
- Field types and validation
- Relationships between models
- Computed fields
- AI guidance

### Multi-Tenant

- Override components per tenant
- Locale-specific content
- Shared vs. tenant pages

## Keyboard Shortcuts

- `Cmd+K` - Command palette
- `Cmd+N` - New page
- `Cmd+F` - Search
- `Space` - Pan mode
- `+/-` - Zoom
```

**Deliverables:**
- ✅ Command palette (Cmd+K)
- ✅ Auto-layout algorithm
- ✅ Keyboard shortcuts
- ✅ User documentation
- ✅ Developer documentation
- ✅ Migration guides

---

## Migration Strategy

### Backward Compatibility

The system maintains backward compatibility:

1. **Existing ContentItems** → Migrated to Pages
2. **Table CRUD** → Remains functional alongside graph
3. **Agents** → Work with both APIs
4. **Workflows** → Gradually adopt graph features

### Gradual Rollout

```
Week 1-2:  Backend only (invisible to users)
Week 3-4:  Graph view (read-only)
Week 5-6:  Graph editing (opt-in)
Week 7-8:  Full features (default)
Week 9-10: Agent integration
Week 11-12: Production polish
```

---

## Success Metrics

### Technical Metrics
- Graph renders < 2s for 1000+ pages
- Position updates save in < 200ms
- Zero data loss during YAML sync
- 99.9% uptime for graph API

### User Metrics
- 80% of users prefer graph over tables
- 50% reduction in time to create sitemap
- 3x increase in internal linking quality
- 90% adoption of AI suggestions

### Agent Metrics
- Agents create 10+ page suggestions/week
- 70% of suggestions accepted
- Freshness score improves 20%
- Link equity increases 30%

---

## Risk Mitigation

### Technical Risks

| Risk | Mitigation |
|------|------------|
| Performance with large graphs | Virtualization, lazy loading, subgraph views |
| PostgreSQL JSONB limits | Separate analytics to time-series DB if needed |
| GitHub API rate limits | Cache, batch operations, queue system |
| React Flow learning curve | Comprehensive docs, video tutorials |

### Business Risks

| Risk | Mitigation |
|------|------------|
| Users don't adopt graph | Keep table view, gradual migration |
| Agents create bad suggestions | Human review required, confidence scores |
| GitHub conflicts | Conflict resolution UI, manual merge tools |
| Complexity overwhelms users | Phased rollout, progressive disclosure |

---

## Cost Estimate

### Development Time

| Phase | Weeks | Developer(s) |
|-------|-------|--------------|
| Phase 0-1 | 2 | 1 Full-stack |
| Phase 2-3 | 3 | 1 Frontend + 1 Backend |
| Phase 4-5 | 3 | 1 Full-stack |
| Phase 6-7 | 3 | 1 Backend (AI focus) |
| Phase 8 | 1 | 1 Full-stack |
| **Total** | **12** | **1.5-2 FTE average** |

### Infrastructure Costs

- **No additional services** required
- Uses existing PostgreSQL, NATS
- GitHub API is free (with token)
- React Flow is free (MIT license)

---

## Next Steps

### Immediate Actions (This Week)

1. **Review this plan** with team
2. **Approve Phase 0** database schema
3. **Set up GitHub repo** for sitemap YAML storage
4. **Create Figma mockups** of graph UI
5. **Spike React Flow** integration (1 day POC)

### Week 1 Kickoff

1. Create migrations (Phase 0.1)
2. Add TypeScript types (Phase 0.2)
3. Run migration on dev environment
4. Start backend routers (Phase 1)

---

## Conclusion

This plan transforms swarm.press from a traditional CMS into a **graph-driven, agent-native content orchestration platform**. The incremental approach ensures:

✅ **Zero disruption** to current workflows
✅ **Progressive enhancement** of capabilities
✅ **Clear deliverables** each week
✅ **Backward compatibility** maintained
✅ **Agent-friendly** architecture from day one

The result: A platform where **humans and AI agents collaborate visually** to create, organize, and optimize content at scale.

---

**Ready to proceed?** Let's start with Phase 0 and build the foundation! 🚀
