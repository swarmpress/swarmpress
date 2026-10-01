#!/usr/bin/env tsx
/**
 * Batch Content Generation Script
 * Generates AI content for all cinqueterre.travel pages using Claude API
 *
 * Features:
 * - Uses 6 agent personas based on content type
 * - Loads collection data for context
 * - Generates JSON blocks matching site builder schema
 * - Saves progress for resume capability
 * - Integrates Unsplash for images
 */

import dotenv from 'dotenv'
import { resolve, join, basename, dirname } from 'path'
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'fs'
import Anthropic from '@anthropic-ai/sdk'

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') })

const CONTENT_DIR = resolve(__dirname, '../cinqueterre.travel/content')
const PAGES_DIR = join(CONTENT_DIR, 'pages')
const COLLECTIONS_DIR = join(CONTENT_DIR, 'collections')
const PROGRESS_FILE = join(CONTENT_DIR, '.generation-progress.json')

// =============================================================================
// CONFIGURATION
// =============================================================================

interface BatchConfig {
  dryRun: boolean
  batchSize: number
  delayBetweenPages: number
  delayBetweenBatches: number
  maxRetries: number
  startFromPage?: string
  onlyPages?: string[]
  skipPages?: string[]
  includeImages: boolean
  verbose: boolean
}

const defaultConfig: BatchConfig = {
  dryRun: false,
  batchSize: 5,
  delayBetweenPages: 3000,    // 3 seconds between pages
  delayBetweenBatches: 15000, // 15 seconds between batches
  maxRetries: 3,
  includeImages: true,
  verbose: true,
}

// =============================================================================
// AGENT PERSONAS
// =============================================================================

interface AgentPersona {
  name: string
  specialty: string
  pageTypes: string[]
  systemPrompt: string
}

const agentPersonas: AgentPersona[] = [
  {
    name: 'Giulia',
    specialty: 'Food & Dining Writer',
    pageTypes: ['restaurants', 'food', 'cuisine', 'dining'],
    systemPrompt: `You are Giulia, a passionate Italian food writer who has spent years exploring the culinary treasures of Cinque Terre. Your writing style is warm, evocative, and deeply knowledgeable about Italian cuisine. You describe food with sensory detail - the aroma of fresh pesto, the texture of hand-rolled trofie pasta, the first sip of chilled Vermentino wine overlooking the sea.

Your expertise includes:
- Traditional Ligurian recipes and their origins
- Local restaurants from hidden trattorias to seaside establishments
- Wine and food pairings, especially local Cinque Terre DOC and Sciacchetrà
- Seasonal ingredients and the best times to visit for specific dishes
- The cultural significance of food in Italian coastal life

Write with authenticity and passion. Share insider tips like a local friend would.`,
  },
  {
    name: 'Isabella',
    specialty: 'Travel & Adventure Writer',
    pageTypes: ['hiking', 'beaches', 'trails', 'things-to-do', 'boat-tours', 'sights', 'activities'],
    systemPrompt: `You are Isabella, an adventurous travel writer who has hiked every trail and discovered every secret beach in Cinque Terre. Your writing combines practical advice with inspiring storytelling. You've watched countless sunrises from the Sentiero Azzurro and know exactly when to time your swim to avoid crowds.

Your expertise includes:
- All hiking trails with difficulty levels, timing, and conditions
- Hidden beaches and secret swimming spots
- Boat tours and kayaking routes
- Photography locations and best times for light
- Safety tips and essential gear recommendations
- Seasonal considerations for outdoor activities

Write with energy and enthusiasm. Make readers feel the wind in their hair and salt spray on their skin.`,
  },
  {
    name: 'Lorenzo',
    specialty: 'Culture & History Writer',
    pageTypes: ['overview', 'history', 'culture', 'region', 'villages', 'heritage'],
    systemPrompt: `You are Lorenzo, a cultural historian who has dedicated his career to preserving the stories of the Cinque Terre. Your writing weaves together centuries of history with present-day culture, helping visitors understand why these villages are so special.

Your expertise includes:
- Medieval history of the five villages
- Architectural heritage and UNESCO significance
- Local traditions and festivals
- The evolution from fishing villages to world-famous destinations
- The ongoing preservation efforts and challenges
- Religious and cultural ceremonies

Write with depth and reverence. Help readers connect with the soul of these ancient places.`,
  },
  {
    name: 'Sophia',
    specialty: 'Editor-in-Chief & Accommodations Expert',
    pageTypes: ['hotels', 'accommodations', 'apartments', 'agriturismi', 'camping', 'where-to-stay'],
    systemPrompt: `You are Sophia, a meticulous editor who has personally inspected every noteworthy accommodation in Cinque Terre. Your writing combines critical assessment with practical guidance. You know which rooms have the best views, which B&Bs serve memorable breakfasts, and which properties offer genuine value.

Your expertise includes:
- Hotels, B&Bs, and vacation rentals across all villages
- Price ranges and value assessments
- Best locations for different travel styles
- Booking tips and timing recommendations
- Accessibility considerations
- What to expect at different price points

Write with precision and authority. Help travelers find their perfect home base.`,
  },
  {
    name: 'Marco',
    specialty: 'Senior Editor & Practical Guide Writer',
    pageTypes: ['transport', 'weather', 'getting-here', 'maps', 'faq', 'practical', 'tips'],
    systemPrompt: `You are Marco, a meticulous researcher who leaves nothing to chance. Your writing is clear, accurate, and immediately useful. You've taken every train, walked every path, and can navigate Cinque Terre with your eyes closed.

Your expertise includes:
- Train schedules and ferry timetables
- Parking and car-free village navigation
- Weather patterns and best times to visit
- Money-saving tips and avoiding tourist traps
- Accessibility and mobility considerations
- Emergency information and local services

Write with clarity and precision. Be the reliable friend who has all the answers.`,
  },
  {
    name: 'Francesca',
    specialty: 'Media Coordinator & Events Writer',
    pageTypes: ['events', 'photo-spots', 'galleries', 'blog', 'insights', 'photography'],
    systemPrompt: `You are Francesca, a creative director who captures the visual magic of Cinque Terre. Your writing focuses on experiences that translate into unforgettable memories and photographs. You know the festivals, the golden hour spots, and the moments that make visitors fall in love.

Your expertise includes:
- Local events and festivals throughout the year
- Best photography locations and lighting conditions
- Instagram-worthy experiences and hidden spots
- Cultural celebrations and how to participate
- Seasonal highlights and special occasions
- Visual storytelling of the Cinque Terre experience

Write with visual poetry. Paint pictures with words that make readers reach for their cameras.`,
  },
]

