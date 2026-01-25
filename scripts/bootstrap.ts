#!/usr/bin/env tsx
/**
 * Bootstrap Script
 * Initializes swarm.press system from scratch
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

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
    { name: 'docker-compose', version: 'latest' },
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
 * Start Docker services
 */
function startDocker(): void {
  console.log('\n🐳 Starting Docker services...')

  // Check if Docker is running
  try {
    execSync('docker info', { stdio: 'ignore' })
  } catch {
    console.error('❌ Docker is not running. Please start Docker Desktop.')
    process.exit(1)
  }

  // Start services
  exec('docker-compose up -d', 'Starting PostgreSQL, NATS, and Temporal')

  // Wait for services to be ready
  console.log('\n⏳ Waiting for services to be ready (15 seconds)...')
  execSync('sleep 15', { stdio: 'inherit' })

  // Check service health
  try {
    exec('docker-compose ps', 'Checking service status')
  } catch {
    console.warn('⚠️  Some services may not be healthy. Check docker-compose ps')
  }
}

/**
 * Install dependencies
 */
function installDependencies(): void {
  exec('pnpm install', 'Installing dependencies')
}

/**
 * Build packages
 */
function buildPackages(): void {
  exec('pnpm build', 'Building all packages')
}

/**
 * Run database migrations
 */
function runMigrations(): void {
  console.log('\n🗄️  Running database migrations...')

  const migrationsDir = join(process.cwd(), 'packages/backend/migrations')
  if (!existsSync(migrationsDir)) {
    console.error('❌ Migrations directory not found')
    process.exit(1)
  }

  // Run migrations in order
  const migrations = [
    '001_initial_schema.sql',
    '002_state_audit_log.sql',
  ]

  for (const migration of migrations) {
    const file = join(migrationsDir, migration)
    if (existsSync(file)) {
      exec(
        `psql $DATABASE_URL -f ${file}`,
        `Applying migration: ${migration}`
      )
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
 * Seed initial data
 */
function seedData(): void {
  console.log('\n🌱 Seeding initial data...')
  exec('tsx scripts/seed.ts', 'Running seed script')
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
      runMigrations()
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
    process.exit(1)
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
