import { z } from 'zod'
import { ContentBlocksSchema } from '../content/blocks'

/**
 * Domain entity schemas for swarm.press
 * Using Zod for runtime validation and TypeScript type generation
 */

// ============================================================================
// Base Schemas
// ============================================================================

const TimestampsSchema = z.object({
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

// ============================================================================
// Company
// ============================================================================

export const CompanySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    description: z.string().optional(),
  })
  .merge(TimestampsSchema)

export type Company = z.infer<typeof CompanySchema>

// ============================================================================
// Department
// ============================================================================

export const DepartmentNameSchema = z.enum([
  'Editorial',
  'Writers Room',
  'SEO & Analytics',
  'Media & Design',
  'Engineering',
  'Distribution & Social',
  'Governance',
])

export const DepartmentSchema = z
  .object({
    id: z.string().uuid(),
    company_id: z.string().uuid(),
    name: DepartmentNameSchema,
    description: z.string(),
  })
  .merge(TimestampsSchema)

export type DepartmentName = z.infer<typeof DepartmentNameSchema>
export type Department = z.infer<typeof DepartmentSchema>

// ============================================================================
// Role
// ============================================================================

export const RoleSchema = z
  .object({
    id: z.string().uuid(),
    department_id: z.string().uuid(),
    name: z.string().min(1),
    description: z.string(),
  })
  .merge(TimestampsSchema)

export type Role = z.infer<typeof RoleSchema>

// ============================================================================
// Agent
// ============================================================================

/**
 * Typed capabilities that map to actual agent tools
 * Each capability has a name and optional configuration
 */
export const AgentCapabilitySchema = z.object({
  name: z.enum([
    // Content Creation
    'content_research',
    'content_writing',
    'content_revision',
    'content_review',
    // SEO & Analytics
    'seo_optimization',
    'keyword_research',
    'analytics_analysis',
    // Media & Design
    'image_generation',
    'image_editing',
    'gallery_curation',
    // Editorial
    'editorial_review',
    'fact_checking',
    'style_enforcement',
    // Engineering
    'site_build',
    'site_deploy',
    'code_generation',
    // Governance
    'escalation_handling',
    'ticket_management',
    'ceo_briefing',
    // Distribution
    'social_posting',
    'newsletter_creation',
  ]),
  enabled: z.boolean().default(true),
  config: z.record(z.any()).optional(),
})

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>

/**
 * Writing style configuration for content-creating agents
 */
export const WritingStyleSchema = z.object({
  tone: z.enum([
    'professional',
    'casual',
    'friendly',
    'authoritative',
    'conversational',
    'enthusiastic',
    'formal',
    'playful',
  ]).optional(),
  vocabulary_level: z.enum(['simple', 'moderate', 'advanced', 'technical']).optional(),
  sentence_length: z.enum(['short', 'medium', 'long', 'varied']).optional(),
  formality: z.enum(['very_informal', 'informal', 'neutral', 'formal', 'very_formal']).optional(),
  humor: z.enum(['none', 'subtle', 'moderate', 'frequent']).optional(),
  emoji_usage: z.enum(['never', 'rarely', 'sometimes', 'often']).optional(),
  perspective: z.enum(['first_person', 'second_person', 'third_person']).optional(),
  // For travel content
  descriptive_style: z.enum(['factual', 'evocative', 'poetic', 'practical']).optional(),
})

export type WritingStyle = z.infer<typeof WritingStyleSchema>

/**
 * Model configuration for the agent's LLM
 */
export const ModelConfigSchema = z.object({
  model: z.string().optional(), // e.g., 'claude-3-5-sonnet-20241022'
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
})

export type ModelConfig = z.infer<typeof ModelConfigSchema>

export const AgentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    role_id: z.string().uuid(),
    department_id: z.string().uuid(),
    persona: z.string(),
    virtual_email: z.string().email(),
    description: z.string().optional(),

    // Visual Identity
    avatar_url: z.string().url().optional(),
    profile_image_url: z.string().url().optional(),

    // Personality
    hobbies: z.array(z.string()).optional(),
    writing_style: WritingStyleSchema.optional(),

    // Capabilities (typed)
    capabilities: z.array(z.union([
      z.string(), // Backwards compatible: simple string
      AgentCapabilitySchema, // New: typed capability object
    ])),

    // Model config
    model_config: ModelConfigSchema.optional(),

    // Status
    status: z.enum(['active', 'inactive', 'suspended']).optional(),
  })
  .merge(TimestampsSchema)

export type Agent = z.infer<typeof AgentSchema>

// ============================================================================
// Website
// ============================================================================

export const WebsiteSchema = z
  .object({
    id: z.string().uuid(),
    domain: z.string().min(1), // hostname validation relaxed for MVP
    name: z.string().min(1), // Display name for the website
    title: z.string().min(1), // HTML title
    description: z.string().optional(),
    settings: z.record(z.any()).optional(), // Website configuration settings
    // GitHub Integration
    github_repo_url: z.string().optional(),
    github_owner: z.string().optional(),
    github_repo: z.string().optional(),
    github_installation_id: z.string().optional(),
    github_connected_at: z.string().datetime().optional(),
  })
  .merge(TimestampsSchema)

