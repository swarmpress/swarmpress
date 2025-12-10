#!/usr/bin/env tsx
/**
 * Generate Cinque Terre Website
 * CLI script to trigger the autonomous website generation workflow
 *
 * Usage:
 *   npx tsx scripts/generate-cinqueterre.ts
 *   npx tsx scripts/generate-cinqueterre.ts --skip-research
 *   npx tsx scripts/generate-cinqueterre.ts --language en
 *   npx tsx scripts/generate-cinqueterre.ts --auto-approve
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

import { db } from '../packages/backend/src/db/connection'
import { temporalClient, startWorkflow, getWorkflowResult } from '../packages/workflows/src/temporal/client'

// ============================================================================
// Configuration
// ============================================================================

const WEBSITE_DOMAIN = 'cinqueterre.travel'

interface GenerateOptions {
  skipResearch: boolean
  skipContentGeneration: boolean
  skipEditorialReview: boolean
  languages: string[]
  autoApprove: boolean
  dryRun: boolean
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('')
  console.log('=========================================')
  console.log('🏖️  Cinque Terre Website Generator')
  console.log('=========================================')
  console.log('')

  // Parse command line arguments
  const options = parseArgs()

  if (options.dryRun) {
    console.log('🔍 DRY RUN - No actual generation will occur')
    console.log('')
  }

  try {
    // Connect to database
    await db.query('SELECT 1')
    console.log('✅ Database connected')

    // Get website and agents
    const { websiteId, agents } = await getWebsiteAndAgents()

    if (!websiteId) {
      console.error('❌ Website cinqueterre.travel not found!')
      console.error('   Run ./test/cinqueterre/BOOTSTRAP.sh first')
      process.exit(1)
    }

    console.log(`✅ Website: ${WEBSITE_DOMAIN} (${websiteId})`)
    console.log(`✅ Writer Agent: ${agents.writer?.name || 'Not found'}`)
    console.log(`✅ Editor Agent: ${agents.editor?.name || 'Not found'}`)
    console.log(`✅ Engineer Agent: ${agents.engineer?.name || 'Not found'}`)
    console.log('')

    // Show configuration
    console.log('Configuration:')
    console.log(`  - Skip Research: ${options.skipResearch}`)
    console.log(`  - Skip Content Gen: ${options.skipContentGeneration}`)
    console.log(`  - Skip Editorial: ${options.skipEditorialReview}`)
    console.log(`  - Languages: ${options.languages.join(', ') || 'all'}`)
    console.log(`  - Auto Approve: ${options.autoApprove}`)
    console.log('')

    if (options.dryRun) {
      console.log('✅ Dry run complete - configuration is valid')
      await db.end()
      return
    }

    // Connect to Temporal
    console.log('Connecting to Temporal...')
    await temporalClient.connect()
    console.log('✅ Temporal connected')
    console.log('')

    // Verify agents exist
    if (!agents.writer?.id || !agents.editor?.id || !agents.engineer?.id) {
      console.error('❌ Missing required agents!')
      console.error('   Ensure Isabella (writer), Marco (editor), and Matteo (engineer) exist')
      process.exit(1)
    }

    // Start the workflow
    console.log('=========================================')
    console.log('Starting Website Generation Workflow...')
    console.log('=========================================')
    console.log('')

    const workflowId = `cinqueterre-generation-${Date.now()}`

    const { workflowId: startedId, runId } = await startWorkflow(
      'websiteGenerationWorkflow',
      [{
        websiteId,
        writerAgentId: agents.writer.id,
        editorAgentId: agents.editor.id,
        engineerAgentId: agents.engineer.id,
        options: {
          skipResearch: options.skipResearch,
          skipContentGeneration: options.skipContentGeneration,
          skipEditorialReview: options.skipEditorialReview,
          languagesToProcess: options.languages.length > 0 ? options.languages : undefined,
          autoApproveContent: options.autoApprove,
          maxPagesPerBatch: 10,
          maxConcurrentContent: 5,
        },
      }],
      {
        workflowId,
        taskQueue: 'swarmpress-default',
      }
    )

    console.log(`✅ Workflow started!`)
    console.log(`   Workflow ID: ${startedId}`)
    console.log(`   Run ID: ${runId}`)
    console.log('')
    console.log('Monitor progress:')
    console.log(`   Temporal UI: http://localhost:8233/namespaces/default/workflows/${startedId}`)
    console.log('')

    // Option to wait for completion
    if (process.argv.includes('--wait')) {
      console.log('Waiting for workflow completion...')
      console.log('(This may take several hours for full generation)')
      console.log('')

      const result = await getWorkflowResult(startedId)

      console.log('')
      console.log('=========================================')
      console.log('Generation Complete!')
      console.log('=========================================')
      console.log('')
      console.log('Summary:')
      console.log(`  - Success: ${result.success}`)
      console.log(`  - Total Pages: ${result.summary?.totalPages || 0}`)
      console.log(`  - Content Created: ${result.summary?.contentCreated || 0}`)
      console.log(`  - Content Approved: ${result.summary?.contentApproved || 0}`)
      console.log(`  - Collections Populated: ${result.summary?.collectionsPopulated || 0}`)
      console.log(`  - Errors: ${result.summary?.errors?.length || 0}`)

      if (result.summary?.errors?.length > 0) {
        console.log('')
        console.log('Errors:')
        for (const error of result.summary.errors.slice(0, 10)) {
          console.log(`  - ${error}`)
        }
      }
    } else {
      console.log('Workflow is running in background.')
      console.log('Use --wait to wait for completion.')
    }

    // Cleanup
    await temporalClient.close()
    await db.end()

  } catch (error) {
    console.error('❌ Error:', error)
    await db.end().catch(() => {})
    process.exit(1)
  }
}

// ============================================================================
// Helpers
// ============================================================================

function parseArgs(): GenerateOptions {
  const args = process.argv.slice(2)

  return {
    skipResearch: args.includes('--skip-research'),
    skipContentGeneration: args.includes('--skip-content'),
    skipEditorialReview: args.includes('--skip-review'),
    languages: getLanguageArg(args),
    autoApprove: args.includes('--auto-approve'),
    dryRun: args.includes('--dry-run'),
  }
}

function getLanguageArg(args: string[]): string[] {
  const langIndex = args.indexOf('--language')
  if (langIndex === -1) return []

  const langValue = args[langIndex + 1]
  if (!langValue) return []

  return langValue.split(',').map(l => l.trim())
}

async function getWebsiteAndAgents() {
  // Get website
  const { rows: websiteRows } = await db.query<{ id: string }>(
    `SELECT id FROM websites WHERE domain = $1`,
    [WEBSITE_DOMAIN]
  )

  const websiteId = websiteRows[0]?.id || null

  // Get agents by their roles/names
  const { rows: agentRows } = await db.query<{
    id: string
    name: string
    role_name: string
  }>(
    `SELECT a.id, a.name, r.name as role_name
     FROM agents a
     JOIN roles r ON a.role_id = r.id
     WHERE a.virtual_email LIKE '%@cinqueterre.travel'`
  )

  const agents: Record<string, { id: string; name: string } | null> = {
    writer: null,
    editor: null,
    engineer: null,
  }

  for (const agent of agentRows) {
    const roleLower = agent.role_name.toLowerCase()
    if (roleLower.includes('writer') && !agents.writer) {
      agents.writer = { id: agent.id, name: agent.name }
    } else if (roleLower.includes('editor') && !agents.editor) {
      agents.editor = { id: agent.id, name: agent.name }
    } else if (roleLower.includes('engineer')) {
      agents.engineer = { id: agent.id, name: agent.name }
    }
  }

  return { websiteId, agents }
}

// Run
main().catch(console.error)
