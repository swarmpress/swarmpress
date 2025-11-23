/**
 * Sitemap Types
 * TypeScript definitions for agentic sitemap system
 */

// ============================================
// PAGE TYPES
// ============================================

export interface Page {
  id: string
  website_id: string
  slug: string
  title: string
  page_type: string
  status: PageStatus
  priority: PagePriority

  parent_id?: string
  order_index: number

  blueprint_id?: string
  content_model_id?: string

  topics: string[]

  seo_profile: SEOProfile
  internal_links: InternalLinks
  owners: PageOwners
  tasks: PageTask[]
  suggestions: AISuggestion[]
  competitors: CompetitorPage[]
  analytics: PageAnalytics
  alerts: PageAlert[]

  translations: Record<string, string>
  tenants: Record<string, TenantOverride>
  component_overrides: Record<string, ComponentOverride>

  history: HistoryEntry[]

  created_at: string
  updated_at: string
}

export type PageStatus = 'planned' | 'draft' | 'published' | 'outdated' | 'deprecated'
export type PagePriority = 'low' | 'medium' | 'high' | 'critical'

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

export interface CompetitorPage {
  domain: string
  url: string
  notes?: string
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

export interface ComponentOverride {
  props?: Record<string, any>
  variant?: string
}

export interface HistoryEntry {
  date: string
  change: string
  agent?: string
  details?: string
}

// ============================================
// BLUEPRINT TYPES
// ============================================

export interface Blueprint {
  id: string
  page_type: string
  name: string
  description?: string
  version: string

  layout?: string

  components: BlueprintComponent[]

  global_linking_rules: LinkingRules
  seo_template?: SEOTemplate
  tenants: Record<string, TenantBlueprintOverride>
  validation: ValidationConfig

  created_at: string
  updated_at: string
}

export interface SEOTemplate {
  title_pattern?: string
  meta_description_pattern?: string
  required_keywords?: string[]
}

export interface BlueprintComponent {
  type: string
  order: number
  variant?: string
  required?: boolean
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
  min_words?: number
  max_words?: number
  must_include?: string[]
  avoid?: string[]
  style?: string
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
  allow_unknown_fields?: boolean
}

export interface TenantBlueprintOverride {
  layout?: string
  components?: BlueprintComponent[]
  css_overrides?: Record<string, string>
}

// ============================================
// CONTENT MODEL TYPES
// ============================================

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
  data_sources: DataSource[]

  ai_guidance: AIGuidance
  tenants: Record<string, TenantModelOverride>
  validation: ValidationConfig
  lifecycle: LifecycleConfig

  history: HistoryEntry[]

  created_at: string
  updated_at: string
}

export type FieldType =
  | 'string'
  | 'text'
  | 'markdown'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'image'
  | 'media'
  | 'reference'
  | 'list'
  | 'object'

export interface ModelField {
  id: string
  label: string
  type: FieldType
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

export interface DataSource {
  id: string
  type: 'http' | 'database' | 'function' | 'ai'
  description?: string
  config?: Record<string, any>
}

export interface AIGuidance {
  persona?: string
  tone?: string
  style?: string
  content_strategy?: string
  crosslink_strategy?: string
}

export interface TenantModelOverride {
  fields?: ModelField[]
  ui?: Record<string, string>
}

export interface LifecycleConfig {
  review_after_days?: number
  expire_after_days?: number
  archivable?: boolean
}

// ============================================
// GRAPH POSITION TYPES
// ============================================

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

// ============================================
// GRAPH STRUCTURE TYPES (for React Flow)
// ============================================

export interface SitemapGraphNode {
  id: string
  type: 'page' | 'cluster'
  position: { x: number; y: number }
  data: {
    page: Page
  }
}

export interface SitemapGraphEdge {
  id: string
  source: string
  target: string
  type: 'parent-child' | 'internal-link' | 'topical-cluster'
  data?: {
    link?: OutgoingLink
  }
}

export interface SitemapGraph {
  nodes: SitemapGraphNode[]
  edges: SitemapGraphEdge[]
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

export interface CreatePageInput {
  website_id: string
  slug: string
  title: string
  page_type: string
  status?: PageStatus
  priority?: PagePriority
  parent_id?: string
  blueprint_id?: string
  content_model_id?: string
  topics?: string[]
  seo_profile?: Partial<SEOProfile>
}

export interface UpdatePageInput {
  id: string
  slug?: string
  title?: string
  status?: PageStatus
  priority?: PagePriority
  parent_id?: string
  blueprint_id?: string
  content_model_id?: string
  topics?: string[]
  seo_profile?: Partial<SEOProfile>
  internal_links?: InternalLinks
  owners?: PageOwners
  tasks?: PageTask[]
  component_overrides?: Record<string, ComponentOverride>
}

export interface CreateBlueprintInput {
  page_type: string
  name: string
  description?: string
  version?: string
  layout?: string
  components: BlueprintComponent[]
  global_linking_rules?: LinkingRules
  validation?: ValidationConfig
}

export interface UpdateBlueprintInput {
  id: string
  name?: string
  description?: string
  version?: string
  layout?: string
  components?: BlueprintComponent[]
  global_linking_rules?: LinkingRules
  validation?: ValidationConfig
}

export interface CreateContentModelInput {
  model_id: string
  name: string
  kind: 'atom' | 'molecule' | 'organism' | 'template'
  description?: string
  version?: string
  fields: ModelField[]
  relations?: ModelRelation[]
  ai_guidance?: AIGuidance
  lifecycle?: LifecycleConfig
}

export interface UpdateContentModelInput {
  id: string
  name?: string
  description?: string
  version?: string
  fields?: ModelField[]
  relations?: ModelRelation[]
  ai_guidance?: AIGuidance
  lifecycle?: LifecycleConfig
}

export interface BulkUpdatePositionsInput {
  website_id: string
  positions: Array<{
    node_id: string
    node_type: string
    position_x: number
    position_y: number
  }>
}

// ============================================
// HELPER TYPES
// ============================================

export interface PageTreeNode extends Page {
  children: PageTreeNode[]
}

export interface SitemapStatistics {
  total_pages: number
  by_status: Record<PageStatus, number>
  by_priority: Record<PagePriority, number>
  by_page_type: Record<string, number>
  orphan_pages: number
  avg_freshness_score: number
  total_internal_links: number
  pages_needing_update: number
}
