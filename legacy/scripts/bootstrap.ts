#!/usr/bin/env tsx
/**
 * Bootstrap Script
 * Initializes swarm.press system from scratch.
 *
 * Designed to be idempotent - re-running should be a fast no-op when nothing
 * has changed. Each step short-circuits if the work has already been done.
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

// NB: the backend `db` singleton is imported lazily inside runMigrations() so
// that environment validation (which it triggers eagerly at module load) does
// not run before checkEnv() has had a chance to surface a friendly error.
type DbModule = typeof import('../packages/backend/src/db/connection')
let dbModule: DbModule | null = null
async function getDb(): Promise<DbModule['db']> {
  if (!dbModule) {
    dbModule = await import('../packages/backend/src/db/connection')
  }
  return dbModule.db
}

interface BootstrapConfig {
  skipDocker?: boolean
  skipMigrations?: boolean
  skipSeeding?: boolean
  skipGitHub?: boolean
  skipSchedules?: boolean
}

/**
 * Execute command and log output
 */
function exec(command: string, description: string): void {
  console.log(`\n📦 ${description}...`)
  try {
    execSync(command, { stdio: 'inherit', cwd: process.cwd() })
    console.log(`✅ ${description} completed`)
  } catch (error) {
    console.error(`❌ ${description} failed`)
    throw error
  }
}

/**
 * Execute command and capture stdout (for idempotency checks)
 */
function execCapture(command: string): string {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return ''
  }
}

/**
 * Check if command exists
 */
function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Check environment variables
 */
