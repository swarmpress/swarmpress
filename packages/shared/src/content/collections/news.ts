/**
 * News Collection Schema
 * For managing news articles, press releases, and announcements
 */

import { z } from 'zod';

// =============================================================================
// AUTHOR SCHEMA
// =============================================================================

export const AuthorSchema = z.object({
  name: z.string().min(1, 'Author name is required'),
  role: z.string().optional(), // e.g., "Reporter", "Editor"
  email: z.string().email().optional(),
  avatar: z.string().optional(), // Media ID reference
  bio: z.string().optional(),
});

export type Author = z.infer<typeof AuthorSchema>;

// =============================================================================
// NEWS SCHEMA (FULL)
// =============================================================================

export const NewsSchema = z.object({
  // Basic Information
  title: z.string().min(1, 'Title is required').max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  subtitle: z.string().max(300).optional(),
  excerpt: z.string().max(400).optional(),

  // Content
  content: z.string().min(1, 'Content is required'), // Main article content (markdown/HTML)

  // Authorship
  author: AuthorSchema.optional(),
  coAuthors: z.array(AuthorSchema).optional(),
  source: z.string().optional(), // External source if republishing
  sourceUrl: z.string().url().optional(),

  // Dates
  publishedAt: z.string().datetime().optional(), // ISO 8601
  updatedAt: z.string().datetime().optional(), // ISO 8601
  expiresAt: z.string().datetime().optional(), // ISO 8601 (for time-sensitive news)

  // Media
  featuredImage: z.string().optional(), // Media ID reference
  featuredImageCaption: z.string().optional(),
  featuredImageCredit: z.string().optional(),
  gallery: z.array(z.string()).optional(), // Array of Media IDs

  // Categorization
  category: z.enum([
    'general',
    'business',
    'technology',
    'sports',
    'entertainment',
    'health',
    'science',
    'politics',
    'culture',
    'travel',
    'local',
    'breaking',
    'opinion',
    'press_release',
  ]).optional(),
  subcategories: z.array(z.string()).optional(),
  tags: z.array(z.string()).default([]),

  // Priority & Urgency
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  breaking: z.boolean().default(false), // Is this breaking news?
  featured: z.boolean().default(false), // Feature on homepage?
  sticky: z.boolean().default(false), // Keep at top of listings?

  // Location
  location: z.object({
    city: z.string().optional(),
    region: z.string().optional(),
    country: z.string().optional(),
  }).optional(),

  // Related Content
  relatedArticles: z.array(z.string()).optional(), // Array of article slugs
  relatedEvents: z.array(z.string()).optional(), // Array of event slugs
  relatedPOIs: z.array(z.string()).optional(), // Array of POI slugs

  // External Links
  externalLinks: z.array(z.object({
    label: z.string(),
    url: z.string().url(),
  })).optional(),

  // SEO
  seo: z.object({
    metaTitle: z.string().max(60).optional(),
    metaDescription: z.string().max(160).optional(),
    ogImage: z.string().optional(), // Media ID reference
    keywords: z.array(z.string()).optional(),
    structuredData: z.record(z.any()).optional(), // Schema.org NewsArticle JSON-LD
  }).optional(),

  // Status & Visibility
  status: z.enum(['draft', 'scheduled', 'published', 'archived', 'retracted']).default('draft'),
  visibility: z.enum(['public', 'members_only', 'private']).default('public'),

  // Comments & Engagement
  allowComments: z.boolean().default(true),
  commentCount: z.number().int().min(0).default(0),

  // Analytics
  viewCount: z.number().int().min(0).default(0),
  shareCount: z.number().int().min(0).default(0),
  likeCount: z.number().int().min(0).default(0),

  // Reading Time
  readingTimeMinutes: z.number().int().min(0).optional(), // Auto-calculated

  // Language & Translation
  language: z.string().length(2).default('en'), // ISO 639-1 language code
  translations: z.array(z.object({
    language: z.string().length(2),
    slug: z.string(),
  })).optional(),

  // Editorial
  editorNotes: z.string().optional(), // Internal notes, not public
  correctionNotes: z.string().optional(), // Public corrections/updates

  // Custom Fields (extensible)
  customFields: z.record(z.any()).optional(),
});

export type News = z.infer<typeof NewsSchema>;

// =============================================================================
// CREATE NEWS SCHEMA (WITHOUT AUTO-GENERATED FIELDS)
// =============================================================================

export const CreateNewsSchema = NewsSchema.omit({
  commentCount: true,
  viewCount: true,
  shareCount: true,
  likeCount: true,
  readingTimeMinutes: true,
});

