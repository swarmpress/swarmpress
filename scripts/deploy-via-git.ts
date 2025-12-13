#!/usr/bin/env tsx
/**
 * Deploy to GitHub Pages via Git
 * Uses git operations instead of GitHub API to avoid rate limits
 */

import dotenv from 'dotenv'
import { resolve, join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { mkdir, rm, cp } from 'fs/promises'

const execAsync = promisify(exec)

// Load environment variables FIRST
dotenv.config({ path: resolve(__dirname, '../.env') })

const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'
const REPO_URL = 'https://github.com/swarmpress/cinqueterre.travel.git'
const TEMP_DIR = '/tmp/cinqueterre-deploy'

async function deployViaGit() {
  console.log('\n🚀 Deploying cinqueterre.travel to GitHub Pages via Git\n')

  // Dynamic import to ensure env is loaded first
  const { db } = await import('../packages/backend/src/db/connection')

  try {
    // Get GitHub credentials from database
    const result = await db.query(
      'SELECT github_owner, github_repo, github_access_token FROM websites WHERE id = $1',
      [WEBSITE_ID]
    )

    if (!result.rows[0]) {
      throw new Error('Website not found')
    }

    const { github_owner, github_repo, github_access_token } = result.rows[0]

    if (!github_access_token) {
      throw new Error('GitHub access token not configured')
    }

    console.log(`📦 Building from: ${github_owner}/${github_repo}`)

    // Import buildFromGitHub
    const { buildFromGitHub } = await import('../packages/site-builder/src/generator/github-build')

    // Path to local i18n pages
    const i18nPagesPath = resolve(__dirname, '../cinqueterre.travel/content/pages')

    console.log('\n🏗️  Building site with i18n pages...\n')
    console.log(`   i18n pages: ${i18nPagesPath}`)

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
      i18nPagesPath,  // Use local i18n pages instead of GitHub pages
    })

    if (!buildResult.success) {
      throw new Error(`Build failed: ${buildResult.error}`)
    }

    console.log(`✅ Build completed in ${buildResult.buildTime}ms`)
    console.log(`   Pages: ${buildResult.pagesGenerated}, Collections: ${buildResult.collectionsGenerated}`)

    const distDir = buildResult.outputDir!

    // Clone the repo (gh-pages branch)
    console.log('\n📥 Cloning repository (gh-pages branch)...')

    // Clean up any existing temp directory
    await rm(TEMP_DIR, { recursive: true, force: true })
    await mkdir(TEMP_DIR, { recursive: true })

    // Clone only gh-pages branch
    const repoUrlWithAuth = REPO_URL.replace('https://', `https://x-access-token:${github_access_token}@`)

    await execAsync(`git clone --branch gh-pages --single-branch --depth 1 "${repoUrlWithAuth}" "${TEMP_DIR}"`, {
      env: { ...process.env }
    })

    console.log('   ✅ Repository cloned')

    // Clear existing content (except .git)
    console.log('\n🗑️  Clearing old content...')

    // Remove all files and directories except .git
    await execAsync(`cd "${TEMP_DIR}" && find . -maxdepth 1 -not -name "." -not -name ".git" -exec rm -rf {} \\;`)

    console.log('   ✅ Old content cleared')

    // Copy new content
    console.log('\n📋 Copying new content...')
    await execAsync(`cp -r "${distDir}/"* "${TEMP_DIR}/"`)

    // Ensure CNAME file exists with correct domain
    await execAsync(`echo "cinqueterre.travel" > "${TEMP_DIR}/CNAME"`)

    const { stdout: fileCount } = await execAsync(`find "${TEMP_DIR}" -type f | wc -l`)
    console.log(`   ✅ Copied ${fileCount.trim()} files`)

    // Commit and push
    console.log('\n📤 Committing and pushing...')
    const commitMessage = `Deploy: ${new Date().toISOString()}`

    // Configure git user for the commit
    await execAsync(`cd "${TEMP_DIR}" && git config user.email "deploy@swarm.press"`)
    await execAsync(`cd "${TEMP_DIR}" && git config user.name "SwarmPress Deploy"`)

    await execAsync(`cd "${TEMP_DIR}" && git add -A`)

    try {
      await execAsync(`cd "${TEMP_DIR}" && git commit -m "${commitMessage}"`)
      await execAsync(`cd "${TEMP_DIR}" && git push origin gh-pages`)
      console.log('   ✅ Changes pushed to gh-pages')
    } catch (e: any) {
      if (e.message?.includes('nothing to commit')) {
        console.log('   ⚠️  No changes to commit')
      } else {
        throw e
      }
    }

    // Clean up
    console.log('\n🧹 Cleaning up...')
    await rm(TEMP_DIR, { recursive: true, force: true })
    console.log('   ✅ Temporary directory removed')

    // Update database
    await db.query(
      `UPDATE websites SET
        deployment_status = 'deployed',
        last_deployed_at = NOW()
      WHERE id = $1`,
      [WEBSITE_ID]
    )

    console.log('\n✅ Deployment successful!')
    console.log('   URL: https://cinqueterre.travel/')
    console.log('   Note: GitHub Pages may take a few minutes to update')

    await db.close()
  } catch (error) {
    await db.close()
    throw error
  }
}

deployViaGit().catch(error => {
  console.error('\n❌ Deployment failed:', error.message || error)
  process.exit(1)
})
