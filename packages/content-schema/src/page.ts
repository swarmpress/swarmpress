import { z } from 'zod'
import { ContentBlockSchema } from './blocks'

/**
 * Multi-language string. `en` is required and is the fallback locale.
 */
export const LocalizedStringSchema = z
  .object({
    en: z.string(),
    de: z.string().optional(),
    fr: z.string().optional(),
    it: z.string().optional(),
  })
  .catchall(z.string())

export const PageSeoSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    canonical: z.string().optional(),
    og_image: z.string().optional(),
  })
  .passthrough()

export const PageStatusSchema = z.enum(['draft', 'in_review', 'published', 'archived'])

/**
 * A page file as committed to a site repo at `content/pages/**.json`.
 * This is the contract between the agents (which write it) and the theme
 * (which renders it).
 */
export const PageSchema = z.object({
  id: z.string().min(1),
  slug: LocalizedStringSchema,
  title: LocalizedStringSchema,
  page_type: z.string().min(1),
  seo: PageSeoSchema.default({}),
  body: z.array(ContentBlockSchema),
  metadata: z.record(z.unknown()).optional(),
  status: PageStatusSchema.default('draft'),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type LocalizedString = z.infer<typeof LocalizedStringSchema>
export type Page = z.infer<typeof PageSchema>