export type CreateNews = z.infer<typeof CreateNewsSchema>;

// =============================================================================
// FIELD METADATA (FOR UI GENERATION)
// =============================================================================

export const NewsFieldMetadata = {
  title: {
    label: 'Article Title',
    placeholder: 'Enter article title',
    helpText: 'The main headline',
    required: true,
  },
  slug: {
    label: 'URL Slug',
    placeholder: 'article-title',
    helpText: 'URL-friendly identifier (lowercase, hyphens only)',
    required: true,
  },
  subtitle: {
    label: 'Subtitle',
    placeholder: 'Optional subtitle',
    helpText: 'Secondary headline (max 300 characters)',
    maxLength: 300,
  },
  excerpt: {
    label: 'Excerpt',
    placeholder: 'Brief summary',
    helpText: 'Short summary for listings (max 400 characters)',
    type: 'textarea',
    maxLength: 400,
  },
  content: {
    label: 'Article Content',
    placeholder: 'Write your article here',
    helpText: 'Main article content',
    required: true,
    type: 'markdown',
  },
  'author.name': {
    label: 'Author Name',
    placeholder: 'John Doe',
    required: true,
  },
  'author.role': {
    label: 'Author Role',
    placeholder: 'Reporter',
  },
  'author.email': {
    label: 'Author Email',
    placeholder: 'john@example.com',
    type: 'email',
  },
  'author.avatar': {
    label: 'Author Avatar',
    helpText: 'Author profile picture',
    type: 'media',
  },
  publishedAt: {
    label: 'Publication Date',
    helpText: 'When to publish this article',
    type: 'datetime',
  },
  expiresAt: {
    label: 'Expiration Date',
    helpText: 'When this article expires (for time-sensitive news)',
    type: 'datetime',
  },
  featuredImage: {
    label: 'Featured Image',
    helpText: 'Main article image',
    type: 'media',
  },
  featuredImageCaption: {
    label: 'Image Caption',
    placeholder: 'Describe the image',
  },
  featuredImageCredit: {
    label: 'Image Credit',
    placeholder: 'Photo by...',
  },
  gallery: {
    label: 'Image Gallery',
    helpText: 'Additional article images',
    type: 'media-multiple',
  },
  category: {
    label: 'Category',
    helpText: 'Article category',
    type: 'select',
    options: [
      'general',
      'business',
      'technology',
      'sports',
      'entertainment',
      'health',
      'science',
      'politics',
      'culture',
      'travel',
      'local',
      'breaking',
      'opinion',
      'press_release',
    ],
  },
  tags: {
    label: 'Tags',
    helpText: 'Keywords for search and filtering',
    type: 'tags',
  },
  priority: {
    label: 'Priority',
    helpText: 'How important is this article?',
    type: 'select',
    options: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  },
  breaking: {
    label: 'Breaking News',
    helpText: 'Mark as breaking news',
    type: 'boolean',
  },
  featured: {
    label: 'Featured',
    helpText: 'Feature on homepage',
    type: 'boolean',
  },
  sticky: {
    label: 'Sticky',
    helpText: 'Keep at top of listings',
    type: 'boolean',
  },
  'location.city': {
    label: 'City',
    placeholder: 'City name',
  },
  'location.region': {
    label: 'Region',
    placeholder: 'Region/state',
  },
  'location.country': {
    label: 'Country',
    placeholder: 'Country name',
  },
  status: {
    label: 'Status',
    type: 'select',
    options: ['draft', 'scheduled', 'published', 'archived', 'retracted'],
    default: 'draft',
  },
  visibility: {
    label: 'Visibility',
    type: 'select',
    options: ['public', 'members_only', 'private'],
    default: 'public',
  },
  allowComments: {
    label: 'Allow Comments',
    helpText: 'Enable comments on this article',
    type: 'boolean',
    default: true,
  },
  language: {
    label: 'Language',
    helpText: 'ISO 639-1 language code',
    default: 'en',
  },
  editorNotes: {
    label: 'Editor Notes',
    helpText: 'Internal notes (not public)',
    type: 'textarea',
  },
  correctionNotes: {
    label: 'Corrections/Updates',
    helpText: 'Public corrections or updates',
    type: 'textarea',
  },
} as const;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const NEWS_COLLECTION_TYPE = {
  type: 'news',
  displayName: 'News',
  singularName: 'News Article',
  icon: 'newspaper',
  color: '#10B981',
  description: 'Manage news articles, press releases, and announcements',
  schema: NewsSchema,
  createSchema: CreateNewsSchema,
  fieldMetadata: NewsFieldMetadata,
} as const;
