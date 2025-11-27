/**
 * Cinque Terre Event Collection Schema
 * Comprehensive schema for events and festivals
 */

import { z } from 'zod';

// =============================================================================
// SUB-SCHEMAS
// =============================================================================

export const EventCoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const EventCategorySchema = z.object({
  primary: z.enum([
    'Festival',
    'Religious',
    'Cultural',
    'Market',
    'Concert',
    'Food & Wine',
    'Sporting',
    'Seasonal',
    'Traditional',
    'Exhibition',
    'Theater',
    'Workshop',
    'Music',
    'Art',
    'Family',
  ]),
  secondary: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const EventOccurrenceSchema = z.object({
  start_date: z.string(),
  end_date: z.string(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  all_day: z.boolean().default(false),
  timezone: z.string().default('Europe/Rome'),
});

export const TypicalScheduleSchema = z.object({
  month: z.string().nullable().optional(),
  day_of_month: z.number().int().nullable().optional(),
  day_of_week: z.string().nullable().optional(),
  week_of_month: z.number().int().nullable().optional(),
  season: z.enum(['Spring', 'Summer', 'Fall', 'Winter', 'Year-Round']).optional(),
  duration_days: z.number().int().default(1),
  duration_hours: z.number().int().nullable().optional(),
});

export const EventScheduleSchema = z.object({
  event_type: z.enum(['Annual', 'Monthly', 'Weekly', 'One-Time', 'Seasonal', 'Recurring']),
  recurrence_pattern: z.string().nullable().optional(),
  next_occurrence: EventOccurrenceSchema,
  typical_schedule: TypicalScheduleSchema.optional(),
  historical_dates: z.array(z.object({
    year: z.number().int(),
    date: z.string(),
  })).default([]),
  schedule_notes: z.string().optional(),
  confirmed: z.boolean().default(false),
  cancellation_history: z.string().nullable().optional(),
});

export const EventLocationSchema = z.object({
  venue_name: z.string(),
  venue_type: z.enum(['Outdoor', 'Indoor', 'Mixed']),
  address: z.string(),
  area: z.enum(['Village Center', 'Harbor', 'Hilltop', 'Throughout Village', 'Church', 'Square']),
  city: z.string().default('Riomaggiore'),
  region: z.string().default('Liguria'),
  country: z.string().default('Italy'),
  coordinates: EventCoordinatesSchema,
  venue_capacity: z.number().int().nullable().optional(),
  multiple_locations: z.boolean().default(false),
  meeting_point: z.string().nullable().optional(),
});

export const OrganizerSchema = z.object({
  name: z.string(),
  type: z.enum(['Municipality', 'Non-Profit', 'Religious', 'Private', 'Tourism Board']),
  website: z.string().nullable().optional(),
  contact_email: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
});

export const EventDetailsSchema = z.object({
  description_short: z.string(),
  description_long: z.string().optional(),
  history: z.string().optional(),
  significance: z.string().optional(),
  year_established: z.number().int().nullable().optional(),
  organizer: OrganizerSchema.optional(),
  official_event: z.boolean().default(false),
  tradition_origin: z.enum(['Religious', 'Pagan', 'Historical', 'Modern']).nullable().optional(),
});

export const ActivityScheduleItemSchema = z.object({
  time: z.string(),
  activity: z.string(),
  location: z.string().optional(),
  duration_minutes: z.number().int().optional(),
});

export const PerformerSchema = z.object({
  name: z.string(),
  type: z.string(),
  performance_time: z.string().optional(),
});

export const WorkshopSchema = z.object({
  name: z.string(),
  time: z.string(),
  price_eur: z.number().nullable().optional(),
});

export const EventProgramSchema = z.object({
  highlights: z.array(z.string()).default([]),
  schedule_of_activities: z.array(ActivityScheduleItemSchema).default([]),
  main_attractions: z.array(z.string()).default([]),
  performers: z.array(PerformerSchema).default([]),
  workshops: z.array(WorkshopSchema).default([]),
});

export const SignatureDishSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  typical_price_eur: z.number().optional(),
});

export const FoodAndDrinkSchema = z.object({
  food_available: z.boolean().default(false),
  food_stalls: z.boolean().default(false),
  number_of_stalls: z.number().int().nullable().optional(),
  local_specialties_served: z.array(z.string()).default([]),
  signature_dishes: z.array(SignatureDishSchema).default([]),
  wine_featured: z.boolean().default(false),
  wine_types: z.array(z.string()).default([]),
  restaurants_participating: z.array(z.string()).default([]),
  food_included_in_ticket: z.boolean().default(false),
});

export const EventPricingSchema = z.object({
  general_admission_eur: z.number().nullable().optional(),
  adult_eur: z.number().nullable().optional(),
  child_eur: z.number().nullable().optional(),
  family_pass_eur: z.number().nullable().optional(),
});

export const TicketsPricingSchema = z.object({
  is_free: z.boolean().default(true),
  ticket_required: z.boolean().default(false),
  pricing: EventPricingSchema.optional(),
  booking_required: z.boolean().default(false),
  booking_url: z.string().nullable().optional(),
  sells_out: z.boolean().default(false),
  typical_sellout_time: z.string().nullable().optional(),
  price_notes: z.string().nullable().optional(),
});

export const AttendanceSchema = z.object({
  expected_attendance: z.number().int().optional(),
  typical_attendance_range: z.object({
    min: z.number().int(),
    max: z.number().int(),
  }).optional(),
  crowd_level: z.enum(['Very High', 'High', 'Moderate', 'Low']).optional(),
  local_vs_tourist_ratio: z.string().optional(),
  family_friendly: z.boolean().default(true),
  peak_hours: z.string().optional(),
  best_arrival_time: z.string().optional(),
});

export const AccessibilityInfoSchema = z.object({
  wheelchair_accessible: z.boolean().default(false),
  accessibility_notes: z.string().optional(),
});

export const PublicTransportSchema = z.object({
  train_service: z.string().optional(),
  last_train_to_la_spezia: z.string().optional(),
  boat_service: z.string().nullable().optional(),
});

export const FacilitiesSchema = z.object({
  restrooms: z.boolean().default(false),
  first_aid: z.boolean().default(false),
  information_booth: z.boolean().default(false),
});

export const PracticalInfoSchema = z.object({
  dress_code: z.string().nullable().optional(),
  what_to_bring: z.array(z.string()).default([]),
  what_to_wear: z.string().optional(),
  accessibility: AccessibilityInfoSchema.optional(),
  parking: z.object({
    available: z.boolean(),
    notes: z.string().optional(),
  }).optional(),
  public_transport: PublicTransportSchema.optional(),
  facilities: FacilitiesSchema.optional(),
  rules_regulations: z.array(z.string()).default([]),
  pet_policy: z.string().optional(),
  photography_policy: z.string().optional(),
});

export const TypicalWeatherSchema = z.object({
  temperature_high_c: z.number().int().optional(),
  temperature_low_c: z.number().int().optional(),
  precipitation_chance_percent: z.number().int().optional(),
});

export const WeatherContingencySchema = z.object({
  weather_dependent: z.boolean().default(false),
  rain_policy: z.string().optional(),
  backup_date: z.string().nullable().optional(),
  indoor_alternative: z.boolean().default(false),
  cancellation_notification: z.string().optional(),
  typical_weather: TypicalWeatherSchema.optional(),
});

export const EventRatingsSchema = z.object({
  average_rating: z.number().min(0).max(5),
  total_reviews: z.number().int().default(0),
  google: z.object({
    rating: z.number().nullable().optional(),
    review_count: z.number().int().nullable().optional(),
  }).optional(),
  tripadvisor: z.object({
    rating: z.number().nullable().optional(),
    review_count: z.number().int().nullable().optional(),
    ranking: z.string().nullable().optional(),
  }).optional(),
  facebook: z.object({
    interested_count: z.number().int().nullable().optional(),
    going_count: z.number().int().nullable().optional(),
    event_url: z.string().nullable().optional(),
  }).optional(),
});

export const EventReviewSchema = z.object({
  source: z.enum(['TripAdvisor', 'Google', 'Facebook', 'Blog']),
  author: z.string(),
  author_country: z.string().optional(),
  rating: z.number().int().min(1).max(5),
  date: z.string(),
  title: z.string().nullable().optional(),
  text: z.string(),
  visit_year: z.number().int().optional(),
  verified_attendance: z.boolean().default(false),
  helpful_votes: z.number().int().nullable().optional(),
  highlights_mentioned: z.array(z.string()).default([]),
  complaints_mentioned: z.array(z.string()).default([]),
});

export const EventImageSchema = z.object({
  url: z.string(),
  source: z.enum(['Google', 'TripAdvisor', 'Official', 'Local News', 'Flickr']),
  alt_text: z.string(),
  type: z.enum(['fireworks', 'procession', 'crowd', 'food', 'venue', 'performers', 'poster', 'historical']),
  year_taken: z.number().int().nullable().optional(),
});

export const TipsRecommendationsSchema = z.object({
  insider_tips: z.array(z.string()).default([]),
  best_viewing_spots: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  local_customs: z.array(z.string()).default([]),
  combine_with: z.array(z.string()).default([]),
});

export const SafetySecuritySchema = z.object({
  security_present: z.boolean().default(false),
  emergency_services: z.boolean().default(false),
  first_aid_stations: z.number().int().default(0),
  emergency_contact: z.string().default('112'),
  prohibited_items: z.array(z.string()).default([]),
});

export const BookingRecommendationsSchema = z.object({
  accommodation_book_ahead_weeks: z.number().int().optional(),
  restaurant_reservations_recommended: z.boolean().default(false),
  transport_book_ahead: z.boolean().default(false),
});

export const EventProsConsSchema = z.object({
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
});

// =============================================================================
// MAIN EVENT SCHEMA
// =============================================================================

export const CinqueTerreEventSchema = z.object({
  // Identification
  rank: z.number().int().optional(),
  name: z.string().min(1),
  name_local: z.string().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/),

  // Classification
  category: EventCategorySchema,
  village: z.enum(['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso', 'All Villages']).optional(),

  // Schedule
  schedule: EventScheduleSchema,

  // Location
  location: EventLocationSchema,

  // Details
  details: EventDetailsSchema,

  // Program
  program: EventProgramSchema.optional(),

  // Food
  food_and_drink: FoodAndDrinkSchema.optional(),

  // Pricing
  tickets_pricing: TicketsPricingSchema.optional(),

  // Attendance
  attendance: AttendanceSchema.optional(),

  // Practical
  practical_info: PracticalInfoSchema.optional(),

  // Weather
  weather_contingency: WeatherContingencySchema.optional(),

  // Ratings
  ratings_reviews: EventRatingsSchema.optional(),
  reviews: z.array(EventReviewSchema).default([]),

  // Images
  images: z.array(EventImageSchema).default([]),

  // Social
  social_media: z.object({
    official_hashtag: z.string().nullable().optional(),
    instagram_hashtag_count: z.number().int().nullable().optional(),
    facebook_event_page: z.string().nullable().optional(),
    live_streaming: z.boolean().default(false),
  }).optional(),

  // Safety
  safety_security: SafetySecuritySchema.optional(),

  // Tips
  tips_recommendations: TipsRecommendationsSchema.optional(),

  // Related
  related_events: z.array(z.object({
    name: z.string(),
    relationship: z.string(),
    date: z.string().optional(),
  })).default([]),

  // Contact
  contact_info: z.object({
    main_contact: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    website: z.string().optional(),
  }).optional(),

  // Summary
  pros_cons: EventProsConsSchema.optional(),

  // Booking
  booking_recommendations: BookingRecommendationsSchema.optional(),

  // Metadata
  last_updated: z.string().datetime().optional(),
  data_source: z.string().default('claude_web_search'),
});

