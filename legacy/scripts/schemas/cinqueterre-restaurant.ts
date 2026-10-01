/**
 * Cinque Terre Restaurant Collection Schema
 * Comprehensive schema for restaurant data fetched via Claude web search
 */

import { z } from 'zod';

// =============================================================================
// SUB-SCHEMAS
// =============================================================================

export const RestaurantCoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const RestaurantLocationSchema = z.object({
  address: z.string(),
  street: z.string().optional(),
  postal_code: z.string().default('19017'),
  city: z.string(),
  region: z.string().default('Liguria'),
  country: z.string().default('Italy'),
  coordinates: RestaurantCoordinatesSchema,
  location_description: z.string().optional(),
});

export const RestaurantContactSchema = z.object({
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  reservations_url: z.string().nullable().optional(),
});

export const PlatformRatingSchema = z.object({
  rating: z.number().min(0).max(5).nullable().optional(),
  review_count: z.number().int().nullable().optional(),
  url: z.string().nullable().optional(),
  ranking: z.string().nullable().optional(),
});

export const MichelinRatingSchema = z.object({
  status: z.enum(['Selected', 'Star', 'Bib Gourmand']).nullable().optional(),
  description: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
});

export const RestaurantRatingsSchema = z.object({
  average_rating: z.number().min(0).max(5),
  google: PlatformRatingSchema.optional(),
  tripadvisor: PlatformRatingSchema.optional(),
  yelp: PlatformRatingSchema.optional(),
  foursquare: z.object({
    rating: z.number().nullable().optional(),
    url: z.string().nullable().optional(),
  }).optional(),
  michelin: MichelinRatingSchema.optional(),
});

export const PriceRangeSchema = z.object({
  level: z.enum(['€', '€€', '€€€', '€€€€']),
  min_price_eur: z.number().int().optional(),
  max_price_eur: z.number().int().optional(),
  average_meal_eur: z.number().int().optional(),
});

export const RestaurantDetailsSchema = z.object({
  cuisine_type: z.array(z.string()),
  price_range: PriceRangeSchema,
  features: z.array(z.string()).default([]),
  dietary_options: z.array(z.string()).default([]),
  best_for: z.array(z.string()).default([]),
  atmosphere: z.string().optional(),
  dress_code: z.enum(['Casual', 'Smart Casual', 'Formal']).default('Casual'),
  reservation_required: z.boolean().default(false),
  credit_cards_accepted: z.boolean().default(true),
  wheelchair_accessible: z.boolean().nullable().optional(),
});

export const DayHoursSchema = z.object({
  open: z.string().nullable().optional(),
  close: z.string().nullable().optional(),
  closed: z.boolean().default(false),
});

export const OpeningHoursSchema = z.object({
  timezone: z.string().default('Europe/Rome'),
  hours: z.object({
    monday: DayHoursSchema.optional(),
    tuesday: DayHoursSchema.optional(),
    wednesday: DayHoursSchema.optional(),
    thursday: DayHoursSchema.optional(),
    friday: DayHoursSchema.optional(),
    saturday: DayHoursSchema.optional(),
    sunday: DayHoursSchema.optional(),
  }),
  lunch_hours: z.string().nullable().optional(),
  dinner_hours: z.string().nullable().optional(),
  seasonal_closure: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const SignatureDishSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  price_eur: z.number().nullable().optional(),
  dietary_info: z.array(z.string()).default([]),
});

export const RestaurantMenuSchema = z.object({
  signature_dishes: z.array(SignatureDishSchema).default([]),
  must_try: z.array(z.string()).default([]),
  specialties: z.array(z.string()).default([]),
});

export const RestaurantReviewSchema = z.object({
  source: z.enum(['Google', 'TripAdvisor', 'Yelp']),
  author: z.string(),
  rating: z.number().int().min(1).max(5),
  date: z.string(),
  title: z.string().nullable().optional(),
  text: z.string(),
  language: z.string().default('en'),
  helpful_votes: z.number().int().nullable().optional(),
});

