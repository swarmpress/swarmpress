/**
 * Page Serializer
 * Converts between database Page/ContentItem entities and GitHub file format
 */

import type { PageFile } from '../content-service'

/**
 * Database page entity (simplified for serialization)
 */
export interface DbPage {
  id: string
  slug: string
  title: string
  description?: string | null
  page_type?: string | null
  template?: string | null
  seo_title?: string | null
  seo_description?: string | null
  seo_keywords?: string[] | null
  metadata?: Record<string, unknown> | null
  created_at: Date | string
  updated_at: Date | string
}

/**
 * Database content item entity (simplified for serialization)
 */
export interface DbContentItem {
  id: string
  title: string
  slug?: string | null
  body: Array<Record<string, unknown>> // Content blocks
  status: string
  metadata?: Record<string, unknown> | null
  created_at: Date | string
  updated_at: Date | string
  published_at?: Date | string | null
}

/**
 * Serialize a database Page + ContentItem to GitHub file format
 */
export function serializePageToFile(
  page: DbPage,
  content?: DbContentItem
): PageFile {
  return {
    id: page.id,
    slug: page.slug,
    title: content?.title || page.title,
    description: page.description || undefined,
    template: page.template || undefined,
    page_type: page.page_type || undefined,
    seo: {
      title: page.seo_title || undefined,
      description: page.seo_description || undefined,
      keywords: page.seo_keywords || undefined,
    },
    body: content?.body || [],
    metadata: {
      ...page.metadata,
      ...content?.metadata,
    },
    status: content?.status || 'draft',
    created_at: toISOString(page.created_at),
    updated_at: toISOString(content?.updated_at || page.updated_at),
  }
}

/**
 * Deserialize a GitHub file to database entities
 */
export function deserializeFileToPage(file: PageFile): {
  page: Partial<DbPage>
  content: Partial<DbContentItem>
} {
  return {
    page: {
      id: file.id,
      slug: file.slug,
      title: file.title,
      description: file.description,
      page_type: file.page_type,
      template: file.template,
      seo_title: file.seo?.title,
      seo_description: file.seo?.description,
      seo_keywords: file.seo?.keywords,
      metadata: file.metadata,
      created_at: file.created_at,
      updated_at: file.updated_at,
    },
    content: {
      id: file.id, // Use same ID for simplicity
      title: file.title,
      slug: file.slug,
      body: file.body,
      status: file.status,
      metadata: file.metadata,
      created_at: file.created_at,
      updated_at: file.updated_at,
    },
  }
}

/**
 * Generate a slug from a title
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}

/**
 * Convert Date or string to ISO string
 */
function toISOString(date: Date | string): string {
  if (typeof date === 'string') return date
  return date.toISOString()
}

/**
 * Create a new page file with defaults
 */
export function createPageFile(params: {
  title: string
  slug?: string
  body?: Array<Record<string, unknown>>
}): PageFile {
  const now = new Date().toISOString()
  const slug = params.slug || generateSlug(params.title)

  return {
    id: crypto.randomUUID(),
    slug,
    title: params.title,
    body: params.body || [],
    status: 'draft',
    created_at: now,
    updated_at: now,
  }
}
