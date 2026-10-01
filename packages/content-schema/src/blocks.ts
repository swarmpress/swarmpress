import { z } from 'zod'

/**
 * JSON Block Model — Canonical content format for swarm.press
 * See: /domain/content-model/JSON_BLOCK_MODEL.md
 *
 * NOTE: Marketing/E-commerce/Application-UI block schemas (pricing-section,
 * testimonial-section, blog-section, team-section, newsletter-section,
 * contact-section, logo-cloud-section, bento-grid-section, banner,
 * footer-section, header-section, error-page, product-list, product-overview,
 * shopping-cart, promo-section, card, data-table, form-layout, modal, alert)
 * were pruned per audit item 8 — none of them had renderers and none were
 * referenced by the cinque-terre reference theme. Restore here if a future
 * theme needs them and add the matching renderer case to the theme's
 * ContentRenderer.astro at the same time.
 */

// ============================================================================
// Base Types
// ============================================================================

const ImageObjectSchema = z.object({
  src: z.string().url(),
  alt: z.string(),
  caption: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

const FAQItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
})

// ============================================================================
// Core Block Schemas
// ============================================================================

export const ParagraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  markdown: z.string().min(1),
})

export const HeadingBlockSchema = z.object({
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  text: z.string().min(1),
  id: z.string().optional(),
})

export const HeroBlockSchema = z.object({
  type: z.literal('hero'),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  backgroundImage: z.string().url().optional(),
})

export const ImageBlockSchema = z.object({
  type: z.literal('image'),
  src: z.string().min(1), // URL or S3 path
  alt: z.string().min(1),
  caption: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const GalleryBlockSchema = z.object({
  type: z.literal('gallery'),
  layout: z.enum(['grid', 'carousel', 'masonry']),
  images: z.array(ImageObjectSchema).min(1),
})

export const QuoteBlockSchema = z.object({
  type: z.literal('quote'),
  text: z.string().min(1),
  attribution: z.string().optional(),
})

export const ListBlockSchema = z.object({
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(z.string().min(1)).min(1),
})

export const FAQBlockSchema = z.object({
  type: z.literal('faq'),
  items: z.array(FAQItemSchema).min(1),
})

export const CalloutBlockSchema = z.object({
  type: z.literal('callout'),
  style: z.enum(['info', 'warning', 'success', 'error']),
  title: z.string().optional(),
  content: z.string().min(1),
})

export const EmbedBlockSchema = z.object({
  type: z.literal('embed'),
  provider: z.enum(['youtube', 'vimeo', 'maps', 'custom']),
  url: z.string().url(),
  title: z.string().optional(),
})

const CollectionEmbedItemSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  image: z.string().optional(),
  date: z.string().optional(),
  url: z.string().optional(),
  data: z.record(z.unknown()),
})

const CollectionEmbedDisplaySchema = z.object({
  layout: z.enum(['grid', 'list', 'carousel', 'compact']),
  columns: z.number().int().min(1).max(6).optional(),
  showImage: z.boolean().optional(),
  showSummary: z.boolean().optional(),
  showDate: z.boolean().optional(),
  imageAspect: z.enum(['square', 'video', 'portrait', 'landscape']).optional(),
})

export const CollectionEmbedBlockSchema = z.object({
  type: z.literal('collection-embed'),
  collectionType: z.string(),
  displayName: z.string().optional(),
  singularName: z.string().optional(),
  items: z.array(CollectionEmbedItemSchema),
  display: CollectionEmbedDisplaySchema,
  heading: z.string().optional(),
  headingLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).optional(),
  showViewAll: z.boolean().optional(),
  viewAllUrl: z.string().optional(),
})

// ============================================================================
// Theme-Adjacent Section Block Schemas (used by cinque-terre theme)
// Marketing/section blocks pared down to only those with active renderers.
// ============================================================================

