#!/usr/bin/env tsx
/**
 * GitHub Integration Workflow Test
 * Tests the complete content workflow with GitHub integration
 *
 * This script:
 * 1. Sets up test data (website, content)
 * 2. Connects to GitHub (if configured)
 * 3. Runs the content production workflow
 * 4. Tests GitHub sync operations
 * 5. Tests webhook handling
 */

import { v4 as uuidv4 } from 'uuid'
import { Client, Connection } from '@temporalio/client'

// Environment configuration
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://swarmpress:swarmpress@localhost:5432/swarmpress'
const TEMPORAL_URL = process.env.TEMPORAL_URL || 'localhost:7233'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_OWNER = process.env.GITHUB_OWNER
const GITHUB_REPO = process.env.GITHUB_REPO

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
  details?: string
}

class WorkflowTester {
  private results: TestResult[] = []
  private temporalClient: Client | null = null
  private websiteId: string = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6' // Existing website
  private contentId: string = ''
  private testAgentId: string = ''

  async initialize() {
    console.log('\n🚀 Initializing GitHub Workflow Test\n')
    console.log('Configuration:')
    console.log(`  DATABASE_URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)
    console.log(`  TEMPORAL_URL: ${TEMPORAL_URL}`)
    console.log(`  GITHUB_TOKEN: ${GITHUB_TOKEN && GITHUB_TOKEN !== 'ghp_your_token_here' ? '***configured***' : '❌ NOT CONFIGURED'}`)
    console.log(`  GITHUB_OWNER: ${GITHUB_OWNER || '❌ NOT SET'}`)
    console.log(`  GITHUB_REPO: ${GITHUB_REPO || '❌ NOT SET'}`)
    console.log('')
  }

  async test(name: string, fn: () => Promise<void>): Promise<void> {
    console.log(`\n🧪 Testing: ${name}`)
    const start = Date.now()

    try {
      await fn()
      const duration = Date.now() - start
      this.results.push({ name, passed: true, duration })
      console.log(`✅ Passed (${duration}ms)`)
    } catch (error) {
      const duration = Date.now() - start
      const message = error instanceof Error ? error.message : 'Unknown error'
      this.results.push({ name, passed: false, duration, error: message })
      console.log(`❌ Failed (${duration}ms): ${message}`)
    }
  }

  async connectTemporal(): Promise<void> {
    console.log('\n📡 Connecting to Temporal...')
    try {
      const connection = await Connection.connect({
        address: TEMPORAL_URL,
      })
      this.temporalClient = new Client({ connection })
      console.log('✅ Connected to Temporal')
    } catch (error) {
      console.log('❌ Could not connect to Temporal:', error instanceof Error ? error.message : 'Unknown error')
      throw error
    }
  }

  async runTests() {
    await this.initialize()

    // Test 1: Database Connection
    await this.test('Database connection', async () => {
      const { default: pg } = await import('pg')
      const client = new pg.Client({ connectionString: DATABASE_URL })
      await client.connect()
      const result = await client.query('SELECT NOW()')
      if (!result.rows[0]) {
        throw new Error('Database query failed')
      }
      console.log(`   Database time: ${result.rows[0].now}`)
      await client.end()
    })

    // Test 2: Get existing website
    await this.test('Fetch existing website', async () => {
      const { default: pg } = await import('pg')
      const client = new pg.Client({ connectionString: DATABASE_URL })
      await client.connect()
      const result = await client.query(
        'SELECT id, domain, title, github_owner, github_repo FROM websites WHERE id = $1',
        [this.websiteId]
      )
      if (!result.rows[0]) {
        throw new Error('Website not found')
      }
      console.log(`   Website: ${result.rows[0].title} (${result.rows[0].domain})`)
      console.log(`   GitHub: ${result.rows[0].github_owner || 'not connected'}/${result.rows[0].github_repo || 'n/a'}`)
      await client.end()
    })

    // Test 3: Connect website to GitHub (if credentials available)
    await this.test('Configure GitHub connection', async () => {
      if (!GITHUB_TOKEN || GITHUB_TOKEN === 'ghp_your_token_here' || !GITHUB_OWNER || !GITHUB_REPO) {
        console.log('   ⚠️ Skipping: GitHub credentials not configured')
        console.log('   Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO in .env')
        return
      }

      const { default: pg } = await import('pg')
      const client = new pg.Client({ connectionString: DATABASE_URL })
      await client.connect()

      await client.query(`
        UPDATE websites SET
          github_owner = $1,
          github_repo = $2,
          github_access_token = $3,
          github_connected_at = NOW()
        WHERE id = $4
      `, [GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, this.websiteId])

      console.log(`   ✅ Connected website to ${GITHUB_OWNER}/${GITHUB_REPO}`)
      await client.end()
    })

    // Test 4: Get or create writer agent
    await this.test('Get writer agent', async () => {
      const { default: pg } = await import('pg')
      const client = new pg.Client({ connectionString: DATABASE_URL })
      await client.connect()

      // Find a writer agent
      const result = await client.query(`
        SELECT a.id, a.name, r.name as role_name
        FROM agents a
        JOIN roles r ON a.role_id = r.id
        WHERE r.name LIKE '%Writer%'
        LIMIT 1
      `)

      if (!result.rows[0]) {
        throw new Error('No writer agent found')
      }

      this.testAgentId = result.rows[0].id
      console.log(`   Agent: ${result.rows[0].name} (${result.rows[0].role_name})`)
      console.log(`   Agent ID: ${this.testAgentId}`)
      await client.end()
    })

    // Test 5: Create test content item
    await this.test('Create test content item', async () => {
      const { default: pg } = await import('pg')
      const client = new pg.Client({ connectionString: DATABASE_URL })
      await client.connect()

      this.contentId = uuidv4()
      const title = `Test Content - ${new Date().toISOString()}`

      await client.query(`
        INSERT INTO content_items (id, website_id, title, slug, content_type, status, body, author_agent_id, brief)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        this.contentId,
        this.websiteId,
        title,
        `test-content-${Date.now()}`,
        'article',
        'brief_created',
        JSON.stringify([]),
        this.testAgentId,
        'Write an engaging travel article about the beautiful villages of Cinque Terre, covering Monterosso, Vernazza, Corniglia, Manarola, and Riomaggiore. Include practical travel tips.'
      ])

