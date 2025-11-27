/**
 * Cinque Terre Village Profile Schema
 * Based on specs/cinqueterre/village-info.py
 * Comprehensive village information for individual Cinque Terre villages
 */

import { z } from 'zod';

// ============================================================================
// Sub-schemas
// ============================================================================

// Metadata
const VillageMetadataSchema = z.object({
  village_name: z.string(),
  generated_at: z.string(),
  search_type: z.literal('village_profile'),
  data_sources: z.array(z.string()),
  last_updated: z.string(),
  content_language: z.string().default('en'),
});

// Coordinates
const VillageCoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

// Location
const VillageLocationSchema = z.object({
  region: z.string(),
  province: z.string(),
  country: z.string(),
  coordinates: VillageCoordinatesSchema,
  elevation_m: z.number(),
  coastal: z.boolean(),
  position_in_cinque_terre: z.string(),
});

// Classification
const VillageClassificationSchema = z.object({
  unesco_world_heritage: z.boolean(),
  unesco_inscription_year: z.number().nullable(),
  national_park: z.string(),
  marine_protected_area: z.boolean(),
  borghi_piu_belli: z.boolean().nullable(),
});

// Demographics
const VillageDemographicsSchema = z.object({
  population: z.number().nullable(),
  population_year: z.number().nullable(),
  population_trend: z.enum(['growing', 'stable', 'declining']).nullable(),
  area_km2: z.number().nullable(),
  density_per_km2: z.number().nullable(),
  primary_language: z.string().default('Italian'),
  local_dialect: z.string().nullable(),
});

// Character
const VillageCharacterSchema = z.object({
  vibe: z.enum(['romantic', 'adventurous', 'relaxed', 'authentic', 'bustling', 'tranquil']),
  atmosphere: z.string(),
  best_known_for: z.array(z.string()),
  unique_qualities: z.array(z.string()),
  comparison_to_other_cinque_terre: z.string(),
});

// Quick Fact
const VillageQuickFactSchema = z.object({
  icon: z.string(),
  fact: z.string(),
});

// Time Needed
const VillageTimeNeededSchema = z.object({
  minimum_hours: z.number(),
  recommended_hours: z.number(),
  to_fully_explore_days: z.number(),
});

// At a Glance
const VillageAtAGlanceSchema = z.object({
  ideal_for: z.array(z.string()),
  time_needed: VillageTimeNeededSchema,
  best_season: z.enum(['spring', 'summer', 'fall', 'winter', 'year-round']),
  crowd_level: z.enum(['very-high', 'high', 'moderate', 'low']),
  budget_level: z.enum(['budget', 'moderate', 'upscale', 'luxury']),
});

// Basic Information
const VillageBasicInfoSchema = z.object({
  name: z.string(),
  name_local: z.string(),
  name_pronunciation: z.string(),
  nickname: z.string().nullable(),
  tagline: z.string(),
  location: VillageLocationSchema,
  classification: VillageClassificationSchema,
  demographics: VillageDemographicsSchema,
  character: VillageCharacterSchema,
  quick_facts: z.array(VillageQuickFactSchema),
  at_a_glance: VillageAtAGlanceSchema,
});

// ============================================================================
// Highlights Section
// ============================================================================

const VillageAttractionSchema = z.object({
  rank: z.number(),
  name: z.string(),
  headline: z.string(),
  intro: z.string(),
  description: z.string(),
  category: z.enum(['viewpoint', 'landmark', 'beach', 'church', 'museum', 'experience', 'neighborhood']),
  must_see_rating: z.number().min(1).max(10),
  time_needed_minutes: z.number(),
  best_time_to_visit: z.string(),
  insider_tip: z.string(),
  coordinates: VillageCoordinatesSchema,
  photo_worthy: z.boolean(),
  free_entry: z.boolean(),
  entry_fee_eur: z.number().nullable(),
});

const VillageSignatureExperienceSchema = z.object({
  name: z.string(),
  headline: z.string(),
  intro: z.string(),
  description: z.string(),
  duration_hours: z.number(),
  best_time: z.string(),
  price_range_eur: z.string().nullable(),
  booking_required: z.boolean(),
  seasonal: z.boolean(),
  season_available: z.string().nullable(),
});

const VillageHiddenGemSchema = z.object({
  name: z.string(),
  headline: z.string(),
  intro: z.string(),
  why_special: z.string(),
  how_to_find: z.string(),
  best_kept_secret_level: z.number().min(1).max(10),
  coordinates: VillageCoordinatesSchema,
});