const ButtonSchema = z.object({
  text: z.string(),
  url: z.string(),
  variant: z.enum(['primary', 'secondary', 'outline', 'ghost']).default('primary'),
  external: z.boolean().optional(),
})

const FeatureItemSchema = z.object({
  icon: z.string().optional(),
  title: z.string(),
  description: z.string(),
})

const TestimonialItemSchema = z.object({
  quote: z.string(),
  author: z.string(),
  role: z.string().optional(),
  company: z.string().optional(),
  image: z.string().optional(),
  rating: z.number().min(1).max(5).optional(),
})

const StatItemSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

const HeroSectionVariantSchema = z.enum([
  'simple-centered',
  'simple-centered-with-background',
  'split-with-image',
  'with-app-screenshot',
  'with-phone-mockup',
  'with-image-tiles',
  'with-offset-image',
  'with-angled-image',
])

export const HeroSectionBlockSchema = z.object({
  type: z.literal('hero-section'),
  variant: HeroSectionVariantSchema.default('simple-centered'),
  title: z.string(),
  subtitle: z.string().optional(),
  eyebrow: z.string().optional(),
  eyebrowUrl: z.string().optional(),
  buttons: z.array(ButtonSchema).optional(),
  backgroundImage: z.string().optional(),
  screenshot: z.string().optional(),
  screenshotDark: z.string().optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  showGradient: z.boolean().default(true),
  alignment: z.enum(['left', 'center', 'right']).default('center'),
})

const FeatureSectionVariantSchema = z.enum([
  'simple',
  'simple-3x2-grid',
  'centered-2x2-grid',
  'offset-2x2-grid',
  'offset-with-feature-list',
  'three-column-with-large-icons',
  'three-column-with-small-icons',
  'with-product-screenshot',
  'with-product-screenshot-on-left',
  'with-product-screenshot-panel',
  'with-large-screenshot',
  'with-large-bordered-screenshot',
  'with-code-example-panel',
  'contained-in-panel',
  'with-testimonial',
])

export const FeatureSectionBlockSchema = z.object({
  type: z.literal('feature-section'),
  variant: FeatureSectionVariantSchema.default('simple-3x2-grid'),
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  features: z.array(FeatureItemSchema),
  screenshot: z.string().optional(),
  screenshotDark: z.string().optional(),
  columns: z.number().min(2).max(4).optional(),
})

const CtaSectionVariantSchema = z.enum([
  'simple-centered',
  'simple-stacked',
  'simple-justified',
  'centered-on-dark-panel',
  'simple-centered-on-brand',
  'simple-centered-with-gradient',
  'simple-justified-on-subtle-brand',
  'split-with-image',
  'dark-panel-with-app-screenshot',
  'two-columns-with-photo',
  'with-image-tiles',
])

export const CtaSectionBlockSchema = z.object({
  type: z.literal('cta-section'),
  variant: CtaSectionVariantSchema.default('simple-centered'),
  title: z.string(),
  subtitle: z.string().optional(),
  buttons: z.array(ButtonSchema).optional(),
  backgroundImage: z.string().optional(),
  image: z.string().optional(),
  inputPlaceholder: z.string().optional(),
  inputButtonText: z.string().optional(),
})

const StatsSectionVariantSchema = z.enum([
  'simple',
  'simple-grid',
  'with-description',
  'split-with-image',
  'stepped',
  'timeline',
  'with-background-image',
  'with-two-column-description',
])

export const StatsSectionBlockSchema = z.object({
  type: z.literal('stats-section'),
  variant: StatsSectionVariantSchema.default('simple-grid'),
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  stats: z.array(StatItemSchema),
  image: z.string().optional(),
})

const FaqSectionVariantSchema = z.enum([
  'centered-accordion',
  'offset-with-supporting-text',
  'side-by-side',
  'three-columns-with-centered-intro',
  'three-columns',
  'two-columns-with-centered-intro',
  'two-columns',
])

