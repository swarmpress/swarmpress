#!/usr/bin/env tsx
/**
 * Infrastructure Verification Script
 *
 * Verifies all required infrastructure is running:
 * - PostgreSQL database
 * - NATS event bus
 * - Temporal workflow engine
 * - Backend API server
 * - Weather API endpoint
 *
 * Usage:
 *   tsx scripts/verify-infrastructure.ts
 *   tsx scripts/verify-infrastructure.ts --fix  # Attempt to start missing services
 */

import pg from 'pg'

// Configuration
const config = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://swarmpress:swarmpress@localhost:5432/swarmpress',
  },
  nats: {
    url: process.env.NATS_URL || 'nats://localhost:4222',
    monitoringUrl: 'http://localhost:8222',
  },
  temporal: {
    url: process.env.TEMPORAL_URL || 'localhost:7233',
    uiUrl: 'http://localhost:8233',
  },
  api: {
    url: process.env.API_URL || 'http://localhost:3000',
  },
}

interface CheckResult {
  name: string
  status: 'ok' | 'error' | 'warning'
  message: string
  details?: string
}

const results: CheckResult[] = []

function log(result: CheckResult) {
  const icon = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌'
  console.log(`${icon} ${result.name}: ${result.message}`)
  if (result.details) {
    console.log(`   ${result.details}`)
  }
  results.push(result)
}