const VillagePhotoSpotSchema = z.object({
  name: z.string(),
  headline: z.string(),
  description: z.string(),
  best_light: z.enum(['sunrise', 'morning', 'midday', 'afternoon', 'golden-hour', 'sunset', 'blue-hour', 'night']),
  best_season: z.string(),
  crowd_level: z.string(),
  tripod_allowed: z.boolean(),
  coordinates: VillageCoordinatesSchema,
  pro_tip: z.string(),
});

const VillageRomanticSpotSchema = z.object({
  name: z.string(),
  headline: z.string(),
  why_romantic: z.string(),
  best_for: z.enum(['sunset', 'dinner', 'stroll', 'proposal', 'anniversary']),
  recommendation: z.string(),
});

const VillageHighlightsSchema = z.object({
  section_intro: z.string(),
  top_attractions: z.array(VillageAttractionSchema),
  signature_experiences: z.array(VillageSignatureExperienceSchema),
  hidden_gems: z.array(VillageHiddenGemSchema),
  photo_spots: z.array(VillagePhotoSpotSchema),
  romantic_spots: z.array(VillageRomanticSpotSchema),
});

// ============================================================================
// History Section
// ============================================================================

const VillageTimelineEventSchema = z.object({
  year: z.string(),
  era: z.string(),
  headline: z.string(),
  event: z.string(),
  significance: z.string(),
  details: z.string(),
});

const VillageNameEtymologySchema = z.object({
  meaning: z.string(),
  origin: z.string(),
  original_name: z.string().nullable(),
});

const VillageOriginStorySchema = z.object({
  headline: z.string(),
  intro: z.string(),
  full_story: z.string(),
  name_etymology: VillageNameEtymologySchema,
  founding_legend: z.string().nullable(),
});

const VillageHistoricalPeriodSchema = z.object({
  period_name: z.string(),
  years: z.string(),
  headline: z.string(),
  intro: z.string(),
  description: z.string(),
  key_developments: z.array(z.string()),
  notable_figures: z.array(z.string()),
  remnants_today: z.string(),
});

const VillageColorPaletteSchema = z.object({
  description: z.string(),
  why_colorful: z.string(),
  most_common_colors: z.array(z.string()),
});

const VillageArchitecturalHeritageSchema = z.object({
  headline: z.string(),
  intro: z.string(),
  signature_style: z.string(),
  building_materials: z.array(z.string()),
  notable_features: z.array(z.string()),
  color_palette: VillageColorPaletteSchema,
  preservation_efforts: z.string(),
});

const VillageCulturalHeritageSchema = z.object({
  headline: z.string(),
  intro: z.string(),
  traditions_maintained: z.array(z.string()),
  local_crafts: z.array(z.string()),
  oral_traditions: z.string().nullable(),
  music_and_dance: z.string().nullable(),
});

const VillageFamousResidentSchema = z.object({
  name: z.string(),
  years: z.string(),
  claim_to_fame: z.string(),
  connection_to_village: z.string(),
});

const VillageHistoricalEventSchema = z.object({
  year: z.string(),
  event: z.string(),
  headline: z.string(),
  description: z.string(),
  impact: z.string(),
});

const VillageTourismTransitionSchema = z.object({
  headline: z.string(),
  traditional_economy: z.string(),
  transition_period: z.string(),
  modern_balance: z.string(),
  challenges: z.array(z.string()),
});

const VillageHistorySchema = z.object({
  section_intro: z.string(),
  timeline: z.array(VillageTimelineEventSchema),
  origin_story: VillageOriginStorySchema,
  historical_periods: z.array(VillageHistoricalPeriodSchema),
  architectural_heritage: VillageArchitecturalHeritageSchema,
  cultural_heritage: VillageCulturalHeritageSchema,
  famous_residents: z.array(VillageFamousResidentSchema),
  historical_events: z.array(VillageHistoricalEventSchema),
  from_fishing_village_to_tourism: VillageTourismTransitionSchema,
});

// ============================================================================
// Detailed Information Blocks Section
// ============================================================================

// Note: The following schemas define the structure of detailed_information_blocks content.
// They are documented here for reference but the main schema uses flexible z.record(z.unknown())
// to accommodate various block types. Prefix with _ to indicate they're for documentation.

// Generic key point for information blocks
const _VillageKeyPointSchema = z.object({
  point: z.string(),
  details: z.string(),
});