export const FaqSectionBlockSchema = z.object({
  type: z.literal('faq-section'),
  variant: FaqSectionVariantSchema.default('centered-accordion'),
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  items: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })),
  supportingText: z.string().optional(),
  contactEmail: z.string().optional(),
})

const ContentSectionVariantSchema = z.enum([
  'centered',
  'split-with-image',
  'two-columns-with-screenshot',
  'with-image-tiles',
  'with-sticky-product-screenshot',
  'with-testimonial-and-stats',
  'with-testimonial',
])

export const ContentSectionBlockSchema = z.object({
  type: z.literal('content-section'),
  variant: ContentSectionVariantSchema.default('centered'),
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  content: z.string(), // Markdown content
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  testimonial: TestimonialItemSchema.optional(),
})

// Newsletter block — wired in cinque-terre theme renderer
export const NewsletterBlockSchema = z.object({
  type: z.literal('newsletter'),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  inputPlaceholder: z.string().optional(),
  buttonText: z.string().optional(),
  disclaimer: z.string().optional(),
  benefits: z.array(z.string()).optional(),
})

// Section header — small label/divider used between sections
export const SectionHeaderBlockSchema = z.object({
  type: z.literal('section-header'),
  label: z.string().min(1),
})

// ============================================================================
// Cinque Terre Theme Block Schemas
// ============================================================================

const StoryItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  category: z.string(),
  dek: z.string().optional(),
  excerpt: z.string().optional(),
  image: z.string(),
  author: z.string().optional(),
  date: z.string().optional(),
  readTime: z.string().optional(),
  url: z.string().optional(),
  isLead: z.boolean().optional(),
})

const VillageItemSchema = z.object({
  name: z.string(),
  slug: z.string().optional(),
  description: z.string(),
  image: z.string(),
  tags: z.array(z.string()).optional(),
})

const StayItemSchema = z.object({
  name: z.string(),
  village: z.string(),
  special: z.string(),
  price: z.string(),
  image: z.string(),
  url: z.string().optional(),
})

const VillageEssentialsSchema = z.object({
  weather: z.string().optional(),
  seaTemp: z.string().optional(),
  seaConditions: z.string().optional(),
  sunset: z.string().optional(),
  crowdRhythm: z.string().optional(),
  bestFelt: z.string().optional(),
  villageShape: z.string().optional(),
  foodWine: z.string().optional(),
  origins: z.string().optional(),
  shapedBy: z.string().optional(),
  rating: z.string().optional(),
  rememberedFor: z.string().optional(),
})

const PlaceItemSchema = z.object({
  name: z.string(),
  type: z.string(),
  village: z.string(),
  blurb: z.string(),
  image: z.string(),
  url: z.string().optional(),
})

const EscapeItemSchema = z.object({
  name: z.string(),
  image: z.string(),
  url: z.string().optional(),
})

const HighlightItemSchema = z.object({
  name: z.string(),
  icon: z.string().optional(),
  desc: z.string(),
  url: z.string().optional(),
})

const AudioGuideItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  duration: z.string(),
  image: z.string(),
  url: z.string().optional(),
})

const AdviceItemSchema = z.object({
  name: z.string(),
  icon: z.string().optional(),
  desc: z.string(),
  url: z.string().optional(),
})

const EditorInfoSchema = z.object({
  name: z.string(),
  role: z.string(),
  avatar: z.string().optional(),
})

// Village Selector Block - Grid of clickable village cards with hover effects
export const VillageSelectorBlockSchema = z.object({
  type: z.literal('village-selector'),
  title: z.string().default('The Five Villages'),
  subtitle: z.string().optional(),
  villages: z.array(VillageItemSchema),
})

// Places to Stay Block - Accommodation cards with pricing badges
export const PlacesToStayBlockSchema = z.object({
  type: z.literal('places-to-stay'),
  title: z.string().default('Places to Stay Spotlight'),
  eyebrow: z.string().default('Where to Sleep'),
  stays: z.array(StayItemSchema),
  viewAllUrl: z.string().optional(),
})

