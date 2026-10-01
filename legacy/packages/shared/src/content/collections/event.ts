/**
 * Event Collection Schema
 * For managing events, concerts, festivals, exhibitions, etc.
 */

import { z } from 'zod';

// =============================================================================
// LOCATION SCHEMA
// =============================================================================

export const LocationSchema = z.object({
  name: z.string().min(1, 'Location name is required'),
  address: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  placeId: z.string().optional(), // Google Maps Place ID
  url: z.string().url().optional(),
});

export type Location = z.infer<typeof LocationSchema>;

// =============================================================================
// ORGANIZER SCHEMA
// =============================================================================

export const OrganizerSchema = z.object({
  name: z.string().min(1, 'Organizer name is required'),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional(),
  logo: z.string().optional(), // Media ID reference
});

export type Organizer = z.infer<typeof OrganizerSchema>;

// =============================================================================
// TICKET SCHEMA
// =============================================================================

export const TicketSchema = z.object({
  type: z.enum(['free', 'paid', 'donation', 'registration_required']),
  price: z.number().min(0).optional(),
  currency: z.string().length(3).optional(), // ISO 4217 currency code
  url: z.string().url().optional(), // Ticket purchase/registration URL
  availability: z.enum(['available', 'sold_out', 'coming_soon']).optional(),
  notes: z.string().optional(),
});

export type Ticket = z.infer<typeof TicketSchema>;

// =============================================================================
// EVENT SCHEMA (FULL)
// =============================================================================

export const EventSchema = z.object({
  // Basic Information
  title: z.string().min(1, 'Title is required').max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().min(1, 'Description is required'),
  excerpt: z.string().max(300).optional(),

  // Date & Time
  startDate: z.string().datetime(), // ISO 8601
  endDate: z.string().datetime().optional(), // ISO 8601
  timezone: z.string().default('UTC'), // IANA timezone
  allDay: z.boolean().default(false),
  recurring: z.object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).default(1),
    until: z.string().datetime().optional(),
    count: z.number().int().min(1).optional(),
  }).optional(),

  // Location
  location: LocationSchema,
  virtualEventUrl: z.string().url().optional(), // For online/hybrid events

  // Organization
  organizer: OrganizerSchema,
  coOrganizers: z.array(OrganizerSchema).optional(),

  // Tickets & Registration
  ticket: TicketSchema.optional(),

  // Media
  featuredImage: z.string().optional(), // Media ID reference
  gallery: z.array(z.string()).optional(), // Array of Media IDs

  // Content
  content: z.string().optional(), // Full markdown/HTML content

  // Categorization
  category: z.string().optional(), // e.g., 'music', 'sports', 'cultural', 'business'
  tags: z.array(z.string()).default([]),

  // SEO
  seo: z.object({
    metaTitle: z.string().max(60).optional(),
    metaDescription: z.string().max(160).optional(),
    ogImage: z.string().optional(), // Media ID reference
    structuredData: z.record(z.any()).optional(), // Schema.org Event JSON-LD
  }).optional(),

  // Status
  status: z.enum(['draft', 'published', 'cancelled', 'postponed']).default('draft'),
  visibility: z.enum(['public', 'private', 'unlisted']).default('public'),

  // Links
  externalLinks: z.array(z.object({
    label: z.string(),
    url: z.string().url(),
  })).optional(),

  // Custom Fields (extensible)
  customFields: z.record(z.any()).optional(),
});

export type Event = z.infer<typeof EventSchema>;

// =============================================================================
// CREATE EVENT SCHEMA (WITHOUT AUTO-GENERATED FIELDS)
// =============================================================================

export const CreateEventSchema = EventSchema.omit({
  // Omit fields that will be auto-generated or set by the system
});

export type CreateEvent = z.infer<typeof CreateEventSchema>;

// =============================================================================
// FIELD METADATA (FOR UI GENERATION)
// =============================================================================

export const EventFieldMetadata = {
  title: {
    label: 'Event Title',
    placeholder: 'Enter event name',
    helpText: 'The main title of the event',
    required: true,
  },
  slug: {
    label: 'URL Slug',
    placeholder: 'event-name',
    helpText: 'URL-friendly identifier (lowercase, hyphens only)',
    required: true,
  },
  description: {
    label: 'Description',
    placeholder: 'Describe the event',
    helpText: 'Full description of the event',
    required: true,
    type: 'textarea',
  },
  excerpt: {
    label: 'Short Excerpt',
    placeholder: 'Brief summary',
    helpText: 'Short summary for listings (max 300 characters)',
    type: 'textarea',
    maxLength: 300,
  },
  startDate: {
    label: 'Start Date & Time',
    helpText: 'When the event starts',
    required: true,
    type: 'datetime',
  },
  endDate: {
    label: 'End Date & Time',
    helpText: 'When the event ends (optional)',
    type: 'datetime',
  },
  timezone: {
    label: 'Timezone',
    helpText: 'Event timezone (e.g., America/New_York)',
    default: 'UTC',
  },
  allDay: {
    label: 'All Day Event',
    helpText: 'Check if this is an all-day event',
    type: 'boolean',
  },
  'location.name': {
    label: 'Venue Name',
    placeholder: 'Event venue',
    required: true,
  },
  'location.address': {
    label: 'Street Address',
    placeholder: '123 Main St',
  },
  'location.city': {
    label: 'City',
    placeholder: 'City name',
  },
  'location.latitude': {
    label: 'Latitude',
    placeholder: '45.4642',
    type: 'number',
  },
  'location.longitude': {
    label: 'Longitude',
    placeholder: '9.1900',
    type: 'number',
  },
  'organizer.name': {
    label: 'Organizer Name',
    placeholder: 'Organization or person',
    required: true,
  },
  'organizer.email': {
    label: 'Organizer Email',
    placeholder: 'contact@example.com',
    type: 'email',
  },
  'organizer.website': {
    label: 'Organizer Website',
    placeholder: 'https://example.com',
    type: 'url',
  },
  'ticket.type': {
    label: 'Ticket Type',
    helpText: 'How attendees can access the event',
    type: 'select',
    options: ['free', 'paid', 'donation', 'registration_required'],
  },
  'ticket.price': {
    label: 'Ticket Price',
    placeholder: '0.00',
    type: 'number',
    min: 0,
  },
  'ticket.currency': {
    label: 'Currency',
    placeholder: 'EUR',
    helpText: 'ISO 4217 currency code',
  },
  'ticket.url': {
    label: 'Ticket URL',
    placeholder: 'https://tickets.example.com',
    helpText: 'Link to purchase or register',
    type: 'url',
  },
  featuredImage: {
    label: 'Featured Image',
    helpText: 'Main event image',
    type: 'media',
  },
  gallery: {
    label: 'Image Gallery',
    helpText: 'Additional event images',
    type: 'media-multiple',
  },
  category: {
    label: 'Category',
    helpText: 'Event category',
    type: 'select',
    options: ['music', 'sports', 'cultural', 'business', 'food', 'art', 'entertainment', 'other'],
  },
  tags: {
    label: 'Tags',
    helpText: 'Keywords for search and filtering',
    type: 'tags',
  },
  status: {
    label: 'Status',
    type: 'select',
    options: ['draft', 'published', 'cancelled', 'postponed'],
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

export const EVENT_COLLECTION_TYPE = {
  type: 'events',
  displayName: 'Events',
  singularName: 'Event',
  icon: 'calendar',
  color: '#3B82F6',
  description: 'Manage events, concerts, festivals, and exhibitions',
  schema: EventSchema,
  createSchema: CreateEventSchema,
  fieldMetadata: EventFieldMetadata,
} as const;
