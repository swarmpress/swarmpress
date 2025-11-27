/**
 * Cinque Terre Accommodation Collection Schema
 * Comprehensive schema for hotels, B&Bs, and apartments
 */

import { z } from 'zod';

// =============================================================================
// SUB-SCHEMAS
// =============================================================================

export const AccommodationCoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const AccommodationTypeSchema = z.object({
  category: z.enum(['Hotel', 'B&B', 'Apartment', 'Guesthouse', 'Hostel', 'Villa', 'Room Rental']),
  star_rating: z.number().int().min(1).max(5).nullable().optional(),
  property_class: z.enum(['Luxury', 'Boutique', 'Mid-Range', 'Budget', 'Vacation Rental']).optional(),
});

export const DistanceToLandmarksSchema = z.object({
  train_station_meters: z.number().int().optional(),
  harbor_meters: z.number().int().optional(),
  main_street_meters: z.number().int().optional(),
  nearest_beach_meters: z.number().int().nullable().optional(),
});

export const AccommodationLocationSchema = z.object({
  address: z.string(),
  street: z.string().optional(),
  postal_code: z.string().default('19017'),
  city: z.string(),
  region: z.string().default('Liguria'),
  country: z.string().default('Italy'),
  coordinates: AccommodationCoordinatesSchema,
  location_description: z.string().optional(),
  distance_to_landmarks: DistanceToLandmarksSchema.optional(),
  accessibility_notes: z.string().optional(),
});

export const BookingUrlsSchema = z.object({
  direct: z.string().nullable().optional(),
  booking_com: z.string().nullable().optional(),
  expedia: z.string().nullable().optional(),
  airbnb: z.string().nullable().optional(),
});

export const AccommodationContactSchema = z.object({
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  booking_urls: BookingUrlsSchema.optional(),
});

export const PlatformRatingSchema = z.object({
  rating: z.number().nullable().optional(),
  review_count: z.number().int().nullable().optional(),
  url: z.string().nullable().optional(),
  ranking: z.string().nullable().optional(),
  certificate_of_excellence: z.boolean().optional(),
  superhost: z.boolean().nullable().optional(),
});

export const AccommodationRatingsSchema = z.object({
  average_rating: z.number().min(0).max(5),
  google: PlatformRatingSchema.optional(),
  booking_com: PlatformRatingSchema.optional(),
  tripadvisor: PlatformRatingSchema.optional(),
  expedia: PlatformRatingSchema.optional(),
  airbnb: PlatformRatingSchema.optional(),
  hotels_com: PlatformRatingSchema.optional(),
});

export const SeasonPricingSchema = z.object({
  min_per_night: z.number().int(),
  max_per_night: z.number().int(),
});

export const AccommodationPricingSchema = z.object({
  currency: z.string().default('EUR'),
  price_level: z.enum(['€', '€€', '€€€', '€€€€']),
  price_range: z.object({
    low_season: SeasonPricingSchema.optional(),
    high_season: SeasonPricingSchema.optional(),
    peak_season: SeasonPricingSchema.optional(),
  }).optional(),
  average_nightly_rate: z.number().int().optional(),
  cleaning_fee: z.number().int().nullable().optional(),
  service_fee_percent: z.number().int().nullable().optional(),
  taxes_included: z.boolean().default(false),
  cancellation_policy: z.string().optional(),
  payment_methods: z.array(z.string()).default([]),
  deposit_required: z.boolean().default(false),
  deposit_amount_eur: z.number().int().nullable().optional(),
});

export const RoomTypeSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  max_occupancy: z.number().int(),
  bed_configuration: z.string().optional(),
  size_sqm: z.number().int().nullable().optional(),
  has_private_bathroom: z.boolean().default(true),
  has_view: z.boolean().default(false),
  view_type: z.enum(['Sea View', 'Village View', 'Garden View']).nullable().optional(),
  price_per_night_eur: z.number().int().optional(),
  amenities: z.array(z.string()).default([]),
});

export const RoomsUnitsSchema = z.object({
  total_rooms: z.number().int(),
  room_types: z.array(RoomTypeSchema).default([]),
});