// Featured Carousel Block - Horizontal carousel of story cards
export const FeaturedCarouselBlockSchema = z.object({
  type: z.literal('featured-carousel'),
  title: z.string().default("Editors' Picks"),
  viewAllUrl: z.string().optional(),
  stories: z.array(StoryItemSchema),
})

// Village Intro Block - Rich editorial intro with lead story and essentials
export const VillageIntroBlockSchema = z.object({
  type: z.literal('village-intro'),
  village: z.string(),
  leadStory: StoryItemSchema.optional(),
  essentials: VillageEssentialsSchema.optional(),
  stories: z.array(StoryItemSchema).optional(),
})

// Trending Now Block - Featured story layout with lead and secondary stories
export const TrendingNowBlockSchema = z.object({
  type: z.literal('trending-now'),
  title: z.string().default('Trending Now'),
  stories: z.array(StoryItemSchema),
})

// About Block - About section with image and editor info
export const AboutBlockSchema = z.object({
  type: z.literal('about'),
  title: z.string().default('We help you discover the real Cinque Terre.'),
  eyebrow: z.string().default('About Us'),
  description: z.array(z.string()),
  image: z.string().optional(),
  editor: EditorInfoSchema.optional(),
})

// Curated Escapes Block - Grid of themed travel collection cards
export const CuratedEscapesBlockSchema = z.object({
  type: z.literal('curated-escapes'),
  title: z.string().default('Curated Escapes'),
  eyebrow: z.string().default('Collections'),
  escapes: z.array(EscapeItemSchema),
})

// Latest Stories Block - Blog-style grid with lead story and filters
export const LatestStoriesBlockSchema = z.object({
  type: z.literal('latest-stories'),
  title: z.string().default('Latest Stories'),
  stories: z.array(StoryItemSchema),
  filters: z.array(z.string()).optional(),
  showFilters: z.boolean().default(true),
})

// Eat Drink Block - Restaurant/place cards with type badges
export const EatDrinkBlockSchema = z.object({
  type: z.literal('eat-drink'),
  title: z.string().default("Editors' Picks"),
  eyebrow: z.string().default('Food & Drink'),
  places: z.array(PlaceItemSchema),
  viewAllUrl: z.string().optional(),
})

// Highlights Block - Icon grid of experiences/activities
export const HighlightsBlockSchema = z.object({
  type: z.literal('highlights'),
  title: z.string().default('Cinque Terre Highlights'),
  eyebrow: z.string().default('Experiences'),
  highlights: z.array(HighlightItemSchema),
})

// Audio Guides Block - Audio/podcast cards with play buttons
export const AudioGuidesBlockSchema = z.object({
  type: z.literal('audio-guides'),
  title: z.string().default('Listen: Cinque Terre Stories'),
  viewAllUrl: z.string().optional(),
  guides: z.array(AudioGuideItemSchema),
})

// Practical Advice Block - Compact icon-based advice strip
export const PracticalAdviceBlockSchema = z.object({
  type: z.literal('practical-advice'),
  advice: z.array(AdviceItemSchema),
})

// ============================================================================
// Editorial Block Schemas (Cinque Terre Theme)
// ============================================================================

// Editorial Hero - Large hero with badge, title, subtitle, and background image
export const EditorialHeroBlockSchema = z.object({
  type: z.literal('editorial-hero'),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  badge: z.string().optional(),
  image: z.string().min(1),
  height: z.string().default('70vh'),
})

// Editorial Intro - Centered intro with badge, quote, and two-column content
export const EditorialIntroBlockSchema = z.object({
  type: z.literal('editorial-intro'),
  badge: z.string().min(1),
  quote: z.string().min(1),
  leftContent: z.string().min(1), // HTML/markdown content for left column
  rightContent: z.string().min(1), // HTML/markdown content for right column
})

