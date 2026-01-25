#!/usr/bin/env tsx
/**
 * Content Workflow Trigger Script
 *
 * Creates a content brief and triggers the contentProductionWorkflow via Temporal.
 *
 * Usage:
 *   tsx scripts/trigger-content-workflow.ts --title "Article Title" --brief "Brief description..."
 *   tsx scripts/trigger-content-workflow.ts --preset monterosso
 *   tsx scripts/trigger-content-workflow.ts --list-presets
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 *   TEMPORAL_URL - Temporal server address (default: localhost:7233)
 */

import { v4 as uuidv4 } from 'uuid'
import { Client, Connection } from '@temporalio/client'
import pg from 'pg'

// Environment configuration
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://swarmpress:swarmpress@localhost:5432/swarmpress'
const TEMPORAL_URL = process.env.TEMPORAL_URL || 'localhost:7233'

// Predefined content briefs for Cinque Terre villages
const CONTENT_PRESETS: Record<string, { title: string; brief: string; slug: string }> = {
  monterosso: {
    title: 'A Perfect Day in Monterosso al Mare',
    slug: 'perfect-day-monterosso',
    brief: `Write a local's guide to spending a perfect day in Monterosso al Mare.

The article should cover:
- Morning: Best time to visit Fegina beach, local breakfast spots
- Mid-day: Exploring the old town, the Giant statue, and hidden gems
- Lunch: Authentic Ligurian restaurants away from tourist traps
- Afternoon: Wine tasting at local cantinas, swimming in crystal waters
- Evening: Aperitivo spots with sunset views, dinner recommendations

Tone: Warm, knowledgeable, like advice from a local friend. Include specific place names,
approximate prices where relevant, and insider tips that only locals would know.

Target length: 1500-2000 words with clear sections for each part of the day.`
  },
  vernazza: {
    title: 'Hidden Corners of Vernazza: Beyond the Postcard Views',
    slug: 'hidden-corners-vernazza',
    brief: `Write an exploratory guide to the lesser-known spots in Vernazza.

Cover these themes:
- The secret swimming spots away from the crowded harbor
- Historic alleyways and their stories
- The best viewpoints that aren't in every travel guide
- Local artisan shops and their crafts
- Where the fishermen actually eat
- The ancient watchtower and its history
- Early morning photography spots

Tone: Adventurous and curious, like sharing discoveries with a fellow traveler.
Include practical tips for finding these spots.

Target length: 1200-1500 words.`
  },
  corniglia: {
    title: 'Corniglia: The Quiet Heart of Cinque Terre',
    slug: 'quiet-heart-corniglia',
    brief: `Write a contemplative guide to Corniglia, the only village not on the sea.

Themes to explore:
- Why the 382-step climb is worth it
- The vineyard-wrapped landscape and local wine
- The sense of authentic village life without cruise ship crowds
- The panoramic views from Largo Taragio
- Local food specialties (honey, pesto, focaccia)
- The Guvano beach mystery (former nudist beach)
- Best times to visit for solitude

Tone: Reflective, appreciating the slower pace. Appeal to travelers seeking authenticity
over Instagram moments.

Target length: 1000-1200 words.`
  },
  manarola: {
    title: 'Manarola After Dark: An Evening Guide',
    slug: 'manarola-after-dark',
    brief: `Write an evening and night-focused guide to Manarola.

Cover:
- The famous sunset views from Nessun Dorma bar
- Evening passeggiata traditions
- Where to watch the stars without light pollution
- Late-night swimming spots (safety tips included)
- The illuminated village after 10 PM
- Wine bars that stay open late
- The magic of the harbor at night

Tone: Romantic and atmospheric. Paint vivid pictures of the village at night.
Include safety tips and practical timing advice.

Target length: 1000-1200 words.`
  },
  riomaggiore: {
    title: 'Riomaggiore Photography Spots: A Visual Guide',
    slug: 'riomaggiore-photography-guide',
    brief: `Write a photography-focused guide to Riomaggiore.

Cover these locations with specific details:
- The iconic harbor view (exact position, best time of day)
- The castle viewpoint
- Via Colombo for street photography
- Morning light vs golden hour comparisons
- The swimming rocks with dramatic waves
- Tips for avoiding crowds in photos
- Night photography opportunities

For each spot, include:
- GPS coordinates or clear directions
- Best time of day and season
- Camera settings suggestions (for various skill levels)
- Composition tips

Tone: Technical but accessible. Help photographers of all levels capture memorable shots.

Target length: 1500-1800 words.`
  },
  hiking: {
    title: 'Spring Wildflower Hiking: Best Trails in Cinque Terre',
    slug: 'spring-wildflower-hiking',
    brief: `Write a seasonal hiking guide for spring (March-May) wildflower viewing.

Cover these trails with botanical detail:
- Monterosso to Vernazza (Blue Trail section) - April blooms
- Volastra to Corniglia via vineyards - wild orchids
- Riomaggiore to Portovenere - coastal flowers
- High path (Sentiero Rosso) - alpine meadows

For each trail include:
- Difficulty level and duration
- Notable wildflowers with bloom timing
- Best viewpoints to stop
- Water and rest stop locations
- What to bring

Add a wildflower identification section with 5-7 common species.

Tone: Nature-focused, encouraging slow hiking to notice details.

Target length: 1800-2200 words.`
  },
  food: {
    title: 'Eating Like a Local: Cinque Terre Food Guide',
    slug: 'eating-like-local-food-guide',
    brief: `Write a comprehensive food guide focused on authentic local cuisine.

Sections:
1. Essential Ligurian dishes to try (with descriptions)
   - Pesto Genovese, focaccia, farinata, trofie
   - Seafood specialties (anchovies, mussels)
2. Village-by-village restaurant picks
   - One splurge and one budget option per village
   - What to order at each
3. Local wines (Sciacchetra, Cinque Terre DOC)
4. Food shopping (what to bring home)
5. Market days and food festivals
6. Eating etiquette tips

Tone: Enthusiastic foodie sharing secrets. Include some Italian phrases.
Avoid the most tourist-trap restaurants.

Target length: 2000-2500 words.`
  }
}

