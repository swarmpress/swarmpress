#!/usr/bin/env tsx
/**
 * Generate Vernazza Content
 * Creates content for just Vernazza village in English
 */
import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

import pg from 'pg'
import { Client, Connection } from '@temporalio/client'
import { v4 as uuidv4 } from 'uuid'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://swarmpress:swarmpress@localhost:5432/swarmpress'
const TEMPORAL_URL = process.env.TEMPORAL_URL || 'localhost:7233'
const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'

// Pages to generate (in order of priority)
// NOTE: Testing with just one page - expand after successful test
const PAGES_TO_GENERATE = [
  { slug: '/en/vernazza/overview', priority: 1 },
  // { slug: '/en/vernazza/sights', priority: 2 },
  // { slug: '/en/vernazza/beaches', priority: 3 },
  // { slug: '/en/vernazza/restaurants', priority: 4 },
  // { slug: '/en/vernazza/hotels', priority: 5 },
  // { slug: '/en/vernazza/hiking', priority: 6 },
  // { slug: '/en/vernazza/things-to-do', priority: 7 },
]

interface Page {
  id: string
  slug: string
  title: string
  page_type: string
  description: string | null
}

async function main() {
  console.log('')
  console.log('=========================================')
  console.log('🏖️  Vernazza Content Generator')
  console.log('=========================================')
  console.log('')

  const db = new pg.Client({ connectionString: DATABASE_URL })
  await db.connect()
  console.log('✅ Database connected')

  // Get writer agent
  const { rows: agents } = await db.query<{ id: string; name: string }>(
    `SELECT a.id, a.name FROM agents a
     JOIN roles r ON a.role_id = r.id
     WHERE r.name LIKE '%Writer%' LIMIT 1`
  )

  if (!agents[0]) {
    console.error('❌ No writer agent found')
    await db.end()
    return
  }

  const writerAgent = agents[0]
  console.log(`✅ Writer Agent: ${writerAgent.name} (${writerAgent.id})`)

  // Get pages to generate
  const pageSlugs = PAGES_TO_GENERATE.map(p => p.slug)
  const { rows: pages } = await db.query<Page>(
    `SELECT id, slug, title, page_type, description
     FROM pages
     WHERE website_id = $1 AND slug = ANY($2)
     ORDER BY slug`,
    [WEBSITE_ID, pageSlugs]
  )

  console.log(`\nFound ${pages.length} pages to generate:`)
  for (const page of pages) {
    console.log(`  - ${page.title} (${page.slug})`)
  }

  // Connect to Temporal
  console.log('\nConnecting to Temporal...')
  const connection = await Connection.connect({ address: TEMPORAL_URL })
  const temporal = new Client({ connection })
  console.log('✅ Temporal connected')

  // Generate content for each page
  console.log('\n=========================================')
  console.log('Starting Content Generation...')
  console.log('=========================================\n')

  let created = 0
  let failed = 0

  for (const page of pages) {
    console.log(`\n📝 Processing: ${page.title}`)
    console.log(`   Slug: ${page.slug}`)
    console.log(`   Type: ${page.page_type}`)

    try {
      // Check if content already exists for this page
      const { rows: existing } = await db.query(
        `SELECT id, title, status FROM content_items
         WHERE page_id = $1`,
        [page.id]
      )

      if (existing.length > 0 && existing[0].status !== 'idea') {
        console.log(`   ⏭️ Content already exists: ${existing[0].title} (${existing[0].status})`)
        continue
      }

      // Create content item (brief)
      const contentId = uuidv4()
      const brief = generateBrief(page)

      await db.query(
        `INSERT INTO content_items (id, website_id, page_id, title, slug, status, body, author_agent_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          contentId,
          WEBSITE_ID,
          page.id,
          page.title,
          page.slug.replace('/en/vernazza/', ''),
          'brief_created',
          JSON.stringify([]),
          writerAgent.id,
          JSON.stringify({ page_type: page.page_type, brief })
        ]
      )
      console.log(`   ✅ Created brief: ${contentId}`)

      // Start content production workflow
      const workflowId = `vernazza-content-${contentId}`
      const handle = await temporal.workflow.start('contentProductionWorkflow', {
        args: [{
          contentId,
          writerAgentId: writerAgent.id,
          brief,
          maxRevisions: 1,
        }],
        taskQueue: 'swarmpress-content-production',
        workflowId,
      })

      console.log(`   🚀 Workflow started: ${workflowId}`)
      console.log(`   ⏳ Waiting for completion...`)

      // Wait for workflow with timeout
      const result = await Promise.race([
        handle.result(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout after 5 minutes')), 5 * 60 * 1000)
        )
      ]) as any

      if (result.success) {
        console.log(`   ✅ Content created successfully!`)
        created++
      } else {
        console.log(`   ❌ Content failed: ${result.error}`)
        failed++
      }

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`)
      failed++
    }

    // Rate limit between pages
    console.log(`   ⏱️ Waiting 5 seconds...`)
    await new Promise(r => setTimeout(r, 5000))
  }

  // Summary
  console.log('\n=========================================')
  console.log('Generation Complete!')
  console.log('=========================================')
  console.log(`\nSummary:`)
  console.log(`  - Pages Processed: ${pages.length}`)
  console.log(`  - Content Created: ${created}`)
  console.log(`  - Failed: ${failed}`)

  // Show created content
  const { rows: content } = await db.query(
    `SELECT id, title, status, jsonb_array_length(body::jsonb) as blocks
     FROM content_items
     WHERE website_id = $1 AND (slug LIKE 'vernazza%' OR metadata->>'page_type' IS NOT NULL)
     ORDER BY created_at DESC
     LIMIT 10`,
    [WEBSITE_ID]
  )

  console.log('\nRecent Content:')
  for (const c of content) {
    console.log(`  - ${c.title}: ${c.status} (${c.blocks} blocks)`)
  }

  await db.end()
  console.log('\n✅ Done!')
}