// Editorial Interlude - Highlighted break between content sections
export const EditorialInterludeBlockSchema = z.object({
  type: z.literal('editorial-interlude'),
  badge: z.string().default('Editorial Interlude'),
  title: z.string().min(1),
  quote: z.string().min(1),
  interludeType: z.enum(['primary', 'secondary']).default('primary'),
  align: z.enum(['left', 'right']).default('left'),
  icon: z.string().optional(), // Lucide icon name
})

// Editor Note - Expert quote with avatar (Giulia Rossi "Local Perspective")
export const EditorNoteBlockSchema = z.object({
  type: z.literal('editor-note'),
  quote: z.string().min(1),
  author: z.string().default('Giulia Rossi'),
  role: z.string().default('Riomaggiore Expert'),
  image: z.string().default('/giulia_rossi.png'),
})

// Closing Note - Dark reflective closing section
export const ClosingNoteBlockSchema = z.object({
  type: z.literal('closing-note'),
  badge: z.string().default('A Final Reflection'),
  title: z.string().min(1),
  content: z.string().min(1), // HTML/markdown content
  actions: z.array(z.object({
    label: z.string(),
    href: z.string(),
    variant: z.enum(['primary', 'secondary']).default('primary'),
  })).optional(),
  backgroundIcon: z.string().optional(), // Lucide icon name for background
})

// ============================================================================
// Template Page Block Schemas (Cinque Terre Theme)
// ============================================================================

const ItineraryDaySchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  village: z.string(),
  rhythm: z.string().optional(),
  perspective: z.string(),
  movement: z.string().optional(),
  moments: z.array(z.string()),
  image: z.string().optional(),
})

export const ItineraryHeroBlockSchema = z.object({
  type: z.literal('itinerary-hero'),
  name: z.string(),
  subtitle: z.string().optional(),
  duration: z.string(),
  pace: z.string(),
  effort: z.string(),
  bestSeason: z.string(),
  image: z.string(),
  badge: z.string().default('Signature Itinerary'),
})

export const ItineraryDaysBlockSchema = z.object({
  type: z.literal('itinerary-days'),
  days: z.array(ItineraryDaySchema),
  showOverview: z.boolean().default(true),
})

const EditorProfileSchema = z.object({
  name: z.string(),
  role: z.string(),
  bio: z.string(),
  image: z.string(),
  persona: z.string().optional(),
  love: z.string().optional(),
  hobbies: z.array(z.string()).optional(),
  accent: z.string().optional(),
})

export const TeamGridBlockSchema = z.object({
  type: z.literal('team-grid'),
  editors: z.array(EditorProfileSchema),
})

const AirportSchema = z.object({
  name: z.string(),
  code: z.string().optional(),
  distance: z.string(),
  time: z.string(),
})

export const AirportsOverviewBlockSchema = z.object({
  type: z.literal('airports-overview'),
  title: z.string().default('Geographical Orientation'),
  subtitle: z.string().optional(),
  airports: z.array(AirportSchema),
})

const CurrentWeatherSchema = z.object({
  temp: z.number(),
  condition: z.string(),
  icon: z.enum(['sun', 'cloud', 'rain']),
  high: z.number().optional(),
  low: z.number().optional(),
  wind: z.string().optional(),
  humidity: z.string().optional(),
  seaTemp: z.string().optional(),
  uvIndex: z.string().optional(),
  visibility: z.string().optional(),
  sunrise: z.string().optional(),
  sunset: z.string().optional(),
})

const ForecastDaySchema = z.object({
  day: z.string(),
  date: z.string(),
  high: z.number(),
  low: z.number(),
  condition: z.string(),
  icon: z.enum(['sun', 'cloud', 'rain']),
})

const WebcamSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  status: z.string().optional(),
})