// =============================================================================
// BRAND GUIDELINES
// =============================================================================

const brandGuidelines = `
## Brand Voice: Black Tomato Inspired Luxury Travel

**Tone:**
- Sophisticated yet approachable
- Inspiring and aspirational
- Knowledgeable without being condescending
- Warm and welcoming
- Modern luxury, not stuffy formality

**Style Guidelines:**
- Use evocative, sensory language
- Lead with benefits and experiences, not just features
- Include insider tips that feel exclusive
- Balance practical information with inspiring storytelling
- Create urgency without being pushy
- Use "you" and "your" to speak directly to the reader

**Content Structure:**
- Start with compelling headlines that promise value
- Use short paragraphs for easy scanning
- Include specific details (times, prices, distances)
- Add local terminology with translations
- Reference seasons and timing for relevance
- End sections with clear next steps or calls to action

**Avoid:**
- Generic travel clichés ("hidden gem", "off the beaten path" overuse)
- Dry, encyclopedic descriptions
- Overly promotional language
- Excessive superlatives
- Outdated information or vague timing
`

// =============================================================================
// UNSPLASH INTEGRATION
// =============================================================================

interface UnsplashPhoto {
  id: string
  urls: { raw: string; full: string; regular: string; small: string }
  alt_description: string
  user: { name: string }
}

async function searchUnsplashPhotos(
  query: string,
  count: number = 3
): Promise<UnsplashPhoto[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  if (!accessKey) return []

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
      }
    )

    if (!response.ok) return []

    const data = await response.json() as { results: UnsplashPhoto[] }
    return data.results
  } catch {
    return []
  }
}

function getImageUrl(photo: UnsplashPhoto, size: 'regular' | 'full' = 'regular'): string {
  return `${photo.urls[size]}&w=1200&q=80`
}

// =============================================================================
// COLLECTION DATA LOADING
// =============================================================================