// Food and Wine specific schemas
const _VillageSignatureDishSchema = z.object({
  name: z.string(),
  local_name: z.string(),
  description: z.string(),
  where_to_try: z.string(),
  price_range: z.string(),
});

const _VillageLocalWineSchema = z.object({
  name: z.string(),
  type: z.enum(['white', 'red', 'dessert', 'rosé']),
  description: z.string(),
  pairs_with: z.string(),
  price_range_eur: z.string(),
});

// Beaches specific schemas
const _VillageMainBeachSchema = z.object({
  name: z.string(),
  type: z.enum(['rocky', 'pebble', 'sandy', 'platform', 'mixed']),
  description: z.string(),
  facilities: z.array(z.string()),
  best_time: z.string(),
  crowd_level: z.string(),
});

const _VillageSwimmingSpotSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string(),
  access: z.string(),
  difficulty: z.enum(['easy', 'moderate', 'difficult']),
  local_secret: z.boolean(),
});

// Nightlife specific schemas
const _VillageBarVenueSchema = z.object({
  name: z.string(),
  type: z.enum(['wine-bar', 'cocktail-bar', 'pub', 'enoteca', 'cafe']),
  vibe: z.string(),
  known_for: z.string(),
  best_time: z.string(),
});

// Shopping specific schemas
const _VillageBestBuySchema = z.object({
  item: z.string(),
  description: z.string(),
  where_to_buy: z.string(),
  price_range: z.string(),
  authenticity_tip: z.string(),
});

const _VillageArtisanShopSchema = z.object({
  name: z.string(),
  specialty: z.string(),
  location: z.string(),
  note: z.string(),
});

const _VillageMarketsSchema = z.object({
  regular_market: z.object({
    day: z.string(),
    location: z.string(),
    hours: z.string(),
  }).nullable(),
  special_markets: z.array(z.string()),
});

// Photography specific schemas
const _VillageGoldenHourSpotSchema = z.object({
  location: z.string(),
  what_to_capture: z.string(),
  best_time: z.string(),
  tip: z.string(),
});

const _VillageSeasonalShotsSchema = z.object({
  spring: z.string(),
  summer: z.string(),
  fall: z.string(),
  winter: z.string(),
});

// Local Life specific schemas
const _VillageDailyRhythmsSchema = z.object({
  morning: z.string(),
  afternoon: z.string(),
  evening: z.string(),
});

// Religious Sites specific schemas
const _VillageChurchSchema = z.object({
  name: z.string(),
  italian_name: z.string(),
  built: z.string(),
  style: z.string(),
  highlights: z.array(z.string()),
  visiting_hours: z.string(),
  mass_times: z.string(),
  special_features: z.string(),
});

const _VillageSanctuarySchema = z.object({
  name: z.string(),
  location: z.string(),
  significance: z.string(),
  how_to_reach: z.string(),
  pilgrimage_tradition: z.string().nullable(),
});

// Family Travel specific schemas
const _VillageKidActivitySchema = z.object({
  activity: z.string(),
  ages: z.string(),
  description: z.string(),
  duration: z.string(),
});

// Accessibility specific schemas
const _VillageStairsInfoSchema = z.object({
  total_estimate: z.number(),
  unavoidable_sections: z.array(z.string()),
  alternatives: z.string(),
});

// Sustainability specific schemas
const _VillageEcoOptionsSchema = z.object({
  accommodation: z.array(z.string()),
  dining: z.array(z.string()),
  activities: z.array(z.string()),
});

// Weather/Seasons specific schemas
const _VillageSeasonSchema = z.object({
  months: z.string(),
  temperature_range_c: z.string(),
  description: z.string(),
  highlights: z.array(z.string()),
  considerations: z.array(z.string()),
});

const _VillageSeasonsSchema = z.object({
  spring: _VillageSeasonSchema,
  summer: _VillageSeasonSchema,
  fall: _VillageSeasonSchema,
  winter: _VillageSeasonSchema,
});

const _VillageBestTimeForSchema = z.object({
  swimming: z.string(),
  hiking: z.string(),
  photography: z.string(),
  avoiding_crowds: z.string(),
  budget_travel: z.string(),
});

const _VillagePackBySeasonSchema = z.object({
  spring: z.array(z.string()),
  summer: z.array(z.string()),
  fall: z.array(z.string()),
  winter: z.array(z.string()),
});