function generateBrief(page: Page): string {
  const briefs: Record<string, string> = {
    overview: `Write a comprehensive overview of Vernazza, one of the five villages of Cinque Terre, Italy.
Cover:
- Introduction to Vernazza as the most picturesque village
- The iconic harbor and colorful buildings
- The Doria Castle and Santa Margherita d'Antiochia church
- Why visitors love Vernazza
- Best time to visit
- Getting around the village
Include practical visitor information and capture the romantic atmosphere of this UNESCO World Heritage Site.`,

    sights: `Write about the main sights and attractions in Vernazza, Italy.
Cover:
- Doria Castle (Castello Doria) - the medieval tower with panoramic views
- Chiesa di Santa Margherita d'Antiochia - the 14th-century church
- The main square (Piazza Marconi) and harbor
- The Belforte Tower
- Via Roma - the main street
- Hidden viewpoints and photo spots
Include opening hours, ticket prices where applicable, and insider tips.`,

    beaches: `Write about the beaches and swimming spots in Vernazza, Cinque Terre.
Cover:
- The main beach at the harbor (pebble beach)
- Rock swimming areas
- Best spots for jumping into the water
- Beach facilities and services
- Water quality and conditions
- Nearby swimming alternatives
- What to bring for a beach day
Include safety tips and best times to visit.`,

    restaurants: `Write a guide to the best restaurants in Vernazza, Cinque Terre.
Cover:
- Top-rated restaurants with harbor views
- Traditional Ligurian cuisine specialties
- Best spots for fresh seafood
- Budget-friendly options
- Wine bars and aperitivo spots
- Gelato and dessert places
Include price ranges, reservation tips, and must-try dishes like pesto, focaccia, and anchovies.`,

    hotels: `Write a guide to accommodation in Vernazza, Cinque Terre.
Cover:
- Best hotels and B&Bs
- Vacation apartments and rentals
- Budget options and hostels
- Luxury stays
- Rooms with a view
- Booking tips and best times
Include price ranges, location advice, and what to expect in this small village.`,

    hiking: `Write about hiking trails around Vernazza, Cinque Terre.
Cover:
- The Blue Trail (Sentiero Azzurro) sections near Vernazza
- Vernazza to Corniglia trail
- Vernazza to Monterosso trail
- Difficulty levels and times
- Trail conditions and passes required
- What to bring
- Best viewpoints along the trails
Include safety tips and seasonal considerations.`,

    'things-to-do': `Write about activities and things to do in Vernazza, Cinque Terre.
Cover:
- Swimming and beach activities
- Hiking and walking
- Boat tours and kayaking
- Wine tasting and food tours
- Photography spots
- Day trip ideas
- Evening activities and nightlife
- Shopping for local products
Include a mix of free and paid activities for different interests.`,
  }

  const pageType = page.page_type || 'overview'
  return briefs[pageType] || briefs['overview']
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
