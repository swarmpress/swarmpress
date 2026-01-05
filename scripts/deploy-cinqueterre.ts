#!/usr/bin/env tsx
/**
 * Deploy Script
 * Builds and deploys cinqueterre.travel to GitHub Pages
 */

import dotenv from 'dotenv'
import { resolve, join } from 'path'
import { existsSync, rmSync } from 'fs'
import { execSync, spawn } from 'child_process'

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') })

const ROOT_DIR = resolve(__dirname, '..')
const SITE_DIR = join(ROOT_DIR, 'cinqueterre.travel')
const DIST_DIR = join(SITE_DIR, 'dist')

// =============================================================================
// UTILITIES
// =============================================================================

function exec(command: string, options: { cwd?: string; silent?: boolean } = {}): string {
  const { cwd = ROOT_DIR, silent = false } = options

  if (!silent) {
    console.log(`   $ ${command}`)
  }

  try {
    return execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
    }) as string
  } catch (error) {
    throw error
  }
}

function execSilent(command: string, cwd: string = ROOT_DIR): string {
  try {
    return execSync(command, { cwd, encoding: 'utf-8', stdio: 'pipe' })
  } catch {
    return ''
  }
}

// =============================================================================
// BUILD STEPS
// =============================================================================

async function checkPrerequisites(): Promise<boolean> {
  console.log('\n🔍 Checking prerequisites...')

  // Check if site directory exists
  if (!existsSync(SITE_DIR)) {
    console.error('   ❌ cinqueterre.travel directory not found')
    return false
  }
  console.log('   ✓ Site directory exists')

  // Check if content exists
  const contentDir = join(SITE_DIR, 'content')
  if (!existsSync(contentDir)) {
    console.error('   ❌ Content directory not found')
    return false
  }
  console.log('   ✓ Content directory exists')

  // Check if config exists
  const configDir = join(contentDir, 'config')
  if (!existsSync(configDir)) {
    console.warn('   ⚠ Config directory not found - run generate-website-navigation.ts first')
  } else {
    console.log('   ✓ Config directory exists')
  }

  // Check git status
  const gitStatus = execSilent('git status --porcelain', SITE_DIR)
  if (gitStatus.trim()) {
    console.log('   ℹ Uncommitted changes in cinqueterre.travel')
  } else {
    console.log('   ✓ Git working directory clean')
  }

  return true
}

async function buildSite(): Promise<boolean> {
  console.log('\n🔨 Building site...')

  // Clean dist directory
  if (existsSync(DIST_DIR)) {
    console.log('   Cleaning dist directory...')
    rmSync(DIST_DIR, { recursive: true, force: true })
  }

  // Run Astro build
  try {
    console.log('   Running Astro build...')

    // Check if we're in the monorepo
    const buildScript = join(SITE_DIR, 'build-and-deploy.sh')
    if (existsSync(buildScript)) {
      exec('bash build-and-deploy.sh', { cwd: SITE_DIR })
    } else {
      // Direct astro build
      exec('npx astro build', { cwd: SITE_DIR })
    }

    console.log('   ✓ Build completed')
    return true
  } catch (error) {
    console.error('   ❌ Build failed')
    return false
  }
}

async function deployToGitHubPages(): Promise<boolean> {
  console.log('\n🚀 Deploying to GitHub Pages...')

  // Check if dist exists
  if (!existsSync(DIST_DIR)) {
    console.error('   ❌ Dist directory not found - build first')
    return false
  }

  try {
    // Get current branch
    const currentBranch = execSilent('git branch --show-current', SITE_DIR).trim()
    console.log(`   Current branch: ${currentBranch}`)

    // Check if gh-pages branch exists
    const branches = execSilent('git branch -a', SITE_DIR)
    const hasGhPages = branches.includes('gh-pages')

    if (hasGhPages) {
      console.log('   gh-pages branch exists')
    } else {
      console.log('   Creating gh-pages branch...')
      exec('git checkout --orphan gh-pages', { cwd: SITE_DIR, silent: true })
      exec('git rm -rf .', { cwd: SITE_DIR, silent: true })
      exec('git checkout main -- .', { cwd: SITE_DIR, silent: true })
      exec('git checkout main', { cwd: SITE_DIR, silent: true })
    }

    // Deploy using gh-pages or direct push
    console.log('   Deploying dist to gh-pages branch...')

    // Use npx gh-pages
    exec(`npx gh-pages -d dist -b gh-pages -m "Deploy: ${new Date().toISOString()}"`, { cwd: SITE_DIR })

    console.log('   ✓ Deployed to GitHub Pages')
    return true
  } catch (error) {
    console.error(`   ❌ Deploy failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return false
  }
}

async function verifyDeployment(): Promise<boolean> {
  console.log('\n🔍 Verifying deployment...')

  // Get GitHub repo info from env
  const owner = process.env.GITHUB_OWNER || 'swarmpress'
  const repo = process.env.GITHUB_REPO || 'cinqueterre.travel'
  const url = `https://${owner}.github.io/${repo}/`

  console.log(`   Site URL: ${url}`)

  // Wait for deployment
  console.log('   Waiting for deployment to propagate (30s)...')
  await new Promise(resolve => setTimeout(resolve, 30000))

  // Try to fetch the site
  try {
    const response = await fetch(url, { method: 'HEAD' })
    if (response.ok) {
      console.log('   ✓ Site is accessible')
      return true
    } else {
      console.warn(`   ⚠ Site returned ${response.status}`)
      return false
    }
  } catch {
    console.warn('   ⚠ Could not verify site accessibility')
    return false
  }
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
  const args = process.argv.slice(2)
  const skipBuild = args.includes('--skip-build')
  const skipDeploy = args.includes('--skip-deploy')
  const skipVerify = args.includes('--skip-verify')

  console.log('\n' + '═'.repeat(60))
  console.log('  cinqueterre.travel Deploy Pipeline')
  console.log('═'.repeat(60))

  // Prerequisites
  const prereqOk = await checkPrerequisites()
  if (!prereqOk) {
    console.error('\n❌ Prerequisites check failed')
    process.exit(1)
  }

  // Build
  if (!skipBuild) {
    const buildOk = await buildSite()
    if (!buildOk) {
      console.error('\n❌ Build failed')
      process.exit(1)
    }
  } else {
    console.log('\n⏭️  Skipping build (--skip-build)')
  }

  // Deploy
  if (!skipDeploy) {
    const deployOk = await deployToGitHubPages()
    if (!deployOk) {
      console.error('\n❌ Deploy failed')
      process.exit(1)
    }
  } else {
    console.log('\n⏭️  Skipping deploy (--skip-deploy)')
  }

  // Verify
  if (!skipVerify && !skipDeploy) {
    await verifyDeployment()
  }

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('  Deploy Complete')
  console.log('═'.repeat(60))

  const owner = process.env.GITHUB_OWNER || 'swarmpress'
  const repo = process.env.GITHUB_REPO || 'cinqueterre.travel'

  console.log(`\n   📍 Site URL: https://${owner}.github.io/${repo}/`)
  console.log(`   📂 Repository: https://github.com/${owner}/${repo}`)
  console.log('')
  console.log('   To use custom domain (cinqueterre.travel):')
  console.log('   1. Go to repository Settings > Pages')
  console.log('   2. Set custom domain to: cinqueterre.travel')
  console.log('   3. Configure DNS A records to GitHub IPs')
  console.log('')
}

main().catch(err => {
  console.error('Deploy failed:', err)
  process.exit(1)
})
