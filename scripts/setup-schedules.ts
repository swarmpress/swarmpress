#!/usr/bin/env tsx
/**
 * Setup Schedules Script
 * Creates default Temporal schedules for all websites
 *
 * Run this script:
 * - After bootstrap to initialize schedules
 * - On system startup to ensure schedules exist
 * - Manually when adding new websites
 *
 * Usage:
 *   tsx scripts/setup-schedules.ts
 *   tsx scripts/setup-schedules.ts --website-id <uuid>
 *   tsx scripts/setup-schedules.ts --dry-run
 */

import { db } from '../packages/backend/src/db/index.js'
import { scheduleRepository } from '../packages/backend/src/db/repositories/index.js'

// Import Temporal schedule manager
async function getScheduleManager() {
  const { temporalClient, scheduleManager, SCHEDULE_FREQUENCIES, DEFAULT_CRON_EXPRESSIONS, SCHEDULE_DESCRIPTIONS } =
    await import('@swarm-press/workflows')
  return { temporalClient, scheduleManager, SCHEDULE_FREQUENCIES, DEFAULT_CRON_EXPRESSIONS, SCHEDULE_DESCRIPTIONS }
}

interface SetupConfig {
  websiteId?: string
  dryRun?: boolean
  force?: boolean
}

interface Website {
  id: string
  domain: string
  title: string
  status: string
}

type ScheduleType = 'scheduled-content' | 'media-check' | 'link-validation' | 'stale-content'

/**
 * Get all active websites
 */
async function getActiveWebsites(websiteId?: string): Promise<Website[]> {
  if (websiteId) {
    const result = await db.query<Website>(
      'SELECT id, domain, title, status FROM websites WHERE id = $1',
      [websiteId]
    )
    return result.rows
  }

  const result = await db.query<Website>(
    'SELECT id, domain, title, status FROM websites WHERE status = $1 ORDER BY domain',
    ['active']
  )
  return result.rows
}

/**
 * Setup schedules for a single website
 */
async function setupSchedulesForWebsite(
  website: Website,
  config: SetupConfig,
  manager: Awaited<ReturnType<typeof getScheduleManager>>
): Promise<{ created: string[]; skipped: string[]; failed: string[] }> {
  const { scheduleManager, SCHEDULE_FREQUENCIES, DEFAULT_CRON_EXPRESSIONS, SCHEDULE_DESCRIPTIONS } = manager
  const scheduleTypes: ScheduleType[] = ['scheduled-content', 'media-check', 'link-validation', 'stale-content']

  const created: string[] = []
  const skipped: string[] = []
  const failed: string[] = []

  console.log(`\n  Website: ${website.domain} (${website.id})`)

  for (const scheduleType of scheduleTypes) {
    const scheduleId = `${website.id}-${scheduleType}`

    try {
      // Check if schedule already exists in database
      const existing = await scheduleRepository.findScheduleByType(website.id, scheduleType)

      if (existing && !config.force) {
        console.log(`    - ${scheduleType}: Already exists (skipping)`)
        skipped.push(scheduleType)
        continue
      }

      if (config.dryRun) {
        console.log(`    - ${scheduleType}: Would create (dry run)`)
        console.log(`      Cron: ${DEFAULT_CRON_EXPRESSIONS[scheduleType]}`)
        console.log(`      Frequency: ${SCHEDULE_FREQUENCIES[scheduleType]}`)
        created.push(scheduleType)
        continue
      }

      // Create in Temporal
      try {
        await scheduleManager.createSchedule({
          websiteId: website.id,
          scheduleType,
          cronExpression: DEFAULT_CRON_EXPRESSIONS[scheduleType],
        })
        console.log(`    - ${scheduleType}: Created in Temporal`)
      } catch (temporalError) {
        // Schedule might already exist in Temporal
        if (String(temporalError).includes('already exists')) {
          console.log(`    - ${scheduleType}: Already exists in Temporal`)
        } else {
          throw temporalError
        }
      }

      // Create/update in database
      await scheduleRepository.upsertSchedule({
        website_id: website.id,
        schedule_type: scheduleType,
        frequency: SCHEDULE_FREQUENCIES[scheduleType] as 'daily' | 'weekly' | 'monthly',
        temporal_schedule_id: scheduleId,
        cron_expression: DEFAULT_CRON_EXPRESSIONS[scheduleType],
        enabled: true,
      })

      console.log(`    - ${scheduleType}: Created (${SCHEDULE_FREQUENCIES[scheduleType]})`)
      created.push(scheduleType)
    } catch (error) {
      console.error(`    - ${scheduleType}: Failed - ${error instanceof Error ? error.message : error}`)
      failed.push(scheduleType)
    }
  }

  return { created, skipped, failed }
}

/**
 * Main setup function
 */
async function setupSchedules(config: SetupConfig = {}): Promise<void> {
  console.log('\n🕐 Setting up autonomous agent schedules\n')
  console.log('=' .repeat(60))

  if (config.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n')
  }

  if (config.force) {
    console.log('⚠️  FORCE MODE - Existing schedules will be recreated\n')
  }

  try {
    // Connect to Temporal
    console.log('📡 Connecting to Temporal...')
    const manager = await getScheduleManager()
    const { temporalClient } = manager

    if (!temporalClient.isConnected()) {
      await temporalClient.connect()
    }
    console.log('✅ Temporal connected\n')

    // Get websites
    const websites = await getActiveWebsites(config.websiteId)

    if (websites.length === 0) {
      console.log('⚠️  No active websites found')
      if (config.websiteId) {
        console.log(`   Website ID ${config.websiteId} not found or not active`)
      }
      return
    }

    console.log(`📋 Found ${websites.length} website(s) to configure:`)

    let totalCreated = 0
    let totalSkipped = 0
    let totalFailed = 0

    // Setup schedules for each website
    for (const website of websites) {
      const { created, skipped, failed } = await setupSchedulesForWebsite(website, config, manager)
      totalCreated += created.length
      totalSkipped += skipped.length
      totalFailed += failed.length
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 Summary:')
    console.log(`   Created: ${totalCreated}`)
    console.log(`   Skipped: ${totalSkipped}`)
    console.log(`   Failed:  ${totalFailed}`)

    if (totalFailed > 0) {
      console.log('\n⚠️  Some schedules failed to create. Check errors above.')
    } else {
      console.log('\n✅ Schedule setup completed successfully!')
    }

    if (config.dryRun) {
      console.log('\n📝 Run without --dry-run to apply changes')
    }

    // List schedule info
    if (!config.dryRun && totalCreated > 0) {
      console.log('\n📅 Schedule Configuration:')
      console.log('   scheduled-content: Daily at 6:00 AM')
      console.log('   media-check:       Daily at 7:00 AM')
      console.log('   link-validation:   Weekly on Monday at 8:00 AM')
      console.log('   stale-content:     Monthly on 1st at 9:00 AM')
      console.log('\n💡 View schedules in Temporal UI: http://localhost:8233/namespaces/default/schedules')
    }
  } catch (error) {
    console.error('\n❌ Schedule setup failed:', error)
    process.exit(1)
  }
}

// Parse CLI arguments
const args = process.argv.slice(2)
const config: SetupConfig = {
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
}

// Parse --website-id argument
const websiteIdIndex = args.indexOf('--website-id')
if (websiteIdIndex !== -1 && args[websiteIdIndex + 1]) {
  config.websiteId = args[websiteIdIndex + 1]
}

// Run setup
setupSchedules(config).then(() => {
  process.exit(0)
}).catch((error) => {
  console.error('Setup failed:', error)
  process.exit(1)
})