export const WeatherLiveBlockSchema = z.object({
  type: z.literal('weather-live'),
  current: CurrentWeatherSchema,
  forecast: z.array(ForecastDaySchema),
  webcams: z.array(WebcamSchema).optional(),
  heroImage: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
})

export const WeatherJournalBlockSchema = z.object({
  type: z.literal('weather-journal'),
  condition: z.string(),
  note: z.string(),
  recommendations: z.array(z.string()).optional(),
  quote: z.string().optional(),
  author: z.string().default('Giulia Rossi'),
  role: z.string().default('Local Expert'),
  image: z.string().optional(),
})

const BlogContentBlockSchema = z.object({
  type: z.enum(['paragraph', 'heading', 'image', 'quote', 'list']),
  text: z.string().optional(),
  level: z.number().optional(),
  src: z.string().optional(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  items: z.array(z.string()).optional(),
  ordered: z.boolean().optional(),
})

const RelatedPostSchema = z.object({
  title: z.string(),
  url: z.string(),
  image: z.string().optional(),
})

const BlogSidebarSchema = z.object({
  keyTakeaways: z.array(z.string()).optional(),
  relatedPosts: z.array(RelatedPostSchema).optional(),
})

export const BlogArticleBlockSchema = z.object({
  type: z.literal('blog-article'),
  title: z.string(),
  author: z.string().optional(),
  authorImage: z.string().optional(),
  date: z.string().optional(),
  readTime: z.string().optional(),
  category: z.string().optional(),
  heroImage: z.string().optional(),
  content: z.array(BlogContentBlockSchema),
  sidebar: BlogSidebarSchema.optional(),
})

const CollectionItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  category: z.string().optional(),
  village: z.string().optional(),
  image: z.string(),
  intro: z.string().optional(),
  description: z.string().optional(),
  giuliaComment: z.string().optional(),
  signature: z.string().optional(),
  priceRange: z.string().optional(),
  practicalInfo: z.string().optional(),
  googleRating: z.number().optional(),
  tripadvisorRating: z.number().optional(),
})

const CollectionInterludeSchema = z.object({
  afterIndex: z.number().int().min(0),
  type: z.enum(['primary', 'secondary']).optional(),
  badge: z.string().optional(),
  title: z.string(),
  quote: z.string(),
  icon: z.string().optional(),
  align: z.enum(['left', 'right']).optional(),
})

export const CollectionWithInterludesBlockSchema = z.object({
  type: z.literal('collection-with-interludes'),
  collectionType: z.string().optional(),
  village: z.string().optional(),
  slugs: z.array(z.string()).optional(),
  items: z.array(CollectionItemSchema).optional(),
  itemType: z.enum(['accommodation', 'restaurant', 'attraction', 'generic', 'sight', 'experience']).optional(),
  interludes: z.array(CollectionInterludeSchema).optional(),
})

const BlogStorySchema = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  author: z.string(),
  date: z.string(),
  readTime: z.string(),
  category: z.string(),
  image: z.string(),
  isLead: z.boolean().optional(),
})

export const BlogIndexBlockSchema = z.object({
  type: z.literal('blog-index'),
  stories: z.array(BlogStorySchema),
  categories: z.array(z.string()).optional(),
  introTitle: z.string().optional(),
  introSubtitle: z.string().optional(),
  newsletterTitle: z.string().optional(),
  newsletterSubtitle: z.string().optional(),
})

// ============================================================================
// Map Block Schema (Interactive Maps with Leaflet)
// ============================================================================

const MapMarkerSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  title: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  url: z.string().optional(),
  category: z.string().optional(),
})

const TrailWaypointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  name: z.string().optional(),
  elevation: z.number().optional(),
})

