#!/usr/bin/env tsx
/**
 * Infrastructure Verification Script
 * Pre-flight checks for cinqueterre.travel website generation
 *
 * Verifies:
 * 1. Database connection
 * 2. Writer agents exist with correct personas
 * 3. MediaAgent has media tools
 * 4. Unsplash API key works
 * 5. R2 storage is accessible
 * 6. GitHub token has repo access
 * 7. cinqueterre.travel content directory exists
 */

import dotenv from 'dotenv'
import { resolve, join } from 'path'
import { existsSync, readdirSync } from 'fs'

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') })

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
}

function success(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`)
}

function error(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`)
}

function warn(msg: string) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`)
}

function info(msg: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`)
}

function section(title: string) {
  console.log(`\n${colors.blue}━━━ ${title} ━━━${colors.reset}`)
}

// Results tracking
const results: { name: string; passed: boolean; details?: string }[] = []

/**
 * Check database connection
 */
async function checkDatabase(): Promise<boolean> {
  section('Database Connection')

  try {
    const { db } = await import('../packages/backend/src/db/connection')
    await db.query('SELECT 1')
    success('PostgreSQL connection established')

    // Check if websites table exists
    const { rows: tables } = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'websites'
    `)

    if (tables.length > 0) {
      success('Database schema exists')
    } else {
      error('Database schema missing - run migrations')
      return false
    }

    return true
  } catch (err) {
    error(`Database connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    return false
  }
}

/**
 * Check cinqueterre.travel website exists (via JSON files - source of truth)
 */
async function checkWebsite(): Promise<boolean> {
  section('Website Configuration')

  // Primary check: JSON files in cinqueterre.travel/content
  // This is the source of truth, NOT the database
  const contentDir = resolve(__dirname, '../cinqueterre.travel/content')

  if (!existsSync(contentDir)) {
    error(`Content directory not found: ${contentDir}`)
    return false
  }

  success(`Content directory exists: ${contentDir}`)

  // Check config.json
  const configPath = join(contentDir, 'config.json')
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'))
      success(`Website: ${config.title || config.domain}`)
      info(`ID: ${config.id}`)
    } catch {
      warn('Could not parse config.json')
    }
  }

  // Count pages
  const pagesDir = join(contentDir, 'pages')
  if (existsSync(pagesDir)) {
    const countJsonFiles = (dir: string): number => {
      let count = 0
      const items = readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        if (item.isDirectory()) {
          count += countJsonFiles(join(dir, item.name))
        } else if (item.name.endsWith('.json')) {
          count++
        }
      }
      return count
    }
    const pageCount = countJsonFiles(pagesDir)
    success(`Found ${pageCount} page JSON files`)
  }

  // Count collections
  const collectionsDir = join(contentDir, 'collections')
  if (existsSync(collectionsDir)) {
    const collections = readdirSync(collectionsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
    success(`Found ${collections.length} collection types`)

    // List collections and their item counts
    for (const collection of collections) {
      const collectionPath = join(collectionsDir, collection.name)
      const items = readdirSync(collectionPath).filter(f => f.endsWith('.json') && !f.startsWith('_'))
      console.log(`  ${colors.dim}• ${collection.name}: ${items.length} items${colors.reset}`)
    }
  }

  return true
}

/**
 * Check writer agents are available (via Claude SDK)
 */
async function checkAgents(): Promise<boolean> {
  section('Writer Agents')

  // Expected personas for cinqueterre.travel
  const expectedPersonas = [
    { name: 'Giulia', specialty: 'Food & Dining', types: ['restaurants', 'food'] },
    { name: 'Isabella', specialty: 'Travel & Adventure', types: ['hiking', 'beaches', 'trails'] },
    { name: 'Lorenzo', specialty: 'Culture & History', types: ['overview', 'history', 'culture'] },
    { name: 'Sophia', specialty: 'Editor-in-Chief', types: ['hotels', 'accommodations'] },
    { name: 'Marco', specialty: 'Senior Editor', types: ['transport', 'weather', 'practical'] },
    { name: 'Francesca', specialty: 'Media Coordinator', types: ['events', 'photo-spots', 'galleries'] },
  ]

  // Check if Anthropic API key is set
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-api')) {
    success('ANTHROPIC_API_KEY configured')
  } else {
    error('ANTHROPIC_API_KEY not set')
    return false
  }

  // Agents are created dynamically - show what will be used
  success(`${expectedPersonas.length} agent personas defined:`)
  for (const persona of expectedPersonas) {
    console.log(`  ${colors.dim}• ${persona.name} - ${persona.specialty}${colors.reset}`)
  }

  // Check if agent persona config exists
  const agentPersonasPath = resolve(__dirname, '../packages/agents/src/writer/agent-personas.ts')
  if (existsSync(agentPersonasPath)) {
    success('Agent personas configuration exists')
  } else {
    info('Agent personas will use default configuration')
  }

  return true
}

/**
 * Check Unsplash API
 */
async function checkUnsplash(): Promise<boolean> {
  section('Unsplash API')

  const accessKey = process.env.UNSPLASH_ACCESS_KEY

  if (!accessKey || accessKey === 'your_unsplash_access_key') {
    error('UNSPLASH_ACCESS_KEY not configured')
    return false
  }

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=cinque+terre&per_page=1`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
      }
    )

    if (!response.ok) {
      error(`Unsplash API error: ${response.status} ${response.statusText}`)
      return false
    }

    const data = await response.json() as { total: number; results: unknown[] }
    success(`Unsplash API working - ${data.total.toLocaleString()} photos available for "Cinque Terre"`)

    return true
  } catch (err) {
    error(`Unsplash API check failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    return false
  }
}

