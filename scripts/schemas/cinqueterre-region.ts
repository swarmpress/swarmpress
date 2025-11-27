/**
 * Cinque Terre Region Information Schema
 * Comprehensive schema for the entire Cinque Terre region profile
 */

import { z } from 'zod';

// =============================================================================
// SUB-SCHEMAS
// =============================================================================

export const RegionCoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const BoundingBoxSchema = z.object({
  north: z.number(),
  south: z.number(),
  east: z.number(),
  west: z.number(),
});

export const RegionLocationSchema = z.object({
  region: z.string().default('Liguria'),
  province: z.string().default('La Spezia'),
  country: z.string().default('Italy'),
  coastline: z.string().default('Italian Riviera (Riviera di Levante)'),
  coordinates_center: RegionCoordinatesSchema,
  bounding_box: BoundingBoxSchema.optional(),
  coastline_length_km: z.number().optional(),
  total_area_km2: z.number().optional(),
});

export const VillageProfileSchema = z.object({
  name: z.enum(['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso al Mare']),
  nickname: z.string().optional(),
  one_liner: z.string(),
  character: z.string(),
  best_for: z.array(z.string()).default([]),
  signature_feature: z.string(),
  population: z.number().int().optional(),
  vibe: z.enum(['romantic', 'adventurous', 'authentic', 'bustling', 'tranquil']).optional(),
  unique_note: z.string().optional(),
});

export const VillageComparisonSchema = z.object({
  most_romantic: z.string().optional(),
  most_photogenic: z.string().optional(),
  best_beaches: z.string().optional(),
  most_authentic: z.string().optional(),
  best_food_scene: z.string().optional(),
  best_nightlife: z.string().optional(),
  most_accessible: z.string().optional(),
  least_crowded: z.string().optional(),
  best_for_families: z.string().optional(),
  best_base_for_hiking: z.string().optional(),
});

export const FiveVillagesSchema = z.object({
  overview: z.string(),
  order_south_to_north: z.array(z.string()).default([
    'Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso al Mare'
  ]),
  villages: z.array(VillageProfileSchema).default([]),
  village_comparison_quick: VillageComparisonSchema.optional(),
});

export const UnescoStatusSchema = z.object({
  status: z.boolean().default(true),
  inscription_year: z.number().int().default(1997),
  criteria: z.array(z.string()).default([]),
  description: z.string().optional(),
  official_name: z.string().default('Portovenere, Cinque Terre, and the Islands'),
});

export const NationalParkSchema = z.object({
  name: z.string().default('Parco Nazionale delle Cinque Terre'),
  established: z.number().int().default(1999),
  area_km2: z.number().optional(),
  description: z.string().optional(),
  unique_distinction: z.string().optional(),
});

export const ClassificationsSchema = z.object({
  unesco_world_heritage: UnescoStatusSchema.optional(),
  national_park: NationalParkSchema.optional(),
  marine_protected_area: z.object({
    name: z.string().optional(),
    established: z.number().int().optional(),
    area_km2: z.number().optional(),
    zones: z.array(z.string()).default([]),
  }).optional(),
  other_recognitions: z.array(z.string()).default([]),
});

export const DemographicsSchema = z.object({
  total_population: z.number().int().optional(),
  population_year: z.number().int().optional(),
  population_trend: z.enum(['declining', 'stable', 'growing']).optional(),
  population_challenge: z.string().optional(),
  annual_visitors: z.number().int().optional(),
  visitor_to_resident_ratio: z.string().optional(),
  primary_language: z.string().default('Italian'),
  local_dialect: z.string().optional(),
});

export const CharacterIdentitySchema = z.object({
  essence: z.string(),
  defining_characteristics: z.array(z.string()).default([]),
  what_makes_it_unique: z.string().optional(),
  the_cinque_terre_experience: z.string().optional(),
  cultural_identity: z.string().optional(),
  relationship_with_sea: z.string().optional(),
  relationship_with_land: z.string().optional(),
});

export const IconicElementsSchema = z.object({
  visual_icons: z.array(z.string()).default([]),
  cultural_icons: z.array(z.string()).default([]),
  architectural_icons: z.array(z.string()).default([]),
  natural_icons: z.array(z.string()).default([]),
});

export const QuickFactSchema = z.object({
  icon: z.string(),
  category: z.string(),
  fact: z.string(),
});

export const TimeNeededSchema = z.object({
  absolute_minimum_days: z.number(),
  recommended_days: z.number().int(),
  to_fully_explore_days: z.number().int(),
  ideal_pace: z.string().optional(),
});

