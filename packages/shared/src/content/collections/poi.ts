/**
 * POI (Point of Interest) Collection Schema
 * For managing locations, landmarks, attractions, restaurants, hotels, etc.
 */

import { z } from 'zod';

// =============================================================================
// COORDINATES SCHEMA
// =============================================================================

export const CoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(), // Meters above sea level
});

export type Coordinates = z.infer<typeof CoordinatesSchema>;

// =============================================================================
// ADDRESS SCHEMA
// =============================================================================

export const AddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  formattedAddress: z.string().optional(), // Full formatted address
});

export type Address = z.infer<typeof AddressSchema>;

// =============================================================================
// CONTACT SCHEMA
// =============================================================================

export const ContactSchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  facebook: z.string().url().optional(),
  instagram: z.string().url().optional(),
  twitter: z.string().url().optional(),
});

export type Contact = z.infer<typeof ContactSchema>;

// =============================================================================
// OPENING HOURS SCHEMA
// =============================================================================

export const OpeningHoursSchema = z.object({
  monday: z.string().optional(), // e.g., "09:00-17:00" or "Closed"
  tuesday: z.string().optional(),
  wednesday: z.string().optional(),
  thursday: z.string().optional(),
  friday: z.string().optional(),
  saturday: z.string().optional(),
  sunday: z.string().optional(),
  notes: z.string().optional(), // e.g., "Summer hours may vary"
});

export type OpeningHours = z.infer<typeof OpeningHoursSchema>;

// =============================================================================
// PRICING SCHEMA
// =============================================================================

export const PricingSchema = z.object({
  range: z.enum(['free', 'budget', 'moderate', 'expensive', 'luxury']),
  currency: z.string().length(3).optional(), // ISO 4217 currency code
  from: z.number().min(0).optional(),
  to: z.number().min(0).optional(),
  notes: z.string().optional(),
});

export type Pricing = z.infer<typeof PricingSchema>;

// =============================================================================
// ACCESSIBILITY SCHEMA
// =============================================================================

export const AccessibilitySchema = z.object({
  wheelchairAccessible: z.boolean().optional(),
  parkingAvailable: z.boolean().optional(),
  publicTransportNearby: z.boolean().optional(),
  familyFriendly: z.boolean().optional(),
  petFriendly: z.boolean().optional(),
  notes: z.string().optional(),
});

export type Accessibility = z.infer<typeof AccessibilitySchema>;

// =============================================================================
// RATING SCHEMA
// =============================================================================

export const RatingSchema = z.object({
  average: z.number().min(0).max(5).optional(),
  count: z.number().int().min(0).default(0),
  source: z.string().optional(), // e.g., "Google", "TripAdvisor"
});

export type Rating = z.infer<typeof RatingSchema>;

// =============================================================================
// POI SCHEMA (FULL)
// =============================================================================

export const POISchema = z.object({
  // Basic Information
  title: z.string().min(1, 'Title is required').max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().min(1, 'Description is required'),
  excerpt: z.string().max(300).optional(),

  // Type & Category
  poiType: z.enum([
    'restaurant',
    'hotel',
    'attraction',
    'museum',
    'beach',
    'park',
    'landmark',
    'viewpoint',
    'shop',
    'service',
    'transport',
    'other',
  ]),
  category: z.string().optional(), // More specific subcategory
  subcategories: z.array(z.string()).optional(),

  // Location
  coordinates: CoordinatesSchema,
  address: AddressSchema.optional(),
  placeId: z.string().optional(), // Google Maps Place ID
  what3words: z.string().optional(), // What3Words address

  // Contact Information
  contact: ContactSchema.optional(),

  // Business Information
  openingHours: OpeningHoursSchema.optional(),
  pricing: PricingSchema.optional(),
  reservationRequired: z.boolean().optional(),
  reservationUrl: z.string().url().optional(),

  // Accessibility
  accessibility: AccessibilitySchema.optional(),

  // Media
  featuredImage: z.string().optional(), // Media ID reference
  gallery: z.array(z.string()).optional(), // Array of Media IDs
  logo: z.string().optional(), // Media ID reference

  // Content
  content: z.string().optional(), // Full markdown/HTML content
  highlights: z.array(z.string()).optional(), // Key features/highlights

  // Rating & Reviews
  rating: RatingSchema.optional(),

  // Amenities & Features
  amenities: z.array(z.string()).optional(), // e.g., ["WiFi", "Parking", "Pet-friendly"]
  features: z.array(z.string()).optional(), // e.g., ["Sea view", "Historic", "Family-friendly"]

  // Categorization
  tags: z.array(z.string()).default([]),

  // SEO
  seo: z.object({
    metaTitle: z.string().max(60).optional(),
    metaDescription: z.string().max(160).optional(),
    ogImage: z.string().optional(), // Media ID reference
    structuredData: z.record(z.any()).optional(), // Schema.org LocalBusiness/Place JSON-LD
  }).optional(),

  // Status & Visibility
  status: z.enum(['draft', 'published', 'closed_temporarily', 'closed_permanently']).default('draft'),
  visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
  featured: z.boolean().default(false), // Highlight this POI

  // External Links
  externalLinks: z.array(z.object({
    label: z.string(),
    url: z.string().url(),
  })).optional(),

  // Verification
  verified: z.boolean().default(false), // Has this info been verified?
  lastVerified: z.string().datetime().optional(), // ISO 8601

  // Custom Fields (extensible)
  customFields: z.record(z.any()).optional(),
});

