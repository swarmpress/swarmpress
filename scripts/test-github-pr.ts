#!/usr/bin/env tsx
/**
 * Direct GitHub PR creation test
 * Tests creating a PR for content using the stored OAuth token
 */
import pg from 'pg'
import { Octokit } from '@octokit/rest'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://swarmpress:swarmpress@localhost:5432/swarmpress'
const CONTENT_ID = 'f1306648-23f7-4b75-a93e-d4f089ccab2e'
const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'

async function main() {
  console.log('🧪 Testing GitHub Sync - Direct API Test\n')

  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()

  // Get website with GitHub token
  const websiteResult = await client.query(`
    SELECT id, domain, github_owner, github_repo, github_access_token
    FROM websites WHERE id = $1
  `, [WEBSITE_ID])

  const website = websiteResult.rows[0]
  if (!website?.github_access_token) {
    console.log('❌ No GitHub token found')
    await client.end()
    return
  }

  console.log('Website:', website.domain)
  console.log('GitHub:', website.github_owner + '/' + website.github_repo)
  console.log('Token: ✅ Found')

  // Get content
  const contentResult = await client.query(`
    SELECT id, title, slug, status, body, metadata
    FROM content_items WHERE id = $1
  `, [CONTENT_ID])

  const content = contentResult.rows[0]
  if (!content) {
    console.log('❌ Content not found')
    await client.end()
    return
  }

  // body might already be parsed by pg driver for JSONB columns
  const bodyBlocks = typeof content.body === 'string'
    ? JSON.parse(content.body || '[]')
    : (content.body || [])
  console.log('\nContent:', content.title)
  console.log('Status:', content.status)
  console.log('Blocks:', bodyBlocks.length)

  // Initialize Octokit
  const octokit = new Octokit({ auth: website.github_access_token })

  // Verify repo access
  console.log('\n📡 Testing GitHub API connection...')
  try {
    const { data: repo } = await octokit.repos.get({
      owner: website.github_owner,
      repo: website.github_repo
    })
    console.log('✅ Connected to', repo.full_name)
    console.log('   Default branch:', repo.default_branch)
    console.log('   Private:', repo.private)
  } catch (error: any) {
    console.log('❌ GitHub API error:', error.message)
    await client.end()
    return
  }

  // Create a branch and PR for the content
  console.log('\n📤 Creating content PR...')
  const branchName = 'content/' + content.slug + '-' + Date.now()

  try {
    // Get default branch SHA
    const { data: defaultBranch } = await octokit.repos.getBranch({
      owner: website.github_owner,
      repo: website.github_repo,
      branch: 'main'
    })

    // Create branch
    await octokit.git.createRef({
      owner: website.github_owner,
      repo: website.github_repo,
      ref: 'refs/heads/' + branchName,
      sha: defaultBranch.commit.sha
    })
    console.log('✅ Created branch:', branchName)

    // Create content file
    const contentPath = 'content/' + content.slug + '.json'
    const contentData = {
      id: content.id,
      title: content.title,
      slug: content.slug,
      status: content.status,
      body: bodyBlocks,
      metadata: content.metadata,
      exported_at: new Date().toISOString()
    }

    await octokit.repos.createOrUpdateFileContents({
      owner: website.github_owner,
      repo: website.github_repo,
      path: contentPath,
      message: 'Add content: ' + content.title,
      content: Buffer.from(JSON.stringify(contentData, null, 2)).toString('base64'),
      branch: branchName
    })
    console.log('✅ Created file:', contentPath)

    // Create PR
    const prBody = [
      '## Content Submission',
      '',
      '**Title:** ' + content.title,
      '**Status:** ' + content.status,
      '**Blocks:** ' + bodyBlocks.length,
      '',
      '### Summary',
      'Content for: ' + content.title,
      '',
      '---',
      '*Submitted via swarm.press workflow*'
    ].join('\n')

    const { data: pr } = await octokit.pulls.create({
      owner: website.github_owner,
      repo: website.github_repo,
      title: '[Content] ' + content.title,
      body: prBody,
      head: branchName,
      base: 'main'
    })

    console.log('\n✅ PR Created Successfully!')
    console.log('   PR Number: #' + pr.number)
    console.log('   PR URL:', pr.html_url)
    console.log('   State:', pr.state)

  } catch (error: any) {
    console.log('❌ Error:', error.message)
    if (error.response?.data) {
      console.log('   Details:', JSON.stringify(error.response.data, null, 2))
    }
  }

  await client.end()
  console.log('\n✅ Test complete!')
}

main().catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