export const BestSeasonSchema = z.object({
  overall: z.enum(['spring', 'summer', 'fall', 'winter']).optional(),
  for_hiking: z.string().optional(),
  for_swimming: z.string().optional(),
  for_fewer_crowds: z.string().optional(),
  for_photography: z.string().optional(),
});

export const BudgetOverviewSchema = z.object({
  budget_daily_eur: z.number().int().optional(),
  moderate_daily_eur: z.number().int().optional(),
  luxury_daily_eur: z.number().int().optional(),
  note: z.string().optional(),
});

export const AtAGlanceSchema = z.object({
  ideal_for: z.array(z.string()).default([]),
  not_ideal_for: z.array(z.string()).default([]),
  time_needed: TimeNeededSchema.optional(),
  best_season: BestSeasonSchema.optional(),
  budget_overview: BudgetOverviewSchema.optional(),
});

export const BasicInformationSchema = z.object({
  name: z.string().default('Cinque Terre'),
  name_meaning: z.string().default('Five Lands'),
  name_local: z.string().default('Cinque Terre'),
  name_pronunciation: z.string().default('CHEEN-kweh TEHR-reh'),
  tagline: z.string(),
  elevator_pitch: z.string(),
  location: RegionLocationSchema,
  the_five_villages: FiveVillagesSchema,
  classifications: ClassificationsSchema.optional(),
  demographics: DemographicsSchema.optional(),
  character_and_identity: CharacterIdentitySchema.optional(),
  iconic_elements: IconicElementsSchema.optional(),
  quick_facts: z.array(QuickFactSchema).default([]),
  at_a_glance: AtAGlanceSchema.optional(),
});

// =============================================================================
// HIGHLIGHTS SCHEMAS
// =============================================================================

export const MustDoExperienceSchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  headline: z.string(),
  intro: z.string().optional(),
  description: z.string(),
  category: z.enum(['hiking', 'culinary', 'scenic', 'cultural', 'adventure', 'relaxation']).optional(),
  location: z.string(),
  duration: z.string().optional(),
  best_time: z.string().optional(),
  difficulty: z.enum(['easy', 'moderate', 'challenging']).optional(),
  cost: z.enum(['free', 'budget', 'moderate', 'expensive']).optional(),
  insider_tip: z.string().optional(),
  why_unmissable: z.string().optional(),
});

export const SignatureViewSchema = z.object({
  name: z.string(),
  headline: z.string().optional(),
  location: z.string(),
  village: z.string(),
  what_you_see: z.string(),
  coordinates: RegionCoordinatesSchema.optional(),
  best_light: z.enum(['sunrise', 'morning', 'afternoon', 'golden-hour', 'sunset', 'blue-hour']).optional(),
  crowd_level: z.enum(['low', 'moderate', 'high', 'very-high']).optional(),
  accessibility: z.enum(['easy', 'moderate', 'difficult']).optional(),
  photo_tips: z.array(z.string()).default([]),
  instagram_worthy_rating: z.number().int().min(1).max(10).optional(),
});

export const HiddenGemSchema = z.object({
  name: z.string(),
  headline: z.string().optional(),
  teaser: z.string(),
  location: z.string(),
  how_to_find: z.string().optional(),
  why_overlooked: z.string().optional(),
  best_kept_secret_rating: z.number().int().min(1).max(10).optional(),
});

export const SeasonalHighlightSchema = z.object({
  headline: z.string(),
  highlights: z.array(z.string()).default([]),
  special_events: z.array(z.string()).default([]),
  nature_notes: z.string().optional(),
  beach_scene: z.string().optional(),
  harvest_activities: z.string().optional(),
  unique_appeal: z.string().optional(),
});

export const TravelerTypeHighlightSchema = z.object({
  headline: z.string(),
  top_experiences: z.array(z.string()).default([]),
  best_village_to_stay: z.string(),
  top_spots: z.array(z.string()).optional(),
  top_free_experiences: z.array(z.string()).optional(),
});

export const HighlightsSchema = z.object({
  section_intro: z.string(),
  must_do_experiences: z.array(MustDoExperienceSchema).default([]),
  signature_views: z.array(SignatureViewSchema).default([]),
  unique_experiences: z.array(z.object({
    name: z.string(),
    headline: z.string().optional(),
    description: z.string(),
    where: z.string().optional(),
    when: z.string().optional(),
    booking_required: z.boolean().optional(),
    price_range_eur: z.string().nullable().optional(),
    locals_favorite: z.boolean().optional(),
  })).default([]),
  hidden_gems: z.array(HiddenGemSchema).default([]),
  seasonal_highlights: z.object({
    spring: SeasonalHighlightSchema.optional(),
    summer: SeasonalHighlightSchema.optional(),
    fall: SeasonalHighlightSchema.optional(),
    winter: SeasonalHighlightSchema.optional(),
  }).optional(),
  for_different_travelers: z.record(z.string(), TravelerTypeHighlightSchema).optional(),
});

