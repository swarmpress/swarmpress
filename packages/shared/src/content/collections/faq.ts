/**
 * FAQ Collection Schema
 * For managing frequently asked questions
 */

import { z } from 'zod';

// =============================================================================
// FAQ ITEM SCHEMA
// =============================================================================

export const FAQItemSchema = z.object({
  question: z.string().min(1, 'Question is required'),
  answer: z.string().min(1, 'Answer is required'),
  order: z.number().int().min(0).optional(), // Display order
});

export type FAQItem = z.infer<typeof FAQItemSchema>;

// =============================================================================
// FAQ SCHEMA (FULL)
// =============================================================================

export const FAQSchema = z.object({
  // Basic Information
  title: z.string().min(1, 'Title is required').max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().optional(),

  // FAQ Items
  items: z.array(FAQItemSchema).min(1, 'At least one FAQ item is required'),

  // Categorization
  category: z.string().optional(), // e.g., 'General', 'Booking', 'Technical'
  tags: z.array(z.string()).default([]),

  // Target Audience
  audience: z.enum(['general', 'visitors', 'customers', 'partners', 'staff']).optional(),

  // Language
  language: z.string().length(2).default('en'), // ISO 639-1 language code

  // Related Content
  relatedPages: z.array(z.string()).optional(), // Array of page slugs
  relatedArticles: z.array(z.string()).optional(), // Array of article slugs

  // Media
  featuredImage: z.string().optional(), // Media ID reference

  // SEO
  seo: z.object({
    metaTitle: z.string().max(60).optional(),
    metaDescription: z.string().max(160).optional(),
    ogImage: z.string().optional(), // Media ID reference
    structuredData: z.record(z.any()).optional(), // Schema.org FAQPage JSON-LD
  }).optional(),

  // Status & Visibility
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  visibility: z.enum(['public', 'private', 'unlisted']).default('public'),

  // Analytics
  viewCount: z.number().int().min(0).default(0),
  helpfulCount: z.number().int().min(0).default(0), // "Was this helpful?" positive votes
  notHelpfulCount: z.number().int().min(0).default(0), // Negative votes

  // Custom Fields (extensible)
  customFields: z.record(z.any()).optional(),
});

export type FAQ = z.infer<typeof FAQSchema>;

// =============================================================================
// CREATE FAQ SCHEMA (WITHOUT AUTO-GENERATED FIELDS)
// =============================================================================

export const CreateFAQSchema = FAQSchema.omit({
  viewCount: true,
  helpfulCount: true,
  notHelpfulCount: true,
});

export type CreateFAQ = z.infer<typeof CreateFAQSchema>;

// =============================================================================
// FIELD METADATA (FOR UI GENERATION)
// =============================================================================

export const FAQFieldMetadata = {
  title: {
    label: 'FAQ Section Title',
    placeholder: 'Enter FAQ section name',
    helpText: 'Name for this FAQ group',
    required: true,
  },
  slug: {
    label: 'URL Slug',
    placeholder: 'faq-section-name',
    helpText: 'URL-friendly identifier (lowercase, hyphens only)',
    required: true,
  },
  description: {
    label: 'Description',
    placeholder: 'Describe this FAQ section',
    helpText: 'Optional description',
    type: 'textarea',
  },
  items: {
    label: 'FAQ Items',
    helpText: 'Questions and answers',
    required: true,
    type: 'array',
    itemSchema: {
      question: {
        label: 'Question',
        placeholder: 'What is your question?',
        required: true,
        type: 'text',
      },
      answer: {
        label: 'Answer',
        placeholder: 'Provide a clear answer',
        required: true,
        type: 'textarea',
      },
      order: {
        label: 'Display Order',
        placeholder: '0',
        helpText: 'Optional ordering (lower numbers first)',
        type: 'number',
      },
    },
  },
  category: {
    label: 'Category',
    placeholder: 'e.g., General, Booking, Technical',
    helpText: 'Group related FAQs',
  },
  tags: {
    label: 'Tags',
    helpText: 'Keywords for search and filtering',
    type: 'tags',
  },
  audience: {
    label: 'Target Audience',
    helpText: 'Who is this FAQ for?',
    type: 'select',
    options: ['general', 'visitors', 'customers', 'partners', 'staff'],
  },
  language: {
    label: 'Language',
    helpText: 'ISO 639-1 language code',
    default: 'en',
  },
  featuredImage: {
    label: 'Featured Image',
    helpText: 'Optional image for this FAQ section',
    type: 'media',
  },
  status: {
    label: 'Status',
    type: 'select',
    options: ['draft', 'published', 'archived'],
    default: 'draft',
  },
  visibility: {
    label: 'Visibility',
    type: 'select',
    options: ['public', 'private', 'unlisted'],
    default: 'public',
  },
} as const;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const FAQ_COLLECTION_TYPE = {
  type: 'faqs',
  displayName: 'FAQs',
  singularName: 'FAQ',
  icon: 'help-circle',
  color: '#8B5CF6',
  description: 'Manage frequently asked questions',
  schema: FAQSchema,
  createSchema: CreateFAQSchema,
  fieldMetadata: FAQFieldMetadata,
} as const;
