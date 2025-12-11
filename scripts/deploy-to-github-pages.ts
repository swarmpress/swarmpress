#!/usr/bin/env tsx
/**
 * Deploy to GitHub Pages
 * Builds the site from GitHub content and deploys to GitHub Pages
 */

import dotenv from 'dotenv'
import { resolve, join } from 'path'
import { readdir, readFile } from 'fs/promises'

// Load environment variables FIRST
dotenv.config({ path: resolve(__dirname, '../.env') })

const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'
const API_URL = 'http://localhost:3000'

async function collectFiles(dir: string, basePath: string = ''): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = []
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, relativePath)
      files.push(...subFiles)
    } else {
      const content = await readFile(fullPath, 'utf-8')
      files.push({ path: relativePath, content })
    }
  }

  return files
}

async function deployToGitHubPages() {
  console.log('\n🚀 Deploying cinqueterre.travel to GitHub Pages\n')

  // Dynamic import to ensure env is loaded first
  const { db } = await import('../packages/backend/src/db/connection')

  try {
    // Get GitHub credentials from database
    const result = await db.query(
      'SELECT github_owner, github_repo, github_access_token, github_pages_enabled FROM websites WHERE id = $1',
      [WEBSITE_ID]
    )

    if (!result.rows[0]) {
      throw new Error('Website not found')
    }

    const { github_owner, github_repo, github_access_token, github_pages_enabled } = result.rows[0]

    if (!github_access_token) {
      throw new Error('GitHub access token not configured')
    }

    if (!github_pages_enabled) {
      throw new Error('GitHub Pages is not enabled for this website')
    }

    console.log(`📦 Building from: ${github_owner}/${github_repo}`)

    // Import buildFromGitHub
    const { buildFromGitHub } = await import('../packages/site-builder/src/generator/github-build')

    console.log('\n🏗️  Building site...\n')

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

    if (!buildResult.success) {
      throw new Error(`Build failed: ${buildResult.error}`)
    }

    console.log(`✅ Build completed in ${buildResult.buildTime}ms`)
    console.log(`   Pages: ${buildResult.pagesGenerated}, Collections: ${buildResult.collectionsGenerated}`)

    // Collect files from dist directory
    // buildResult.outputDir already points to .../dist
    const distDir = buildResult.outputDir!
    console.log(`\n📁 Collecting files from ${distDir}...`)

    const files = await collectFiles(distDir)
    console.log(`   Found ${files.length} files`)

    // Deploy to GitHub Pages via API
    console.log('\n📤 Deploying to GitHub Pages...')

    const response = await fetch(`${API_URL}/api/trpc/github.deployToPages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        json: {
          websiteId: WEBSITE_ID,
          files,
          commitMessage: `Deploy: ${new Date().toISOString()}`,
        },
      }),
    })

    const data = await response.json()

    if (!response.ok || data.error) {
      const errorMsg = data.error?.json?.message || data.error?.message || 'Deployment failed'
      throw new Error(errorMsg)
    }

    const deployResult = data.result?.data?.json || data.result?.data

    console.log('\n✅ Deployment successful!')
    console.log(`   URL: ${deployResult?.pagesUrl}`)
    console.log(`   Commit: ${deployResult?.commitSha}`)
    console.log(`   Files deployed: ${deployResult?.filesDeployed}`)

    await db.close()
  } catch (error) {
    await db.close()
    throw error
  }
}

deployToGitHubPages().catch(error => {
  console.error('\n❌ Deployment failed:', error)
  process.exit(1)
})
