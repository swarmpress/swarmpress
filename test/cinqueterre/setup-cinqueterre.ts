/**
 * Setup script for cinqueterre.travel virtual media house
 * Creates website, content structure, and GitHub integration
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '.env') })

import { db } from '../../packages/backend/src/db/connection'
import { v4 as uuidv4 } from 'uuid'

async function setupCinqueTerre() {
  console.log('🏖️  Setting up cinqueterre.travel virtual media house\n')

  try {
    // ========================================================================
    // 1. Create Website
    // ========================================================================
    console.log('📝 Step 1: Creating website entry...')

    const websiteId = uuidv4()
    await db.query(
      `INSERT INTO websites (id, domain, title, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (domain) DO UPDATE SET title = EXCLUDED.title`,
      [
        websiteId,
        'cinqueterre.travel',
        'Cinqueterre.travel - Your Guide to the Italian Riviera',
        'The ultimate travel guide to Cinque Terre, featuring village guides, hiking trails, local cuisine, and insider tips for exploring this stunning Italian coastal region.',
      ]
    )

    console.log('✅ Website created:', websiteId)

    // ========================================================================
    // 2. Create GitHub Configuration
    // ========================================================================
    console.log('\n📝 Step 2: Setting up GitHub integration...')

    const githubConfigId = uuidv4()
    await db.query(
      `INSERT INTO github_repos (id, website_id, owner, repo, branch, sync_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (website_id) DO UPDATE SET
         owner = EXCLUDED.owner,
         repo = EXCLUDED.repo,
         branch = EXCLUDED.branch`,
      [
        githubConfigId,
        websiteId,
        'swarmpress',
        'cinqueterre.travel',
        'main',
        true,
      ]
    )

    console.log('✅ GitHub integration configured')
    console.log('   Repository: https://github.com/swarmpress/cinqueterre.travel.git')

    // ========================================================================
    // 3. Create Initial Content Briefs
    // ========================================================================
    console.log('\n📝 Step 3: Creating initial content briefs...')

    const contentTopics = [
      {
        title: 'Ultimate Guide to Visiting Cinque Terre',
        slug: 'ultimate-guide-cinque-terre',
        description: 'Comprehensive guide covering all five villages, best times to visit, how to get there, and essential travel tips',
        keywords: ['cinque terre', 'italian riviera', 'travel guide', 'italy travel'],
      },
      {
        title: 'The Five Villages of Cinque Terre Explained',
        slug: 'five-villages-guide',
        description: 'Detailed exploration of Monterosso, Vernazza, Corniglia, Manarola, and Riomaggiore - what makes each unique',
        keywords: ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'],
      },
      {
        title: 'Best Hiking Trails in Cinque Terre',
        slug: 'hiking-trails-guide',
        description: 'Complete guide to hiking trails including Sentiero Azzurro, Via dell\'Amore, and mountain paths with difficulty ratings',
        keywords: ['hiking', 'trails', 'sentiero azzurro', 'via dell amore'],
      },
      {
        title: 'Where to Eat in Cinque Terre: Local Food Guide',
        slug: 'food-guide-cinque-terre',
        description: 'Best restaurants, trattorias, and local specialties including pesto, focaccia, seafood, and local wines',
        keywords: ['food', 'restaurants', 'italian cuisine', 'local food'],
      },
      {
        title: 'Best Time to Visit Cinque Terre: Seasonal Guide',
        slug: 'best-time-to-visit',
        description: 'Month-by-month breakdown of weather, crowds, events, and what to expect in each season',
        keywords: ['when to visit', 'best time', 'weather', 'seasons'],
      },
    ]

    const contentIds = []
    for (const topic of contentTopics) {
      const contentId = uuidv4()
      contentIds.push(contentId)

      await db.query(
        `INSERT INTO content (id, website_id, title, slug, status, content_blocks, seo_keywords, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          contentId,
          websiteId,
          topic.title,
          topic.slug,
          'idea', // Initial status
          JSON.stringify([]), // Empty blocks initially
          topic.keywords,
        ]
      )

      console.log(`   ✅ Created: ${topic.title}`)
    }

    // ========================================================================
    // 4. Create Initial Tasks for Agents
    // ========================================================================
    console.log('\n📝 Step 4: Creating tasks for agents...')

    // Get a writer agent (we'll use the first one from seed data)
    const writerResult = await db.query(
      `SELECT id FROM agents WHERE capabilities @> ARRAY['content_creation'] LIMIT 1`
    )

    if (writerResult.rows.length > 0) {
      const writerId = writerResult.rows[0].id

      // Create brief tasks for each content item
      for (let i = 0; i < contentIds.length && i < 2; i++) { // Start with first 2 items
        const taskId = uuidv4()
        await db.query(
          `INSERT INTO tasks (id, type, agent_id, content_id, website_id, status, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [
            taskId,
            'create_brief',
            writerId,
            contentIds[i],
            websiteId,
            'pending',
            'Create a detailed content brief for this Cinque Terre travel guide article',
          ]
        )
      }

      console.log('   ✅ Created 2 brief creation tasks for writer agent')
    } else {
      console.log('   ⚠️  No writer agent found - tasks will be created manually')
    }

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('\n🎉 Setup complete!\n')
    console.log('📊 Summary:')
    console.log('   • Website: cinqueterre.travel')
    console.log('   • Website ID:', websiteId)
    console.log(`   • Content items: ${contentTopics.length}`)
    console.log('   • GitHub: https://github.com/swarmpress/cinqueterre.travel.git')
    console.log('   • Status: Ready for agent workflows')
    console.log('\n🚀 Next steps:')
    console.log('   1. Clone or create the GitHub repository')
    console.log('   2. Configure GitHub webhook (optional)')
    console.log('   3. Start content workflow for the pending tasks')
    console.log('   4. Agents will create briefs, write drafts, and publish content')
    console.log('\n💡 You can now start workflows using Temporal or the CLI')

  } catch (error) {
    console.error('❌ Setup failed:', error)
    throw error
  } finally {
    await db.close()
  }
}

// Run setup
setupCinqueTerre().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