// Export the documentation schemas for reference
export const VillageInfoBlockSchemas = {
  keyPoint: _VillageKeyPointSchema,
  signatureDish: _VillageSignatureDishSchema,
  localWine: _VillageLocalWineSchema,
  mainBeach: _VillageMainBeachSchema,
  swimmingSpot: _VillageSwimmingSpotSchema,
  barVenue: _VillageBarVenueSchema,
  bestBuy: _VillageBestBuySchema,
  artisanShop: _VillageArtisanShopSchema,
  markets: _VillageMarketsSchema,
  goldenHourSpot: _VillageGoldenHourSpotSchema,
  seasonalShots: _VillageSeasonalShotsSchema,
  dailyRhythms: _VillageDailyRhythmsSchema,
  church: _VillageChurchSchema,
  sanctuary: _VillageSanctuarySchema,
  kidActivity: _VillageKidActivitySchema,
  stairsInfo: _VillageStairsInfoSchema,
  ecoOptions: _VillageEcoOptionsSchema,
  season: _VillageSeasonSchema,
  seasons: _VillageSeasonsSchema,
  bestTimeFor: _VillageBestTimeForSchema,
  packBySeason: _VillagePackBySeasonSchema,
};

// Generic Information Block
// Using a flexible content structure that can accommodate different block types
const VillageInfoBlockSchema = z.object({
  block_id: z.string(),
  title: z.string(),
  headline: z.string(),
  icon: z.string(),
  intro: z.string(),
  content: z.record(z.unknown()), // Flexible content structure
  related_blocks: z.array(z.string()).optional(),
});

// ============================================================================
// Reviews Section
// ============================================================================

const VillageReviewSchema = z.object({
  rank: z.number(),
  source: z.enum(['Google', 'TripAdvisor', 'Booking.com', 'Yelp', 'Facebook']),
  author: z.string(),
  author_location: z.string().nullable(),
  rating: z.number(),
  date: z.string(),
  visit_date: z.string().nullable(),
  traveler_type: z.enum(['solo', 'couple', 'family', 'friends', 'business']),
  title: z.string().nullable(),
  text: z.string(),
  highlights_mentioned: z.array(z.string()),
  criticisms_mentioned: z.array(z.string()),
  tips_shared: z.array(z.string()),
  would_recommend: z.boolean(),
  helpful_votes: z.number().nullable(),
  response_from_local: z.string().nullable(),
  verified: z.boolean(),
  photos_attached: z.number(),
});

const VillageReviewThemeSchema = z.object({
  theme: z.string(),
  mention_count: z.number(),
  sample_quote: z.string(),
});

const VillageReviewTipSchema = z.object({
  tip: z.string(),
  frequency: z.string(),
});

const VillageCommonThemesSchema = z.object({
  most_praised: z.array(VillageReviewThemeSchema),
  most_criticized: z.array(VillageReviewThemeSchema),
  tips_from_visitors: z.array(VillageReviewTipSchema),
});

const VillageRatingBreakdownSchema = z.object({
  '5_star_percent': z.number(),
  '4_star_percent': z.number(),
  '3_star_percent': z.number(),
  '2_star_percent': z.number(),
  '1_star_percent': z.number(),
});

const VillageLatestReviewsSchema = z.object({
  section_intro: z.string(),
  overall_sentiment: z.enum(['very-positive', 'positive', 'mixed', 'negative']),
  average_rating: z.number(),
  total_reviews_analyzed: z.number(),
  reviews: z.array(VillageReviewSchema),
  common_themes: VillageCommonThemesSchema,
  rating_breakdown: VillageRatingBreakdownSchema,
  review_highlights_summary: z.string(),
});

// ============================================================================
// Travel Essentials Section
// ============================================================================

const VillageTrainInfoSchema = z.object({
  time_minutes: z.number().optional(),
  time_hours: z.number().optional(),
  frequency: z.string().optional(),
  changes: z.number().optional(),
  cost_eur: z.number(),
});

const VillageByTrainSchema = z.object({
  nearest_station: z.string(),
  from_la_spezia: VillageTrainInfoSchema,
  from_genoa: VillageTrainInfoSchema,
  from_pisa: VillageTrainInfoSchema,
  from_florence: VillageTrainInfoSchema,
  tip: z.string(),
});

const VillageByCarSchema = z.object({
  parking_situation: z.string(),
  nearest_parking: z.string(),
  cost_per_day_eur: z.number(),
  recommendation: z.string(),
  tip: z.string(),
});

const VillageByFerrySchema = z.object({
  available: z.boolean(),
  seasonal: z.boolean(),
  from_where: z.array(z.string()),
  scenic_rating: z.number().min(1).max(10),
  tip: z.string(),
});

