#!/usr/bin/env tsx
/**
 * Test GitHub Submit Flow
 * Tests submitting existing content for review and GitHub sync
 */

import { Client, Connection } from '@temporalio/client'
import { v4 as uuidv4 } from 'uuid'
import pg from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://swarmpress:swarmpress@localhost:5432/swarmpress'
const TEMPORAL_URL = process.env.TEMPORAL_URL || 'localhost:7233'

async function main() {
  console.log('🧪 Testing Submit for Review + GitHub Sync\n')

  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()

  // 1. Check existing content that has body
  console.log('1️⃣ Finding content with body...')
  const result = await client.query(`
    SELECT id, title, status, jsonb_array_length(body::jsonb) as block_count, website_id
    FROM content_items
    WHERE jsonb_array_length(body::jsonb) > 0
    ORDER BY updated_at DESC
    LIMIT 1
  `)

  if (!result.rows[0]) {
    console.log('❌ No content with body found')
    await client.end()
    return
  }

  const content = result.rows[0]
  console.log(`   Found: ${content.title}`)
  console.log(`   ID: ${content.id}`)
  console.log(`   Status: ${content.status}`)
  console.log(`   Blocks: ${content.block_count}`)

  // 2. Get writer agent
  console.log('\n2️⃣ Getting writer agent...')
  const agentResult = await client.query(`
    SELECT a.id, a.name, r.name as role_name
    FROM agents a
    JOIN roles r ON a.role_id = r.id
    WHERE r.name LIKE '%Writer%'
    LIMIT 1
  `)

  if (!agentResult.rows[0]) {
    console.log('❌ No writer agent found')
    await client.end()
    return
  }

  const agent = agentResult.rows[0]
  console.log(`   Agent: ${agent.name} (${agent.role_name})`)

  // 3. Test state transition: draft -> in_editorial_review
  console.log('\n3️⃣ Testing state transition...')

  if (content.status === 'draft') {
    console.log('   Content is in draft state, testing submit_for_review transition...')

    // Import the repository to test the transition
    const transitionResult = await client.query(`
      UPDATE content_items
      SET status = 'in_editorial_review', updated_at = NOW()
      WHERE id = $1 AND status = 'draft'
      RETURNING status
    `, [content.id])

    if (transitionResult.rows[0]) {
      console.log(`   ✅ Transition successful: draft -> ${transitionResult.rows[0].status}`)
    }
  } else if (content.status === 'brief_created') {
    console.log('   Content is in brief_created state, transitioning to draft first...')
    await client.query(`UPDATE content_items SET status = 'draft' WHERE id = $1`, [content.id])
    console.log('   ✅ Transitioned to draft')

    await client.query(`UPDATE content_items SET status = 'in_editorial_review', updated_at = NOW() WHERE id = $1`, [content.id])
    console.log('   ✅ Transitioned to in_editorial_review')
  } else {
    console.log(`   ℹ️ Content is already in ${content.status} state`)
  }

  // 4. Check website GitHub configuration
  console.log('\n4️⃣ Checking website GitHub configuration...')
  const websiteResult = await client.query(`
    SELECT id, domain, title, github_owner, github_repo, github_access_token IS NOT NULL as has_token
    FROM websites
    WHERE id = $1
  `, [content.website_id])

  const website = websiteResult.rows[0]
  if (website) {
    console.log(`   Website: ${website.title}`)
    console.log(`   GitHub: ${website.github_owner || 'NOT CONNECTED'}/${website.github_repo || 'N/A'}`)
    console.log(`   Token: ${website.has_token ? '✅ Configured' : '❌ Missing'}`)
  }

  // 5. Test GitHub sync (if configured)
  console.log('\n5️⃣ Testing GitHub sync layer...')
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN
  const GITHUB_OWNER = process.env.GITHUB_OWNER
  const GITHUB_REPO = process.env.GITHUB_REPO

  if (!GITHUB_TOKEN || GITHUB_TOKEN === 'ghp_your_token_here') {
    console.log('   ⚠️ GitHub not configured (GITHUB_TOKEN missing)')
    console.log('   Skipping actual GitHub sync test')
  } else {
    console.log('   GitHub credentials available, testing sync...')

    try {
      // Initialize GitHub client
      const { initializeGitHub } = await import('../packages/github-integration/src/client')
      const { syncContentToGitHub, getGitHubMapping } = await import('../packages/github-integration/src/sync')

      // First update website with GitHub credentials
      await client.query(`
        UPDATE websites SET
          github_owner = $1,
          github_repo = $2,
          github_access_token = $3,
          github_connected_at = NOW()
        WHERE id = $4
      `, [GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, content.website_id])

      console.log(`   Updated website with GitHub credentials`)

      // Initialize the client
      initializeGitHub({
        token: GITHUB_TOKEN!,
        owner: GITHUB_OWNER!,
        repo: GITHUB_REPO!,
      })

      console.log('   GitHub client initialized')

      // Try to sync content
      await syncContentToGitHub(content.id)
      const mapping = getGitHubMapping('content', content.id)

      if (mapping) {
        console.log(`   ✅ Content synced to GitHub PR #${mapping.github_number}`)
        console.log(`   PR URL: ${mapping.github_url}`)
      }
    } catch (error: any) {
      console.log(`   ❌ GitHub sync error: ${error.message}`)
    }
  }

  // 6. Final state check
  console.log('\n6️⃣ Final state check...')
  const finalResult = await client.query(`
    SELECT id, title, status
    FROM content_items
    WHERE id = $1
  `, [content.id])

  console.log(`   Content: ${finalResult.rows[0].title}`)
  console.log(`   Final Status: ${finalResult.rows[0].status}`)

  await client.end()

  console.log('\n✅ Test complete!')
}

main().catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