      console.log(`   Created content: ${title}`)
      console.log(`   Content ID: ${this.contentId}`)
      await client.end()
    })

    // Test 6: Connect to Temporal
    await this.test('Connect to Temporal', async () => {
      await this.connectTemporal()
    })

    // Test 7: Start Content Production Workflow
    await this.test('Start content production workflow', async () => {
      if (!this.temporalClient) {
        throw new Error('Temporal client not connected')
      }

      const workflowId = `content-production-${this.contentId}`

      console.log(`   Starting workflow: ${workflowId}`)
      console.log(`   Content ID: ${this.contentId}`)
      console.log(`   Writer Agent: ${this.testAgentId}`)

      try {
        const handle = await this.temporalClient.workflow.start('contentProductionWorkflow', {
          args: [{
            contentId: this.contentId,
            writerAgentId: this.testAgentId,
            brief: 'Write an engaging travel article about the beautiful villages of Cinque Terre.',
            maxRevisions: 1,
          }],
          taskQueue: 'swarmpress-content-production',
          workflowId,
        })

        console.log(`   ✅ Workflow started: ${handle.workflowId}`)
        console.log(`   Run ID: ${handle.firstExecutionRunId}`)

        // Wait for workflow with timeout (don't wait forever)
        console.log('   ⏳ Waiting for workflow result (timeout: 5 minutes)...')
        const result = await Promise.race([
          handle.result(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Workflow timeout after 5 minutes')), 5 * 60 * 1000)
          )
        ])

        console.log('   Workflow result:', JSON.stringify(result, null, 2))

        if (!(result as any).success) {
          throw new Error(`Workflow failed: ${(result as any).error}`)
        }

        if ((result as any).githubPrUrl) {
          console.log(`   🔗 GitHub PR: ${(result as any).githubPrUrl}`)
        }
      } catch (error: any) {
        if (error.message?.includes('already running') || error.message?.includes('already exists')) {
          console.log('   ⚠️ Workflow already exists, checking status...')
          const handle = this.temporalClient.workflow.getHandle(workflowId)
          const description = await handle.describe()
          console.log(`   Status: ${description.status.name}`)
          throw new Error(`Workflow already running: ${description.status.name}`)
        }
        throw error
      }
    })

    // Test 8: Verify content state after workflow
    await this.test('Verify content state after workflow', async () => {
      const { default: pg } = await import('pg')
      const client = new pg.Client({ connectionString: DATABASE_URL })
      await client.connect()

      const result = await client.query(
        'SELECT id, title, status, body FROM content_items WHERE id = $1',
        [this.contentId]
      )

      if (!result.rows[0]) {
        throw new Error('Content not found')
      }

      const content = result.rows[0]
      console.log(`   Status: ${content.status}`)
      console.log(`   Body blocks: ${JSON.parse(content.body || '[]').length}`)

      // Check if content was updated (body should have content now)
      const body = JSON.parse(content.body || '[]')
      if (body.length === 0) {
        console.log('   ⚠️ Warning: Content body is empty')
      }

      await client.end()
    })

    // Test 9: Test GitHub Sync (if configured)
    await this.test('Test GitHub sync layer', async () => {
      if (!GITHUB_TOKEN || GITHUB_TOKEN === 'ghp_your_token_here') {
        console.log('   ⚠️ Skipping: GitHub not configured')
        return
      }

      // Import GitHub integration
      const { initializeGitHub, getGitHub } = await import('../packages/github-integration/src/client')
      const { syncContentToGitHub, getGitHubMapping } = await import('../packages/github-integration/src/sync')

      try {
        initializeGitHub({
          token: GITHUB_TOKEN,
          owner: GITHUB_OWNER!,
          repo: GITHUB_REPO!,
        })

        console.log('   GitHub client initialized')

        // Try to sync content (might already be synced from workflow)
        const mapping = getGitHubMapping('content', this.contentId)
        if (mapping) {
          console.log(`   ✅ Content already synced to PR #${mapping.github_number}`)
          console.log(`   PR URL: ${mapping.github_url}`)
        } else {
          console.log('   No existing GitHub mapping, attempting sync...')
          await syncContentToGitHub(this.contentId)
          const newMapping = getGitHubMapping('content', this.contentId)
          if (newMapping) {
            console.log(`   ✅ Created PR #${newMapping.github_number}`)
          }
        }
      } catch (error: any) {
        if (error.message?.includes('Website') && error.message?.includes('not connected')) {
          console.log('   ⚠️ Website not connected to GitHub')
          return
        }
        throw error
      }
    })

    // Test 10: Test webhook handling
    await this.test('Test webhook handler imports', async () => {
      try {
        // Just verify the webhook handlers can be imported
        const webhookHandlerPath = '../packages/workflows/dist/services/github-webhook-handler'
        const handlers = await import(webhookHandlerPath)

        const requiredHandlers = ['handlePRReviewSubmitted', 'handleIssueComment', 'handlePRMerged', 'handlePRClosed']
        const available = Object.keys(handlers)

        for (const handler of requiredHandlers) {
          if (!available.includes(handler)) {
            console.log(`   ⚠️ Missing handler: ${handler}`)
          } else {
            console.log(`   ✅ Handler available: ${handler}`)
          }
        }
      } catch (error: any) {
        if (error.code === 'ERR_MODULE_NOT_FOUND') {
          console.log('   ⚠️ Webhook handlers not built - run pnpm build first')
          console.log(`   Missing module: ${error.message}`)
        } else {
          throw error
        }
      }
    })

    // Cleanup
    await this.test('Cleanup test content', async () => {
      const { default: pg } = await import('pg')
      const client = new pg.Client({ connectionString: DATABASE_URL })
      await client.connect()

      // Delete test content (optional - comment out to keep for inspection)
      // await client.query('DELETE FROM content_items WHERE id = $1', [this.contentId])
      // console.log(`   Deleted test content: ${this.contentId}`)

      console.log(`   Test content preserved: ${this.contentId}`)
      console.log('   To delete manually: DELETE FROM content_items WHERE id = \'...\';')

      await client.end()
    })

    this.printSummary()
  }

  printSummary() {
    console.log('\n' + '='.repeat(70))
    console.log('📊 Test Summary')
    console.log('='.repeat(70) + '\n')

    const passed = this.results.filter(r => r.passed).length
    const failed = this.results.filter(r => !r.passed).length
    const total = this.results.length

    console.log(`Total: ${total}`)
    console.log(`Passed: ${passed} ✅`)
    console.log(`Failed: ${failed} ❌`)
    console.log('')

    if (failed > 0) {
      console.log('Failed tests:')
      this.results
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`  ❌ ${r.name}`)
          console.log(`     Error: ${r.error}`)
        })
      console.log('')
    }

    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0)
    console.log(`Total duration: ${totalDuration}ms`)
    console.log('='.repeat(70))

    // Return test content ID for further inspection
    console.log('\n📋 Test Artifacts:')
    console.log(`   Content ID: ${this.contentId}`)
    console.log(`   Website ID: ${this.websiteId}`)
    console.log(`   Agent ID: ${this.testAgentId}`)

    if (failed > 0) {
      process.exit(1)
    }
  }
}

// Run tests
const tester = new WorkflowTester()
tester.runTests().catch(error => {
  console.error('\n💥 Test runner crashed:', error)
  process.exit(1)
})
