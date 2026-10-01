/**
 * Cinque Terre Transportation Collection Schema
 * Comprehensive schema for transportation data
 */

import { z } from 'zod';

// =============================================================================
// COMMON SUB-SCHEMAS
// =============================================================================

export const TransportCoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

// =============================================================================
// HUB INFORMATION
// =============================================================================

export const HubFacilitiesSchema = z.object({
  ticket_office: z.boolean().default(false),
  ticket_machines: z.boolean().default(false),
  waiting_room: z.boolean().default(false),
  restrooms: z.boolean().default(false),
  luggage_storage: z.boolean().default(false),
  wifi: z.boolean().default(false),
  atm: z.boolean().default(false),
  accessibility: z.object({
    wheelchair_accessible: z.boolean().default(false),
    elevator: z.boolean().default(false),
    ramps: z.boolean().default(false),
    accessibility_notes: z.string().optional(),
  }).optional(),
});

export const OperatingHoursSchema = z.object({
  monday: z.object({ open: z.string(), close: z.string() }).optional(),
  tuesday: z.object({ open: z.string(), close: z.string() }).optional(),
  wednesday: z.object({ open: z.string(), close: z.string() }).optional(),
  thursday: z.object({ open: z.string(), close: z.string() }).optional(),
  friday: z.object({ open: z.string(), close: z.string() }).optional(),
  saturday: z.object({ open: z.string(), close: z.string() }).optional(),
  sunday: z.object({ open: z.string(), close: z.string() }).optional(),
});

export const PrimaryHubSchema = z.object({
  name: z.string(),
  name_local: z.string().optional(),
  type: z.enum(['Train Station', 'Ferry Terminal', 'Bus Station']),
  address: z.string(),
  coordinates: TransportCoordinatesSchema,
  facilities: HubFacilitiesSchema.optional(),
  operating_hours: z.object({
    ticket_office: OperatingHoursSchema.optional(),
    station_access: z.string().optional(),
  }).optional(),
  contact: z.object({
    phone: z.string().optional(),
    website: z.string().optional(),
  }).optional(),
});

export const SecondaryHubSchema = z.object({
  name: z.string(),
  type: z.string(),
  distance_km: z.number(),
  travel_time_minutes: z.number().int(),
  connection_type: z.string(),
  notes: z.string().optional(),
});

export const HubInformationSchema = z.object({
  primary_hub: PrimaryHubSchema,
  secondary_hubs: z.array(SecondaryHubSchema).default([]),
});

// =============================================================================
// TRANSPORTATION OPTIONS
// =============================================================================