export const MapBlockSchema = z.object({
  type: z.literal('map'),
  variant: z.enum([
    'single-location',
    'multi-marker',
    'village-overview',
    'hiking-trail',
    'category-filtered',
  ]).default('multi-marker'),
  center: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  zoom: z.number().min(1).max(22).default(14),
  minZoom: z.number().min(1).max(22).default(10),
  maxZoom: z.number().min(1).max(22).default(18),
  height: z.string().default('400px'),
  collectionTypes: z.array(z.string()).optional(),
  collectionFilter: z.object({
    village: z.string().optional(),
    category: z.string().optional(),
  }).optional(),
  lang: z.string().optional(),
  markers: z.array(MapMarkerSchema).optional(),
  trail: z.object({
    waypoints: z.array(TrailWaypointSchema),
    color: z.string().default('#3b82f6'),
    weight: z.number().default(4),
  }).optional(),
  showControls: z.boolean().default(true),
  showClustering: z.boolean().default(true),
  showFilters: z.boolean().default(false),
  filterCategories: z.array(z.string()).optional(),
  heading: z.string().optional(),
  headingLevel: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
})

// ============================================================================
// Union of All Blocks
// ============================================================================

export const ContentBlockSchema = z.discriminatedUnion('type', [
  // Core content blocks
  ParagraphBlockSchema,
  HeadingBlockSchema,
  HeroBlockSchema,
  ImageBlockSchema,
  GalleryBlockSchema,
  QuoteBlockSchema,
  ListBlockSchema,
  FAQBlockSchema,
  CalloutBlockSchema,
  EmbedBlockSchema,
  CollectionEmbedBlockSchema,
  MapBlockSchema,
  // Section blocks (theme-adjacent, all wired in renderers)
  HeroSectionBlockSchema,
  FeatureSectionBlockSchema,
  StatsSectionBlockSchema,
  CtaSectionBlockSchema,
  FaqSectionBlockSchema,
  ContentSectionBlockSchema,
  NewsletterBlockSchema,
  SectionHeaderBlockSchema,
  // Cinque Terre Theme blocks
  VillageSelectorBlockSchema,
  PlacesToStayBlockSchema,
  FeaturedCarouselBlockSchema,
  VillageIntroBlockSchema,
  TrendingNowBlockSchema,
  AboutBlockSchema,
  CuratedEscapesBlockSchema,
  LatestStoriesBlockSchema,
  EatDrinkBlockSchema,
  HighlightsBlockSchema,
  AudioGuidesBlockSchema,
  PracticalAdviceBlockSchema,
  // Editorial blocks (Cinque Terre Theme)
  EditorialHeroBlockSchema,
  EditorialIntroBlockSchema,
  EditorialInterludeBlockSchema,
  EditorNoteBlockSchema,
  ClosingNoteBlockSchema,
  // Template page blocks (Cinque Terre Theme)
  ItineraryHeroBlockSchema,
  ItineraryDaysBlockSchema,
  TeamGridBlockSchema,
  AirportsOverviewBlockSchema,
  WeatherLiveBlockSchema,
  WeatherJournalBlockSchema,
  BlogArticleBlockSchema,
  CollectionWithInterludesBlockSchema,
  BlogIndexBlockSchema,
])

export const ContentBlocksSchema = z.array(ContentBlockSchema)

// ============================================================================
// TypeScript Types
// ============================================================================

// Core block types
export type ParagraphBlock = z.infer<typeof ParagraphBlockSchema>
export type HeadingBlock = z.infer<typeof HeadingBlockSchema>
export type HeroBlock = z.infer<typeof HeroBlockSchema>
export type ImageBlock = z.infer<typeof ImageBlockSchema>
export type GalleryBlock = z.infer<typeof GalleryBlockSchema>
export type QuoteBlock = z.infer<typeof QuoteBlockSchema>
export type ListBlock = z.infer<typeof ListBlockSchema>
export type FAQBlock = z.infer<typeof FAQBlockSchema>
export type CalloutBlock = z.infer<typeof CalloutBlockSchema>
export type EmbedBlock = z.infer<typeof EmbedBlockSchema>
export type CollectionEmbedBlock = z.infer<typeof CollectionEmbedBlockSchema>
export type MapBlock = z.infer<typeof MapBlockSchema>