export type Website = z.infer<typeof WebsiteSchema>

// ============================================================================
// WebPage
// ============================================================================

export const WebPageMetadataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  og_image: z.string().url().optional(),
})

export const WebPageSchema = z
  .object({
    id: z.string().uuid(),
    website_id: z.string().uuid(),
    slug: z.string().regex(/^\/[a-z0-9-/]*$/),
    template: z.string().min(1),
    metadata: WebPageMetadataSchema.optional(),
  })
  .merge(TimestampsSchema)

export type WebPageMetadata = z.infer<typeof WebPageMetadataSchema>
export type WebPage = z.infer<typeof WebPageSchema>

// ============================================================================
// ContentItem
// ============================================================================

export const ContentItemTypeSchema = z.enum([
  'article',
  'section',
  'hero',
  'metadata',
  'component',
])

export const ContentItemStatusSchema = z.enum([
  'idea',
  'planned',
  'brief_created',
  'draft',
  'in_editorial_review',
  'needs_changes',
  'approved',
  'scheduled',
  'published',
  'archived',
])

export const ContentItemMetadataSchema = z.object({
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  reading_time: z.string().optional(),
  seo_keywords: z.array(z.string()).optional(),
  // Editorial review tracking
  reviews: z.array(z.any()).optional(),
  revisions: z.array(z.any()).optional(),
  escalations: z.array(z.any()).optional(),
  pending_ceo_approval: z.boolean().optional(),
})

export const ContentItemSchema = z
  .object({
    id: z.string().uuid(),
    website_id: z.string().uuid(),
    page_id: z.string().uuid().nullable().optional(),
    type: ContentItemTypeSchema,
    title: z.string().min(1), // Content title
    brief: z.string().optional(), // Content brief/summary
    slug: z.string().optional(), // URL slug
    body: ContentBlocksSchema, // Array of JSON blocks
    metadata: ContentItemMetadataSchema.optional(),
    author_agent_id: z.string().uuid(),
    status: ContentItemStatusSchema,
  })
  .merge(TimestampsSchema)

export type ContentItemType = z.infer<typeof ContentItemTypeSchema>
export type ContentItemStatus = z.infer<typeof ContentItemStatusSchema>
export type ContentItemMetadata = z.infer<typeof ContentItemMetadataSchema>
export type ContentItem = z.infer<typeof ContentItemSchema>

// ============================================================================
// Task
// ============================================================================

export const TaskTypeSchema = z.enum([
  'create_brief',
  'write_draft',
  'revise_draft',
  'editorial_review',
  'seo_optimization',
  'generate_media',
  'prepare_build',
  'publish_site',
])

export const TaskStatusSchema = z.enum([
  'planned',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
])

export const TaskSchema = z
  .object({
    id: z.string().uuid(),
    type: TaskTypeSchema,
    status: TaskStatusSchema,
    agent_id: z.string().uuid(),
    content_id: z.string().uuid().nullable().optional(),
    website_id: z.string().uuid().nullable().optional(),
    notes: z.string().optional(),
  })
  .merge(TimestampsSchema)

export type TaskType = z.infer<typeof TaskTypeSchema>
export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type Task = z.infer<typeof TaskSchema>

// ============================================================================
// Review
// ============================================================================

export const ReviewResultSchema = z.enum(['approved', 'needs_changes', 'rejected'])

export const ReviewSchema = z
  .object({
    id: z.string().uuid(),
    content_id: z.string().uuid(),
    reviewer_agent_id: z.string().uuid(),
    result: ReviewResultSchema,
    comments: z.string(),
  })
  .merge(TimestampsSchema)

export type ReviewResult = z.infer<typeof ReviewResultSchema>
export type Review = z.infer<typeof ReviewSchema>

// ============================================================================
// QuestionTicket
// ============================================================================

export const QuestionTicketTargetSchema = z.enum(['CEO', 'ChiefEditor', 'TechnicalLead'])

export const QuestionTicketStatusSchema = z.enum(['open', 'answered', 'closed'])

export const QuestionTicketSchema = z
  .object({
    id: z.string().uuid(),
    created_by_agent_id: z.string().uuid(),
    target: QuestionTicketTargetSchema,
    subject: z.string().min(1),
    body: z.string().min(1),
    status: QuestionTicketStatusSchema,
    content_id: z.string().uuid().nullable().optional(), // Related content item
    answer_agent_id: z.string().uuid().nullable().optional(),
    answer_body: z.string().nullable().optional(),
  })
  .merge(TimestampsSchema)

export type QuestionTicketTarget = z.infer<typeof QuestionTicketTargetSchema>
export type QuestionTicketStatus = z.infer<typeof QuestionTicketStatusSchema>
export type QuestionTicket = z.infer<typeof QuestionTicketSchema>