const VillageAirportConnectionSchema = z.object({
  airport: z.string(),
  distance_km: z.number(),
  best_route: z.string(),
  time_hours: z.number(),
});

const VillageGettingThereSchema = z.object({
  headline: z.string(),
  best_option: z.object({
    method: z.enum(['train', 'car', 'ferry']),
    why_best: z.string(),
  }),
  by_train: VillageByTrainSchema,
  by_car: VillageByCarSchema,
  by_ferry: VillageByFerrySchema,
  from_airports: z.array(VillageAirportConnectionSchema),
});

const VillageToOtherVillagesSchema = z.object({
  by_train: z.object({
    frequency: z.string(),
    cost_eur: z.number(),
  }),
  by_ferry: z.object({
    available: z.boolean(),
    seasonal: z.boolean(),
  }),
  by_hiking: z.object({
    trails_available: z.boolean(),
    main_trail: z.string(),
  }),
});

const VillageGettingAroundSchema = z.object({
  headline: z.string(),
  primary_mode: z.string(),
  walkability_rating: z.number().min(1).max(10),
  key_info: z.array(z.string()),
  stairs_warning: z.string(),
  to_other_villages: VillageToOtherVillagesSchema,
});

const VillageBudgetBreakdownSchema = z.object({
  budget_daily_eur: z.number(),
  moderate_daily_eur: z.number(),
  luxury_daily_eur: z.number(),
});

const VillageMoneyMattersSchema = z.object({
  headline: z.string(),
  currency: z.literal('EUR'),
  atms_available: z.boolean(),
  atm_locations: z.array(z.string()),
  credit_cards_accepted: z.enum(['widely', 'mostly', 'sometimes', 'rarely']),
  cash_recommended: z.boolean(),
  tipping_culture: z.string(),
  budget_breakdown: VillageBudgetBreakdownSchema,
  money_saving_tips: z.array(z.string()),
});

const VillageUsefulPhraseSchema = z.object({
  italian: z.string(),
  pronunciation: z.string(),
  english: z.string(),
});

const VillageCommunicationSchema = z.object({
  headline: z.string(),
  wifi_availability: z.enum(['excellent', 'good', 'moderate', 'limited']),
  free_wifi_spots: z.array(z.string()),
  mobile_coverage: z.enum(['excellent', 'good', 'moderate', 'poor']),
  useful_phrases: z.array(VillageUsefulPhraseSchema),
  english_spoken: z.enum(['widely', 'commonly', 'sometimes', 'rarely']),
});

const VillageNearestHospitalSchema = z.object({
  name: z.string(),
  location: z.string(),
  distance_km: z.number(),
});

const VillageHealthSafetySchema = z.object({
  headline: z.string(),
  overall_safety: z.enum(['very-safe', 'safe', 'moderate', 'caution-advised']),
  emergency_number: z.string(),
  nearest_hospital: VillageNearestHospitalSchema,
  pharmacy_locations: z.array(z.string()),
  common_health_concerns: z.array(z.string()),
  safety_tips: z.array(z.string()),
  water_drinkable: z.boolean(),
});

const VillageReservationTipsSchema = z.object({
  restaurants: z.string(),
  accommodation: z.string(),
  activities: z.string(),
});

const VillagePracticalTipsSchema = z.object({
  headline: z.string(),
  best_time_to_arrive: z.string(),
  worst_time_to_visit: z.string(),
  luggage_tip: z.string(),
  footwear_essential: z.string(),
  sun_protection: z.string(),
  reservation_tips: VillageReservationTipsSchema,
  local_etiquette: z.array(z.string()),
  common_mistakes: z.array(z.string()),
  pro_tips: z.array(z.string()),
});

const VillageTouristOfficeSchema = z.object({
  address: z.string(),
  phone: z.string(),
  hours: z.string(),
});

const VillageParkOfficeSchema = z.object({
  phone: z.string(),
  website: z.string(),
});

const VillageUsefulContactsSchema = z.object({
  tourist_office: VillageTouristOfficeSchema,
  emergency: z.string(),
  police: z.string(),
  medical: z.string(),
  park_office: VillageParkOfficeSchema,
});

const VillagePackingChecklistSchema = z.object({
  essentials: z.array(z.string()),
  recommended: z.array(z.string()),
  leave_at_home: z.array(z.string()),
});

