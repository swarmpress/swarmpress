/**
 * Cinque Terre POI (Point of Interest) Collection Schema
 * Comprehensive schema for attractions and landmarks
 */

import { z } from 'zod';

// =============================================================================
// SUB-SCHEMAS
// =============================================================================

export const POICoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const POICategorySchema = z.object({
  primary: z.enum([
    'Beach',
    'Viewpoint',
    'Hiking Trail',
    'Historic Site',
    'Church',
    'Landmark',
    'Natural Attraction',
    'Harbor',
    'Museum',
    'Activity',
    'Square',
    'Street',
    'Castle',
    'Tower',
    'Cliff',
    'Cave',
    'Diving Spot',
  ]),
  secondary: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const POIPopularitySchema = z.object({
  popularity_score: z.number().min(0).max(100),
  popularity_rank: z.number().int().optional(),
  total_reviews: z.number().int().default(0),
  monthly_visitors_estimate: z.number().int().nullable().optional(),
  peak_season_crowd_level: z.enum(['Very High', 'High', 'Moderate', 'Low']),
  best_time_to_visit: z.string().optional(),
  instagram_hashtag_count: z.number().int().nullable().optional(),
  featured_in: z.array(z.string()).default([]),
});

export const DirectionsSchema = z.object({
  from_train_station: z.string().optional(),
  from_harbor: z.string().optional(),
  from_main_street: z.string().optional(),
});

export const DistanceFromLandmarksSchema = z.object({
  train_station_meters: z.number().int().optional(),
  harbor_meters: z.number().int().optional(),
  main_square_meters: z.number().int().optional(),
});

export const POILocationSchema = z.object({
  address: z.string(),
  area: z.enum(['Harbor Area', 'Village Center', 'Hilltop', 'Coastal Path', 'Outskirts']),
  postal_code: z.string().default('19017'),
  city: z.string(),
  region: z.string().default('Liguria'),
  country: z.string().default('Italy'),
  coordinates: POICoordinatesSchema,
  location_description: z.string().optional(),
  directions: DirectionsSchema.optional(),
  distance_from_landmarks: DistanceFromLandmarksSchema.optional(),
});

export const POIAccessSchema = z.object({
  accessibility_rating: z.enum(['Easy', 'Moderate', 'Difficult', 'Very Difficult']),
  accessibility_details: z.string().optional(),
  stairs_count: z.number().int().nullable().optional(),
  walking_time_from_station_minutes: z.number().int().optional(),
  requires_hiking: z.boolean().default(false),
  hiking_difficulty: z.enum(['Easy', 'Moderate', 'Difficult']).nullable().optional(),
  trail_length_km: z.number().nullable().optional(),
  elevation_gain_meters: z.number().int().nullable().optional(),
  wheelchair_accessible: z.boolean().default(false),
  stroller_friendly: z.boolean().default(false),
  suitable_for_elderly: z.boolean().default(false),
  suitable_for_children: z.boolean().default(true),
  swimming_required: z.boolean().default(false),
  boat_access_available: z.boolean().default(false),
  parking_nearby: z.boolean().default(false),
  public_transport_access: z.string().optional(),
});

export const PlatformRatingSchema = z.object({
  rating: z.number().nullable().optional(),
  review_count: z.number().int().nullable().optional(),
  url: z.string().nullable().optional(),
  ranking: z.string().nullable().optional(),
  certificate_of_excellence: z.boolean().optional(),
  travelers_choice: z.boolean().optional(),
});

export const POIRatingsSchema = z.object({
  average_rating: z.number().min(0).max(5),
  google: PlatformRatingSchema.optional(),
  tripadvisor: PlatformRatingSchema.optional(),
  viator: PlatformRatingSchema.optional(),
  get_your_guide: PlatformRatingSchema.optional(),
  yelp: PlatformRatingSchema.optional(),
  foursquare: z.object({
    rating: z.number().nullable().optional(),
    url: z.string().nullable().optional(),
  }).optional(),
});

export const SizeSchema = z.object({
  area_sqm: z.number().int().nullable().optional(),
  length_meters: z.number().int().nullable().optional(),
  height_meters: z.number().int().nullable().optional(),
});

export const POIDetailsSchema = z.object({
  description_short: z.string(),
  description_long: z.string().optional(),
  historical_significance: z.string().nullable().optional(),
  year_established: z.number().int().nullable().optional(),
  architectural_style: z.string().nullable().optional(),
  unesco_status: z.string().nullable().optional(),
  size: SizeSchema.optional(),
  features: z.array(z.string()).default([]),
  wildlife: z.array(z.string()).default([]),
  flora: z.array(z.string()).default([]),
});

export const EntryFeeSchema = z.object({
  is_free: z.boolean().default(true),
  adult_eur: z.number().nullable().optional(),
  child_eur: z.number().nullable().optional(),
  senior_eur: z.number().nullable().optional(),
  student_eur: z.number().nullable().optional(),
  family_pass_eur: z.number().nullable().optional(),
  cinque_terre_card_included: z.boolean().default(false),
  free_days: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const DayHoursSchema = z.object({
  open: z.string().nullable().optional(),
  close: z.string().nullable().optional(),
  closed: z.boolean().default(false),
});

export const OpeningHoursSchema = z.object({
  is_always_open: z.boolean().default(false),
  hours: z.object({
    monday: DayHoursSchema.optional(),
    tuesday: DayHoursSchema.optional(),
    wednesday: DayHoursSchema.optional(),
    thursday: DayHoursSchema.optional(),
    friday: DayHoursSchema.optional(),
    saturday: DayHoursSchema.optional(),
    sunday: DayHoursSchema.optional(),
  }).optional(),
  seasonal_variations: z.string().nullable().optional(),
  last_entry_before_closing: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const BestVisitingTimeSchema = z.object({
  time_of_day: z.enum(['Sunrise', 'Morning', 'Midday', 'Afternoon', 'Sunset', 'Evening', 'Night', 'Any']),
  best_months: z.array(z.string()).default([]),
  avoid_months: z.array(z.string()).default([]),
  avoid_times: z.string().optional(),
  sunset_time_approximate: z.string().nullable().optional(),
  golden_hour_recommended: z.boolean().default(false),
});

export const DurationSchema = z.object({
  minimum_minutes: z.number().int(),
  recommended_minutes: z.number().int(),
  maximum_minutes: z.number().int().optional(),
});

export const GuidedToursSchema = z.object({
  available: z.boolean().default(false),
  languages: z.array(z.string()).default([]),
  price_range_eur: z.string().nullable().optional(),
  booking_url: z.string().nullable().optional(),
});

export const AudioGuideSchema = z.object({
  available: z.boolean().default(false),
  languages: z.array(z.string()).default([]),
  price_eur: z.number().nullable().optional(),
});

export const VisitingInfoSchema = z.object({
  entry_fee: EntryFeeSchema.optional(),
  opening_hours: OpeningHoursSchema.optional(),
  best_visiting_time: BestVisitingTimeSchema.optional(),
  duration: DurationSchema.optional(),
  guided_tours: GuidedToursSchema.optional(),
  audio_guide: AudioGuideSchema.optional(),
});

export const EquipmentRentalSchema = z.object({
  available: z.boolean().default(false),
  types: z.array(z.string()).default([]),
  prices: z.string().nullable().optional(),
});

export const POIFacilitiesSchema = z.object({
  restrooms: z.boolean().default(false),
  drinking_water: z.boolean().default(false),
  food_nearby: z.boolean().default(false),
  restaurants_nearby: z.array(z.string()).default([]),
  shops_nearby: z.boolean().default(false),
  benches_seating: z.boolean().default(false),
  shade_available: z.boolean().default(false),
  lighting_at_night: z.boolean().default(false),
  lifeguard: z.boolean().default(false),
  first_aid: z.boolean().default(false),
  information_board: z.boolean().default(false),
  wifi: z.boolean().default(false),
  charging_stations: z.boolean().default(false),
  lockers: z.boolean().default(false),
  changing_rooms: z.boolean().default(false),
  showers: z.boolean().default(false),
  equipment_rental: EquipmentRentalSchema.optional(),
});

export const GuidedExperienceSchema = z.object({
  name: z.string(),
  provider: z.string(),
  duration_hours: z.number(),
  price_eur: z.number(),
  url: z.string().optional(),
});

export const SeasonalActivitiesSchema = z.object({
  summer: z.array(z.string()).default([]),
  winter: z.array(z.string()).default([]),
  year_round: z.array(z.string()).default([]),
});

export const POIActivitiesSchema = z.object({
  primary_activities: z.array(z.string()).default([]),
  secondary_activities: z.array(z.string()).default([]),
  water_activities: z.array(z.string()).default([]),
  guided_experiences: z.array(GuidedExperienceSchema).default([]),
  prohibited_activities: z.array(z.string()).default([]),
  seasonal_activities: SeasonalActivitiesSchema.optional(),
});

export const SwimmingSafetySchema = z.object({
  lifeguard_on_duty: z.boolean().default(false),
  currents: z.enum(['Calm', 'Moderate', 'Strong']).nullable().optional(),
  water_depth: z.enum(['Shallow', 'Medium', 'Deep']).nullable().optional(),
  recommended_swimming_ability: z.string().nullable().optional(),
});

export const POISafetySchema = z.object({
  safety_rating: z.enum(['Safe', 'Caution Advised', 'Hazardous Conditions']),
  hazards: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  emergency_contact: z.string().default('112'),
  nearest_hospital_km: z.number().optional(),
  swimming_safety: SwimmingSafetySchema.optional(),
  weather_dependent: z.boolean().default(false),
  closed_in_bad_weather: z.boolean().default(false),
});

export const PracticalTipsSchema = z.object({
  what_to_bring: z.array(z.string()).default([]),
  what_to_wear: z.string().optional(),
  what_not_to_bring: z.array(z.string()).default([]),
  insider_tips: z.array(z.string()).default([]),
  common_mistakes: z.array(z.string()).default([]),
  photography_tips: z.array(z.string()).default([]),
  local_secrets: z.string().optional(),
});

export const RelatedPOISchema = z.object({
  name: z.string(),
  relationship: z.string(),
  distance_meters: z.number().int(),
});

export const SuggestedItinerarySchema = z.object({
  name: z.string(),
  pois_included: z.array(z.string()),
  duration_hours: z.number(),
});

export const ConnectivitySchema = z.object({
  related_pois: z.array(RelatedPOISchema).default([]),
  nearby_pois: z.array(z.string()).default([]),
  suggested_itineraries: z.array(SuggestedItinerarySchema).default([]),
  can_combine_with: z.array(z.string()).default([]),
});

export const POIReviewSchema = z.object({
  source: z.enum(['TripAdvisor', 'Google', 'Viator']),
  author: z.string(),
  author_country: z.string().optional(),
  rating: z.number().int().min(1).max(5),
  date: z.string(),
  title: z.string().nullable().optional(),
  text: z.string(),
  visit_type: z.enum(['Solo', 'Couple', 'Family', 'Friends', 'Tour Group']).optional(),
  visit_season: z.enum(['Summer', 'Fall', 'Winter', 'Spring']).optional(),
  verified: z.boolean().default(false),
  helpful_votes: z.number().int().nullable().optional(),
  photos_posted: z.number().int().default(0),
  highlights_mentioned: z.array(z.string()).default([]),
  complaints_mentioned: z.array(z.string()).default([]),
});

export const POIImageSchema = z.object({
  url: z.string(),
  source: z.enum(['Google', 'TripAdvisor', 'Official', 'Wikipedia', 'Flickr']),
  alt_text: z.string(),
  type: z.enum(['panoramic', 'detail', 'aerial', 'historical', 'activity', 'sunset', 'underwater']),
  photographer_credit: z.string().nullable().optional(),
  license: z.enum(['CC BY-SA', 'Public Domain', 'Rights Reserved']).nullable().optional(),
});

export const POIProsConsSchema = z.object({
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
});

export const AwardSchema = z.object({
  award: z.string(),
  year: z.number().int(),
  category: z.string().optional(),
});

export const SocialMediaSchema = z.object({
  instagram_hashtags: z.array(z.string()).default([]),
  tiktok_trending: z.boolean().default(false),
  pinterest_saves_estimate: z.number().int().nullable().optional(),
  featured_influencers: z.array(z.string()).default([]),
});

export const SustainabilitySchema = z.object({
  eco_guidelines: z.array(z.string()).default([]),
  conservation_efforts: z.string().nullable().optional(),
  crowd_management: z.string().nullable().optional(),
  environmental_concerns: z.array(z.string()).default([]),
});

export const POIContactSchema = z.object({
  official_website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  tourist_info_office: z.string().optional(),
});

// =============================================================================
// MAIN POI SCHEMA
// =============================================================================

export const CinqueTerrePoiSchema = z.object({
  // Identification
  rank: z.number().int().optional(),
  name: z.string().min(1),
  name_local: z.string().nullable().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/),

  // Classification
  category: POICategorySchema,
  village: z.enum(['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso']),

  // Popularity
  popularity: POIPopularitySchema,

  // Location
  location: POILocationSchema,

  // Access
  access: POIAccessSchema,

  // Ratings
  ratings: POIRatingsSchema,

  // Details
  details: POIDetailsSchema,

  // Visiting
  visiting_info: VisitingInfoSchema.optional(),

  // Facilities
  facilities: POIFacilitiesSchema.optional(),

  // Activities
  activities: POIActivitiesSchema.optional(),

  // Safety
  safety: POISafetySchema.optional(),

  // Tips
  practical_tips: PracticalTipsSchema.optional(),

  // Connectivity
  connectivity: ConnectivitySchema.optional(),

  // Reviews
  reviews: z.array(POIReviewSchema).default([]),

  // Images
  images: z.array(POIImageSchema).default([]),

  // Summary
  pros_cons: POIProsConsSchema.optional(),

  // Awards
  awards_recognition: z.array(AwardSchema).default([]),

  // Social
  social_media: SocialMediaSchema.optional(),

  // Sustainability
  sustainability: SustainabilitySchema.optional(),

  // Contact
  contact_info: POIContactSchema.optional(),

  // Metadata
  last_updated: z.string().datetime().optional(),
  data_source: z.string().default('claude_web_search'),
});

export type CinqueTerrePoi = z.infer<typeof CinqueTerrePoiSchema>;

// =============================================================================
// COLLECTION RESPONSE SCHEMA
// =============================================================================

export const CinqueTerrePoiResponseSchema = z.object({
  metadata: z.object({
    query_location: z.string(),
    generated_at: z.string(),
    total_results: z.number().int(),
    sort_order: z.string().optional(),
    search_type: z.string().default('points_of_interest'),
    categories_included: z.array(z.string()).default([]),
  }),
  points_of_interest: z.array(CinqueTerrePoiSchema),
});

export type CinqueTerrePoiResponse = z.infer<typeof CinqueTerrePoiResponseSchema>;

// =============================================================================
// CREATE SCHEMA
// =============================================================================

export const CreateCinqueTerrePoiSchema = CinqueTerrePoiSchema.omit({
  rank: true,
  last_updated: true,
});

export type CreateCinqueTerrePoi = z.infer<typeof CreateCinqueTerrePoiSchema>;

// =============================================================================
// FIELD METADATA
// =============================================================================

export const CinqueTerrePoiFieldMetadata = {
  name: {
    label: 'POI Name',
    placeholder: 'Enter point of interest name',
    helpText: 'The name of the attraction',
    required: true,
  },
  slug: {
    label: 'URL Slug',
    placeholder: 'poi-name',
    helpText: 'URL-friendly identifier',
    required: true,
  },
  'category.primary': {
    label: 'Category',
    type: 'select',
    options: ['Beach', 'Viewpoint', 'Hiking Trail', 'Historic Site', 'Church', 'Landmark', 'Natural Attraction', 'Harbor', 'Museum'],
    required: true,
  },
  village: {
    label: 'Village',
    type: 'select',
    options: ['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso'],
    required: true,
  },
  'popularity.popularity_score': {
    label: 'Popularity Score',
    type: 'number',
    min: 0,
    max: 100,
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

export const CINQUETERRE_POI_COLLECTION_TYPE = {
  type: 'cinqueterre_pois',
  displayName: 'Cinque Terre POIs',
  singularName: 'Point of Interest',
  icon: 'map-pin',
  color: '#EF4444',
  description: 'Points of interest and attractions in Cinque Terre',
  schema: CinqueTerrePoiSchema,
  createSchema: CreateCinqueTerrePoiSchema,
  fieldMetadata: CinqueTerrePoiFieldMetadata,
} as const;
