/**
 * Cinque Terre Weather Collection Schema
 * Comprehensive schema for weather data and activity recommendations
 */

import { z } from 'zod';

// =============================================================================
// COMMON SUB-SCHEMAS
// =============================================================================

export const WeatherCoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const WeatherMetadataSchema = z.object({
  query_location: z.string(),
  generated_at: z.string(),
  search_type: z.string().default('weather_and_recommendations'),
  data_sources: z.array(z.string()).default([]),
  timezone: z.string().default('Europe/Rome'),
  coordinates: WeatherCoordinatesSchema.optional(),
  elevation_m: z.number().int().optional(),
  climate_zone: z.string().default('Mediterranean'),
});

// =============================================================================
// CURRENT CONDITIONS
// =============================================================================

export const TemperatureSchema = z.object({
  current_c: z.number(),
  current_f: z.number(),
  feels_like_c: z.number(),
  feels_like_f: z.number(),
  min_today_c: z.number().optional(),
  max_today_c: z.number().optional(),
});

export const PrecipitationSchema = z.object({
  is_precipitating: z.boolean(),
  type: z.enum(['none', 'drizzle', 'rain', 'heavy-rain', 'thunderstorm', 'snow', 'sleet', 'hail']).nullable().optional(),
  intensity: z.enum(['none', 'light', 'moderate', 'heavy']).nullable().optional(),
  probability_percent: z.number().int().min(0).max(100),
  amount_last_hour_mm: z.number().nullable().optional(),
  amount_today_mm: z.number().optional(),
});

export const HumiditySchema = z.object({
  relative_percent: z.number().int().min(0).max(100),
  dew_point_c: z.number().optional(),
  comfort_level: z.enum(['comfortable', 'slightly-humid', 'humid', 'very-humid', 'dry']).optional(),
});