interface CollectionData {
  [key: string]: unknown[]
}

function loadCollections(): CollectionData {
  const collections: CollectionData = {}

  if (!existsSync(COLLECTIONS_DIR)) return collections

  const collectionDirs = readdirSync(COLLECTIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())

  for (const dir of collectionDirs) {
    const collectionPath = join(COLLECTIONS_DIR, dir.name)
    const files = readdirSync(collectionPath)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))

    collections[dir.name] = []

    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(collectionPath, file), 'utf-8'))
        if (data.items && Array.isArray(data.items)) {
          collections[dir.name].push(...data.items)
        } else {
          collections[dir.name].push(data)
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  return collections
}

// =============================================================================
// PAGE DISCOVERY
// =============================================================================

interface PageInfo {
  path: string
  relativePath: string
  slug: string
  pageType: string
  village?: string
}

function discoverPages(): PageInfo[] {
  const pages: PageInfo[] = []

  function scanDirectory(dir: string, baseSlug: string = '') {
    const items = readdirSync(dir, { withFileTypes: true })

    for (const item of items) {
      const fullPath = join(dir, item.name)

      if (item.isDirectory()) {
        scanDirectory(fullPath, baseSlug ? `${baseSlug}/${item.name}` : item.name)
      } else if (item.name.endsWith('.json')) {
        const slug = item.name.replace('.json', '')
        const relativePath = baseSlug ? `${baseSlug}/${slug}` : slug

        // Determine page type from path
        let pageType = 'general'
        const pathParts = relativePath.split('/')

        if (pathParts.includes('restaurants')) pageType = 'restaurants'
        else if (pathParts.includes('hotels') || pathParts.includes('accommodations')) pageType = 'hotels'
        else if (pathParts.includes('hiking') || pathParts.includes('hikes')) pageType = 'hiking'
        else if (pathParts.includes('beaches')) pageType = 'beaches'
        else if (pathParts.includes('events')) pageType = 'events'
        else if (pathParts.includes('weather')) pageType = 'weather'
        else if (pathParts.includes('transport')) pageType = 'transport'
        else if (pathParts.includes('faq')) pageType = 'faq'
        else if (pathParts.includes('overview')) pageType = 'overview'
        else if (slug === 'cinque-terre') pageType = 'region'
        else if (['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'].includes(slug)) {
          pageType = 'village'
        }

        // Determine village from path
        const villages = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']
        const village = pathParts.find(p => villages.includes(p))

        pages.push({
          path: fullPath,
          relativePath,
          slug,
          pageType,
          village,
        })
      }
    }
  }

  scanDirectory(PAGES_DIR)
  return pages
}

// =============================================================================
// AGENT SELECTION
// =============================================================================

function selectAgent(pageType: string): AgentPersona {
  // Find agent that handles this page type
  for (const agent of agentPersonas) {
    if (agent.pageTypes.some(t => pageType.includes(t))) {
      return agent
    }
  }

  // Default to Lorenzo for general/unknown pages
  return agentPersonas.find(a => a.name === 'Lorenzo') || agentPersonas[0]
}

// =============================================================================
// CONTENT GENERATION
// =============================================================================

const anthropic = new Anthropic()

interface GeneratedContent {
  title: string
  seoTitle: string
  seoDescription: string
  body: unknown[]
}

// Mapping of page types to their corresponding collection types
const pageTypeToCollection: Record<string, string> = {
  'events': 'events',
  'restaurants': 'restaurants',
  'hotels': 'accommodations',
  'accommodations': 'accommodations',
  'hiking': 'hikes',
  'beaches': 'beaches',
  'transport': 'transportation',
}

// Helper to format collection items for listing pages
function formatCollectionItems(items: any[], lang: string = 'en'): any[] {
  return items.slice(0, 20).map((item: any) => ({
    slug: item.slug,
    title: typeof item.name === 'object' ? item.name[lang] || item.name.en : item.name,
    summary: item.details?.teaser?.[lang] || item.details?.teaser?.en || item.details?.description?.[lang]?.slice(0, 200),
    image: item.image || item.media?.featuredImage,
    url: `/${item.slug}`,
    category: item.category,
    village: item.village,
    data: {
      featured: item.featured,
      rating: item.rating,
      priceRange: item.price_range,
    }
  }))
}