export type CinqueTerreEvent = z.infer<typeof CinqueTerreEventSchema>;

// =============================================================================
// COLLECTION RESPONSE SCHEMA
// =============================================================================

export const CinqueTerreEventResponseSchema = z.object({
  metadata: z.object({
    query_location: z.string(),
    generated_at: z.string(),
    total_results: z.number().int(),
    sort_order: z.string().optional(),
    date_range_searched: z.object({
      from: z.string(),
      to: z.string(),
    }).optional(),
    categories_included: z.array(z.string()).default([]),
  }),
  events: z.array(CinqueTerreEventSchema),
});

export type CinqueTerreEventResponse = z.infer<typeof CinqueTerreEventResponseSchema>;

// =============================================================================
// CREATE SCHEMA
// =============================================================================

export const CreateCinqueTerreEventSchema = CinqueTerreEventSchema.omit({
  rank: true,
  last_updated: true,
});

export type CreateCinqueTerreEvent = z.infer<typeof CreateCinqueTerreEventSchema>;

// =============================================================================
// FIELD METADATA
// =============================================================================

export const CinqueTerreEventFieldMetadata = {
  name: {
    label: 'Event Name',
    placeholder: 'Enter event name',
    helpText: 'The name of the event',
    required: true,
  },
  slug: {
    label: 'URL Slug',
    placeholder: 'event-name',
    helpText: 'URL-friendly identifier',
    required: true,
  },
  'category.primary': {
    label: 'Category',
    type: 'select',
    options: ['Festival', 'Religious', 'Cultural', 'Market', 'Concert', 'Food & Wine'],
    required: true,
  },
  'schedule.event_type': {
    label: 'Event Type',
    type: 'select',
    options: ['Annual', 'Monthly', 'Weekly', 'One-Time', 'Seasonal', 'Recurring'],
  },
  'tickets_pricing.is_free': {
    label: 'Free Event',
    type: 'boolean',
  },
} as const;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const CINQUETERRE_EVENT_COLLECTION_TYPE = {
  type: 'cinqueterre_events',
  displayName: 'Cinque Terre Events',
  singularName: 'Event',
  icon: 'calendar',
  color: '#8B5CF6',
  description: 'Events and festivals in Cinque Terre',
  schema: CinqueTerreEventSchema,
  createSchema: CreateCinqueTerreEventSchema,
  fieldMetadata: CinqueTerreEventFieldMetadata,
} as const;