interface WorkflowInput {
  contentId: string
  writerAgentId: string
  brief: string
  maxRevisions?: number
}

async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  let title: string | undefined
  let brief: string | undefined
  let slug: string | undefined
  let preset: string | undefined

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--title':
        title = args[++i]
        break
      case '--brief':
        brief = args[++i]
        break
      case '--slug':
        slug = args[++i]
        break
      case '--preset':
        preset = args[++i]
        break
      case '--list-presets':
        console.log('\nAvailable content presets:\n')
        for (const [key, value] of Object.entries(CONTENT_PRESETS)) {
          console.log(`  ${key.padEnd(15)} - ${value.title}`)
        }
        console.log('\nUsage: tsx scripts/trigger-content-workflow.ts --preset <name>')
        process.exit(0)
      case '--help':
        console.log(`
Content Workflow Trigger Script

Usage:
  tsx scripts/trigger-content-workflow.ts --preset <name>
  tsx scripts/trigger-content-workflow.ts --title "Title" --brief "Brief..." [--slug "slug"]

Options:
  --preset <name>    Use a predefined content brief
  --list-presets     Show available presets
  --title <string>   Article title
  --brief <string>   Content brief (detailed instructions)
  --slug <string>    URL slug (generated from title if not provided)
  --help             Show this help

Environment:
  DATABASE_URL       PostgreSQL connection (default: localhost)
  TEMPORAL_URL       Temporal server (default: localhost:7233)

Examples:
  tsx scripts/trigger-content-workflow.ts --preset monterosso
  tsx scripts/trigger-content-workflow.ts --title "Wine Tasting Guide" --brief "Write about..."
        `)
        process.exit(0)
    }
  }

  // Use preset if specified
  if (preset) {
    const presetData = CONTENT_PRESETS[preset.toLowerCase()]
    if (!presetData) {
      console.error(`Unknown preset: ${preset}`)
      console.error('Use --list-presets to see available options')
      process.exit(1)
    }
    title = presetData.title
    brief = presetData.brief
    slug = presetData.slug
  }

  if (!title || !brief) {
    console.error('Error: --title and --brief are required (or use --preset)')
    console.error('Use --help for usage information')
    process.exit(1)
  }

  // Generate slug if not provided
  if (!slug) {
    slug = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  console.log('\n========================================')
  console.log('Content Workflow Trigger')
  console.log('========================================\n')
  console.log(`Title: ${title}`)
  console.log(`Slug: ${slug}`)
  console.log(`Brief: ${brief.substring(0, 100)}...`)
  console.log('')

  // Connect to database
  console.log('Connecting to database...')
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()

  try {
    // Find Cinque Terre website
    console.log('Finding Cinque Terre website...')
    const websiteResult = await client.query(`
      SELECT id, domain, title FROM websites
      WHERE domain LIKE '%cinqueterre%' OR title LIKE '%Cinque Terre%'
      LIMIT 1
    `)

    if (!websiteResult.rows[0]) {
      throw new Error('Cinque Terre website not found in database')
    }

    const website = websiteResult.rows[0]
    console.log(`Found website: ${website.title} (${website.domain})`)

    // Find writer agent
    console.log('Finding writer agent...')
    const agentResult = await client.query(`
      SELECT a.id, a.name, r.name as role_name
      FROM agents a
      JOIN roles r ON a.role_id = r.id
      WHERE r.name LIKE '%Writer%'
      LIMIT 1
    `)

    if (!agentResult.rows[0]) {
      throw new Error('No writer agent found in database')
    }

    const agent = agentResult.rows[0]
    console.log(`Found agent: ${agent.name} (${agent.role_name})`)

    // Create content item
    console.log('\nCreating content item...')
    const contentId = uuidv4()

    await client.query(`
      INSERT INTO content_items (
        id, website_id, title, slug, content_type,
        status, body, author_agent_id, brief, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    `, [
      contentId,
      website.id,
      title,
      slug,
      'blog-article',
      'brief_created',
      JSON.stringify([]),
      agent.id,
      brief
    ])

    console.log(`Created content item: ${contentId}`)

    // Connect to Temporal
    console.log('\nConnecting to Temporal...')
    const connection = await Connection.connect({ address: TEMPORAL_URL })
    const temporalClient = new Client({ connection })
    console.log('Connected to Temporal')

    // Start workflow
    const workflowId = `content-production-${contentId}`
    console.log(`\nStarting workflow: ${workflowId}`)

    const workflowInput: WorkflowInput = {
      contentId,
      writerAgentId: agent.id,
      brief,
      maxRevisions: 2
    }

    const handle = await temporalClient.workflow.start('contentProductionWorkflow', {
      args: [workflowInput],
      taskQueue: 'swarmpress-content-production',
      workflowId
    })

    console.log(`Workflow started successfully!`)
    console.log(`  Workflow ID: ${handle.workflowId}`)
    console.log(`  Run ID: ${handle.firstExecutionRunId}`)
    console.log('')
    console.log('Monitor progress:')
    console.log(`  Temporal UI: http://localhost:8233/namespaces/default/workflows/${handle.workflowId}`)
    console.log('')
    console.log('To wait for result:')
    console.log(`  tsx scripts/trigger-content-workflow.ts --wait ${handle.workflowId}`)

    // Check if user wants to wait
    if (args.includes('--wait-result')) {
      console.log('\nWaiting for workflow result (timeout: 10 minutes)...')
      try {
        const result = await Promise.race([
          handle.result(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 10 * 60 * 1000)
          )
        ])
        console.log('\nWorkflow completed!')
        console.log(JSON.stringify(result, null, 2))
      } catch (err) {
        if (err instanceof Error && err.message === 'Timeout') {
          console.log('\nWorkflow still running after 10 minutes.')
          console.log('Check Temporal UI for status.')
        } else {
          throw err
        }
      }
    }

    console.log('\n========================================')
    console.log('Summary')
    console.log('========================================')
    console.log(`Content ID: ${contentId}`)
    console.log(`Workflow ID: ${workflowId}`)
    console.log(`Status: Started`)
    console.log('========================================\n')

  } finally {
    await client.end()
  }
}

main().catch(error => {
  console.error('\nError:', error.message)
  process.exit(1)
})