// =============================================================================
// HISTORY SCHEMAS
// =============================================================================

export const TimelineEventSchema = z.object({
  period: z.string(),
  era: z.enum(['Prehistoric', 'Roman', 'Medieval', 'Renaissance', 'Modern']).optional(),
  headline: z.string(),
  event: z.string(),
  significance: z.string().optional(),
  legacy_today: z.string().optional(),
});

export const OriginStorySchema = z.object({
  headline: z.string(),
  intro: z.string().optional(),
  full_story: z.string(),
  earliest_inhabitants: z.string().optional(),
  why_here: z.string().optional(),
  name_origins: z.object({
    cinque_terre: z.string().optional(),
    individual_villages: z.string().optional(),
  }).optional(),
});

export const TerracesSchema = z.object({
  headline: z.string(),
  intro: z.string().optional(),
  statistics: z.object({
    total_walls_km: z.number().optional(),
    total_terraces_hectares: z.number().optional(),
    comparison: z.string().optional(),
  }).optional(),
  construction: z.object({
    when_built: z.string().optional(),
    how_built: z.string().optional(),
    dry_stone_technique: z.string().optional(),
  }).optional(),
  purpose: z.object({
    original_purpose: z.string().optional(),
    crops_grown: z.array(z.string()).default([]),
    modern_use: z.string().optional(),
  }).optional(),
  unesco_recognition: z.string().optional(),
  preservation_challenges: z.string().optional(),
  how_to_experience: z.string().optional(),
});

export const HistorySchema = z.object({
  section_intro: z.string(),
  timeline: z.array(TimelineEventSchema).default([]),
  origin_story: OriginStorySchema.optional(),
  the_terraces: TerracesSchema.optional(),
  historical_periods: z.array(z.object({
    period_name: z.string(),
    years: z.string().optional(),
    headline: z.string(),
    intro: z.string().optional(),
    key_developments: z.array(z.string()).default([]),
    remnants_today: z.string().optional(),
    genoese_influence: z.string().optional(),
    transformation: z.string().optional(),
  })).default([]),
  architectural_heritage: z.object({
    headline: z.string().optional(),
    intro: z.string().optional(),
    tower_houses: z.object({
      description: z.string().optional(),
      why_built_tall: z.string().optional(),
      where_to_see: z.string().optional(),
    }).optional(),
    the_colors: z.object({
      famous_palette: z.array(z.string()).default([]),
      origin_of_colors: z.string().optional(),
      color_coding_legend: z.string().optional(),
      best_village_for_colors: z.string().optional(),
    }).optional(),
  }).optional(),
  cultural_heritage: z.object({
    headline: z.string().optional(),
    fishing_tradition: z.object({
      history: z.string().optional(),
      today: z.string().optional(),
    }).optional(),
    winemaking_tradition: z.object({
      history: z.string().optional(),
      sciacchetra: z.object({
        description: z.string().optional(),
        production_method: z.string().optional(),
        rarity: z.string().optional(),
      }).optional(),
    }).optional(),
    local_festivals: z.array(z.string()).default([]),
  }).optional(),
  from_isolation_to_fame: z.object({
    headline: z.string().optional(),
    the_isolation_years: z.string().optional(),
    the_railroad: z.object({
      year: z.number().int().optional(),
      impact: z.string().optional(),
    }).optional(),
    discovery_by_tourists: z.string().optional(),
    unesco_effect: z.string().optional(),
    modern_challenges: z.object({
      overtourism: z.string().optional(),
      depopulation: z.string().optional(),
      sustainable_solutions: z.string().optional(),
    }).optional(),
  }).optional(),
});

// =============================================================================
// INFORMATION BLOCK SCHEMA
// =============================================================================

export const InformationBlockSchema = z.object({
  block_id: z.string(),
  title: z.string(),
  headline: z.string(),
  icon: z.string(),
  intro: z.string(),
  content: z.record(z.string(), z.unknown()), // Flexible content structure
});

// =============================================================================
// REVIEW SCHEMAS
// =============================================================================