async function checkPostgres(): Promise<void> {
  console.log('\n📦 Checking PostgreSQL...')

  try {
    const client = new pg.Client({ connectionString: config.database.url })
    await client.connect()

    // Check connection
    const result = await client.query('SELECT NOW() as time, current_database() as db')
    const { time, db } = result.rows[0]

    log({
      name: 'PostgreSQL Connection',
      status: 'ok',
      message: `Connected to database "${db}"`,
      details: `Server time: ${time}`,
    })

    // Check for required tables
    const tablesResult = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    const tables = tablesResult.rows.map(r => r.table_name)

    const requiredTables = ['websites', 'content_items', 'agents', 'tasks', 'pages']
    const missingTables = requiredTables.filter(t => !tables.includes(t))

    if (missingTables.length === 0) {
      log({
        name: 'Database Schema',
        status: 'ok',
        message: `All ${requiredTables.length} required tables exist`,
        details: `Total tables: ${tables.length}`,
      })
    } else {
      log({
        name: 'Database Schema',
        status: 'error',
        message: `Missing tables: ${missingTables.join(', ')}`,
        details: 'Run: tsx scripts/bootstrap.ts',
      })
    }

    // Check for Cinque Terre website
    const websiteResult = await client.query(`
      SELECT id, domain, title FROM websites
      WHERE domain LIKE '%cinqueterre%' OR title LIKE '%Cinque Terre%'
      LIMIT 1
    `)

    if (websiteResult.rows[0]) {
      log({
        name: 'Cinque Terre Website',
        status: 'ok',
        message: `Found: ${websiteResult.rows[0].title}`,
        details: `ID: ${websiteResult.rows[0].id}`,
      })
    } else {
      log({
        name: 'Cinque Terre Website',
        status: 'warning',
        message: 'Not found in database',
        details: 'Run: tsx scripts/seed.ts',
      })
    }

    await client.end()
  } catch (error) {
    log({
      name: 'PostgreSQL Connection',
      status: 'error',
      message: 'Failed to connect',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

async function checkNats(): Promise<void> {
  console.log('\n📡 Checking NATS...')

  try {
    const response = await fetch(config.nats.monitoringUrl + '/varz', {
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      const data = await response.json() as { server_id: string; version: string; uptime: string }
      log({
        name: 'NATS Server',
        status: 'ok',
        message: `Running (v${data.version})`,
        details: `Server ID: ${data.server_id}`,
      })
    } else {
      throw new Error(`HTTP ${response.status}`)
    }
  } catch (error) {
    log({
      name: 'NATS Server',
      status: 'error',
      message: 'Not accessible',
      details: 'Start with: docker compose up -d nats',
    })
  }
}

async function checkTemporal(): Promise<void> {
  console.log('\n⏰ Checking Temporal...')

  try {
    // Check Temporal UI
    const response = await fetch(config.temporal.uiUrl, {
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      log({
        name: 'Temporal UI',
        status: 'ok',
        message: `Accessible at ${config.temporal.uiUrl}`,
      })
    } else {
      throw new Error(`HTTP ${response.status}`)
    }
  } catch (error) {
    log({
      name: 'Temporal UI',
      status: 'warning',
      message: 'Not accessible (may still be starting)',
      details: 'Start with: docker compose up -d temporal',
    })
  }

  // Check Temporal gRPC (basic TCP check)
  try {
    const [host, port] = config.temporal.url.split(':')
    const { connect } = await import('net')

    await new Promise<void>((resolve, reject) => {
      const socket = connect(parseInt(port), host)
      socket.setTimeout(5000)

      socket.on('connect', () => {
        socket.destroy()
        resolve()
      })

      socket.on('error', reject)
      socket.on('timeout', () => reject(new Error('Timeout')))
    })

    log({
      name: 'Temporal gRPC',
      status: 'ok',
      message: `Listening on ${config.temporal.url}`,
    })
  } catch (error) {
    log({
      name: 'Temporal gRPC',
      status: 'error',
      message: 'Not accessible',
      details: 'Start with: docker compose up -d temporal',
    })
  }
}

async function checkApi(): Promise<void> {
  console.log('\n🌐 Checking Backend API...')

  try {
    // Health check
    const healthResponse = await fetch(config.api.url + '/health', {
      signal: AbortSignal.timeout(5000),
    })

    if (healthResponse.ok) {
      const health = await healthResponse.json() as { status: string; services: { database: string; eventBus: string } }
      log({
        name: 'API Health',
        status: 'ok',
        message: `Status: ${health.status}`,
        details: `Database: ${health.services?.database}, Event Bus: ${health.services?.eventBus}`,
      })
    } else {
      throw new Error(`HTTP ${healthResponse.status}`)
    }
  } catch (error) {
    log({
      name: 'API Health',
      status: 'error',
      message: 'Not accessible',
      details: 'Start with: pnpm --filter @swarm-press/backend dev',
    })
    return // Skip weather check if API is down
  }

  // Weather API check
  try {
    const weatherResponse = await fetch(config.api.url + '/api/trpc/weather.current', {
      signal: AbortSignal.timeout(10000),
    })

    if (weatherResponse.ok) {
      const data = await weatherResponse.json() as { result: { data: { current: { temperature_c: number; weather_description: string } } } }
      const current = data.result?.data?.current
      if (current) {
        log({
          name: 'Weather API',
          status: 'ok',
          message: `Working (${current.temperature_c}°C, ${current.weather_description})`,
        })
      } else {
        log({
          name: 'Weather API',
          status: 'warning',
          message: 'Returned unexpected format',
          details: JSON.stringify(data).substring(0, 100),
        })
      }
    } else {
      throw new Error(`HTTP ${weatherResponse.status}`)
    }
  } catch (error) {
    log({
      name: 'Weather API',
      status: 'error',
      message: 'Failed to fetch weather',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

async function checkFiles(): Promise<void> {
  console.log('\n📁 Checking Required Files...')

  const { existsSync } = await import('fs')
  const { resolve } = await import('path')

  const requiredFiles = [
    {
      path: 'cinqueterre.travel/content/config/content-calendar.json',
      name: 'Content Calendar',
    },
    {
      path: 'cinqueterre.travel/content/config/writer-prompt.json',
      name: 'Writer Prompt Config',
    },
    {
      path: 'packages/backend/src/api/routers/weather.router.ts',
      name: 'Weather Router',
    },
    {
      path: 'packages/site-builder/src/themes/cinque-terre/src/components/WeatherWidget.tsx',
      name: 'Weather Widget',
    },
    {
      path: 'scripts/trigger-content-workflow.ts',
      name: 'Content Workflow Trigger',
    },
  ]

  for (const file of requiredFiles) {
    const fullPath = resolve(process.cwd(), file.path)
    if (existsSync(fullPath)) {
      log({
        name: file.name,
        status: 'ok',
        message: 'Found',
        details: file.path,
      })
    } else {
      log({
        name: file.name,
        status: 'error',
        message: 'Not found',
        details: file.path,
      })
    }
  }
}

async function printSummary(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary')
  console.log('='.repeat(60))

  const ok = results.filter(r => r.status === 'ok').length
  const warnings = results.filter(r => r.status === 'warning').length
  const errors = results.filter(r => r.status === 'error').length

  console.log(`\n  ✅ OK: ${ok}`)
  console.log(`  ⚠️  Warnings: ${warnings}`)
  console.log(`  ❌ Errors: ${errors}`)

  if (errors > 0) {
    console.log('\n❌ Some checks failed. Fix the errors above to proceed.')
    console.log('\nQuick fixes:')
    console.log('  • Start Docker services: docker compose up -d')
    console.log('  • Bootstrap database: tsx scripts/bootstrap.ts')
    console.log('  • Start API server: pnpm --filter @swarm-press/backend dev')
    process.exit(1)
  } else if (warnings > 0) {
    console.log('\n⚠️  Infrastructure running with warnings.')
  } else {
    console.log('\n✅ All infrastructure checks passed!')
  }

  console.log('\n' + '='.repeat(60))
}

async function main() {
  console.log('🔍 Infrastructure Verification')
  console.log('='.repeat(60))
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`Database: ${config.database.url.replace(/:[^:@]+@/, ':***@')}`)
  console.log(`API: ${config.api.url}`)
  console.log(`Temporal: ${config.temporal.url}`)

  await checkPostgres()
  await checkNats()
  await checkTemporal()
  await checkApi()
  await checkFiles()
  await printSummary()
}

main().catch(error => {
  console.error('\n💥 Verification failed:', error)
  process.exit(1)
})
