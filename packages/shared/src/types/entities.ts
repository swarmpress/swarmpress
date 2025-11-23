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

export const AgentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    role_id: z.string().uuid(),
    department_id: z.string().uuid(),
    persona: z.string(),
    virtual_email: z.string().email(),
    description: z.string().optional(),
    capabilities: z.array(z.string()),
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
    title: z.string().min(1),
    description: z.string().optional(),
    github_repo_url: z.string().optional(),
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
})

export const ContentItemSchema = z
  .object({
    id: z.string().uuid(),
    website_id: z.string().uuid(),
    page_id: z.string().uuid().nullable().optional(),
    type: ContentItemTypeSchema,
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
    answer_agent_id: z.string().uuid().nullable().optional(),
    answer_body: z.string().nullable().optional(),
  })
  .merge(TimestampsSchema)

export type QuestionTicketTarget = z.infer<typeof QuestionTicketTargetSchema>
export type QuestionTicketStatus = z.infer<typeof QuestionTicketStatusSchema>
export type QuestionTicket = z.infer<typeof QuestionTicketSchema>