function checkEnv(): void {
  console.log('\n🔍 Checking environment configuration...')

  const envFile = join(process.cwd(), '.env')
  if (!existsSync(envFile)) {
    console.error('❌ .env file not found')
    console.log('📝 Copy .env.example to .env and configure:')
    console.log('   cp .env.example .env')
    process.exit(1)
  }

  const env = readFileSync(envFile, 'utf-8')
  const required = [
    'DATABASE_URL',
    'NATS_URL',
    'TEMPORAL_URL',
    'ANTHROPIC_API_KEY',
  ]

  const missing: string[] = []
  for (const key of required) {
    if (!env.includes(`${key}=`) || env.includes(`${key}=your_`)) {
      missing.push(key)
    }
  }

  if (missing.length > 0) {
    console.error(`❌ Missing or unconfigured environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  console.log('✅ Environment configuration valid')
}

/**
 * Check required tools
 */
function checkTools(): void {
  console.log('\n🔧 Checking required tools...')

  const required = [
    { name: 'node', version: 'v18+' },
    { name: 'pnpm', version: '8+' },
    { name: 'docker', version: 'latest' },
  ]

  for (const tool of required) {
    if (!commandExists(tool.name)) {
      console.error(`❌ ${tool.name} not found (required: ${tool.version})`)
      process.exit(1)
    }
    console.log(`✅ ${tool.name} installed`)
  }
}

/**
 * Start Docker services (idempotent)
 */
function startDocker(): void {
  console.log('\n🐳 Starting Docker services...')

  // Check if Docker daemon is running
  try {
    execSync('docker info', { stdio: 'ignore' })
  } catch {
    console.error('❌ Docker is not running. Please start Docker Desktop.')
    process.exit(1)
  }

  // Idempotency: skip startup if all required services are already running
  const required = ['postgres', 'nats', 'temporal']
  const running = execCapture('docker compose ps --status running --services')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const missing = required.filter((svc) => !running.includes(svc))
  if (missing.length === 0) {
    console.log('✅ Docker services already running (postgres, nats, temporal) - skipping')
    return
  }

  console.log(`   Starting missing services: ${missing.join(', ')}`)
  exec('docker compose up -d', 'Starting PostgreSQL, NATS, and Temporal')

  // Wait for services to be ready
  console.log('\n⏳ Waiting for services to be ready (15 seconds)...')
  execSync('sleep 15', { stdio: 'inherit' })

  // Check service health
  try {
    exec('docker compose ps', 'Checking service status')
  } catch {
    console.warn('⚠️  Some services may not be healthy. Check docker compose ps')
  }
}

/**
 * Cache file used to short-circuit pnpm install when nothing has changed.
 */
const INSTALL_CACHE = join(process.cwd(), 'node_modules', '.swarmpress-install-cache')

/**
 * Install dependencies (idempotent: skip when node_modules exists and
 * pnpm-lock.yaml hasn't changed since last install).
 */
function installDependencies(): void {
  const nodeModules = join(process.cwd(), 'node_modules')
  const lockFile = join(process.cwd(), 'pnpm-lock.yaml')

  if (existsSync(nodeModules) && existsSync(lockFile) && existsSync(INSTALL_CACHE)) {
    try {
      const lockMtime = statSync(lockFile).mtimeMs
      const cacheMtime = parseFloat(readFileSync(INSTALL_CACHE, 'utf-8').trim())
      if (!Number.isNaN(cacheMtime) && cacheMtime >= lockMtime) {
        console.log('\n📦 Dependencies up to date (pnpm-lock.yaml unchanged) - skipping install')
        return
      }
    } catch {
      // fall through to install
    }
  }

  exec('pnpm install', 'Installing dependencies')

  // Record the lockfile mtime so subsequent runs can short-circuit
  try {
    if (existsSync(lockFile)) {
      mkdirSync(nodeModules, { recursive: true })
      writeFileSync(INSTALL_CACHE, String(statSync(lockFile).mtimeMs))
    }
  } catch (error) {
    console.warn(`⚠️  Could not write install cache: ${(error as Error).message}`)
  }
}

/**
 * Build packages
 */
function buildPackages(): void {
  exec('pnpm build', 'Building all packages')
}

/**
 * Run database migrations.
 *
 * Reads every *.sql file from packages/backend/src/db/migrations/ in
 * lexicographic order and executes each via the existing pg connection pool.
 * The master schema (000_schema.sql) is fully idempotent (CREATE ... IF NOT
 * EXISTS, ALTER ... IF EXISTS, DROP TRIGGER ... IF EXISTS), so re-running
 * bootstrap is safe.
 */
async function runMigrations(): Promise<void> {
  console.log('\n🗄️  Running database migrations...')

  const migrationsDir = join(process.cwd(), 'packages/backend/src/db/migrations')
  if (!existsSync(migrationsDir)) {
    console.error(`❌ Migrations directory not found: ${migrationsDir}`)
    process.exit(1)
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort() // lexicographic order: 000_schema.sql comes first

  if (files.length === 0) {
    console.warn('⚠️  No migration files found')
    return
  }

  const db = await getDb()

  for (const file of files) {
    const fullPath = join(migrationsDir, file)
    console.log(`   Applying ${file}...`)
    let sql: string
    try {
      sql = readFileSync(fullPath, 'utf-8')
    } catch (error) {
      throw new Error(`Failed to read migration ${file}: ${(error as Error).message}`)
    }

    // psql meta-commands like \echo and \set are not understood by the pg
    // protocol; strip lines starting with a backslash before submission.
    const cleaned = sql
      .split('\n')
      .filter((line) => !/^\s*\\/.test(line))
      .join('\n')

    try {
      await db.query(cleaned)
      console.log(`   ✅ ${file}`)
    } catch (error) {
      const err = error as Error & { position?: string; detail?: string }
      const detail = err.detail ? ` (${err.detail})` : ''
      throw new Error(`Migration ${file} failed: ${err.message}${detail}`)
    }
  }

  console.log('✅ Database migrations completed')
}

/**
 * Setup autonomous agent schedules
 */
function setupSchedules(): void {
  console.log('\n🕐 Setting up autonomous agent schedules...')

  try {
    exec('tsx scripts/setup-schedules.ts', 'Creating Temporal schedules for websites')
  } catch (error) {
    console.warn('⚠️  Schedule setup failed. Run manually: tsx scripts/setup-schedules.ts')
    // Don't fail bootstrap if schedules fail - they can be set up later
  }
}

/**
 * Initialize GitHub repository
 */
function initializeGitHub(): void {
  console.log('\n🐙 GitHub initialization...')

  const hasToken = process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN !== 'ghp_your_token_here'
  const hasRepo = process.env.GITHUB_OWNER && process.env.GITHUB_REPO

  if (!hasToken || !hasRepo) {
    console.log('⚠️  GitHub not configured. Skipping.')
    console.log('📝 To enable GitHub collaboration:')
    console.log('   1. Create a GitHub repository')
    console.log('   2. Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO in .env')
    console.log('   3. Configure webhook: https://your-api.com/api/webhooks/github')
    return
  }

  console.log('✅ GitHub configured')
  console.log(`   Repository: ${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`)
  console.log('   Remember to configure webhook in GitHub repository settings!')
}

/**
 * Seed initial data. Idempotent: re-running should be a no-op (or at worst a
 * detected duplicate). The seed script is invoked with --upsert so it can
 * decide to upsert rather than insert; we additionally swallow errors that
 * indicate the seed has already been applied.
 */
function seedData(): void {
  console.log('\n🌱 Seeding initial data...')
  try {
    exec('tsx scripts/seed.ts --upsert', 'Running seed script')
  } catch (error) {
    const message = (error as Error).message || ''
    if (/already seeded|duplicate key|unique constraint/i.test(message)) {
      console.log('ℹ️  Seed data already present - continuing')
      return
    }
    console.warn('⚠️  Seed script failed (continuing):', message)
  }
}

/**
 * Main bootstrap function
 */
async function bootstrap(config: BootstrapConfig = {}): Promise<void> {
  console.log('🚀 swarm.press Bootstrap\n')
  console.log('=' .repeat(60))

  try {
    // Pre-flight checks
    checkTools()
    checkEnv()

    // Start infrastructure
    if (!config.skipDocker) {
      startDocker()
    }

    // Install and build
    installDependencies()
    buildPackages()

    // Database setup
    if (!config.skipMigrations) {
      await runMigrations()
    }

    // Seed data
    if (!config.skipSeeding) {
      seedData()
    }

    // GitHub setup
    if (!config.skipGitHub) {
      initializeGitHub()
    }

    // Autonomous agent schedules
    if (!config.skipSchedules) {
      setupSchedules()
    }

    console.log('\n' + '='.repeat(60))
    console.log('✨ Bootstrap completed successfully!\n')
    console.log('Next steps:')
    console.log('  1. Start the API server: pnpm --filter @swarm-press/backend dev')
    console.log('  2. Start Temporal worker: pnpm --filter @swarm-press/workflows dev')
    console.log('  3. Access API: http://localhost:3000')
    console.log('  4. View health: http://localhost:3000/health')
    console.log('\n📚 Documentation: docs/README.md')
    console.log('🐙 GitHub: Configure webhook if not already done')
    console.log('')
  } catch (error) {
    console.error('\n❌ Bootstrap failed:', error)
    process.exitCode = 1
  } finally {
    // Always close the DB pool so the process exits cleanly (only if we
    // actually constructed it during runMigrations).
    if (dbModule) {
      try {
        await dbModule.db.close()
      } catch {
        // ignore
      }
    }
  }
}

// Parse CLI arguments
const args = process.argv.slice(2)
const config: BootstrapConfig = {
  skipDocker: args.includes('--skip-docker'),
  skipMigrations: args.includes('--skip-migrations'),
  skipSeeding: args.includes('--skip-seeding'),
  skipGitHub: args.includes('--skip-github'),
  skipSchedules: args.includes('--skip-schedules'),
}

// Run bootstrap
bootstrap(config)