export const WindSchema = z.object({
  speed_kmh: z.number(),
  speed_mph: z.number().optional(),
  speed_knots: z.number().optional(),
  gust_kmh: z.number().nullable().optional(),
  direction_degrees: z.number().int().optional(),
  direction_cardinal: z.enum(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']).optional(),
  beaufort_scale: z.number().int().min(0).max(12).optional(),
  description: z.enum([
    'calm',
    'light-breeze',
    'gentle-breeze',
    'moderate-breeze',
    'fresh-breeze',
    'strong-breeze',
    'near-gale',
    'gale',
    'strong-gale',
    'storm',
  ]).optional(),
});

export const PressureSchema = z.object({
  hpa: z.number(),
  inhg: z.number().optional(),
  trend: z.enum(['rising', 'falling', 'steady']).optional(),
  trend_description: z.string().optional(),
});

export const VisibilitySchema = z.object({
  km: z.number(),
  miles: z.number().optional(),
  description: z.enum(['excellent', 'good', 'moderate', 'poor', 'very-poor']).optional(),
});

export const UVIndexSchema = z.object({
  value: z.number().int().min(0),
  level: z.enum(['low', 'moderate', 'high', 'very-high', 'extreme']),
  protection_required: z.boolean(),
  recommendation: z.string().optional(),
});

export const AirQualitySchema = z.object({
  aqi: z.number().int().nullable().optional(),
  level: z.enum(['good', 'moderate', 'unhealthy-sensitive', 'unhealthy', 'very-unhealthy', 'hazardous']).nullable().optional(),
  dominant_pollutant: z.string().nullable().optional(),
  recommendation: z.string().nullable().optional(),
});

export const GoldenHourSchema = z.object({
  start: z.string(),
  end: z.string(),
});

export const SunMoonSchema = z.object({
  sunrise: z.string(),
  sunset: z.string(),
  daylight_hours: z.number(),
  golden_hour_morning: GoldenHourSchema.optional(),
  golden_hour_evening: GoldenHourSchema.optional(),
  blue_hour_morning: GoldenHourSchema.optional(),
  blue_hour_evening: GoldenHourSchema.optional(),
  moon_phase: z.enum([
    'new',
    'waxing-crescent',
    'first-quarter',
    'waxing-gibbous',
    'full',
    'waning-gibbous',
    'last-quarter',
    'waning-crescent',
  ]).optional(),
  moon_illumination_percent: z.number().int().optional(),
  moonrise: z.string().nullable().optional(),
  moonset: z.string().nullable().optional(),
});

export const ComfortIndicesSchema = z.object({
  heat_index_c: z.number().nullable().optional(),
  wind_chill_c: z.number().nullable().optional(),
  outdoor_comfort: z.enum(['excellent', 'good', 'fair', 'poor', 'uncomfortable']).optional(),
  outdoor_comfort_score: z.number().int().min(1).max(10).optional(),
});

export const CurrentConditionsSchema = z.object({
  observation_time: z.string(),
  weather_station: z.string().optional(),
  summary: z.string(),
  icon: z.enum([
    'clear',
    'partly-cloudy',
    'cloudy',
    'overcast',
    'fog',
    'drizzle',
    'rain',
    'heavy-rain',
    'thunderstorm',
    'snow',
    'sleet',
    'hail',
    'windy',
  ]),
  temperature: TemperatureSchema,
  precipitation: PrecipitationSchema.optional(),
  humidity: HumiditySchema.optional(),
  wind: WindSchema.optional(),
  pressure: PressureSchema.optional(),
  visibility: VisibilitySchema.optional(),
  uv_index: UVIndexSchema.optional(),
  air_quality: AirQualitySchema.optional(),
  sun_moon: SunMoonSchema.optional(),
  comfort_indices: ComfortIndicesSchema.optional(),
});

// =============================================================================
// HOURLY FORECAST
// =============================================================================

export const ActivitySuitabilitySchema = z.object({
  hiking: z.enum(['excellent', 'good', 'fair', 'poor', 'not-recommended']).optional(),
  swimming: z.enum(['excellent', 'good', 'fair', 'poor', 'not-recommended']).optional(),
  photography: z.enum(['excellent', 'good', 'fair', 'poor']).optional(),
  dining_outdoors: z.enum(['excellent', 'good', 'fair', 'poor', 'not-recommended']).optional(),
});

export const HourlyPrecipitationSchema = z.object({
  probability_percent: z.number().int().min(0).max(100),
  type: z.enum(['none', 'rain', 'snow', 'sleet']).nullable().optional(),
  intensity: z.enum(['none', 'light', 'moderate', 'heavy']).nullable().optional(),
  amount_mm: z.number().optional(),
});

export const HourlyWindSchema = z.object({
  speed_kmh: z.number(),
  gust_kmh: z.number().nullable().optional(),
  direction_cardinal: z.string().optional(),
});

export const HourlyForecastItemSchema = z.object({
  time: z.string(),
  hour: z.string(),
  is_daylight: z.boolean(),
  summary: z.string(),
  icon: z.string(),
  temperature_c: z.number(),
  feels_like_c: z.number(),
  precipitation: HourlyPrecipitationSchema.optional(),
  humidity_percent: z.number().int().optional(),
  wind: HourlyWindSchema.optional(),
  cloud_cover_percent: z.number().int().optional(),
  visibility_km: z.number().optional(),
  uv_index: z.number().int().optional(),
  activity_suitability: ActivitySuitabilitySchema.optional(),
});

export const HourlyForecastSchema = z.object({
  generated_at: z.string(),
  hours: z.array(HourlyForecastItemSchema),
});

// =============================================================================
// DAILY FORECAST
// =============================================================================

export const DailyTemperatureSchema = z.object({
  high_c: z.number(),
  high_f: z.number(),
  low_c: z.number(),
  low_f: z.number(),
  feels_like_high_c: z.number().optional(),
  feels_like_low_c: z.number().optional(),
});

export const DailyPrecipitationSchema = z.object({
  probability_percent: z.number().int().min(0).max(100),
  type: z.enum(['none', 'rain', 'snow', 'mixed']).nullable().optional(),
  total_mm: z.number().optional(),
  hours_of_precipitation: z.number().int().optional(),
  thunderstorm_risk: z.boolean().optional(),
  timing: z.enum(['morning', 'afternoon', 'evening', 'night', 'all-day', 'intermittent']).nullable().optional(),
});

export const ActivityRatingSchema = z.object({
  rating: z.enum(['excellent', 'good', 'fair', 'poor', 'not-recommended', 'cancelled']),
  score: z.number().int().min(1).max(10),
  best_time: z.string().optional(),
  notes: z.string().optional(),
  sea_conditions: z.string().optional(),
  lighting_conditions: z.string().optional(),
});

export const DayActivityRatingsSchema = z.object({
  hiking: ActivityRatingSchema.optional(),
  swimming_beach: ActivityRatingSchema.optional(),
  boat_tour: ActivityRatingSchema.optional(),
  photography: ActivityRatingSchema.optional(),
  village_exploration: ActivityRatingSchema.optional(),
  outdoor_dining: ActivityRatingSchema.optional(),
  wine_tasting: ActivityRatingSchema.optional(),
  train_travel: ActivityRatingSchema.optional(),
  ferry_travel: ActivityRatingSchema.optional(),
});

export const DailyAlertSchema = z.object({
  type: z.enum(['heat', 'cold', 'wind', 'rain', 'thunderstorm', 'fog', 'uv', 'air-quality', 'sea-conditions']),
  severity: z.enum(['advisory', 'watch', 'warning']),
  message: z.string(),
  recommendation: z.string().optional(),
});

export const ClothingRecommendationSchema = z.object({
  morning: z.array(z.string()).default([]),
  afternoon: z.array(z.string()).default([]),
  evening: z.array(z.string()).default([]),
  essentials: z.array(z.string()).default([]),
});

export const DailyForecastItemSchema = z.object({
  date: z.string(),
  day_of_week: z.string(),
  is_today: z.boolean(),
  summary: z.string(),
  detailed_description: z.string().optional(),
  icon: z.string(),
  temperature: DailyTemperatureSchema,
  precipitation: DailyPrecipitationSchema.optional(),
  humidity: z.object({
    average_percent: z.number().int().optional(),
    morning_percent: z.number().int().optional(),
    afternoon_percent: z.number().int().optional(),
  }).optional(),
  wind: z.object({
    avg_speed_kmh: z.number().optional(),
    max_gust_kmh: z.number().optional(),
    direction_cardinal: z.string().optional(),
    description: z.string().optional(),
  }).optional(),
  sun: z.object({
    sunrise: z.string(),
    sunset: z.string(),
    daylight_hours: z.number().optional(),
    uv_index_max: z.number().int().optional(),
    uv_level: z.enum(['low', 'moderate', 'high', 'very-high', 'extreme']).optional(),
  }).optional(),
  comfort: z.object({
    overall_rating: z.enum(['excellent', 'good', 'fair', 'poor', 'uncomfortable']).optional(),
    morning_comfort: z.string().optional(),
    afternoon_comfort: z.string().optional(),
    evening_comfort: z.string().optional(),
  }).optional(),
  activity_ratings: DayActivityRatingsSchema.optional(),
  alerts: z.array(DailyAlertSchema).default([]),
  clothing_recommendation: ClothingRecommendationSchema.optional(),
  packing_suggestions: z.array(z.string()).default([]),
});

export const DailyForecastSchema = z.object({
  generated_at: z.string(),
  days: z.array(DailyForecastItemSchema),
});

// =============================================================================
// MARINE CONDITIONS
// =============================================================================

export const SeaStateSchema = z.object({
  description: z.enum([
    'calm',
    'smooth',
    'slight',
    'moderate',
    'rough',
    'very-rough',
    'high',
    'very-high',
    'phenomenal',
  ]),
  beaufort_sea_scale: z.number().int().min(0).max(9).optional(),
  wave_height_m: z.number(),
  wave_period_seconds: z.number().optional(),
  wave_direction: z.string().optional(),
  swell_height_m: z.number().nullable().optional(),
  swell_direction: z.string().nullable().optional(),
});

export const WaterTemperatureSchema = z.object({
  surface_c: z.number(),
  surface_f: z.number(),
  swimming_comfort: z.enum(['cold', 'cool', 'refreshing', 'comfortable', 'warm']),
  wetsuit_recommendation: z.enum(['not-needed', 'optional', 'recommended', 'required']).optional(),
});

export const TideSchema = z.object({
  type: z.enum(['high', 'low']),
  time: z.string(),
  height_m: z.number(),
});

export const TidesSchema = z.object({
  tidal_range: z.enum(['micro', 'meso', 'macro']).optional(),
  next_high_tide: z.object({
    time: z.string(),
    height_m: z.number(),
  }).optional(),
  next_low_tide: z.object({
    time: z.string(),
    height_m: z.number(),
  }).optional(),
  current_tide_status: z.enum(['rising', 'falling', 'high', 'low']).optional(),
  tide_table_today: z.array(TideSchema).default([]),
});

export const WaterActivityStatusSchema = z.object({
  recommended: z.boolean(),
  rating: z.enum(['excellent', 'good', 'fair', 'poor', 'not-recommended']),
  notes: z.string().optional(),
});

export const WaterActivitiesSchema = z.object({
  swimming: WaterActivityStatusSchema.optional(),
  snorkeling: WaterActivityStatusSchema.optional(),
  diving: WaterActivityStatusSchema.optional(),
  kayaking: WaterActivityStatusSchema.optional(),
  sup: WaterActivityStatusSchema.optional(),
  boat_rental: WaterActivityStatusSchema.optional(),
});

export const MarineConditionsSchema = z.object({
  observation_time: z.string(),
  data_source: z.string().optional(),
  sea_state: SeaStateSchema,
  water_temperature: WaterTemperatureSchema,
  tides: TidesSchema.optional(),
  currents: z.object({
    strength: z.enum(['weak', 'moderate', 'strong']).optional(),
    direction: z.string().optional(),
    swimming_advisory: z.enum(['safe', 'caution', 'dangerous']).optional(),
  }).optional(),
  visibility_underwater: z.object({
    estimated_m: z.number().nullable().optional(),
    conditions: z.enum(['excellent', 'good', 'moderate', 'poor']).nullable().optional(),
    snorkeling_rating: z.enum(['excellent', 'good', 'fair', 'poor', 'not-recommended']).optional(),
  }).optional(),
  ferry_boat_conditions: z.object({
    overall_status: z.enum(['excellent', 'good', 'fair', 'poor', 'service-at-risk', 'cancelled']),
    seasickness_risk: z.enum(['low', 'moderate', 'high', 'very-high']).optional(),
    recommendation: z.string().optional(),
  }).optional(),
  beach_conditions: z.object({
    swimming_safety: z.enum(['safe', 'caution', 'not-recommended', 'dangerous']).optional(),
    jellyfish_risk: z.enum(['low', 'moderate', 'high']).nullable().optional(),
    water_quality: z.enum(['excellent', 'good', 'moderate', 'poor']).nullable().optional(),
    best_beaches_today: z.array(z.string()).default([]),
  }).optional(),
  water_activities: WaterActivitiesSchema.optional(),
});

// =============================================================================
// WEATHER ALERTS
// =============================================================================

export const WeatherAlertSchema = z.object({
  id: z.string(),
  type: z.enum([
    'thunderstorm',
    'heavy-rain',
    'flooding',
    'high-wind',
    'heat',
    'cold',
    'fog',
    'air-quality',
    'uv',
    'marine',
    'wildfire',
  ]),
  severity: z.enum(['minor', 'moderate', 'severe', 'extreme']),
  urgency: z.enum(['immediate', 'expected', 'future']),
  certainty: z.enum(['observed', 'likely', 'possible']).optional(),
  headline: z.string(),
  description: z.string(),
  instruction: z.string().optional(),
  issued_at: z.string(),
  expires_at: z.string(),
  affected_areas: z.array(z.string()).default([]),
  source: z.string().optional(),
});

export const WeatherAlertsSchema = z.object({
  active_alerts: z.array(WeatherAlertSchema).default([]),
  no_alerts: z.boolean().default(true),
  last_checked: z.string(),
});

// =============================================================================
// ACTIVITY RECOMMENDATIONS
// =============================================================================

export const TopRecommendationSchema = z.object({
  rank: z.number().int().min(1).max(5),
  activity: z.string(),
  category: z.enum(['outdoor', 'water', 'cultural', 'culinary', 'relaxation', 'adventure']),
  weather_suitability_score: z.number().int().min(1).max(10),
  best_time_window: z.object({
    start: z.string(),
    end: z.string(),
  }).optional(),
  reason: z.string(),
  weather_considerations: z.string().optional(),
  what_to_bring: z.array(z.string()).default([]),
  alternatives_if_weather_changes: z.array(z.string()).default([]),
  booking_required: z.boolean().default(false),
  estimated_duration_hours: z.number().optional(),
  physical_intensity: z.enum(['low', 'moderate', 'high']).optional(),
});

export const TimeOfDayActivitySchema = z.object({
  activity: z.string(),
  suitability: z.enum(['excellent', 'good', 'fair']),
  notes: z.string().optional(),
});

export const TimeOfDayRecommendationsSchema = z.object({
  time_window: z.string(),
  weather_summary: z.string(),
  recommended_activities: z.array(TimeOfDayActivitySchema).default([]),
  not_recommended: z.array(z.string()).default([]),
});

export const HikingTrailConditionSchema = z.object({
  status: z.enum(['open', 'partially-open', 'closed']),
  weather_suitability: z.enum(['excellent', 'good', 'fair', 'poor', 'dangerous']),
  recommended_today: z.boolean(),
  best_time: z.string().optional(),
  hazards: z.array(z.string()).default([]),
  notes: z.string().optional(),
  difficulty_increase_due_to_weather: z.boolean().optional(),
});

export const HikingRecommendationsSchema = z.object({
  overall_hiking_conditions: z.enum(['excellent', 'good', 'fair', 'poor', 'not-recommended']),
  trail_conditions: z.object({
    via_dell_amore: HikingTrailConditionSchema.optional(),
    sentiero_azzurro: HikingTrailConditionSchema.optional(),
    sanctuary_trails: HikingTrailConditionSchema.optional(),
  }).optional(),
  hiking_gear_recommendations: z.object({
    footwear: z.string().optional(),
    clothing_layers: z.array(z.string()).default([]),
    essential_items: z.array(z.string()).default([]),
    hydration_recommendation: z.string().optional(),
    sun_protection: z.string().optional(),
  }).optional(),
  safety_considerations: z.array(z.string()).default([]),
});

export const PhotographyTimeSchema = z.object({
  time_window: z.string(),
  type: z.enum(['golden-hour', 'blue-hour', 'midday', 'sunset', 'night']),
  quality_rating: z.enum(['excellent', 'good', 'fair']),
  recommended_subjects: z.array(z.string()).default([]),
  recommended_locations: z.array(z.string()).default([]),
});

export const PhotographyRecommendationsSchema = z.object({
  overall_conditions: z.enum(['excellent', 'good', 'fair', 'poor']),
  lighting_quality: z.enum(['harsh', 'bright', 'soft', 'dramatic', 'flat', 'golden']).optional(),
  best_times: z.array(PhotographyTimeSchema).default([]),
  weather_impact_on_photos: z.string().optional(),
  gear_recommendations: z.array(z.string()).default([]),
  tips: z.array(z.string()).default([]),
});

export const IndoorAlternativeSchema = z.object({
  name: z.string(),
  type: z.enum(['museum', 'restaurant', 'wine-tasting', 'cooking-class', 'spa', 'shopping']),
  location: z.string().optional(),
  why_recommended: z.string().optional(),
  duration_hours: z.number().optional(),
  booking_required: z.boolean().default(false),
});

export const ActivityRecommendationsSchema = z.object({
  generated_for_date: z.string(),
  todays_top_recommendations: z.array(TopRecommendationSchema).default([]),
  activities_by_time_of_day: z.object({
    early_morning: TimeOfDayRecommendationsSchema.optional(),
    morning: TimeOfDayRecommendationsSchema.optional(),
    afternoon: TimeOfDayRecommendationsSchema.optional(),
    evening: TimeOfDayRecommendationsSchema.optional(),
    night: TimeOfDayRecommendationsSchema.optional(),
  }).optional(),
  hiking_recommendations: HikingRecommendationsSchema.optional(),
  photography_recommendations: PhotographyRecommendationsSchema.optional(),
  indoor_alternatives: z.object({
    recommended_when: z.string().optional(),
    activities: z.array(IndoorAlternativeSchema).default([]),
  }).optional(),
  weather_dependent_warnings: z.array(z.object({
    activity: z.string(),
    current_status: z.enum(['go', 'caution', 'no-go']),
    reason: z.string(),
    expected_change: z.string().nullable().optional(),
    alternative: z.string().optional(),
  })).default([]),
});

// =============================================================================
// PACKING AND PREPARATION
// =============================================================================

export const PackingAndPreparationSchema = z.object({
  for_date_range: z.string().optional(),
  essential_items: z.object({
    always_bring: z.array(z.string()).default([]),
    weather_specific: z.array(z.string()).default([]),
    activity_specific: z.object({
      hiking: z.array(z.string()).default([]),
      beach: z.array(z.string()).default([]),
      photography: z.array(z.string()).default([]),
    }).optional(),
  }).optional(),
  clothing_guide: z.object({
    daytime: z.object({
      temperature_range: z.string().optional(),
      recommendations: z.array(z.string()).default([]),
      layering_advice: z.string().optional(),
    }).optional(),
    evening: z.object({
      temperature_range: z.string().optional(),
      recommendations: z.array(z.string()).default([]),
      notes: z.string().optional(),
    }).optional(),
    rain_gear: z.object({
      needed: z.boolean(),
      probability: z.enum(['low', 'medium', 'high']).optional(),
      recommendations: z.array(z.string()).default([]),
    }).optional(),
    sun_protection: z.object({
      needed: z.boolean(),
      uv_level: z.string().optional(),
      recommendations: z.array(z.string()).default([]),
    }).optional(),
    footwear: z.object({
      primary: z.string().optional(),
      alternatives: z.array(z.string()).default([]),
      notes: z.string().optional(),
    }).optional(),
  }).optional(),
  health_and_safety: z.object({
    hydration: z.object({
      recommendation: z.string().optional(),
      water_intake_liters: z.number().optional(),
    }).optional(),
    sun_exposure: z.object({
      risk_level: z.enum(['low', 'moderate', 'high', 'very-high']).optional(),
      peak_hours_to_avoid: z.string().optional(),
      spf_recommendation: z.number().int().optional(),
    }).optional(),
    heat_safety: z.object({
      concern_level: z.enum(['none', 'low', 'moderate', 'high']).optional(),
      recommendations: z.array(z.string()).default([]),
    }).optional(),
  }).optional(),
});

// =============================================================================
// SEASONAL CONTEXT
// =============================================================================

export const SeasonalContextSchema = z.object({
  current_season: z.enum(['spring', 'summer', 'fall', 'winter']),
  season_description: z.string().optional(),
  is_typical_weather: z.boolean().optional(),
  comparison_to_average: z.object({
    temperature: z.enum(['above-average', 'average', 'below-average']).optional(),
    precipitation: z.enum(['above-average', 'average', 'below-average']).optional(),
    notes: z.string().optional(),
  }).optional(),
  tourist_season: z.enum(['low', 'shoulder', 'high', 'peak']).optional(),
  crowd_expectations: z.string().optional(),
  seasonal_events: z.array(z.object({
    name: z.string(),
    date: z.string(),
    weather_dependent: z.boolean().default(false),
  })).default([]),
  seasonal_activities: z.object({
    best_activities_this_season: z.array(z.string()).default([]),
    activities_to_avoid: z.array(z.string()).default([]),
    seasonal_highlights: z.array(z.string()).default([]),
  }).optional(),
});

// =============================================================================
// MAIN WEATHER SCHEMA
// =============================================================================

export const CinqueTerreWeatherSchema = z.object({
  metadata: WeatherMetadataSchema,
  current_conditions: CurrentConditionsSchema,
  hourly_forecast: HourlyForecastSchema.optional(),
  daily_forecast: DailyForecastSchema.optional(),
  marine_conditions: MarineConditionsSchema.optional(),
  weather_alerts: WeatherAlertsSchema.optional(),
  activity_recommendations: ActivityRecommendationsSchema.optional(),
  packing_and_preparation: PackingAndPreparationSchema.optional(),
  seasonal_context: SeasonalContextSchema.optional(),
  forecast_confidence: z.object({
    today: z.object({ confidence: z.enum(['high', 'medium', 'low']), notes: z.string().optional() }).optional(),
    tomorrow: z.object({ confidence: z.enum(['high', 'medium', 'low']), notes: z.string().optional() }).optional(),
    days_3_5: z.object({ confidence: z.enum(['high', 'medium', 'low']), notes: z.string().optional() }).optional(),
    days_6_7: z.object({ confidence: z.enum(['high', 'medium', 'low']), notes: z.string().optional() }).optional(),
    last_updated: z.string().optional(),
    next_update: z.string().optional(),
  }).optional(),
  useful_links: z.object({
    official_weather: z.string().optional(),
    marine_forecast: z.string().optional(),
    trail_conditions: z.string().optional(),
    ferry_status: z.string().optional(),
    emergency_services: z.string().default('112'),
  }).optional(),
});

export type CinqueTerreWeather = z.infer<typeof CinqueTerreWeatherSchema>;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const CINQUETERRE_WEATHER_COLLECTION_TYPE = {
  type: 'cinqueterre_weather',
  displayName: 'Cinque Terre Weather',
  singularName: 'Weather Report',
  icon: 'cloud-sun',
  color: '#3B82F6',
  description: 'Weather conditions and activity recommendations for Cinque Terre',
  schema: CinqueTerreWeatherSchema,
  createSchema: CinqueTerreWeatherSchema,
  fieldMetadata: {},
} as const;