async function generatePageContent(
  pageInfo: PageInfo,
  existingPage: unknown,
  collections: CollectionData,
  config: BatchConfig
): Promise<GeneratedContent | null> {
  const agent = selectAgent(pageInfo.pageType)

  // Determine if this is a listing page that should include collection items
  const isListingPage = Object.keys(pageTypeToCollection).includes(pageInfo.pageType)
  const collectionType = pageTypeToCollection[pageInfo.pageType]

  // Build context from collections
  let collectionContext = ''
  let collectionItems: any[] = []

  // For listing pages, load the relevant collection items
  if (isListingPage && collectionType && collections[collectionType]) {
    let items = collections[collectionType] as any[]

    // Filter by village if applicable
    if (pageInfo.village) {
      items = items.filter((item: any) =>
        item.village === pageInfo.village ||
        item.location?.village === pageInfo.village
      )
    }

    // Sort by rank/featured
    items = items.sort((a: any, b: any) => {
      if (a.featured && !b.featured) return -1
      if (!a.featured && b.featured) return 1
      return (a.rank || 999) - (b.rank || 999)
    })

    collectionItems = formatCollectionItems(items)

    if (collectionItems.length > 0) {
      collectionContext += `\n\n## Collection Items (${collectionType})\nThere are ${items.length} items in this collection. Here are the top items to feature:\n`
      collectionContext += JSON.stringify(collectionItems.slice(0, 8), null, 2)
    }
  }

  // Add village-specific context
  if (pageInfo.village && collections.restaurants && !isListingPage) {
    const villageRestaurants = (collections.restaurants as any[]).filter(
      (r: any) => r.village === pageInfo.village || r.slug?.includes(pageInfo.village)
    ).slice(0, 5)
    if (villageRestaurants.length > 0) {
      collectionContext += `\n\nTop restaurants in ${pageInfo.village}:\n${JSON.stringify(villageRestaurants.slice(0, 3), null, 2)}`
    }
  }

  if (pageInfo.village && collections.villages) {
    const villageData = (collections.villages as any[]).find(
      (v: any) => v.slug === pageInfo.village
    )
    if (villageData) {
      collectionContext += `\n\nVillage profile:\n${JSON.stringify(villageData, null, 2).slice(0, 4000)}`
    }
  }

  // Build image search queries based on page type
  let imageQueries: string[] = []
  if (pageInfo.village) {
    imageQueries.push(`${pageInfo.village} cinque terre italy`)
  }
  if (pageInfo.pageType === 'restaurants') {
    imageQueries.push('italian seafood restaurant coastal')
  } else if (pageInfo.pageType === 'hiking') {
    imageQueries.push('cinque terre coastal hiking trail')
  } else if (pageInfo.pageType === 'beaches') {
    imageQueries.push('cinque terre beach swimming')
  } else {
    imageQueries.push('cinque terre italy colorful houses')
  }

  // Fetch images
  let imageUrl = 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?w=1200&q=80'
  if (config.includeImages && imageQueries.length > 0) {
    const photos = await searchUnsplashPhotos(imageQueries[0], 1)
    if (photos.length > 0) {
      imageUrl = getImageUrl(photos[0])
    }
  }

  // Build collection-embed block if this is a listing page
  let collectionEmbedInstruction = ''
  let collectionEmbedExample = ''

  if (isListingPage && collectionItems.length > 0) {
    collectionEmbedInstruction = `
## IMPORTANT: This is a Listing Page
Since this is a ${pageInfo.pageType} listing page, you MUST include a "collection-embed" block to display the actual ${collectionType} items. This block will render a grid/list of the collection items provided in the context data.

Include the collection-embed block AFTER the hero and introductory content sections.`

    collectionEmbedExample = `
    {
      "type": "collection-embed",
      "collectionType": "${collectionType}",
      "heading": "Featured ${collectionType.charAt(0).toUpperCase() + collectionType.slice(1)}",
      "headingLevel": 2,
      "items": ${JSON.stringify(collectionItems.slice(0, 12))},
      "display": {
        "layout": "grid",
        "columns": 3,
        "showImage": true,
        "showSummary": true,
        "imageAspect": "landscape"
      },
      "showViewAll": ${collectionItems.length > 12},
      "viewAllUrl": "/${collectionType}"
    },`
  }

  // Build prompt
  const prompt = `You are writing content for a luxury travel website about Cinque Terre, Italy.

${brandGuidelines}

## Page Information
- Path: ${pageInfo.relativePath}
- Page Type: ${pageInfo.pageType}
- Village: ${pageInfo.village || 'General/Regional'}
${isListingPage ? `- This is a LISTING PAGE for ${collectionType}` : ''}

${collectionContext ? `## Context Data\n${collectionContext}` : ''}
${collectionEmbedInstruction}

## Task
Generate complete page content in JSON format. The output should be structured as follows:

1. A compelling title (English only)
2. SEO title (60 chars max, include location)
3. SEO description (155 chars max, include key benefits)
4. Body array with section blocks

## Section Block Types Available
Use these exact types for the body array:

- hero-section: Main hero with image, title, subtitle, buttons
- stats-section: Key numbers/facts
- feature-section: Grid of features/benefits with icons
- content-section: Text content with optional image
- faq-section: Question and answer pairs
- cta-section: Call to action block
- gallery-section: Image gallery
- testimonial-section: Reviews/quotes
${isListingPage ? `- collection-embed: REQUIRED for listing pages - displays the actual ${collectionType} items from collections` : ''}

## Output Format
Return ONLY valid JSON in this exact structure:

{
  "title": "Page Title Here",
  "seoTitle": "SEO Title | Cinqueterre.travel",
  "seoDescription": "Meta description under 155 characters",
  "body": [
    {
      "type": "hero-section",
      "variant": "split-with-image",
      "image": "${imageUrl}",
      "eyebrow": "Short label",
      "title": "Main Headline",
      "subtitle": "Supporting text that expands on the headline",
      "buttons": [
        {"text": "Primary CTA", "url": "#section", "variant": "primary"},
        {"text": "Secondary CTA", "url": "#other", "variant": "secondary"}
      ]
    },${collectionEmbedExample}
    // More sections...
  ]
}

Generate 4-6 sections that create a complete, engaging page. Include:
- A hero section with compelling headline
- Key facts or statistics if relevant
${isListingPage ? `- A collection-embed block to display the ${collectionType} items (REQUIRED)` : '- Features/highlights grid'}
- At least one content section with detailed information
- FAQ section with 4-6 common questions
- CTA section at the end

Remember: English only. Luxury travel tone. Specific, useful information.${isListingPage ? ` The collection-embed block MUST be included for this listing page.` : ''}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: agent.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    })

    // Extract JSON from response
    const content = response.content[0]
    if (content.type !== 'text') return null

    // Find JSON in response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as GeneratedContent
    return parsed
  } catch (error) {
    console.error(`Error generating content for ${pageInfo.relativePath}:`, error)
    return null
  }
}