export const ParkingInfoSchema = z.object({
  available: z.boolean().default(false),
  type: z.enum(['On-site', 'Nearby', 'Street']).nullable().optional(),
  price_per_day_eur: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const BreakfastInfoSchema = z.object({
  included: z.boolean().default(false),
  type: z.enum(['Continental', 'Italian', 'Buffet', 'À la carte']).nullable().optional(),
  price_if_extra_eur: z.number().int().nullable().optional(),
  hours: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const PetPolicySchema = z.object({
  allowed: z.boolean().default(false),
  fee_per_night_eur: z.number().int().nullable().optional(),
  restrictions: z.string().nullable().optional(),
});

export const AmenitiesSchema = z.object({
  general: z.array(z.string()).default([]),
  room_amenities: z.array(z.string()).default([]),
  kitchen: z.array(z.string()).default([]),
  outdoor: z.array(z.string()).default([]),
  services: z.array(z.string()).default([]),
  accessibility: z.array(z.string()).default([]),
  parking: ParkingInfoSchema.optional(),
  breakfast: BreakfastInfoSchema.optional(),
  pets: PetPolicySchema.optional(),
});

export const CheckInSchema = z.object({
  from: z.string(),
  to: z.string().optional(),
  flexible: z.boolean().default(false),
  self_check_in: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});

export const CheckOutSchema = z.object({
  by: z.string(),
  late_checkout_available: z.boolean().default(false),
  late_checkout_fee_eur: z.number().int().nullable().optional(),
});

export const MinimumStaySchema = z.object({
  low_season: z.number().int().default(1),
  high_season: z.number().int().default(2),
  peak_season: z.number().int().default(3),
});

export const PoliciesSchema = z.object({
  check_in: CheckInSchema,
  check_out: CheckOutSchema,
  minimum_stay: MinimumStaySchema.optional(),
  age_restriction: z.string().nullable().optional(),
  smoking: z.enum(['Non-smoking', 'Designated areas', 'Allowed']).default('Non-smoking'),
  parties_events: z.enum(['Not allowed', 'Allowed', 'Upon request']).default('Not allowed'),
  quiet_hours: z.string().nullable().optional(),
});

export const HostInfoSchema = z.object({
  host_name: z.string().nullable().optional(),
  host_type: z.enum(['Individual', 'Professional', 'Property Management']).optional(),
  languages_spoken: z.array(z.string()).default([]),
  response_rate_percent: z.number().int().nullable().optional(),
  response_time: z.string().nullable().optional(),
  superhost_status: z.boolean().nullable().optional(),
  years_hosting: z.number().int().nullable().optional(),
  local_tips_provided: z.boolean().default(false),
});

export const AccommodationReviewSchema = z.object({
  source: z.enum(['Booking.com', 'TripAdvisor', 'Google', 'Airbnb', 'Expedia']),
  author: z.string(),
  author_country: z.string().optional(),
  rating: z.number().min(1).max(10),
  date: z.string(),
  title: z.string().nullable().optional(),
  text: z.string(),
  stayed_in: z.string().nullable().optional(),
  trip_type: z.enum(['Couple', 'Family', 'Solo', 'Business', 'Friends']).optional(),
  verified_stay: z.boolean().default(false),
  helpful_votes: z.number().int().nullable().optional(),
  pros_mentioned: z.array(z.string()).default([]),
  cons_mentioned: z.array(z.string()).default([]),
});

export const AccommodationImageSchema = z.object({
  url: z.string(),
  source: z.enum(['Official', 'Booking.com', 'TripAdvisor', 'Google', 'Airbnb']),
  alt_text: z.string(),
  type: z.enum(['exterior', 'interior', 'room', 'bathroom', 'view', 'breakfast', 'common_area']),
});

export const AccommodationProsConsSchema = z.object({
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
});

export const NearbySchema = z.object({
  restaurants: z.array(z.string()).default([]),
  attractions: z.array(z.string()).default([]),
  transport: z.array(z.string()).default([]),
});

export const SustainabilitySchema = z.object({
  eco_certified: z.boolean().default(false),
  practices: z.array(z.string()).default([]),
});

// =============================================================================
// MAIN ACCOMMODATION SCHEMA
// =============================================================================

export const CinqueTerreAccommodationSchema = z.object({
  // Identification
  rank: z.number().int().optional(),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),

  // Type
  type: AccommodationTypeSchema,
  village: z.enum(['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso']),

  // Location
  location: AccommodationLocationSchema,

  // Contact
  contact: AccommodationContactSchema.optional(),

  // Ratings
  ratings: AccommodationRatingsSchema,

  // Pricing
  pricing: AccommodationPricingSchema,

  // Rooms
  rooms_units: RoomsUnitsSchema.optional(),

  // Amenities
  amenities: AmenitiesSchema.optional(),

  // Policies
  policies: PoliciesSchema.optional(),

  // Host
  host_info: HostInfoSchema.optional(),

  // Reviews
  reviews: z.array(AccommodationReviewSchema).default([]),

  // Images
  images: z.array(AccommodationImageSchema).default([]),

  // Summary
  pros_cons: AccommodationProsConsSchema.optional(),
  tips: z.array(z.string()).default([]),

  // Nearby
  nearby: NearbySchema.optional(),

  // Sustainability
  sustainability: SustainabilitySchema.optional(),

  // Metadata
  last_updated: z.string().datetime().optional(),
  data_source: z.string().default('claude_web_search'),
});

export type CinqueTerreAccommodation = z.infer<typeof CinqueTerreAccommodationSchema>;

// =============================================================================
// COLLECTION RESPONSE SCHEMA
// =============================================================================

export const CinqueTerreAccommodationResponseSchema = z.object({
  metadata: z.object({
    query_location: z.string(),
    generated_at: z.string(),
    total_results: z.number().int(),
    sort_order: z.string().optional(),
    search_type: z.string().default('accommodations'),
  }),
  accommodations: z.array(CinqueTerreAccommodationSchema),
});

export type CinqueTerreAccommodationResponse = z.infer<typeof CinqueTerreAccommodationResponseSchema>;

// =============================================================================
// CREATE SCHEMA
// =============================================================================

export const CreateCinqueTerreAccommodationSchema = CinqueTerreAccommodationSchema.omit({
  rank: true,
  last_updated: true,
});

export type CreateCinqueTerreAccommodation = z.infer<typeof CreateCinqueTerreAccommodationSchema>;

// =============================================================================
// FIELD METADATA
// =============================================================================

export const CinqueTerreAccommodationFieldMetadata = {
  name: {
    label: 'Property Name',
    placeholder: 'Enter property name',
    helpText: 'The name of the accommodation',
    required: true,
  },
  slug: {
    label: 'URL Slug',
    placeholder: 'property-name',
    helpText: 'URL-friendly identifier',
    required: true,
  },
  'type.category': {
    label: 'Type',
    type: 'select',
    options: ['Hotel', 'B&B', 'Apartment', 'Guesthouse', 'Hostel', 'Villa', 'Room Rental'],
    required: true,
  },
  village: {
    label: 'Village',
    type: 'select',
    options: ['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso'],
    required: true,
  },
  'type.star_rating': {
    label: 'Star Rating',
    type: 'select',
    options: [1, 2, 3, 4, 5],
  },
  'pricing.price_level': {
    label: 'Price Level',
    type: 'select',
    options: ['€', '€€', '€€€', '€€€€'],
  },
  'ratings.average_rating': {
    label: 'Average Rating',
    type: 'number',
    min: 0,
    max: 5,
  },
} as const;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const CINQUETERRE_ACCOMMODATION_COLLECTION_TYPE = {
  type: 'cinqueterre_accommodations',
  displayName: 'Cinque Terre Accommodations',
  singularName: 'Accommodation',
  icon: 'bed',
  color: '#EC4899',
  description: 'Hotels, B&Bs, and apartments in Cinque Terre',
  schema: CinqueTerreAccommodationSchema,
  createSchema: CreateCinqueTerreAccommodationSchema,
  fieldMetadata: CinqueTerreAccommodationFieldMetadata,
} as const;