export const TransportCategorySchema = z.object({
  primary: z.enum([
    'Train',
    'Ferry',
    'Bus',
    'Taxi',
    'Car Service',
    'Walking Path',
    'Water Taxi',
    'Boat Rental',
    'Bike Rental',
  ]),
  secondary: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const OperatorSchema = z.object({
  name: z.string(),
  name_local: z.string().nullable().optional(),
  type: z.enum(['National Rail Operator', 'Ferry Company', 'Private', 'Municipal']),
  website: z.string().optional(),
  app: z.object({
    name: z.string(),
    ios_url: z.string().optional(),
    android_url: z.string().optional(),
  }).optional(),
  customer_service: z.object({
    phone: z.string().optional(),
    email: z.string().nullable().optional(),
    hours: z.string().optional(),
  }).optional(),
});

export const RouteSchema = z.object({
  route_id: z.string().optional(),
  route_name: z.string(),
  route_name_local: z.string().nullable().optional(),
  line_number: z.string().nullable().optional(),
  route_type: z.enum(['Regional', 'Express', 'Local']).optional(),
  origin: z.string(),
  destination: z.string(),
  via_stops: z.array(z.string()).default([]),
  direction: z.enum(['Both', 'One-way']).default('Both'),
  total_stops: z.number().int().optional(),
  total_distance_km: z.number().optional(),
  total_duration_minutes: z.number().int().optional(),
  scenic_rating: z.number().int().min(1).max(5).nullable().optional(),
  scenic_highlights: z.array(z.string()).default([]),
});

export const StopSchema = z.object({
  stop_name: z.string(),
  stop_type: z.enum(['Station', 'Dock', 'Stop']),
  platform_count: z.number().int().nullable().optional(),
  coordinates: TransportCoordinatesSchema.optional(),
  zone: z.string().optional(),
  staffed: z.boolean().default(false),
  announcements: z.boolean().default(false),
  display_boards: z.boolean().default(false),
});

export const FrequencySchema = z.object({
  trains_per_hour: z.number().int().optional(),
  interval_minutes: z.number().int().optional(),
});

export const ServiceHoursSchema = z.object({
  first_train_from_la_spezia: z.string().optional(),
  last_train_from_la_spezia: z.string().optional(),
  first_train_to_la_spezia: z.string().optional(),
  last_train_to_la_spezia: z.string().optional(),
  first_train_to_monterosso: z.string().optional(),
  last_train_to_monterosso: z.string().optional(),
});

export const SeasonalVariationSchema = z.object({
  period: z.string().optional(),
  frequency_increase: z.boolean().optional(),
  frequency_decrease: z.boolean().optional(),
  extended_hours: z.boolean().optional(),
  notes: z.string().optional(),
});

export const TransportScheduleSchema = z.object({
  frequency: z.object({
    peak_hours: FrequencySchema.optional(),
    off_peak: FrequencySchema.optional(),
    weekend: FrequencySchema.optional(),
  }).optional(),
  service_hours: ServiceHoursSchema.optional(),
  seasonal_variations: z.object({
    summer: SeasonalVariationSchema.optional(),
    winter: SeasonalVariationSchema.optional(),
  }).optional(),
  holiday_schedule: z.string().optional(),
  real_time_info: z.object({
    available: z.boolean().default(false),
    app: z.string().optional(),
    website: z.string().optional(),
    station_displays: z.boolean().default(false),
  }).optional(),
  timetable_url: z.string().optional(),
});

export const JourneyTimeSchema = z.object({
  destination: z.string(),
  duration_minutes: z.number().int(),
  distance_km: z.number().optional(),
  requires_change: z.boolean().default(false),
  change_at: z.string().nullable().optional(),
});

export const PassSchema = z.object({
  name: z.string(),
  name_local: z.string().optional(),
  description: z.string(),
  validity_options: z.array(z.object({
    duration: z.string(),
    adult_eur: z.number(),
    child_eur: z.number(),
    family_eur: z.number().nullable().optional(),
  })),
  includes: z.array(z.string()).default([]),
  purchase_locations: z.array(z.string()).default([]),
  purchase_url: z.string().optional(),
  recommended: z.boolean().default(false),
  value_assessment: z.string().optional(),
});

export const DiscountsSchema = z.object({
  children: z.object({
    age_range: z.string(),
    discount_percent: z.number().int(),
    notes: z.string().optional(),
  }).optional(),
  seniors: z.object({
    age_range: z.string(),
    discount_percent: z.number().int(),
    notes: z.string().optional(),
  }).optional(),
  groups: z.object({
    minimum_size: z.number().int(),
    discount_percent: z.number().int(),
  }).optional(),
});

export const TransportPricingSchema = z.object({
  currency: z.string().default('EUR'),
  fare_type: z.enum(['Zone-based', 'Flat', 'Distance-based']).optional(),
  single_tickets: z.object({
    riomaggiore_to_la_spezia: z.number().optional(),
    riomaggiore_to_manarola: z.number().optional(),
    riomaggiore_to_monterosso: z.number().optional(),
    between_any_cinque_terre: z.number().optional(),
  }).optional(),
  passes: z.array(PassSchema).default([]),
  discounts: DiscountsSchema.optional(),
  payment_methods: z.array(z.string()).default([]),
  ticket_purchase: z.object({
    in_advance: z.boolean().default(false),
    on_train: z.boolean().default(false),
    at_station: z.boolean().default(false),
    online: z.boolean().default(false),
    app: z.boolean().default(false),
    validation_required: z.boolean().default(true),
    validation_notes: z.string().optional(),
  }).optional(),
  price_notes: z.string().optional(),
});

export const VehicleAmenitiesSchema = z.object({
  air_conditioning: z.boolean().default(false),
  wifi: z.boolean().default(false),
  power_outlets: z.boolean().default(false),
  restrooms: z.boolean().default(false),
  luggage_space: z.string().optional(),
  bike_storage: z.string().optional(),
  food_service: z.boolean().default(false),
  quiet_car: z.boolean().default(false),
});

export const VehiclesSchema = z.object({
  train_type: z.string().optional(),
  capacity: z.object({
    seats: z.number().int().optional(),
    standing: z.number().int().optional(),
  }).optional(),
  amenities: VehicleAmenitiesSchema.optional(),
  accessibility: z.object({
    wheelchair_accessible: z.boolean().default(false),
    wheelchair_spaces: z.number().int().optional(),
    accessibility_notes: z.string().optional(),
    assistance_available: z.boolean().default(false),
    assistance_booking: z.string().optional(),
  }).optional(),
});

export const TransportRatingsSchema = z.object({
  average_rating: z.number().min(0).max(5),
  total_reviews: z.number().int().default(0),
  google: z.object({
    rating: z.number().optional(),
    review_count: z.number().int().optional(),
  }).optional(),
  tripadvisor: z.object({
    rating: z.number().optional(),
    review_count: z.number().int().optional(),
  }).optional(),
});

export const TransportReviewSchema = z.object({
  source: z.enum(['TripAdvisor', 'Google', 'Rome2Rio']),
  author: z.string(),
  author_country: z.string().optional(),
  rating: z.number().int().min(1).max(5),
  date: z.string(),
  title: z.string().nullable().optional(),
  text: z.string(),
  helpful_votes: z.number().int().nullable().optional(),
  highlights_mentioned: z.array(z.string()).default([]),
  complaints_mentioned: z.array(z.string()).default([]),
});

export const TransportProsConsSchema = z.object({
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
});

export const TransportationOptionSchema = z.object({
  id: z.string().optional(),
  rank: z.number().int().optional(),
  name: z.string(),
  name_local: z.string().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  category: TransportCategorySchema,
  operator: OperatorSchema.optional(),
  routes: z.array(RouteSchema).default([]),
  stops_serving_riomaggiore: z.array(StopSchema).default([]),
  schedule: TransportScheduleSchema.optional(),
  journey_times: z.object({
    from_riomaggiore: z.array(JourneyTimeSchema).default([]),
  }).optional(),
  pricing: TransportPricingSchema.optional(),
  vehicles: VehiclesSchema.optional(),
  practical_info: z.object({
    booking_required: z.boolean().default(false),
    reservation_available: z.boolean().default(false),
    arrive_before_minutes: z.number().int().optional(),
    boarding_process: z.string().optional(),
    luggage_policy: z.object({
      carry_on: z.string().optional(),
      large_luggage: z.string().optional(),
      bikes: z.string().optional(),
      pets: z.string().optional(),
    }).optional(),
    tips: z.array(z.string()).default([]),
    common_issues: z.array(z.string()).default([]),
  }).optional(),
  ratings_reviews: TransportRatingsSchema.optional(),
  reviews: z.array(TransportReviewSchema).default([]),
  pros_cons: TransportProsConsSchema.optional(),
  best_for: z.array(z.string()).default([]),
  not_recommended_for: z.array(z.string()).default([]),
});

// =============================================================================
// PARKING OPTIONS
// =============================================================================

export const ParkingLocationSchema = z.object({
  address: z.string(),
  area: z.string(),
  coordinates: TransportCoordinatesSchema,
  distance_to_village_center_meters: z.number().int(),
  access_to_village: z.string(),
});

export const ParkingCapacitySchema = z.object({
  total_spaces: z.number().int(),
  accessible_spaces: z.number().int().default(0),
  motorcycle_spaces: z.number().int().nullable().optional(),
  ev_charging: z.boolean().default(false),
});

export const ParkingRatesSchema = z.object({
  per_hour: z.number(),
  per_day_max: z.number(),
  overnight: z.number().nullable().optional(),
  weekly: z.number().nullable().optional(),
});

export const ParkingPricingSchema = z.object({
  currency: z.string().default('EUR'),
  rates: ParkingRatesSchema,
  payment_methods: z.array(z.string()).default([]),
  payment_notes: z.string().optional(),
});

export const ParkingAvailabilitySchema = z.object({
  typical_availability: z.enum(['Very Limited', 'Limited', 'Good', 'Excellent']),
  fills_up_by: z.string().optional(),
  best_arrival_time: z.string().optional(),
  reservation_possible: z.boolean().default(false),
  real_time_availability: z.boolean().default(false),
});

export const ParkingOptionSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  name_local: z.string().nullable().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  category: z.object({
    primary: z.literal('Parking'),
    secondary: z.enum(['Public Parking Lot', 'Park and Ride', 'Private']),
    tags: z.array(z.string()).default([]),
  }),
  location: ParkingLocationSchema,
  capacity: ParkingCapacitySchema,
  pricing: ParkingPricingSchema,
  operating_hours: z.object({
    open_24_hours: z.boolean().default(false),
    staffed_hours: z.string().nullable().optional(),
  }).optional(),
  availability: ParkingAvailabilitySchema,
  restrictions: z.object({
    vehicle_height_limit_m: z.number().nullable().optional(),
    vehicle_length_limit_m: z.number().nullable().optional(),
    overnight_allowed: z.boolean().default(false),
    campers_allowed: z.boolean().default(false),
    time_limit_hours: z.number().int().nullable().optional(),
  }).optional(),
  facilities: z.object({
    covered: z.boolean().default(false),
    security: z.string().optional(),
    lighting: z.boolean().default(false),
    restrooms: z.boolean().default(false),
    ev_charging: z.boolean().default(false),
  }).optional(),
  practical_info: z.object({
    tips: z.array(z.string()).default([]),
    warnings: z.array(z.string()).default([]),
  }).optional(),
  ratings_reviews: z.object({
    average_rating: z.number().optional(),
    total_reviews: z.number().int().default(0),
  }).optional(),
  pros_cons: TransportProsConsSchema.optional(),
  recommended: z.boolean().default(false),
  alternative_suggestion: z.string().optional(),
});