export const RegionReviewSchema = z.object({
  rank: z.number().int().optional(),
  source: z.enum(['Google', 'TripAdvisor', 'Booking.com', 'Lonely Planet', 'Travel Blog']),
  author: z.string(),
  author_location: z.string().nullable().optional(),
  rating: z.number().min(1).max(5),
  date: z.string(),
  visit_date: z.string().optional(),
  visit_duration: z.string().optional(),
  traveler_type: z.enum(['solo', 'couple', 'family', 'friends', 'group-tour']).optional(),
  title: z.string().nullable().optional(),
  text: z.string(),
  villages_visited: z.array(z.string()).default([]),
  favorite_village: z.string().nullable().optional(),
  highlights_mentioned: z.array(z.string()).default([]),
  criticisms_mentioned: z.array(z.string()).default([]),
  tips_shared: z.array(z.string()).default([]),
  would_return: z.boolean().optional(),
  would_recommend: z.boolean().optional(),
  helpful_votes: z.number().int().nullable().optional(),
  photos_attached: z.number().int().optional(),
});

export const ReviewThemeSchema = z.object({
  theme: z.string(),
  frequency: z.enum(['very-common', 'common', 'occasional', 'rare']).optional(),
  sample_quote: z.string().optional(),
  validity: z.string().optional(),
});

export const LatestReviewsSchema = z.object({
  section_intro: z.string().optional(),
  overall_sentiment: z.enum(['very-positive', 'positive', 'mixed', 'negative']).optional(),
  average_rating: z.number().min(0).max(5).optional(),
  total_reviews_analyzed: z.number().int().optional(),
  reviews: z.array(RegionReviewSchema).default([]),
  common_themes: z.object({
    what_people_love: z.array(ReviewThemeSchema).default([]),
    common_complaints: z.array(ReviewThemeSchema).default([]),
    recurring_tips: z.array(z.object({
      tip: z.string(),
      frequency: z.string().optional(),
    })).default([]),
  }).optional(),
  rating_breakdown: z.object({
    '5_star_percent': z.number().int().optional(),
    '4_star_percent': z.number().int().optional(),
    '3_star_percent': z.number().int().optional(),
    '2_star_percent': z.number().int().optional(),
    '1_star_percent': z.number().int().optional(),
  }).optional(),
  review_summary: z.string().optional(),
});

// =============================================================================
// TRAVEL ESSENTIALS SCHEMA
// =============================================================================

export const TravelEssentialsSchema = z.object({
  section_intro: z.string().optional(),
  getting_there: z.object({
    headline: z.string().optional(),
    nearest_airports: z.array(z.object({
      airport: z.string(),
      distance_km: z.number().int().optional(),
      transfer_time_hours: z.number().optional(),
      best_route: z.string().optional(),
    })).default([]),
    by_train: z.object({
      main_hub: z.string().default('La Spezia Centrale'),
      from_major_cities: z.record(z.string(), z.object({
        time_hours: z.number().optional(),
        changes: z.number().int().optional(),
        cost_eur: z.string().optional(),
      })).optional(),
      booking_tip: z.string().optional(),
    }).optional(),
    by_car: z.object({
      driving_recommendation: z.string().optional(),
      where_to_leave_car: z.string().optional(),
      parking_daily_cost_eur: z.string().optional(),
    }).optional(),
  }).optional(),
  getting_around: z.object({
    headline: z.string().optional(),
    golden_rule: z.string().optional(),
    transport_options: z.record(z.string(), z.object({
      description: z.string().optional(),
      cost: z.string().optional(),
      frequency: z.string().optional(),
      season: z.string().optional(),
    })).optional(),
    cinque_terre_card: z.object({
      what_it_is: z.string().optional(),
      who_needs_it: z.string().optional(),
      where_to_buy: z.string().optional(),
    }).optional(),
  }).optional(),
  money_matters: z.object({
    headline: z.string().optional(),
    currency: z.string().default('EUR'),
    atms: z.string().optional(),
    credit_cards: z.string().optional(),
    tipping: z.string().optional(),
    daily_budgets: z.object({
      backpacker_eur: z.number().int().optional(),
      mid_range_eur: z.number().int().optional(),
      luxury_eur: z.number().int().optional(),
    }).optional(),
    money_tips: z.array(z.string()).default([]),
  }).optional(),
  health_safety: z.object({
    overall_safety: z.string().optional(),
    emergency_number: z.string().default('112'),
    nearest_hospital: z.string().optional(),
    tap_water: z.string().optional(),
    sun_safety: z.string().optional(),
    hiking_safety: z.string().optional(),
  }).optional(),
  essential_tips: z.object({
    before_you_go: z.array(z.string()).default([]),
    during_your_visit: z.array(z.string()).default([]),
    common_mistakes_to_avoid: z.array(z.string()).default([]),
  }).optional(),
  packing_essentials: z.object({
    must_have: z.array(z.string()).default([]),
    highly_recommended: z.array(z.string()).default([]),
    leave_at_home: z.array(z.string()).default([]),
  }).optional(),
});