export const RestaurantImageSchema = z.object({
  url: z.string(),
  source: z.enum(['Google', 'TripAdvisor', 'Official', 'Yelp']),
  alt_text: z.string(),
  type: z.enum(['exterior', 'interior', 'food', 'view']),
});

export const ProsConsSchema = z.object({
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
});

// =============================================================================
// MAIN RESTAURANT SCHEMA
// =============================================================================

export const CinqueTerreRestaurantSchema = z.object({
  // Identification
  rank: z.number().int().optional(),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),

  // Location
  location: RestaurantLocationSchema,
  village: z.enum(['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso']),

  // Contact
  contact: RestaurantContactSchema.optional(),

  // Ratings
  ratings: RestaurantRatingsSchema,

  // Details
  details: RestaurantDetailsSchema,

  // Hours
  opening_hours: OpeningHoursSchema.optional(),

  // Menu
  menu: RestaurantMenuSchema.optional(),

  // Reviews
  reviews: z.array(RestaurantReviewSchema).default([]),

  // Images
  images: z.array(RestaurantImageSchema).default([]),

  // Pros/Cons
  pros_cons: ProsConsSchema.optional(),

  // Tips
  tips: z.array(z.string()).default([]),

  // Metadata
  last_updated: z.string().datetime().optional(),
  data_source: z.string().default('claude_web_search'),
});

export type CinqueTerreRestaurant = z.infer<typeof CinqueTerreRestaurantSchema>;

// =============================================================================
// COLLECTION RESPONSE SCHEMA (for API responses)
// =============================================================================

export const CinqueTerreRestaurantResponseSchema = z.object({
  metadata: z.object({
    query_location: z.string(),
    generated_at: z.string(),
    total_results: z.number().int(),
    sort_order: z.string().optional(),
  }),
  restaurants: z.array(CinqueTerreRestaurantSchema),
});

export type CinqueTerreRestaurantResponse = z.infer<typeof CinqueTerreRestaurantResponseSchema>;

// =============================================================================
// CREATE SCHEMA (for new entries)
// =============================================================================

export const CreateCinqueTerreRestaurantSchema = CinqueTerreRestaurantSchema.omit({
  rank: true,
  last_updated: true,
});

export type CreateCinqueTerreRestaurant = z.infer<typeof CreateCinqueTerreRestaurantSchema>;

// =============================================================================
// FIELD METADATA (for UI generation)
// =============================================================================

export const CinqueTerreRestaurantFieldMetadata = {
  name: {
    label: 'Restaurant Name',
    placeholder: 'Enter restaurant name',
    helpText: 'The name of the restaurant',
    required: true,
  },
  slug: {
    label: 'URL Slug',
    placeholder: 'restaurant-name',
    helpText: 'URL-friendly identifier',
    required: true,
  },
  village: {
    label: 'Village',
    helpText: 'Which Cinque Terre village',
    required: true,
    type: 'select',
    options: ['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso'],
  },
  'details.cuisine_type': {
    label: 'Cuisine Type',
    helpText: 'Types of cuisine served',
    type: 'tags',
  },
  'details.price_range.level': {
    label: 'Price Range',
    type: 'select',
    options: ['€', '€€', '€€€', '€€€€'],
  },
  'ratings.average_rating': {
    label: 'Average Rating',
    helpText: 'Overall rating (0-5)',
    type: 'number',
    min: 0,
    max: 5,
  },
} as const;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const CINQUETERRE_RESTAURANT_COLLECTION_TYPE = {
  type: 'cinqueterre_restaurants',
  displayName: 'Cinque Terre Restaurants',
  singularName: 'Restaurant',
  icon: 'utensils',
  color: '#F97316',
  description: 'Restaurant data for Cinque Terre villages',
  schema: CinqueTerreRestaurantSchema,
  createSchema: CreateCinqueTerreRestaurantSchema,
  fieldMetadata: CinqueTerreRestaurantFieldMetadata,
} as const;