export type POI = z.infer<typeof POISchema>;

// =============================================================================
// CREATE POI SCHEMA (WITHOUT AUTO-GENERATED FIELDS)
// =============================================================================

export const CreatePOISchema = POISchema.omit({
  // Omit fields that will be auto-generated or set by the system
});

export type CreatePOI = z.infer<typeof CreatePOISchema>;

// =============================================================================
// FIELD METADATA (FOR UI GENERATION)
// =============================================================================

export const POIFieldMetadata = {
  title: {
    label: 'POI Name',
    placeholder: 'Enter location name',
    helpText: 'The name of this place',
    required: true,
  },
  slug: {
    label: 'URL Slug',
    placeholder: 'location-name',
    helpText: 'URL-friendly identifier (lowercase, hyphens only)',
    required: true,
  },
  description: {
    label: 'Description',
    placeholder: 'Describe this location',
    helpText: 'Full description of the place',
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
  poiType: {
    label: 'POI Type',
    helpText: 'What type of place is this?',
    required: true,
    type: 'select',
    options: [
      'restaurant',
      'hotel',
      'attraction',
      'museum',
      'beach',
      'park',
      'landmark',
      'viewpoint',
      'shop',
      'service',
      'transport',
      'other',
    ],
  },
  category: {
    label: 'Category',
    placeholder: 'e.g., Italian Restaurant, Boutique Hotel',
    helpText: 'More specific category',
  },
  'coordinates.latitude': {
    label: 'Latitude',
    placeholder: '44.1298',
    helpText: 'Geographic latitude',
    required: true,
    type: 'number',
  },
  'coordinates.longitude': {
    label: 'Longitude',
    placeholder: '9.7234',
    helpText: 'Geographic longitude',
    required: true,
    type: 'number',
  },
  'coordinates.altitude': {
    label: 'Altitude',
    placeholder: '350',
    helpText: 'Meters above sea level (optional)',
    type: 'number',
  },
  'address.street': {
    label: 'Street Address',
    placeholder: 'Via Roma 123',
  },
  'address.city': {
    label: 'City',
    placeholder: 'City name',
  },
  'address.postalCode': {
    label: 'Postal Code',
    placeholder: '19017',
  },
  'address.country': {
    label: 'Country',
    placeholder: 'Italy',
  },
  'contact.phone': {
    label: 'Phone',
    placeholder: '+39 0187 123456',
  },
  'contact.email': {
    label: 'Email',
    placeholder: 'info@example.com',
    type: 'email',
  },
  'contact.website': {
    label: 'Website',
    placeholder: 'https://example.com',
    type: 'url',
  },
  'pricing.range': {
    label: 'Price Range',
    type: 'select',
    options: ['free', 'budget', 'moderate', 'expensive', 'luxury'],
  },
  'pricing.currency': {
    label: 'Currency',
    placeholder: 'EUR',
    helpText: 'ISO 4217 currency code',
  },
  'pricing.from': {
    label: 'Price From',
    placeholder: '0.00',
    type: 'number',
    min: 0,
  },
  'pricing.to': {
    label: 'Price To',
    placeholder: '100.00',
    type: 'number',
    min: 0,
  },
  featuredImage: {
    label: 'Featured Image',
    helpText: 'Main location image',
    type: 'media',
  },
  gallery: {
    label: 'Image Gallery',
    helpText: 'Additional location images',
    type: 'media-multiple',
  },
  logo: {
    label: 'Logo',
    helpText: 'Business logo',
    type: 'media',
  },
  'accessibility.wheelchairAccessible': {
    label: 'Wheelchair Accessible',
    type: 'boolean',
  },
  'accessibility.parkingAvailable': {
    label: 'Parking Available',
    type: 'boolean',
  },
  'accessibility.petFriendly': {
    label: 'Pet Friendly',
    type: 'boolean',
  },
  'accessibility.familyFriendly': {
    label: 'Family Friendly',
    type: 'boolean',
  },
  amenities: {
    label: 'Amenities',
    helpText: 'Available facilities and services',
    type: 'tags',
  },
  features: {
    label: 'Features',
    helpText: 'Notable characteristics',
    type: 'tags',
  },
  tags: {
    label: 'Tags',
    helpText: 'Keywords for search and filtering',
    type: 'tags',
  },
  status: {
    label: 'Status',
    type: 'select',
    options: ['draft', 'published', 'closed_temporarily', 'closed_permanently'],
    default: 'draft',
  },
  visibility: {
    label: 'Visibility',
    type: 'select',
    options: ['public', 'private', 'unlisted'],
    default: 'public',
  },
  featured: {
    label: 'Featured',
    helpText: 'Highlight this location',
    type: 'boolean',
  },
  verified: {
    label: 'Verified',
    helpText: 'Information has been verified',
    type: 'boolean',
  },
} as const;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const POI_COLLECTION_TYPE = {
  type: 'pois',
  displayName: 'Points of Interest',
  singularName: 'POI',
  icon: 'map-pin',
  color: '#EF4444',
  description: 'Manage locations, attractions, restaurants, and points of interest',
  schema: POISchema,
  createSchema: CreatePOISchema,
  fieldMetadata: POIFieldMetadata,
} as const;