// Section block types
export type HeroSectionBlock = z.infer<typeof HeroSectionBlockSchema>
export type FeatureSectionBlock = z.infer<typeof FeatureSectionBlockSchema>
export type StatsSectionBlock = z.infer<typeof StatsSectionBlockSchema>
export type CtaSectionBlock = z.infer<typeof CtaSectionBlockSchema>
export type FaqSectionBlock = z.infer<typeof FaqSectionBlockSchema>
export type ContentSectionBlock = z.infer<typeof ContentSectionBlockSchema>
export type NewsletterBlock = z.infer<typeof NewsletterBlockSchema>
export type SectionHeaderBlock = z.infer<typeof SectionHeaderBlockSchema>

// Cinque Terre Theme block types
export type VillageSelectorBlock = z.infer<typeof VillageSelectorBlockSchema>
export type PlacesToStayBlock = z.infer<typeof PlacesToStayBlockSchema>
export type FeaturedCarouselBlock = z.infer<typeof FeaturedCarouselBlockSchema>
export type VillageIntroBlock = z.infer<typeof VillageIntroBlockSchema>
export type TrendingNowBlock = z.infer<typeof TrendingNowBlockSchema>
export type AboutBlock = z.infer<typeof AboutBlockSchema>
export type CuratedEscapesBlock = z.infer<typeof CuratedEscapesBlockSchema>
export type LatestStoriesBlock = z.infer<typeof LatestStoriesBlockSchema>
export type EatDrinkBlock = z.infer<typeof EatDrinkBlockSchema>
export type HighlightsBlock = z.infer<typeof HighlightsBlockSchema>
export type AudioGuidesBlock = z.infer<typeof AudioGuidesBlockSchema>
export type PracticalAdviceBlock = z.infer<typeof PracticalAdviceBlockSchema>

// Editorial block types (Cinque Terre Theme)
export type EditorialHeroBlock = z.infer<typeof EditorialHeroBlockSchema>
export type EditorialIntroBlock = z.infer<typeof EditorialIntroBlockSchema>
export type EditorialInterludeBlock = z.infer<typeof EditorialInterludeBlockSchema>
export type EditorNoteBlock = z.infer<typeof EditorNoteBlockSchema>
export type ClosingNoteBlock = z.infer<typeof ClosingNoteBlockSchema>

// Template page block types (Cinque Terre Theme)
export type ItineraryHeroBlock = z.infer<typeof ItineraryHeroBlockSchema>
export type ItineraryDaysBlock = z.infer<typeof ItineraryDaysBlockSchema>
export type TeamGridBlock = z.infer<typeof TeamGridBlockSchema>
export type AirportsOverviewBlock = z.infer<typeof AirportsOverviewBlockSchema>
export type WeatherLiveBlock = z.infer<typeof WeatherLiveBlockSchema>
export type WeatherJournalBlock = z.infer<typeof WeatherJournalBlockSchema>
export type BlogArticleBlock = z.infer<typeof BlogArticleBlockSchema>
export type CollectionWithInterludesBlock = z.infer<typeof CollectionWithInterludesBlockSchema>
export type BlogIndexBlock = z.infer<typeof BlogIndexBlockSchema>

// Union types
export type ContentBlock = z.infer<typeof ContentBlockSchema>
export type ContentBlocks = z.infer<typeof ContentBlocksSchema>

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Validate an array of content blocks
 * @throws ZodError if validation fails
 */
export function validateContentBlocks(blocks: unknown): ContentBlocks {
  return ContentBlocksSchema.parse(blocks)
}

/**
 * Safely validate content blocks
 * Returns { success: true, data } or { success: false, error }
 */
export function safeValidateContentBlocks(blocks: unknown) {
  return ContentBlocksSchema.safeParse(blocks)
}
