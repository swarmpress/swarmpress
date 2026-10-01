/**
 * Seed Cinque Terre Blueprints
 * Creates comprehensive page blueprints matching the specs/cinque-terre-website-structure.md
 */

import { db } from '../packages/backend/src/db/connection'

const WEBSITE_ID = '47536686-4732-4c33-b529-66316a472c88'

interface BlueprintSchema {
  page_type?: string
  version?: string
  components: Array<{
    type: string
    order: number
    required?: boolean
    variant?: string
    ai_hints?: {
      purpose?: string
      tone?: string
      min_words?: number
      max_words?: number
    }
  }>
  global_linking_rules?: {
    min_total_links?: number
    max_total_links?: number
    must_link_to_page_type?: string[]
  }
  seo_template?: {
    title_pattern?: string
    meta_description_pattern?: string
    required_keywords?: string[]
  }
  data_sources?: string[]
}

interface Blueprint {
  name: string
  description: string
  schema: BlueprintSchema
}

const blueprints: Blueprint[] = [
  // ============================================
  // ENHANCED EXISTING BLUEPRINTS
  // ============================================

  {
    name: 'Homepage',
    description: 'Main landing page for the Cinque Terre travel portal with hero, highlights, and quick navigation',
    schema: {
      page_type: 'homepage',
      version: '2.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Captivating introduction to Cinque Terre', tone: 'inspiring, welcoming', min_words: 20, max_words: 50 } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Brief overview of Cinque Terre', tone: 'informative, enticing', min_words: 100, max_words: 200 } },
        { type: 'gallery', order: 2, required: true, variant: 'carousel', ai_hints: { purpose: 'Showcase the five villages' } },
        { type: 'heading', order: 3, required: false, ai_hints: { purpose: 'Section header for villages' } },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'Quick links to each village' } },
        { type: 'callout', order: 5, required: false, variant: 'info', ai_hints: { purpose: 'Travel tips or seasonal highlights' } },
        { type: 'faq', order: 6, required: false, ai_hints: { purpose: 'Common visitor questions', min_words: 50 } },
      ],
      global_linking_rules: {
        min_total_links: 5,
        max_total_links: 15,
        must_link_to_page_type: ['village_overview', 'transport', 'itinerary'],
      },
      seo_template: {
        title_pattern: 'Cinque Terre Travel Guide | {{year}} Complete Visitor Information',
        meta_description_pattern: 'Plan your perfect trip to Cinque Terre. Discover the five villages, hiking trails, beaches, and local cuisine. Updated for {{year}}.',
        required_keywords: ['Cinque Terre', 'Italy', 'travel guide'],
      },
    },
  },

  {
    name: 'Village Overview',
    description: 'Overview page for each of the five villages with highlights, attractions, and practical info',
    schema: {
      page_type: 'village_overview',
      version: '2.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Village hero with iconic view', tone: 'welcoming' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Village introduction and character', tone: 'descriptive, evocative', min_words: 150, max_words: 300 } },
        { type: 'callout', order: 2, required: false, variant: 'info', ai_hints: { purpose: 'Quick facts about the village' } },
        { type: 'gallery', order: 3, required: true, variant: 'grid', ai_hints: { purpose: 'Village photo gallery' } },
        { type: 'heading', order: 4, required: true, ai_hints: { purpose: 'Things to Do section' } },
        { type: 'list', order: 5, required: true, ai_hints: { purpose: 'Top attractions and activities' } },
        { type: 'heading', order: 6, required: false, ai_hints: { purpose: 'Getting There section' } },
        { type: 'paragraph', order: 7, required: false, ai_hints: { purpose: 'Transport information', min_words: 50 } },
        { type: 'faq', order: 8, required: true, ai_hints: { purpose: 'Village-specific FAQs' } },
      ],
      global_linking_rules: {
        min_total_links: 8,
        max_total_links: 20,
        must_link_to_page_type: ['poi_detail', 'trail_guide', 'restaurant_detail', 'hotel_detail'],
      },
      seo_template: {
        title_pattern: '{{village_name}} Guide | Cinque Terre {{year}}',
        meta_description_pattern: 'Discover {{village_name}} in Cinque Terre. Find the best restaurants, hotels, beaches, and things to do. Complete visitor guide.',
        required_keywords: ['{{village_name}}', 'Cinque Terre'],
      },
      data_sources: ['Google Places API', 'Wikidata', 'OpenWeather'],
    },
  },

  // ============================================
  // NEW BLUEPRINTS - TRANSPORT
  // ============================================

  {
    name: 'Transport Hub',
    description: 'Main transport information page with overview of all transport options',
    schema: {
      page_type: 'transport_hub',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Transport overview header', tone: 'practical, helpful' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Overview of getting around Cinque Terre', min_words: 100, max_words: 200 } },
        { type: 'callout', order: 2, required: true, variant: 'warning', ai_hints: { purpose: 'Important transport notice (car restrictions, peak times)' } },
        { type: 'heading', order: 3, required: true },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'Transport options overview with links' } },
        { type: 'embed', order: 5, required: false, variant: 'maps', ai_hints: { purpose: 'Interactive transport map' } },
        { type: 'faq', order: 6, required: true, ai_hints: { purpose: 'Common transport questions' } },
      ],
      global_linking_rules: {
        min_total_links: 5,
        max_total_links: 12,
        must_link_to_page_type: ['transport_train', 'transport_ferry', 'transport_car'],
      },
      seo_template: {
        title_pattern: 'Getting to & Around Cinque Terre | Transport Guide {{year}}',
        meta_description_pattern: 'Complete guide to Cinque Terre transport. Train schedules, ferry times, parking info, and the Cinque Terre Card explained.',
      },
      data_sources: ['Trenitalia GTFS', 'Traghetti Lines API'],
    },
  },

  {
    name: 'Train Guide',
    description: 'Detailed train information for traveling between villages and from major cities',
    schema: {
      page_type: 'transport_train',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Train travel header' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Overview of train travel in Cinque Terre', min_words: 150 } },
        { type: 'callout', order: 2, required: true, variant: 'info', ai_hints: { purpose: 'Cinque Terre Card info and pricing' } },
        { type: 'heading', order: 3, required: true, ai_hints: { purpose: 'Schedule section' } },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'Train frequency and travel times between villages' } },
        { type: 'heading', order: 5, required: false, ai_hints: { purpose: 'From Major Cities section' } },
        { type: 'paragraph', order: 6, required: false, ai_hints: { purpose: 'Connections from Florence, Milan, Rome, Pisa' } },
        { type: 'callout', order: 7, required: false, variant: 'warning', ai_hints: { purpose: 'Peak season crowding warnings' } },
        { type: 'faq', order: 8, required: true },
      ],
      global_linking_rules: {
        min_total_links: 4,
        max_total_links: 10,
      },
      seo_template: {
        title_pattern: 'Cinque Terre Train Guide | Schedules, Tickets & Tips {{year}}',
        meta_description_pattern: 'Everything about trains in Cinque Terre. Timetables, ticket prices, Cinque Terre Card, and how to avoid crowds.',
      },
      data_sources: ['Trenitalia GTFS'],
    },
  },

  {
    name: 'Ferry Guide',
    description: 'Ferry service information for coastal travel between villages',
    schema: {
      page_type: 'transport_ferry',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Ferry travel header with scenic coast image' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Overview of ferry services', min_words: 100 } },
        { type: 'callout', order: 2, required: true, variant: 'warning', ai_hints: { purpose: 'Seasonal availability notice' } },
        { type: 'heading', order: 3, required: true },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'Ferry routes and schedules' } },
        { type: 'gallery', order: 5, required: false, ai_hints: { purpose: 'Views from the ferry' } },
        { type: 'paragraph', order: 6, required: false, ai_hints: { purpose: 'Booking and ticket info' } },
        { type: 'faq', order: 7, required: true },
      ],
      global_linking_rules: {
        min_total_links: 3,
        max_total_links: 8,
      },
      seo_template: {
        title_pattern: 'Cinque Terre Ferry Service | Schedules & Tickets {{year}}',
        meta_description_pattern: 'Take the ferry between Cinque Terre villages. Seasonal schedules, ticket prices, and the best views from the water.',
      },
      data_sources: ['Traghetti Lines API'],
    },
  },

  {
    name: 'Car & Parking Guide',
    description: 'Information about driving to Cinque Terre and parking options',
    schema: {
      page_type: 'transport_car',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true },
        { type: 'callout', order: 1, required: true, variant: 'warning', ai_hints: { purpose: 'Strong advisory against driving into villages' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: 'Driving overview and restrictions', min_words: 150 } },
        { type: 'heading', order: 3, required: true, ai_hints: { purpose: 'Parking Options section' } },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'Parking locations by village with prices' } },
        { type: 'embed', order: 5, required: false, variant: 'maps', ai_hints: { purpose: 'Map of parking locations' } },
        { type: 'callout', order: 6, required: false, variant: 'info', ai_hints: { purpose: 'Tips for peak season' } },
        { type: 'faq', order: 7, required: true },
      ],
      global_linking_rules: {
        min_total_links: 3,
        max_total_links: 8,
      },
      seo_template: {
        title_pattern: 'Driving & Parking in Cinque Terre | Complete Guide {{year}}',
        meta_description_pattern: 'Should you drive to Cinque Terre? Parking locations, costs, and why the train is better. Essential info for drivers.',
      },
    },
  },

  {
    name: 'Cinque Terre Card Guide',
    description: 'Complete guide to the Cinque Terre Card passes and what they include',
    schema: {
      page_type: 'transport_pass',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'What is the Cinque Terre Card', min_words: 100 } },
        { type: 'heading', order: 2, required: true, ai_hints: { purpose: 'Card Types section' } },
        { type: 'list', order: 3, required: true, ai_hints: { purpose: 'Different card options and prices' } },
        { type: 'callout', order: 4, required: true, variant: 'success', ai_hints: { purpose: 'What\'s included in each card' } },
        { type: 'heading', order: 5, required: true, ai_hints: { purpose: 'Where to Buy section' } },
        { type: 'paragraph', order: 6, required: true, ai_hints: { purpose: 'Purchase locations and tips' } },
        { type: 'callout', order: 7, required: false, variant: 'info', ai_hints: { purpose: 'Is the card worth it calculation' } },
        { type: 'faq', order: 8, required: true },
      ],
      global_linking_rules: {
        min_total_links: 4,
        max_total_links: 10,
        must_link_to_page_type: ['transport_train', 'trail_guide'],
      },
      seo_template: {
        title_pattern: 'Cinque Terre Card {{year}} | Prices, Benefits & Is It Worth It?',
        meta_description_pattern: 'Complete guide to the Cinque Terre Card. Compare card types, prices, what\'s included, and whether you need one.',
      },
    },
  },

  // ============================================
  // NEW BLUEPRINTS - WEATHER
  // ============================================

  {
    name: 'Weather Overview',
    description: 'Current weather and forecast for Cinque Terre',
    schema: {
      page_type: 'weather_forecast',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Weather overview header' } },
        { type: 'callout', order: 1, required: true, variant: 'info', ai_hints: { purpose: 'Current conditions summary' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: '7-day forecast overview', min_words: 100 } },
        { type: 'heading', order: 3, required: true },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'Daily forecast breakdown' } },
        { type: 'callout', order: 5, required: false, variant: 'warning', ai_hints: { purpose: 'Weather alerts if any' } },
        { type: 'paragraph', order: 6, required: false, ai_hints: { purpose: 'What to pack based on forecast' } },
      ],
      global_linking_rules: {
        min_total_links: 2,
        max_total_links: 6,
        must_link_to_page_type: ['weather_monthly', 'itinerary'],
      },
      seo_template: {
        title_pattern: 'Cinque Terre Weather Forecast | 7-Day Outlook',
        meta_description_pattern: 'Current weather in Cinque Terre and 7-day forecast. Plan your hiking and beach days with accurate local weather.',
      },
      data_sources: ['OpenWeather OneCall API'],
    },
  },

  {
    name: 'Monthly Weather Guide',
    description: 'Month-by-month climate guide for planning trips',
    schema: {
      page_type: 'weather_monthly',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Overview of Cinque Terre climate', min_words: 150 } },
        { type: 'heading', order: 2, required: true, ai_hints: { purpose: 'Best Time to Visit section' } },
        { type: 'callout', order: 3, required: true, variant: 'success', ai_hints: { purpose: 'Best months recommendation' } },
        { type: 'heading', order: 4, required: true, ai_hints: { purpose: 'Month by Month section' } },
        { type: 'list', order: 5, required: true, ai_hints: { purpose: 'Monthly breakdown with temps and rainfall' } },
        { type: 'paragraph', order: 6, required: false, ai_hints: { purpose: 'Seasonal activities and events' } },
        { type: 'faq', order: 7, required: true },
      ],
      global_linking_rules: {
        min_total_links: 4,
        max_total_links: 10,
        must_link_to_page_type: ['itinerary', 'events_calendar'],
      },
      seo_template: {
        title_pattern: 'Best Time to Visit Cinque Terre | Month-by-Month Weather Guide',
        meta_description_pattern: 'When is the best time to visit Cinque Terre? Monthly weather averages, crowd levels, and what to expect each season.',
      },
      data_sources: ['OpenWeather Historical API'],
    },
  },

  // ============================================
  // NEW BLUEPRINTS - ITINERARIES
  // ============================================

  {
    name: 'Itinerary Guide',
    description: 'Day-by-day itinerary for visiting Cinque Terre',
    schema: {
      page_type: 'itinerary',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Itinerary header with trip duration' } },
        { type: 'callout', order: 1, required: true, variant: 'info', ai_hints: { purpose: 'Trip overview: duration, difficulty, highlights' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: 'Itinerary introduction', min_words: 100 } },
        { type: 'heading', order: 3, required: true, ai_hints: { purpose: 'Day 1 header' } },
        { type: 'paragraph', order: 4, required: true, ai_hints: { purpose: 'Day 1 activities', min_words: 200 } },
        { type: 'list', order: 5, required: false, ai_hints: { purpose: 'Day 1 schedule breakdown' } },
        { type: 'heading', order: 6, required: false, ai_hints: { purpose: 'Day 2 header (if multi-day)' } },
        { type: 'paragraph', order: 7, required: false, ai_hints: { purpose: 'Day 2 activities' } },
        { type: 'callout', order: 8, required: false, variant: 'success', ai_hints: { purpose: 'Pro tips for this itinerary' } },
        { type: 'gallery', order: 9, required: false, ai_hints: { purpose: 'Photos from the itinerary route' } },
        { type: 'faq', order: 10, required: true },
      ],
      global_linking_rules: {
        min_total_links: 8,
        max_total_links: 20,
        must_link_to_page_type: ['village_overview', 'restaurant_detail', 'trail_guide'],
      },
      seo_template: {
        title_pattern: '{{duration}} Cinque Terre Itinerary | {{theme}} Trip Guide',
        meta_description_pattern: 'Perfect {{duration}} itinerary for Cinque Terre. Day-by-day guide with best villages, hiking trails, restaurants, and local tips.',
      },
    },
  },

  // ============================================
  // NEW BLUEPRINTS - HISTORY & CULTURE
  // ============================================

  {
    name: 'History & Culture',
    description: 'Historical and cultural information about Cinque Terre',
    schema: {
      page_type: 'history_culture',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Historical/cultural header image' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Historical overview', tone: 'educational, engaging', min_words: 200 } },
        { type: 'quote', order: 2, required: false, ai_hints: { purpose: 'Historical quote or local saying' } },
        { type: 'heading', order: 3, required: true },
        { type: 'paragraph', order: 4, required: true, ai_hints: { purpose: 'Detailed historical narrative', min_words: 300 } },
        { type: 'gallery', order: 5, required: false, ai_hints: { purpose: 'Historical photos or artwork' } },
        { type: 'heading', order: 6, required: false, ai_hints: { purpose: 'UNESCO Heritage section' } },
        { type: 'paragraph', order: 7, required: false, ai_hints: { purpose: 'UNESCO designation information' } },
        { type: 'callout', order: 8, required: false, variant: 'info', ai_hints: { purpose: 'Cultural traditions highlight' } },
        { type: 'faq', order: 9, required: false },
      ],
      global_linking_rules: {
        min_total_links: 4,
        max_total_links: 12,
        must_link_to_page_type: ['village_overview', 'poi_detail'],
      },
      seo_template: {
        title_pattern: '{{topic}} | Cinque Terre History & Culture',
        meta_description_pattern: 'Discover the rich history and culture of Cinque Terre. From ancient fishing villages to UNESCO World Heritage Site.',
      },
      data_sources: ['Wikidata', 'Wikipedia API'],
    },
  },

  // ============================================
  // NEW BLUEPRINTS - MAPS
  // ============================================

  {
    name: 'Interactive Map',
    description: 'Interactive map page with points of interest',
    schema: {
      page_type: 'maps',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Maps page header' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Map usage instructions', min_words: 50 } },
        { type: 'embed', order: 2, required: true, variant: 'maps', ai_hints: { purpose: 'Main interactive map' } },
        { type: 'heading', order: 3, required: false, ai_hints: { purpose: 'Map legend section' } },
        { type: 'list', order: 4, required: false, ai_hints: { purpose: 'POI categories on the map' } },
        { type: 'callout', order: 5, required: false, variant: 'info', ai_hints: { purpose: 'Download offline map info' } },
      ],
      global_linking_rules: {
        min_total_links: 5,
        max_total_links: 15,
        must_link_to_page_type: ['village_overview', 'trail_guide'],
      },
      seo_template: {
        title_pattern: 'Cinque Terre Map | Interactive Guide to All Villages',
        meta_description_pattern: 'Interactive map of Cinque Terre with all villages, hiking trails, beaches, restaurants, and hotels. Plan your trip visually.',
      },
    },
  },

  // ============================================
  // NEW BLUEPRINTS - POI DETAILS
  // ============================================

  {
    name: 'Restaurant Detail',
    description: 'Individual restaurant page with menu highlights, reviews, and booking info',
    schema: {
      page_type: 'restaurant_detail',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Restaurant exterior or signature dish' } },
        { type: 'callout', order: 1, required: true, variant: 'info', ai_hints: { purpose: 'Quick info: cuisine type, price range, hours' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: 'Restaurant description and atmosphere', min_words: 150 } },
        { type: 'heading', order: 3, required: true, ai_hints: { purpose: 'Menu Highlights section' } },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'Must-try dishes' } },
        { type: 'gallery', order: 5, required: false, ai_hints: { purpose: 'Food and interior photos' } },
        { type: 'quote', order: 6, required: false, ai_hints: { purpose: 'Customer review excerpt' } },
        { type: 'heading', order: 7, required: false, ai_hints: { purpose: 'Practical Info section' } },
        { type: 'paragraph', order: 8, required: false, ai_hints: { purpose: 'Reservations, location, tips' } },
        { type: 'embed', order: 9, required: false, variant: 'maps', ai_hints: { purpose: 'Location map' } },
      ],
      global_linking_rules: {
        min_total_links: 3,
        max_total_links: 8,
        must_link_to_page_type: ['village_overview', 'restaurant_listing'],
      },
      seo_template: {
        title_pattern: '{{restaurant_name}} | Restaurant in {{village_name}}, Cinque Terre',
        meta_description_pattern: '{{restaurant_name}} in {{village_name}}. Menu, prices, reviews, and how to book. Discover authentic Ligurian cuisine.',
      },
      data_sources: ['Google Places API'],
    },
  },

  {
    name: 'Hotel Detail',
    description: 'Individual hotel/accommodation page with rooms, amenities, and booking',
    schema: {
      page_type: 'hotel_detail',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Hotel exterior or best room view' } },
        { type: 'callout', order: 1, required: true, variant: 'info', ai_hints: { purpose: 'Quick info: star rating, price range, location' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: 'Hotel description and unique features', min_words: 150 } },
        { type: 'gallery', order: 3, required: true, ai_hints: { purpose: 'Room and amenity photos' } },
        { type: 'heading', order: 4, required: true, ai_hints: { purpose: 'Rooms & Rates section' } },
        { type: 'list', order: 5, required: true, ai_hints: { purpose: 'Room types and starting prices' } },
        { type: 'heading', order: 6, required: true, ai_hints: { purpose: 'Amenities section' } },
        { type: 'list', order: 7, required: true, ai_hints: { purpose: 'Hotel amenities' } },
        { type: 'quote', order: 8, required: false, ai_hints: { purpose: 'Guest review excerpt' } },
        { type: 'callout', order: 9, required: false, variant: 'success', ai_hints: { purpose: 'Special offers or booking tip' } },
        { type: 'embed', order: 10, required: false, variant: 'maps', ai_hints: { purpose: 'Location map' } },
      ],
      global_linking_rules: {
        min_total_links: 4,
        max_total_links: 10,
        must_link_to_page_type: ['village_overview', 'hotel_listing'],
      },
      seo_template: {
        title_pattern: '{{hotel_name}} | {{village_name}} Hotel, Cinque Terre',
        meta_description_pattern: 'Stay at {{hotel_name}} in {{village_name}}. Rooms, rates, amenities, and guest reviews. Book your Cinque Terre accommodation.',
      },
      data_sources: ['Google Places API'],
    },
  },

  {
    name: 'POI Detail',
    description: 'Generic point of interest detail page (sights, attractions)',
    schema: {
      page_type: 'poi_detail',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Main attraction photo' } },
        { type: 'callout', order: 1, required: false, variant: 'info', ai_hints: { purpose: 'Quick info: hours, entry fee, location' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: 'Attraction description and significance', min_words: 150 } },
        { type: 'gallery', order: 3, required: false, ai_hints: { purpose: 'Photo gallery' } },
        { type: 'heading', order: 4, required: false, ai_hints: { purpose: 'History section' } },
        { type: 'paragraph', order: 5, required: false, ai_hints: { purpose: 'Historical background' } },
        { type: 'heading', order: 6, required: false, ai_hints: { purpose: 'Visitor Tips section' } },
        { type: 'list', order: 7, required: false, ai_hints: { purpose: 'Tips for visiting' } },
        { type: 'embed', order: 8, required: false, variant: 'maps', ai_hints: { purpose: 'Location map' } },
      ],
      global_linking_rules: {
        min_total_links: 3,
        max_total_links: 8,
        must_link_to_page_type: ['village_overview', 'poi_listing'],
      },
      seo_template: {
        title_pattern: '{{poi_name}} | {{village_name}} Attraction, Cinque Terre',
        meta_description_pattern: 'Visit {{poi_name}} in {{village_name}}. Opening hours, entrance fees, and why this is a must-see in Cinque Terre.',
      },
      data_sources: ['Google Places API', 'Wikidata'],
    },
  },

  // ============================================
  // ENHANCED TRAIL GUIDE
  // ============================================

  {
    name: 'Trail Guide',
    description: 'Detailed hiking trail guide with difficulty, elevation, and tips',
    schema: {
      page_type: 'trail_guide',
      version: '2.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Scenic trail photo' } },
        { type: 'callout', order: 1, required: true, variant: 'info', ai_hints: { purpose: 'Trail stats: distance, time, difficulty, elevation' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: 'Trail overview and highlights', min_words: 150 } },
        { type: 'callout', order: 3, required: false, variant: 'warning', ai_hints: { purpose: 'Trail status/closure notice if applicable' } },
        { type: 'heading', order: 4, required: true, ai_hints: { purpose: 'Route Description section' } },
        { type: 'paragraph', order: 5, required: true, ai_hints: { purpose: 'Detailed route description', min_words: 300 } },
        { type: 'gallery', order: 6, required: true, ai_hints: { purpose: 'Trail photos at key points' } },
        { type: 'heading', order: 7, required: true, ai_hints: { purpose: 'What to Bring section' } },
        { type: 'list', order: 8, required: true, ai_hints: { purpose: 'Packing list and gear recommendations' } },
        { type: 'callout', order: 9, required: false, variant: 'success', ai_hints: { purpose: 'Best time of day/season' } },
        { type: 'embed', order: 10, required: false, variant: 'maps', ai_hints: { purpose: 'Trail map with GPX' } },
        { type: 'faq', order: 11, required: true },
      ],
      global_linking_rules: {
        min_total_links: 5,
        max_total_links: 12,
        must_link_to_page_type: ['village_overview', 'transport_pass'],
      },
      seo_template: {
        title_pattern: '{{trail_name}} Hike | Cinque Terre Trail Guide {{year}}',
        meta_description_pattern: 'Complete guide to hiking {{trail_name}} in Cinque Terre. Distance, difficulty, what to bring, and stunning viewpoints.',
      },
      data_sources: ['OpenStreetMap', 'OpenElevation'],
    },
  },

  // ============================================
  // ENHANCED BEACH GUIDE
  // ============================================

  {
    name: 'Beach Guide',
    description: 'Beach detail page with facilities, access, and swimming info',
    schema: {
      page_type: 'beach_guide',
      version: '2.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Beach photo' } },
        { type: 'callout', order: 1, required: true, variant: 'info', ai_hints: { purpose: 'Quick info: beach type, facilities, access' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: 'Beach description and character', min_words: 150 } },
        { type: 'gallery', order: 3, required: true, ai_hints: { purpose: 'Beach photos from different angles' } },
        { type: 'heading', order: 4, required: true, ai_hints: { purpose: 'Facilities section' } },
        { type: 'list', order: 5, required: true, ai_hints: { purpose: 'Available facilities and rentals' } },
        { type: 'heading', order: 6, required: true, ai_hints: { purpose: 'How to Get There section' } },
        { type: 'paragraph', order: 7, required: true, ai_hints: { purpose: 'Access instructions' } },
        { type: 'callout', order: 8, required: false, variant: 'warning', ai_hints: { purpose: 'Safety or crowd warnings' } },
        { type: 'embed', order: 9, required: false, variant: 'maps', ai_hints: { purpose: 'Beach location map' } },
      ],
      global_linking_rules: {
        min_total_links: 3,
        max_total_links: 8,
        must_link_to_page_type: ['village_overview', 'beach_listing'],
      },
      seo_template: {
        title_pattern: '{{beach_name}} Beach | {{village_name}}, Cinque Terre',
        meta_description_pattern: 'Everything about {{beach_name}} in {{village_name}}. Facilities, how to get there, and what makes this beach special.',
      },
    },
  },

  // ============================================
  // NEW BLUEPRINTS - BOAT TOURS
  // ============================================

  {
    name: 'Boat Tour Detail',
    description: 'Boat tour or excursion page with itinerary and booking',
    schema: {
      page_type: 'boat_tour',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Tour boat or coastal view' } },
        { type: 'callout', order: 1, required: true, variant: 'info', ai_hints: { purpose: 'Quick info: duration, price, departure point' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: 'Tour description and highlights', min_words: 150 } },
        { type: 'heading', order: 3, required: true, ai_hints: { purpose: 'Itinerary section' } },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'Tour stops and timeline' } },
        { type: 'gallery', order: 5, required: false, ai_hints: { purpose: 'Photos from the tour' } },
        { type: 'heading', order: 6, required: true, ai_hints: { purpose: 'What\'s Included section' } },
        { type: 'list', order: 7, required: true, ai_hints: { purpose: 'Included services and amenities' } },
        { type: 'callout', order: 8, required: false, variant: 'success', ai_hints: { purpose: 'Booking tip or best time' } },
        { type: 'faq', order: 9, required: true },
      ],
      global_linking_rules: {
        min_total_links: 3,
        max_total_links: 8,
        must_link_to_page_type: ['village_overview', 'boat_tour_listing'],
      },
      seo_template: {
        title_pattern: '{{tour_name}} | Cinque Terre Boat Tour',
        meta_description_pattern: 'Book {{tour_name}} in Cinque Terre. See the coastline from the water, visit hidden coves, and experience the villages by sea.',
      },
    },
  },

  // ============================================
  // NEW BLUEPRINTS - ACCOMMODATIONS
  // ============================================

  {
    name: 'Accommodation Listing',
    description: 'Category listing page for apartments, agriturismi, or camping',
    schema: {
      page_type: 'accommodation_listing',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Accommodation category header' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Overview of accommodation type', min_words: 100 } },
        { type: 'callout', order: 2, required: false, variant: 'info', ai_hints: { purpose: 'Booking tips for this category' } },
        { type: 'heading', order: 3, required: true, ai_hints: { purpose: 'Featured Options section' } },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'List of accommodations with links' } },
        { type: 'heading', order: 5, required: false, ai_hints: { purpose: 'By Village section' } },
        { type: 'list', order: 6, required: false, ai_hints: { purpose: 'Accommodations grouped by village' } },
        { type: 'faq', order: 7, required: true },
      ],
      global_linking_rules: {
        min_total_links: 10,
        max_total_links: 30,
        must_link_to_page_type: ['hotel_detail', 'village_overview'],
      },
      seo_template: {
        title_pattern: '{{accommodation_type}} in Cinque Terre | Best Options {{year}}',
        meta_description_pattern: 'Find the best {{accommodation_type}} in Cinque Terre. Compare options, prices, and locations across all five villages.',
      },
      data_sources: ['Google Places API'],
    },
  },

  // ============================================
  // ENHANCED EVENTS CALENDAR
  // ============================================

  {
    name: 'Events Calendar',
    description: 'Events and festivals calendar with upcoming activities',
    schema: {
      page_type: 'events_calendar',
      version: '2.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Events/festival header' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Overview of events in Cinque Terre', min_words: 100 } },
        { type: 'callout', order: 2, required: false, variant: 'success', ai_hints: { purpose: 'Highlight upcoming major event' } },
        { type: 'heading', order: 3, required: true, ai_hints: { purpose: 'Upcoming Events section' } },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'List of upcoming events with dates' } },
        { type: 'heading', order: 5, required: false, ai_hints: { purpose: 'Annual Festivals section' } },
        { type: 'paragraph', order: 6, required: false, ai_hints: { purpose: 'Major annual festivals overview' } },
        { type: 'gallery', order: 7, required: false, ai_hints: { purpose: 'Festival photos' } },
        { type: 'faq', order: 8, required: true },
      ],
      global_linking_rules: {
        min_total_links: 5,
        max_total_links: 15,
        must_link_to_page_type: ['event_detail', 'village_overview'],
      },
      seo_template: {
        title_pattern: 'Cinque Terre Events & Festivals {{year}} | What\'s On',
        meta_description_pattern: 'Discover events and festivals in Cinque Terre. From local sagras to religious celebrations, plan around these special occasions.',
      },
      data_sources: ['Eventbrite API'],
    },
  },

  {
    name: 'Event Detail',
    description: 'Individual event page with details and practical info',
    schema: {
      page_type: 'event_detail',
      version: '1.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Event photo or poster' } },
        { type: 'callout', order: 1, required: true, variant: 'info', ai_hints: { purpose: 'Quick info: date, time, location, price' } },
        { type: 'paragraph', order: 2, required: true, ai_hints: { purpose: 'Event description', min_words: 150 } },
        { type: 'heading', order: 3, required: false, ai_hints: { purpose: 'Program section' } },
        { type: 'list', order: 4, required: false, ai_hints: { purpose: 'Event schedule/program' } },
        { type: 'gallery', order: 5, required: false, ai_hints: { purpose: 'Photos from past events' } },
        { type: 'heading', order: 6, required: false, ai_hints: { purpose: 'Getting There section' } },
        { type: 'paragraph', order: 7, required: false, ai_hints: { purpose: 'Transport and access info' } },
        { type: 'embed', order: 8, required: false, variant: 'maps', ai_hints: { purpose: 'Event location map' } },
      ],
      global_linking_rules: {
        min_total_links: 3,
        max_total_links: 8,
        must_link_to_page_type: ['events_calendar', 'village_overview'],
      },
      seo_template: {
        title_pattern: '{{event_name}} | Cinque Terre Event',
        meta_description_pattern: '{{event_name}} in Cinque Terre. Date, location, program, and how to attend this special event.',
      },
      data_sources: ['Eventbrite API'],
    },
  },

  // ============================================
  // ENHANCED FAQ PAGE
  // ============================================

  {
    name: 'FAQ Page',
    description: 'Comprehensive FAQ page with categorized questions',
    schema: {
      page_type: 'faq_page',
      version: '2.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'FAQ page header' } },
        { type: 'paragraph', order: 1, required: false, ai_hints: { purpose: 'Brief intro to FAQ page' } },
        { type: 'heading', order: 2, required: true, ai_hints: { purpose: 'Category 1 header (e.g., Getting There)' } },
        { type: 'faq', order: 3, required: true, ai_hints: { purpose: 'Category 1 FAQs' } },
        { type: 'heading', order: 4, required: true, ai_hints: { purpose: 'Category 2 header (e.g., Accommodation)' } },
        { type: 'faq', order: 5, required: true, ai_hints: { purpose: 'Category 2 FAQs' } },
        { type: 'heading', order: 6, required: false, ai_hints: { purpose: 'Category 3 header' } },
        { type: 'faq', order: 7, required: false, ai_hints: { purpose: 'Category 3 FAQs' } },
        { type: 'callout', order: 8, required: false, variant: 'info', ai_hints: { purpose: 'Still have questions? Contact info' } },
      ],
      global_linking_rules: {
        min_total_links: 10,
        max_total_links: 25,
        must_link_to_page_type: ['transport_hub', 'village_overview', 'itinerary'],
      },
      seo_template: {
        title_pattern: 'Cinque Terre FAQ | Your Questions Answered',
        meta_description_pattern: 'Answers to the most common questions about visiting Cinque Terre. Transport, accommodation, hiking, beaches, and more.',
      },
    },
  },

  // ============================================
  // ENHANCED BLOG POST
  // ============================================

  {
    name: 'Blog Post',
    description: 'Blog article with rich content and engagement features',
    schema: {
      page_type: 'blog_post',
      version: '2.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Blog post featured image' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Article introduction', tone: 'engaging, personal', min_words: 100 } },
        { type: 'heading', order: 2, required: true },
        { type: 'paragraph', order: 3, required: true, ai_hints: { purpose: 'Main content section 1', min_words: 200 } },
        { type: 'image', order: 4, required: false, ai_hints: { purpose: 'Supporting image' } },
        { type: 'heading', order: 5, required: false },
        { type: 'paragraph', order: 6, required: false, ai_hints: { purpose: 'Main content section 2', min_words: 200 } },
        { type: 'quote', order: 7, required: false, ai_hints: { purpose: 'Pull quote or local insight' } },
        { type: 'gallery', order: 8, required: false, ai_hints: { purpose: 'Photo gallery for the post' } },
        { type: 'callout', order: 9, required: false, variant: 'success', ai_hints: { purpose: 'Key takeaway or tip' } },
        { type: 'paragraph', order: 10, required: false, ai_hints: { purpose: 'Conclusion', min_words: 50 } },
      ],
      global_linking_rules: {
        min_total_links: 5,
        max_total_links: 15,
        must_link_to_page_type: ['village_overview', 'trail_guide', 'restaurant_detail'],
      },
      seo_template: {
        title_pattern: '{{title}} | Cinque Terre Travel Blog',
        meta_description_pattern: '{{excerpt}}',
      },
      data_sources: ['Pexels', 'Unsplash'],
    },
  },

  // ============================================
  // POI LISTING PAGES
  // ============================================

  {
    name: 'POI Listing',
    description: 'Listing page for restaurants, hotels, sights, etc.',
    schema: {
      page_type: 'poi_listing',
      version: '2.0',
      components: [
        { type: 'hero', order: 0, required: true, ai_hints: { purpose: 'Category header' } },
        { type: 'paragraph', order: 1, required: true, ai_hints: { purpose: 'Category overview', min_words: 100 } },
        { type: 'callout', order: 2, required: false, variant: 'info', ai_hints: { purpose: 'Tips for choosing' } },
        { type: 'heading', order: 3, required: true, ai_hints: { purpose: 'Top Picks section' } },
        { type: 'list', order: 4, required: true, ai_hints: { purpose: 'Featured items with links' } },
        { type: 'heading', order: 5, required: false, ai_hints: { purpose: 'All Options section' } },
        { type: 'list', order: 6, required: false, ai_hints: { purpose: 'Complete listing' } },
        { type: 'embed', order: 7, required: false, variant: 'maps', ai_hints: { purpose: 'Map of all locations' } },
        { type: 'faq', order: 8, required: false },
      ],
      global_linking_rules: {
        min_total_links: 10,
        max_total_links: 40,
        must_link_to_page_type: ['poi_detail', 'restaurant_detail', 'hotel_detail'],
      },
      seo_template: {
        title_pattern: 'Best {{category}} in {{location}} | Cinque Terre {{year}}',
        meta_description_pattern: 'Discover the best {{category}} in {{location}}, Cinque Terre. Reviews, prices, and local recommendations.',
      },
      data_sources: ['Google Places API'],
    },
  },
]

async function seedBlueprints() {
  console.log('🌱 Seeding Cinque Terre blueprints...')

  try {
    // First, delete existing blueprints for this website
    console.log('Removing existing blueprints...')
    await db.query('DELETE FROM content_blueprints WHERE website_id = $1', [WEBSITE_ID])

    // Insert new blueprints
    for (const blueprint of blueprints) {
      console.log(`  Creating: ${blueprint.name}`)
      await db.query(
        `INSERT INTO content_blueprints (website_id, name, description, schema)
         VALUES ($1, $2, $3, $4)`,
        [WEBSITE_ID, blueprint.name, blueprint.description, JSON.stringify(blueprint.schema)]
      )
    }

    console.log(`\n✅ Successfully created ${blueprints.length} blueprints`)

    // List created blueprints
    const result = await db.query(
      'SELECT name, description FROM content_blueprints WHERE website_id = $1 ORDER BY name',
      [WEBSITE_ID]
    )
    console.log('\nCreated blueprints:')
    result.rows.forEach((row: any, i: number) => {
      console.log(`  ${i + 1}. ${row.name}`)
    })

  } catch (error) {
    console.error('❌ Error seeding blueprints:', error)
    throw error
  } finally {
    await db.end()
  }
}

seedBlueprints()