const VillageTravelEssentialsSchema = z.object({
  section_intro: z.string(),
  getting_there: VillageGettingThereSchema,
  getting_around: VillageGettingAroundSchema,
  money_matters: VillageMoneyMattersSchema,
  communication: VillageCommunicationSchema,
  health_and_safety: VillageHealthSafetySchema,
  practical_tips: VillagePracticalTipsSchema,
  useful_contacts: VillageUsefulContactsSchema,
  packing_checklist: VillagePackingChecklistSchema,
});

// ============================================================================
// Comparison Section
// ============================================================================

const VillageComparisonItemSchema = z.object({
  village: z.enum(['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso']),
  riomaggiore_better_for: z.array(z.string()),
  other_village_better_for: z.array(z.string()),
  key_difference: z.string(),
});

const VillageComparisonSchema = z.object({
  section_intro: z.string(),
  unique_advantages: z.array(z.string()),
  compared_to: z.array(VillageComparisonItemSchema),
  who_should_base_here: z.array(z.string()),
  who_should_base_elsewhere: z.array(z.string()),
});

// ============================================================================
// Final Verdict Section
// ============================================================================

const VillageFinalVerdictSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  best_for: z.array(z.string()),
  skip_if: z.array(z.string()),
  insider_secret: z.string(),
  closing_thought: z.string(),
});

// ============================================================================
// Main Response Schema
// ============================================================================

/**
 * Complete Village Profile Response Schema
 */
export const CinqueTerreVillageResponseSchema = z.object({
  metadata: VillageMetadataSchema,
  basic_information: VillageBasicInfoSchema,
  highlights: VillageHighlightsSchema,
  history: VillageHistorySchema,
  detailed_information_blocks: z.array(VillageInfoBlockSchema),
  latest_reviews: VillageLatestReviewsSchema,
  travel_essentials_summary: VillageTravelEssentialsSchema,
  comparison_with_other_villages: VillageComparisonSchema,
  final_verdict: VillageFinalVerdictSchema,
});

export type CinqueTerreVillageResponse = z.infer<typeof CinqueTerreVillageResponseSchema>;

// ============================================================================
// Create Schema (for new village profiles)
// ============================================================================

export const CinqueTerreVillageCreateSchema = CinqueTerreVillageResponseSchema;
export type CinqueTerreVillageCreate = z.infer<typeof CinqueTerreVillageCreateSchema>;

// ============================================================================
// Collection Definition
// ============================================================================

export const CinqueTerreVillageCollectionDefinition = {
  type: 'cinqueterre_villages' as const,
  displayName: 'Cinque Terre Villages',
  singularName: 'Village Profile',
  icon: '🏘️',
  color: '#8B4513',
  description: 'Comprehensive profiles of individual Cinque Terre villages',
  schema: CinqueTerreVillageResponseSchema,
  createSchema: CinqueTerreVillageCreateSchema,
};

// ============================================================================
// Exports - Selective to avoid naming collisions
// ============================================================================

// Export main schemas
export {
  VillageMetadataSchema as CinqueTerreVillageMetadataSchema,
  VillageBasicInfoSchema as CinqueTerreVillageBasicInfoSchema,
  VillageHighlightsSchema as CinqueTerreVillageHighlightsSchema,
  VillageHistorySchema as CinqueTerreVillageHistorySchema,
  VillageInfoBlockSchema as CinqueTerreVillageInfoBlockSchema,
  VillageLatestReviewsSchema as CinqueTerreVillageLatestReviewsSchema,
  VillageTravelEssentialsSchema as CinqueTerreVillageTravelEssentialsSchema,
  VillageComparisonSchema as CinqueTerreVillageComparisonSchema,
  VillageFinalVerdictSchema as CinqueTerreVillageFinalVerdictSchema,
};

// Export types
export type CinqueTerreVillageMetadata = z.infer<typeof VillageMetadataSchema>;
export type CinqueTerreVillageBasicInfo = z.infer<typeof VillageBasicInfoSchema>;
export type CinqueTerreVillageHighlights = z.infer<typeof VillageHighlightsSchema>;
export type CinqueTerreVillageHistory = z.infer<typeof VillageHistorySchema>;
export type CinqueTerreVillageInfoBlock = z.infer<typeof VillageInfoBlockSchema>;
export type CinqueTerreVillageLatestReviews = z.infer<typeof VillageLatestReviewsSchema>;
export type CinqueTerreVillageTravelEssentials = z.infer<typeof VillageTravelEssentialsSchema>;
export type CinqueTerreVillageComparison = z.infer<typeof VillageComparisonSchema>;
export type CinqueTerreVillageFinalVerdict = z.infer<typeof VillageFinalVerdictSchema>;