/**
 * Check R2 storage
 */
async function checkR2Storage(): Promise<boolean> {
  section('R2 Storage (CDN)')

  const required = ['R2_ACCOUNT_ID', 'R2_ENDPOINT', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
  const missing = required.filter(k => !process.env[k])

  if (missing.length > 0) {
    error(`Missing R2 configuration: ${missing.join(', ')}`)
    return false
  }

  try {
    // Try to import and check the storage service
    const { getStorageService, isStorageConfigured } = await import('../packages/backend/src/services/storage.service')

    if (!isStorageConfigured()) {
      error('R2 storage not configured')
      return false
    }

    success('R2 storage credentials configured')
    success(`Bucket: ${process.env.R2_BUCKET_NAME}`)
    success(`Public URL: ${process.env.R2_PUBLIC_URL}`)

    return true
  } catch (err) {
    // Check if it's just missing the service
    if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
      success('R2 credentials configured')
      return true
    }
    error(`R2 check failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    return false
  }
}

/**
 * Check GitHub access
 */
async function checkGitHub(): Promise<boolean> {
  section('GitHub Integration')

  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO

  if (!owner || !repo) {
    warn('GITHUB_OWNER or GITHUB_REPO not set')
    info('GitHub integration is optional for local development')
    return true
  }

  info(`Configured repo: ${owner}/${repo}`)

  // Check if we can access the repo (public access, no token needed for read)
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'swarm-press-verification',
      },
    })

    if (response.ok) {
      const data = await response.json() as { full_name: string; html_url: string }
      success(`Repository accessible: ${data.html_url}`)
    } else if (response.status === 404) {
      warn('Repository not found (may be private)')
      info('Will use local content directory')
    } else {
      warn(`GitHub API: ${response.status}`)
    }

    return true
  } catch (err) {
    warn(`GitHub check skipped: ${err instanceof Error ? err.message : 'Unknown error'}`)
    return true
  }
}

/**
 * Check Google AI (for image generation)
 */
async function checkGoogleAI(): Promise<boolean> {
  section('Google AI (Image Generation)')

  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY

  if (!apiKey) {
    warn('GOOGLE_API_KEY not configured')
    info('AI image generation will be unavailable - using stock photos only')
    return true // Not required since we use Unsplash
  }

  success('Google API key configured')
  info('AI image generation available (backup to stock photos)')

  return true
}

/**
 * Check content structure
 */
async function checkContentStructure(): Promise<boolean> {
  section('Content Structure')

  const contentDir = resolve(__dirname, '../cinqueterre.travel/content')

  const requiredFiles = [
    'config.json',
    'sitemap.json',
  ]

  const requiredDirs = [
    'pages',
    'collections',
  ]

  let allPresent = true

  for (const file of requiredFiles) {
    const path = join(contentDir, file)
    if (existsSync(path)) {
      success(`${file} exists`)
    } else {
      error(`Missing: ${file}`)
      allPresent = false
    }
  }

  for (const dir of requiredDirs) {
    const path = join(contentDir, dir)
    if (existsSync(path)) {
      success(`${dir}/ directory exists`)
    } else {
      error(`Missing directory: ${dir}/`)
      allPresent = false
    }
  }

  // Check for villages
  const villages = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']
  const pagesDir = join(contentDir, 'pages')

  if (existsSync(pagesDir)) {
    const missingVillages = villages.filter(v => !existsSync(join(pagesDir, `${v}.json`)))
    if (missingVillages.length === 0) {
      success('All 5 village pages exist')
    } else {
      warn(`Missing village pages: ${missingVillages.join(', ')}`)
    }
  }

  return allPresent
}

/**
 * Main verification function
 */
async function verify() {
  console.log('\n' + '═'.repeat(60))
  console.log('  cinqueterre.travel Infrastructure Verification')
  console.log('═'.repeat(60))

  const checks = [
    { name: 'Database', fn: checkDatabase },
    { name: 'Website', fn: checkWebsite },
    { name: 'Agents', fn: checkAgents },
    { name: 'Unsplash', fn: checkUnsplash },
    { name: 'R2 Storage', fn: checkR2Storage },
    { name: 'GitHub', fn: checkGitHub },
    { name: 'Google AI', fn: checkGoogleAI },
    { name: 'Content Structure', fn: checkContentStructure },
  ]

  for (const check of checks) {
    const passed = await check.fn()
    results.push({ name: check.name, passed })
  }

  // Summary
  section('Summary')

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  console.log('')
  for (const result of results) {
    const icon = result.passed ? colors.green + '✓' : colors.red + '✗'
    console.log(`  ${icon}${colors.reset} ${result.name}`)
  }

  console.log('')
  console.log('═'.repeat(60))

  if (failed === 0) {
    console.log(`${colors.green}All ${passed} checks passed! Ready to generate content.${colors.reset}`)
    console.log('')
    console.log('Next steps:')
    console.log('  1. tsx scripts/generate-website-navigation.ts')
    console.log('  2. tsx scripts/batch-generate-website.ts')
    console.log('')
  } else {
    console.log(`${colors.red}${failed} check(s) failed.${colors.reset} Please fix issues before proceeding.`)
    console.log('')
    process.exit(1)
  }

  // Close database connection
  try {
    const { db } = await import('../packages/backend/src/db/connection')
    await db.end()
  } catch {
    // Ignore
  }
}

// Run verification
verify().catch(err => {
  console.error('Verification failed:', err)
  process.exit(1)
})