// =============================================================================
// WALKING PATHS
// =============================================================================

export const WalkingRouteSchema = z.object({
  start_point: z.string(),
  end_point: z.string(),
  distance_km: z.number(),
  duration_minutes: z.number().int(),
  difficulty: z.enum(['Easy', 'Moderate', 'Difficult', 'Very Difficult']),
  terrain: z.string(),
  elevation_gain_m: z.number().int(),
  direction: z.enum(['Both ways', 'One-way recommended']).default('Both ways'),
});

export const WalkingPathStatusSchema = z.object({
  open: z.boolean(),
  partial_opening: z.boolean().default(false),
  reopened_date: z.string().nullable().optional(),
  status_notes: z.string().optional(),
  closures_due_to_weather: z.boolean().default(false),
  status_check_url: z.string().optional(),
});

export const WalkingPathSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  name_local: z.string().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  category: z.object({
    primary: z.literal('Walking Path'),
    secondary: z.enum(['Scenic Footpath', 'Hiking Trail']),
    tags: z.array(z.string()).default([]),
  }),
  route: WalkingRouteSchema,
  current_status: WalkingPathStatusSchema,
  access: z.object({
    entry_points: z.array(z.object({
      location: z.string(),
      coordinates: TransportCoordinatesSchema.optional(),
    })).default([]),
    ticket_required: z.boolean().default(false),
    included_in_cinque_terre_card: z.boolean().default(false),
    standalone_ticket_eur: z.number().optional(),
  }).optional(),
  highlights: z.array(z.string()).default([]),
  practical_info: z.object({
    best_time: z.string().optional(),
    crowd_level: z.string().optional(),
    tips: z.array(z.string()).default([]),
  }).optional(),
});