// =============================================================================
// PROGRESS TRACKING
// =============================================================================

interface Progress {
  startedAt: string
  lastUpdated: string
  totalPages: number
  completedPages: string[]
  failedPages: string[]
  skippedPages: string[]
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'))
  }
  return {
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalPages: 0,
    completedPages: [],
    failedPages: [],
    skippedPages: [],
  }
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString()
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2)
  const config: BatchConfig = {
    ...defaultConfig,
    dryRun: args.includes('--dry-run'),
    verbose: !args.includes('--quiet'),
  }

  // Filter arguments
  const onlyArg = args.find(a => a.startsWith('--only='))
  if (onlyArg) {
    config.onlyPages = onlyArg.replace('--only=', '').split(',')
  }

  const skipArg = args.find(a => a.startsWith('--skip='))
  if (skipArg) {
    config.skipPages = skipArg.replace('--skip=', '').split(',')
  }

  console.log('\n' + '═'.repeat(60))
  console.log('  cinqueterre.travel Batch Content Generation')
  console.log('═'.repeat(60))

  if (config.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be saved')
  }

  // Load collections
  console.log('\n📚 Loading collections...')
  const collections = loadCollections()
  const collectionCounts = Object.entries(collections).map(([k, v]) => `${k}: ${v.length}`)
  console.log(`   Loaded: ${collectionCounts.join(', ')}`)

  // Discover pages
  console.log('\n📄 Discovering pages...')
  let pages = discoverPages()
  console.log(`   Found ${pages.length} pages`)

  // Apply filters
  if (config.onlyPages && config.onlyPages.length > 0) {
    pages = pages.filter(p => config.onlyPages!.some(o => p.relativePath.includes(o)))
    console.log(`   Filtered to ${pages.length} pages (--only)`)
  }

  if (config.skipPages && config.skipPages.length > 0) {
    pages = pages.filter(p => !config.skipPages!.some(s => p.relativePath.includes(s)))
    console.log(`   Filtered to ${pages.length} pages (--skip)`)
  }

  // Load progress
  const progress = loadProgress()
  progress.totalPages = pages.length

  // Skip already completed pages
  pages = pages.filter(p => !progress.completedPages.includes(p.relativePath))
  console.log(`   ${pages.length} pages remaining (${progress.completedPages.length} already done)`)

  if (pages.length === 0) {
    console.log('\n✨ All pages already generated!')
    return
  }

  // Process pages in batches
  console.log('\n🚀 Starting generation...')
  console.log(`   Batch size: ${config.batchSize}`)
  console.log(`   Delay between pages: ${config.delayBetweenPages}ms`)
  console.log(`   Delay between batches: ${config.delayBetweenBatches}ms`)

  let processed = 0
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < pages.length; i += config.batchSize) {
    const batch = pages.slice(i, i + config.batchSize)
    const batchNum = Math.floor(i / config.batchSize) + 1
    const totalBatches = Math.ceil(pages.length / config.batchSize)

    console.log(`\n━━━ Batch ${batchNum}/${totalBatches} ━━━`)

    for (const page of batch) {
      processed++
      const agent = selectAgent(page.pageType)

      console.log(`\n[${processed}/${pages.length}] ${page.relativePath}`)
      console.log(`   Agent: ${agent.name} (${agent.specialty})`)
      console.log(`   Type: ${page.pageType}`)

      if (config.dryRun) {
        console.log('   ⏭️  Skipping (dry run)')
        continue
      }

      try {
        // Load existing page
        const existingPage = JSON.parse(readFileSync(page.path, 'utf-8'))

        // Generate new content
        const generated = await generatePageContent(page, existingPage, collections, config)

        if (!generated) {
          console.log('   ❌ Generation failed')
          failed++
          progress.failedPages.push(page.relativePath)
          continue
        }

        // Update page with generated content
        const updatedPage = {
          ...existingPage,
          title: { en: generated.title },
          seo: {
            title: { en: generated.seoTitle },
            description: { en: generated.seoDescription },
          },
          body: generated.body,
          status: 'generated',
          updated_at: new Date().toISOString(),
        }

        // Save
        writeFileSync(page.path, JSON.stringify(updatedPage, null, 2))
        console.log('   ✓ Generated and saved')

        succeeded++
        progress.completedPages.push(page.relativePath)
        saveProgress(progress)

        // Delay between pages
        if (batch.indexOf(page) < batch.length - 1) {
          await sleep(config.delayBetweenPages)
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`)
        failed++
        progress.failedPages.push(page.relativePath)
      }
    }

    // Delay between batches
    if (i + config.batchSize < pages.length) {
      console.log(`\n⏳ Waiting ${config.delayBetweenBatches / 1000}s before next batch...`)
      await sleep(config.delayBetweenBatches)
    }
  }

  // Final summary
  console.log('\n' + '═'.repeat(60))
  console.log('  Generation Complete')
  console.log('═'.repeat(60))
  console.log(`\n   Total processed: ${processed}`)
  console.log(`   ✓ Succeeded: ${succeeded}`)
  console.log(`   ❌ Failed: ${failed}`)
  console.log(`   Previously done: ${progress.completedPages.length - succeeded}`)

  if (failed > 0) {
    console.log(`\n   Failed pages:`)
    for (const p of progress.failedPages.slice(-10)) {
      console.log(`   - ${p}`)
    }
  }

  console.log('\nNext steps:')
  console.log('  1. tsx scripts/enrich-pages-with-images.ts')
  console.log('  2. tsx scripts/audit-generated-content.ts')
  console.log('  3. tsx scripts/deploy-cinqueterre.ts')
  console.log('')

  saveProgress(progress)
}

main().catch(err => {
  console.error('Generation failed:', err)
  process.exit(1)
})
