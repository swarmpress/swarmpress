#!/usr/bin/env tsx
/**
 * Test buildFromGitHub functionality
 * Tests building a static site from GitHub repository content
 */

import dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables FIRST
dotenv.config({ path: resolve(__dirname, '../.env') })

async function testBuildFromGitHub() {
  console.log('\n🏗️  Testing buildFromGitHub for cinqueterre.travel\n')

  // Dynamic import to ensure env is loaded first
  const { db } = await import('../packages/backend/src/db/connection')

  try {
    // Get GitHub credentials from database
    const result = await db.query(
      'SELECT github_owner, github_repo, github_access_token FROM websites WHERE id = $1',
      ['42b7e20d-7f6c-48aa-9e16-f610a84b79a6']
    )

    if (!result.rows[0]) {
      throw new Error('Website not found')
    }

    const { github_owner, github_repo, github_access_token } = result.rows[0]

    if (!github_access_token) {
      throw new Error('GitHub access token not configured')
    }

    console.log(`📦 Building from: ${github_owner}/${github_repo}`)
    console.log(`🔑 Token: ***${github_access_token.slice(-4)}`)

    // Import buildFromGitHub
    const { buildFromGitHub } = await import('../packages/site-builder/src/generator/github-build')

    console.log('\n🚀 Starting build...\n')

    const buildResult = await buildFromGitHub({
      github: {
        owner: github_owner,
        repo: github_repo,
        token: github_access_token,
        branch: 'main',
        contentPath: 'content/collections',
      },
      siteUrl: 'https://cinqueterre.travel',
      itemsPerPage: 12,
    })

    console.log('\n📊 Build Result:')
    console.log(`   Success: ${buildResult.success ? '✅' : '❌'}`)

    if (buildResult.success) {
      console.log(`   Output: ${buildResult.outputDir}`)
      console.log(`   URL: ${buildResult.url}`)
      console.log(`   Build time: ${buildResult.buildTime}ms`)
      console.log(`   Pages generated: ${buildResult.pagesGenerated}`)
      console.log(`   Collection pages: ${buildResult.collectionsGenerated}`)
    } else {
      console.log(`   Error: ${buildResult.error}`)
      await db.close()
      process.exit(1)
    }

    console.log('\n✅ Build test completed successfully!\n')
    await db.close()
  } catch (error) {
    await db.close()
    throw error
  }
}

testBuildFromGitHub().catch(error => {
  console.error('\n❌ Build test failed:', error)
  process.exit(1)
})
