/**
 * Cinque Terre Hiking Trail Collection Schema
 * Comprehensive schema for hiking trail data fetched via Claude web search
 */

import { z } from 'zod';

// =============================================================================
// SUB-SCHEMAS
// =============================================================================

export const HikeCoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const HikeCategorySchema = z.object({
  primary: z.enum([
    'Coastal Path',
    'Mountain Trail',
    'Sanctuary Trail',
    'Village Connection',
    'Ridge Walk',
    'Valley Trail',
    'Historic Path',
  ]),
  secondary: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const HikePopularitySchema = z.object({
  popularity_score: z.number().min(0).max(100),
  total_reviews: z.number().int().default(0),
  annual_hikers_estimate: z.number().int().nullable().optional(),
  crowd_level: z.enum(['very-high', 'high', 'moderate', 'low', 'minimal']),
  best_time_to_avoid_crowds: z.string().optional(),
  instagram_hashtag_count: z.number().int().nullable().optional(),
  featured_in: z.array(z.string()).default([]),
});

export const TrailPointSchema = z.object({
  name: z.string(),
  location: z.string(),
  coordinates: HikeCoordinatesSchema,
  access: z.string().optional(),
  nearest_train_station: z.string().optional(),
  distance_from_station_m: z.number().int().optional(),
  distance_to_station_m: z.number().int().optional(),
  parking_available: z.boolean().optional(),
  facilities_at_start: z.array(z.string()).default([]),
  facilities_at_end: z.array(z.string()).default([]),
});

export const WaypointSchema = z.object({
  name: z.string(),
  km_from_start: z.number(),
  type: z.enum([
    'viewpoint',
    'village',
    'junction',
    'landmark',
    'water-source',
    'rest-area',
    'church',
    'sanctuary',
  ]),
  coordinates: HikeCoordinatesSchema.optional(),
  description: z.string().optional(),
  facilities: z.array(z.string()).default([]),
  photo_opportunity: z.boolean().default(false),
});

export const TrailConnectionSchema = z.object({
  trail_name: z.string(),
  junction_point: z.string(),
  trail_number: z.string().nullable().optional(),
});

export const HikeRouteSchema = z.object({
  start_point: TrailPointSchema,
  end_point: TrailPointSchema,
  route_type: z.enum(['point-to-point', 'loop', 'out-and-back']),
  reversible: z.boolean().default(true),
  preferred_direction: z.enum(['start-to-end', 'end-to-start', 'either']).default('either'),
  direction_notes: z.string().optional(),
  waypoints: z.array(WaypointSchema).default([]),
  villages_passed: z.array(z.string()).default([]),
  connections_to_other_trails: z.array(TrailConnectionSchema).default([]),
});

export const HikeDistanceSchema = z.object({
  km: z.number(),
  miles: z.number(),
});

export const HikeDurationSchema = z.object({
  minimum_hours: z.number(),
  average_hours: z.number(),
  leisurely_hours: z.number().optional(),
  with_stops_hours: z.number().optional(),
});

export const HikeElevationSchema = z.object({
  gain_m: z.number().int(),
  loss_m: z.number().int(),
  max_altitude_m: z.number().int(),
  min_altitude_m: z.number().int(),
  elevation_profile: z.enum([
    'gradual',
    'steep-sections',
    'constant-climb',
    'rolling',
    'steep-throughout',
  ]).optional(),
});

export const HikeStepsSchema = z.object({
  approximate_count: z.number().int().nullable().optional(),
  significant_stair_sections: z.boolean().default(false),
  stair_notes: z.string().nullable().optional(),
});

export const HikeMetricsSchema = z.object({
  distance: HikeDistanceSchema,
  duration: HikeDurationSchema,
  elevation: HikeElevationSchema,
  steps: HikeStepsSchema.optional(),
});

export const DifficultyFactorsSchema = z.object({
  terrain: z.enum(['paved', 'gravel', 'rocky', 'mixed', 'technical']),
  exposure: z.enum(['none', 'minimal', 'moderate', 'significant', 'extreme']),
  steepness: z.enum(['gentle', 'moderate', 'steep', 'very-steep']),
  navigation: z.enum(['very-easy', 'easy', 'moderate', 'difficult']),
  scrambling_required: z.boolean().default(false),
  vertigo_risk: z.boolean().default(false),
});

export const SuitabilitySchema = z.object({
  beginners: z.boolean().default(false),
  families_with_children: z.boolean().default(false),
  elderly: z.boolean().default(false),
  dogs: z.boolean().default(false),
  trail_runners: z.boolean().default(false),
});

export const HikeDifficultySchema = z.object({
  overall_rating: z.enum(['easy', 'moderate', 'difficult', 'very-difficult', 'expert']),
  technical_difficulty: z.enum(['T1-hiking', 'T2-mountain-hiking', 'T3-demanding', 'T4-alpine', 'T5-expert']).optional(),
  physical_difficulty: z.enum(['low', 'moderate', 'high', 'very-high']),
  difficulty_score: z.number().int().min(1).max(10),
  factors: DifficultyFactorsSchema.optional(),
  suitable_for: SuitabilitySchema.optional(),
  not_suitable_for: z.array(z.string()).default([]),
  difficulty_notes: z.string().optional(),
});

export const TrailMarkingsSchema = z.object({
  marked: z.boolean().default(true),
  marking_type: z.enum(['red-white-blazes', 'CAI-markers', 'signposts', 'painted-markers']).optional(),
  marking_quality: z.enum(['excellent', 'good', 'fair', 'poor']).optional(),
  easy_to_follow: z.boolean().default(true),
});

export const SurfacePercentageSchema = z.object({
  paved: z.number().int().optional(),
  stone_path: z.number().int().optional(),
  dirt_trail: z.number().int().optional(),
  rocky: z.number().int().optional(),
  stairs: z.number().int().optional(),
});

export const ConditionReportSchema = z.object({
  date: z.string(),
  source: z.string(),
  report: z.string(),
});

export const MaintenanceSchema = z.object({
  last_maintained: z.string().optional(),
  maintained_by: z.string().optional(),
  condition_quality: z.enum(['excellent', 'good', 'fair', 'poor']).optional(),
});

export const TrailConditionsSchema = z.object({
  current_status: z.enum(['open', 'partially-open', 'closed', 'unknown']),
  last_status_check: z.string().optional(),
  closure_details: z.string().nullable().optional(),
  expected_reopening: z.string().nullable().optional(),
  surface_types: z.array(z.string()).default([]),
  surface_percentage: SurfacePercentageSchema.optional(),
  trail_markings: TrailMarkingsSchema.optional(),
  hazards: z.array(z.string()).default([]),
  recent_conditions_reports: z.array(ConditionReportSchema).default([]),
  maintenance: MaintenanceSchema.optional(),
});

export const AccessAndFeesSchema = z.object({
  fee_required: z.boolean().default(false),
  fee_amount_eur: z.number().nullable().optional(),
  cinque_terre_card_valid: z.boolean().default(false),
  free_access: z.boolean().default(true),
  ticket_purchase_locations: z.array(z.string()).default([]),
  access_restrictions: z.string().nullable().optional(),
  seasonal_closures: z.string().nullable().optional(),
  opening_hours: z.string().nullable().optional(),
  group_permits_required: z.boolean().default(false),
  guide_required: z.boolean().default(false),
});

export const SeasonalHighlightsSchema = z.object({
  spring: z.string().optional(),
  summer: z.string().optional(),
  fall: z.string().optional(),
  winter: z.string().optional(),
});

export const BestTimesSchema = z.object({
  best_months: z.array(z.string()).default([]),
  worst_months: z.array(z.string()).default([]),
  best_time_of_day: z.enum(['early-morning', 'morning', 'midday', 'afternoon', 'sunset', 'any']).optional(),
  avoid_times: z.string().optional(),
  seasonal_highlights: SeasonalHighlightsSchema.optional(),
  sunrise_sunset_views: z.boolean().default(false),
  recommended_start_time: z.string().optional(),
});

export const ViewpointSchema = z.object({
  name: z.string(),
  km_from_start: z.number(),
  description: z.string().optional(),
  what_you_see: z.array(z.string()).default([]),
  best_light: z.enum(['morning', 'midday', 'afternoon', 'sunset']).optional(),
  photography_rating: z.number().int().min(1).max(10).optional(),
});

export const FloraFaunaSchema = z.object({
  notable_plants: z.array(z.string()).default([]),
  wildlife_possible: z.array(z.string()).default([]),
  best_wildflower_season: z.string().nullable().optional(),
});

export const InstagramSpotSchema = z.object({
  location: z.string(),
  km_from_start: z.number(),
  description: z.string().optional(),
});

export const HikeHighlightsSchema = z.object({
  main_attractions: z.array(z.string()).default([]),
  viewpoints: z.array(ViewpointSchema).default([]),
  natural_features: z.array(z.string()).default([]),
  historic_features: z.array(z.string()).default([]),
  flora_fauna: FloraFaunaSchema.optional(),
  unique_experiences: z.array(z.string()).default([]),
  instagram_spots: z.array(InstagramSpotSchema).default([]),
});

export const PlatformRatingsSchema = z.object({
  alltrails: z.object({
    rating: z.number().nullable().optional(),
    review_count: z.number().int().nullable().optional(),
    url: z.string().nullable().optional(),
  }).optional(),
  tripadvisor: z.object({
    rating: z.number().nullable().optional(),
    review_count: z.number().int().nullable().optional(),
    ranking: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
  }).optional(),
  komoot: z.object({
    rating: z.number().nullable().optional(),
    review_count: z.number().int().nullable().optional(),
    url: z.string().nullable().optional(),
  }).optional(),
  wikiloc: z.object({
    rating: z.number().nullable().optional(),
    review_count: z.number().int().nullable().optional(),
    url: z.string().nullable().optional(),
  }).optional(),
  google: z.object({
    rating: z.number().nullable().optional(),
    review_count: z.number().int().nullable().optional(),
  }).optional(),
});

export const HikeRatingsSchema = z.object({
  average_rating: z.number().min(0).max(5),
  total_reviews: z.number().int().default(0),
  rating_breakdown: z.object({
    '5_star_percent': z.number().int().optional(),
    '4_star_percent': z.number().int().optional(),
    '3_star_percent': z.number().int().optional(),
    '2_star_percent': z.number().int().optional(),
    '1_star_percent': z.number().int().optional(),
  }).optional(),
  platforms: PlatformRatingsSchema.optional(),
});

export const HikeReviewSchema = z.object({
  source: z.enum(['AllTrails', 'TripAdvisor', 'Komoot', 'Wikiloc', 'Google']),
  author: z.string(),
  author_country: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5),
  date: z.string(),
  title: z.string().nullable().optional(),
  text: z.string(),
  hike_date: z.string().nullable().optional(),
  conditions_mentioned: z.string().nullable().optional(),
  difficulty_opinion: z.enum(['easier-than-expected', 'as-expected', 'harder-than-expected']).nullable().optional(),
  would_recommend: z.boolean().default(true),
  helpful_votes: z.number().int().nullable().optional(),
  highlights_mentioned: z.array(z.string()).default([]),
  complaints_mentioned: z.array(z.string()).default([]),
  tips_shared: z.array(z.string()).default([]),
});

export const HikePhotoSchema = z.object({
  url: z.string(),
  alt_text: z.string(),
  type: z.enum(['trail', 'viewpoint', 'wildlife', 'landmark']).optional(),
  km_from_start: z.number().nullable().optional(),
  credit: z.string().nullable().optional(),
});

export const HikePhotosSchema = z.object({
  featured_image: z.object({
    url: z.string(),
    alt_text: z.string(),
    credit: z.string().nullable().optional(),
  }).optional(),
  gallery: z.array(HikePhotoSchema).default([]),
  user_photo_count: z.number().int().nullable().optional(),
});

export const GpxMapsSchema = z.object({
  gpx_download_url: z.string().nullable().optional(),
  official_map_url: z.string().nullable().optional(),
  alltrails_url: z.string().nullable().optional(),
  komoot_url: z.string().nullable().optional(),
  wikiloc_url: z.string().nullable().optional(),
  offline_maps_recommended: z.boolean().default(true),
});

export const SafetySchema = z.object({
  overall_safety: z.enum(['very-safe', 'safe', 'moderate-risk', 'risky', 'dangerous']),
  main_risks: z.array(z.string()).default([]),
  precautions: z.array(z.string()).default([]),
  weather_sensitivity: z.enum(['low', 'moderate', 'high', 'extreme']),
  avoid_in_conditions: z.array(z.string()).default([]),
  emergency_contacts: z.object({
    general: z.string().default('112'),
    mountain_rescue: z.string().default('118'),
    park_rangers: z.string().nullable().optional(),
  }).optional(),
  insurance_recommended: z.boolean().default(false),
  solo_hiking: z.object({
    recommended: z.boolean().default(true),
    notes: z.string().optional(),
  }).optional(),
});

export const HikeProsConsSchema = z.object({
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
});

// =============================================================================
// MAIN HIKE SCHEMA
// =============================================================================

export const CinqueTerreHikeSchema = z.object({
  // Identification
  rank: z.number().int().optional(),
  id: z.string().optional(),
  name: z.string().min(1),
  name_local: z.string().optional(),
  name_alternative: z.array(z.string()).default([]),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  trail_number: z.string().nullable().optional(),

  // Classification
  category: HikeCategorySchema,
  popularity: HikePopularitySchema,

  // Route
  route: HikeRouteSchema,

  // Metrics
  metrics: HikeMetricsSchema,

  // Difficulty
  difficulty: HikeDifficultySchema,

  // Conditions
  trail_conditions: TrailConditionsSchema,

  // Access
  access_and_fees: AccessAndFeesSchema,

  // Timing
  best_times: BestTimesSchema.optional(),

  // Highlights
  highlights: HikeHighlightsSchema.optional(),

  // Ratings & Reviews
  ratings: HikeRatingsSchema,
  reviews: z.array(HikeReviewSchema).default([]),

  // Media
  photos: HikePhotosSchema.optional(),
  gpx_maps: GpxMapsSchema.optional(),

  // Safety
  safety: SafetySchema.optional(),

  // Summary
  pros_cons: HikeProsConsSchema.optional(),
  insider_tips: z.array(z.string()).default([]),

  // Related
  similar_alternatives: z.array(z.object({
    name: z.string(),
    why_similar: z.string(),
    key_difference: z.string(),
  })).default([]),
  combine_with: z.array(z.object({
    activity: z.string(),
    description: z.string(),
  })).default([]),

  // Metadata
  last_updated: z.string().datetime().optional(),
  data_source: z.string().default('claude_web_search'),
});

export type CinqueTerreHike = z.infer<typeof CinqueTerreHikeSchema>;

// =============================================================================
// COLLECTION RESPONSE SCHEMA
// =============================================================================

export const CinqueTerreHikeResponseSchema = z.object({
  metadata: z.object({
    query_location: z.string(),
    generated_at: z.string(),
    total_results: z.number().int(),
    sort_order: z.string().optional(),
    region_covered: z.string().optional(),
  }),
  pass_information: z.object({
    cinque_terre_card_trekking: z.object({
      name: z.string(),
      description: z.string(),
      validity_options: z.array(z.object({
        duration: z.string(),
        adult_eur: z.number(),
        child_eur: z.number(),
        family_eur: z.number().nullable().optional(),
      })),
      includes: z.array(z.string()),
      purchase_locations: z.array(z.string()),
      purchase_url: z.string().optional(),
      trails_requiring_card: z.array(z.string()),
    }).optional(),
    free_trails: z.array(z.string()).default([]),
  }).optional(),
  trail_conditions_summary: z.object({
    last_updated: z.string().optional(),
    overall_status: z.enum(['excellent', 'good', 'fair', 'poor', 'mixed']).optional(),
    recent_closures: z.array(z.object({
      trail: z.string(),
      reason: z.string(),
      since: z.string().optional(),
      expected_reopening: z.string().nullable().optional(),
    })).default([]),
    best_season: z.string().optional(),
  }).optional(),
  hikes: z.array(CinqueTerreHikeSchema),
});

export type CinqueTerreHikeResponse = z.infer<typeof CinqueTerreHikeResponseSchema>;

// =============================================================================
// CREATE SCHEMA
// =============================================================================

export const CreateCinqueTerreHikeSchema = CinqueTerreHikeSchema.omit({
  rank: true,
  last_updated: true,
});

export type CreateCinqueTerreHike = z.infer<typeof CreateCinqueTerreHikeSchema>;

// =============================================================================
// FIELD METADATA
// =============================================================================

export const CinqueTerreHikeFieldMetadata = {
  name: {
    label: 'Trail Name',
    placeholder: 'Enter trail name',
    helpText: 'The name of the hiking trail',
    required: true,
  },
  slug: {
    label: 'URL Slug',
    placeholder: 'trail-name',
    helpText: 'URL-friendly identifier',
    required: true,
  },
  'difficulty.overall_rating': {
    label: 'Difficulty',
    type: 'select',
    options: ['easy', 'moderate', 'difficult', 'very-difficult', 'expert'],
    required: true,
  },
  'metrics.distance.km': {
    label: 'Distance (km)',
    type: 'number',
    min: 0,
  },
  'metrics.duration.average_hours': {
    label: 'Average Duration (hours)',
    type: 'number',
    min: 0,
  },
  'trail_conditions.current_status': {
    label: 'Current Status',
    type: 'select',
    options: ['open', 'partially-open', 'closed', 'unknown'],
  },
} as const;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const CINQUETERRE_HIKE_COLLECTION_TYPE = {
  type: 'cinqueterre_hikes',
  displayName: 'Cinque Terre Hikes',
  singularName: 'Hike',
  icon: 'mountain',
  color: '#22C55E',
  description: 'Hiking trail data for Cinque Terre',
  schema: CinqueTerreHikeSchema,
  createSchema: CreateCinqueTerreHikeSchema,
  fieldMetadata: CinqueTerreHikeFieldMetadata,
} as const;