// =============================================================================
// ACCESSIBILITY SUMMARY
// =============================================================================

export const AccessibilitySummarySchema = z.object({
  overall_rating: z.enum(['Challenging', 'Moderate', 'Good', 'Excellent']),
  summary: z.string(),
  train_accessibility: z.string().optional(),
  ferry_accessibility: z.string().optional(),
  village_accessibility: z.string().optional(),
  accessible_alternatives: z.array(z.string()).default([]),
  resources: z.object({
    accessibility_info_url: z.string().optional(),
    assistance_request: z.string().optional(),
  }).optional(),
});

// =============================================================================
// MAIN TRANSPORTATION SCHEMA
// =============================================================================

export const CinqueTerreTransportationSchema = z.object({
  metadata: z.object({
    query_location: z.string(),
    generated_at: z.string(),
    total_results: z.number().int(),
    search_type: z.string().default('transportation'),
    last_schedule_update: z.string().optional(),
    currency: z.string().default('EUR'),
    categories_included: z.array(z.string()).default([]),
  }),

  hub_information: HubInformationSchema.optional(),

  transportation_options: z.array(TransportationOptionSchema).default([]),

  parking_options: z.array(ParkingOptionSchema).default([]),

  walking_paths: z.array(WalkingPathSchema).default([]),

  taxi_car_services: z.array(z.object({
    id: z.string().optional(),
    name: z.string(),
    category: z.object({
      primary: z.enum(['Taxi', 'Car Service', 'Water Taxi']),
      secondary: z.string().optional(),
    }),
    services: z.array(z.string()).default([]),
    coverage: z.object({
      airports: z.array(z.string()).default([]),
      cities: z.array(z.string()).default([]),
      ports: z.array(z.string()).default([]),
    }).optional(),
    pricing: z.object({
      currency: z.string().default('EUR'),
      example_fares: z.record(z.number()).optional(),
      pricing_notes: z.string().optional(),
      payment_methods: z.array(z.string()).default([]),
    }).optional(),
    contact: z.object({
      phone: z.string().optional(),
      email: z.string().nullable().optional(),
      website: z.string().optional(),
      booking_url: z.string().nullable().optional(),
    }).optional(),
    pros_cons: TransportProsConsSchema.optional(),
  })).default([]),

  rental_options: z.array(z.object({
    id: z.string().optional(),
    name: z.string(),
    category: z.object({
      primary: z.enum(['Boat Rental', 'Bike Rental', 'Scooter Rental', 'Kayak Rental']),
      secondary: z.enum(['Self-Drive', 'Guided']).optional(),
    }),
    location: z.string().optional(),
    coordinates: TransportCoordinatesSchema.optional(),
    rental_types: z.array(z.object({
      type: z.string(),
      description: z.string().optional(),
      capacity: z.number().int().optional(),
      price_per_hour_eur: z.number().optional(),
      price_half_day_eur: z.number().optional(),
      price_full_day_eur: z.number().optional(),
      fuel: z.enum(['Included', 'Extra', 'Electric']).optional(),
    })).default([]),
    requirements: z.object({
      license_required: z.boolean().default(false),
      license_type: z.string().nullable().optional(),
      minimum_age: z.number().int().optional(),
      deposit_eur: z.number().optional(),
      id_required: z.boolean().default(true),
    }).optional(),
    availability: z.object({
      seasonal: z.boolean().default(false),
      season: z.string().nullable().optional(),
      booking_recommended: z.boolean().default(false),
    }).optional(),
  })).default([]),

  accessibility_summary: AccessibilitySummarySchema.optional(),

  recommended_itineraries: z.array(z.object({
    name: z.string(),
    description: z.string(),
    target_audience: z.string().optional(),
    transportation_sequence: z.array(z.object({
      step: z.number().int(),
      mode: z.string(),
      action: z.string(),
      duration_minutes: z.number().int().nullable().optional(),
      cost_eur: z.number().nullable().optional(),
    })).default([]),
    total_cost_estimate_eur: z.number().optional(),
    time_required_hours: z.number().optional(),
    notes: z.string().nullable().optional(),
  })).default([]),

  tips_and_recommendations: z.object({
    general_tips: z.array(z.string()).default([]),
    seasonal_tips: z.object({
      summer: z.string().optional(),
      spring_fall: z.string().optional(),
      winter: z.string().optional(),
    }).optional(),
    money_saving_tips: z.array(z.string()).default([]),
    first_time_visitor_tips: z.array(z.string()).default([]),
  }).optional(),

  emergency_contacts: z.object({
    general_emergency: z.string().default('112'),
    police: z.string().default('113'),
    medical: z.string().default('118'),
    coast_guard: z.string().default('1530'),
    tourist_police: z.string().nullable().optional(),
    nearest_hospital: z.object({
      name: z.string(),
      address: z.string(),
      distance_km: z.number(),
    }).optional(),
  }).optional(),
});

export type CinqueTerreTransportation = z.infer<typeof CinqueTerreTransportationSchema>;

// =============================================================================
// COLLECTION TYPE DEFINITION
// =============================================================================

export const CINQUETERRE_TRANSPORTATION_COLLECTION_TYPE = {
  type: 'cinqueterre_transportation',
  displayName: 'Cinque Terre Transportation',
  singularName: 'Transportation Guide',
  icon: 'train',
  color: '#06B6D4',
  description: 'Transportation options for Cinque Terre',
  schema: CinqueTerreTransportationSchema,
  createSchema: CinqueTerreTransportationSchema,
  fieldMetadata: {},
} as const;