// =============================================================================
// VILLAGE COMPARISON GUIDE
// =============================================================================

export const VillageComparisonGuideSchema = z.object({
  section_intro: z.string().optional(),
  comparison_table: z.object({
    categories: z.array(z.string()).default([]),
    villages: z.record(z.string(), z.object({
      romantic: z.number().int().min(1).max(5).optional(),
      photogenic: z.number().int().min(1).max(5).optional(),
      beaches: z.number().int().min(1).max(5).optional(),
      food_scene: z.number().int().min(1).max(5).optional(),
      nightlife: z.number().int().min(1).max(5).optional(),
      accessibility: z.number().int().min(1).max(5).optional(),
      crowds: z.number().int().min(1).max(5).optional(),
      authenticity: z.number().int().min(1).max(5).optional(),
      overall: z.number().optional(),
    })).optional(),
  }).optional(),
  best_village_for: z.record(z.string(), z.object({
    village: z.string(),
    why: z.string(),
  })).optional(),
  which_village_to_stay_in: z.object({
    intro: z.string().optional(),
    recommendations: z.array(z.object({
      traveler_type: z.string(),
      recommended_village: z.string(),
      reason: z.string(),
      alternative: z.string().optional(),
    })).default([]),
  }).optional(),
});

// =============================================================================
// FINAL VERDICT
// =============================================================================

export const FinalVerdictSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  the_magic: z.string().optional(),
  the_reality: z.string().optional(),
  who_will_love_it: z.array(z.string()).default([]),
  who_might_not: z.array(z.string()).default([]),
  one_piece_of_advice: z.string().optional(),
  parting_thought: z.string().optional(),
});

// =============================================================================
// MAIN REGION SCHEMA
// =============================================================================

export const CinqueTerreRegionSchema = z.object({
  // Metadata
  metadata: z.object({
    region_name: z.string().default('Cinque Terre'),
    generated_at: z.string().datetime().optional(),
    search_type: z.string().default('region_profile'),
    data_sources: z.array(z.string()).default([]),
    last_updated: z.string().datetime().optional(),
    content_language: z.string().default('en'),
  }),

  // Basic Information
  basic_information: BasicInformationSchema,

  // Highlights
  highlights: HighlightsSchema.optional(),

  // History
  history: HistorySchema.optional(),

  // Detailed Information Blocks
  detailed_information_blocks: z.array(InformationBlockSchema).default([]),

  // Latest Reviews
  latest_reviews: LatestReviewsSchema.optional(),

  // Travel Essentials
  travel_essentials_summary: TravelEssentialsSchema.optional(),

  // Village Comparison
  village_comparison_guide: VillageComparisonGuideSchema.optional(),

  // Beyond the Five
  beyond_the_five: z.object({
    section_intro: z.string().optional(),
    nearby_destinations: z.array(z.object({
      name: z.string(),
      distance_km: z.number().int().optional(),
      why_visit: z.string(),
      highlights: z.array(z.string()).default([]),
      how_to_get_there: z.string().optional(),
      time_needed_hours: z.number().optional(),
      day_trip_worthy: z.boolean().optional(),
    })).default([]),
    combining_with_other_italian_destinations: z.record(z.string(), z.string()).optional(),
  }).optional(),

  // Final Verdict
  final_verdict: FinalVerdictSchema.optional(),
});

export type CinqueTerreRegion = z.infer<typeof CinqueTerreRegionSchema>;

// =============================================================================
// FIELD METADATA
// =============================================================================

export const CinqueTerreRegionFieldMetadata = {
  'basic_information.name': {
    label: 'Region Name',
    placeholder: 'Cinque Terre',
    required: true,
  },
  'basic_information.tagline': {
    label: 'Tagline',
    placeholder: 'Where Mountains Kiss the Sea',
    required: true,
  },
  'metadata.generated_at': {
    label: 'Generated At',
    type: 'datetime',
  },
} as const;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const CINQUETERRE_REGION_COLLECTION_TYPE = {
  type: 'cinqueterre_region',
  displayName: 'Cinque Terre Region Profile',
  singularName: 'Region Profile',
  icon: 'map',
  color: '#10B981',
  description: 'Comprehensive Cinque Terre regional information',
  schema: CinqueTerreRegionSchema,
  createSchema: CinqueTerreRegionSchema,
  fieldMetadata: CinqueTerreRegionFieldMetadata,
} as const;
