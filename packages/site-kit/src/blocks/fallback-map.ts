/**
 * Core block type → kit neutral renderer (components/blocks/<Name>.astro).
 * Kept free of `.astro` imports so it can be unit-tested; every core type
 * must be listed (block-coverage test).
 */
export type FallbackName =
  | 'Paragraph'
  | 'Heading'
  | 'Hero'
  | 'Figure'
  | 'Gallery'
  | 'Quote'
  | 'List'
  | 'Faq'
  | 'Callout'
  | 'Embed'
  | 'CollectionBlock'
  | 'Cards'
  | 'ClosingNote'
  | 'EditorialIntro'
  | 'SectionHeader'
  | 'BlogArticle'
  | 'BlogIndex'

export const FALLBACK_RENDERER: Readonly<Record<string, FallbackName>> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  hero: 'Hero',
  image: 'Figure',
  gallery: 'Gallery',
  quote: 'Quote',
  list: 'List',
  faq: 'Faq',
  callout: 'Callout',
  embed: 'Embed',
  'collection-embed': 'CollectionBlock',
  map: 'Embed',
  'hero-section': 'Hero',
  'feature-section': 'Cards',
  'stats-section': 'Cards',
  'cta-section': 'ClosingNote',
  'faq-section': 'Faq',
  'content-section': 'EditorialIntro',
  newsletter: 'Callout',
  'section-header': 'SectionHeader',
  'village-selector': 'Cards',
  'places-to-stay': 'Cards',
  'featured-carousel': 'Cards',
  'village-intro': 'Cards',
  'trending-now': 'Cards',
  about: 'EditorialIntro',
  'curated-escapes': 'Cards',
  'latest-stories': 'Cards',
  'eat-drink': 'Cards',
  highlights: 'Cards',
  'audio-guides': 'Cards',
  'practical-advice': 'Cards',
  'editorial-hero': 'Hero',
  'editorial-intro': 'EditorialIntro',
  'editorial-interlude': 'Quote',
  'editor-note': 'Quote',
  'closing-note': 'ClosingNote',
  'itinerary-hero': 'Hero',
  'itinerary-days': 'Cards',
  'team-grid': 'Cards',
  'airports-overview': 'Cards',
  'weather-live': 'Cards',
  'weather-journal': 'Callout',
  'blog-article': 'BlogArticle',
  'collection-with-interludes': 'CollectionBlock',
  'blog-index': 'BlogIndex',
}
