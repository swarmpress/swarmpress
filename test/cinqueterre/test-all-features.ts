#!/usr/bin/env tsx
/**
 * Cinqueterre.travel - Comprehensive Feature Test Script
 *
 * Tests all swarm.press features using the Cinqueterre test data:
 * - Database connectivity and data loading
 * - tRPC API endpoints (all routers)
 * - Editorial Planning (tasks, phases, statistics)
 * - Sitemap functionality
 * - Agent management
 * - Company/Department/Role hierarchy
 * - GitHub integration endpoints
 *
 * Usage:
 *   npx tsx test/cinqueterre/test-all-features.ts
 */

import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@swarm-press/backend'
import superjson from 'superjson'
import { Pool } from 'pg'

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000'
const DB_HOST = process.env.DB_HOST || 'localhost'
const DB_PORT = parseInt(process.env.DB_PORT || '5432')
const DB_NAME = process.env.DB_NAME || 'swarmpress'
const DB_USER = process.env.DB_USER || 'swarmpress'
const DB_PASSWORD = process.env.DB_PASSWORD || 'swarmpress'

const CINQUETERRE_WEBSITE_ID = 'ct-website-001'
const CINQUETERRE_COMPANY_ID = 'ct-company-001'

// Colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

// Test results tracking
interface TestResult {
  category: string
  name: string
  status: 'pass' | 'fail' | 'skip'
  error?: string
  duration?: number
}

const results: TestResult[] = []

// Helper functions
function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(80))
  log(title, 'cyan')
  console.log('='.repeat(80))
}

function logTest(category: string, name: string) {
  process.stdout.write(`${colors.blue}[${category}]${colors.reset} ${name}... `)
}

function logPass(duration?: number) {
  const durationStr = duration ? ` (${duration}ms)` : ''
  log(`✓ PASS${durationStr}`, 'green')
}

function logFail(error: string) {
  log(`✗ FAIL`, 'red')
  log(`  Error: ${error}`, 'red')
}

function logSkip(reason: string) {
  log(`⊘ SKIP (${reason})`, 'yellow')
}

async function runTest(
  category: string,
  name: string,
  testFn: () => Promise<void>,
  skipCondition?: boolean,
  skipReason?: string
): Promise<void> {
  logTest(category, name)

  if (skipCondition) {
    logSkip(skipReason || 'Condition not met')
    results.push({ category, name, status: 'skip' })
    return
  }

  const startTime = Date.now()
  try {
    await testFn()
    const duration = Date.now() - startTime
    logPass(duration)
    results.push({ category, name, status: 'pass', duration })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logFail(errorMsg)
    results.push({ category, name, status: 'fail', error: errorMsg })
  }
}

// Initialize clients
let trpcClient: ReturnType<typeof createTRPCProxyClient<AppRouter>>
let dbPool: Pool

function initializeClients() {
  logSection('Initializing Test Environment')

  log(`API URL: ${API_URL}`, 'blue')
  log(`Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}`, 'blue')

  // tRPC client
  trpcClient = createTRPCProxyClient<AppRouter>({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: `${API_URL}/api/trpc`,
        headers() {
          return {
            authorization: 'Bearer ceo:admin@swarm.press',
          }
        },
      }),
    ],
  })

  // PostgreSQL client
  dbPool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  })

  log('✓ Clients initialized', 'green')
}

// Test Categories

async function testDatabaseConnectivity() {
  logSection('1. Database Connectivity Tests')

  await runTest('Database', 'PostgreSQL connection', async () => {
    const result = await dbPool.query('SELECT NOW()')
    if (!result.rows[0]) throw new Error('No result from database')
  })

  await runTest('Database', 'Cinqueterre company exists', async () => {
    const result = await dbPool.query(
      'SELECT id, name FROM companies WHERE id = $1',
      [CINQUETERRE_COMPANY_ID]
    )
    if (result.rows.length === 0) {
      throw new Error('Cinqueterre company not found - run setup script first')
    }
    if (result.rows[0].name !== 'Cinqueterre.travel') {
      throw new Error('Company name mismatch')
    }
  })

  await runTest('Database', 'All 8 agents exist', async () => {
    const result = await dbPool.query(
      'SELECT COUNT(*) as count FROM agents WHERE id LIKE $1',
      ['ct-agent-%']
    )
    const count = parseInt(result.rows[0].count)
    if (count !== 8) {
      throw new Error(`Expected 8 agents, found ${count}`)
    }
  })

  await runTest('Database', 'All 12 editorial tasks exist', async () => {
    const result = await dbPool.query(
      'SELECT COUNT(*) as count FROM editorial_tasks WHERE website_id = $1',
      [CINQUETERRE_WEBSITE_ID]
    )
    const count = parseInt(result.rows[0].count)
    if (count !== 12) {
      throw new Error(`Expected 12 tasks, found ${count}`)
    }
  })

  await runTest('Database', 'All 11 sitemap pages exist', async () => {
    const result = await dbPool.query(
      'SELECT COUNT(*) as count FROM pages WHERE website_id = $1',
      [CINQUETERRE_WEBSITE_ID]
    )
    const count = parseInt(result.rows[0].count)
    if (count !== 11) {
      throw new Error(`Expected 11 pages, found ${count}`)
    }
  })

  await runTest('Database', 'Task phases initialized (72+)', async () => {
    const result = await dbPool.query(
      `SELECT COUNT(*) as count FROM task_phases tp
       JOIN editorial_tasks et ON tp.task_id = et.id
       WHERE et.website_id = $1`,
      [CINQUETERRE_WEBSITE_ID]
    )
    const count = parseInt(result.rows[0].count)
    if (count < 72) {
      throw new Error(`Expected 72+ task phases, found ${count}`)
    }
  })
}

async function testCompanyManagement() {
  logSection('2. Company Management API Tests')

  await runTest('Company', 'Get company by ID', async () => {
    const company = await trpcClient.company.getById.query({ id: CINQUETERRE_COMPANY_ID })
    if (!company) throw new Error('Company not found')
    if (company.name !== 'Cinqueterre.travel') throw new Error('Company name mismatch')
  })

  await runTest('Company', 'List all companies', async () => {
    const companies = await trpcClient.company.list.query()
    const cinqueterre = companies.find((c: any) => c.id === CINQUETERRE_COMPANY_ID)
    if (!cinqueterre) throw new Error('Cinqueterre not in company list')
  })

  await runTest('Company', 'Get company statistics', async () => {
    const stats = await trpcClient.company.getStatistics.query({ id: CINQUETERRE_COMPANY_ID })
    if (!stats) throw new Error('No statistics returned')
    if (stats.departmentCount !== 6) throw new Error(`Expected 6 departments, got ${stats.departmentCount}`)
    if (stats.agentCount !== 8) throw new Error(`Expected 8 agents, got ${stats.agentCount}`)
  })
}

async function testDepartmentManagement() {
  logSection('3. Department Management API Tests')

  await runTest('Department', 'List departments by company', async () => {
    const departments = await trpcClient.department.listByCompany.query({
      companyId: CINQUETERRE_COMPANY_ID
    })
    if (departments.length !== 6) {
      throw new Error(`Expected 6 departments, found ${departments.length}`)
    }
  })

  await runTest('Department', 'Get specific department (Editorial)', async () => {
    const result = await dbPool.query(
      'SELECT id FROM departments WHERE company_id = $1 AND name = $2',
      [CINQUETERRE_COMPANY_ID, 'Editorial']
    )
    if (result.rows.length === 0) throw new Error('Editorial department not found')

    const deptId = result.rows[0].id
    const department = await trpcClient.department.getById.query({ id: deptId })
    if (!department) throw new Error('Department not found via API')
    if (department.name !== 'Editorial') throw new Error('Department name mismatch')
  })
}

async function testRoleManagement() {
  logSection('4. Role Management API Tests')

  await runTest('Role', 'List roles by company', async () => {
    const roles = await trpcClient.role.listByCompany.query({
      companyId: CINQUETERRE_COMPANY_ID
    })
    if (roles.length !== 9) {
      throw new Error(`Expected 9 roles, found ${roles.length}`)
    }
  })

  await runTest('Role', 'Get specific role (Travel Writer)', async () => {
    const result = await dbPool.query(
      `SELECT r.id FROM roles r
       JOIN departments d ON r.department_id = d.id
       WHERE d.company_id = $1 AND r.name = $2`,
      [CINQUETERRE_COMPANY_ID, 'Travel Writer']
    )
    if (result.rows.length === 0) throw new Error('Travel Writer role not found')

    const roleId = result.rows[0].id
    const role = await trpcClient.role.getById.query({ id: roleId })
    if (!role) throw new Error('Role not found via API')
    if (role.name !== 'Travel Writer') throw new Error('Role name mismatch')
  })
}

async function testAgentManagement() {
  logSection('5. Agent Management API Tests')

  await runTest('Agent', 'List agents by company', async () => {
    const agents = await trpcClient.agent.listByCompany.query({
      companyId: CINQUETERRE_COMPANY_ID
    })
    if (agents.length !== 8) {
      throw new Error(`Expected 8 agents, found ${agents.length}`)
    }
  })

  await runTest('Agent', 'Get specific agent (Isabella - Travel Writer)', async () => {
    const agent = await trpcClient.agent.getById.query({ id: 'ct-agent-isabella' })
    if (!agent) throw new Error('Isabella not found')
    if (agent.name !== 'Isabella') throw new Error('Agent name mismatch')
    if (!agent.persona?.includes('travel writer')) {
      throw new Error('Agent persona incorrect')
    }
  })

  await runTest('Agent', 'Verify agent capabilities', async () => {
    const agent = await trpcClient.agent.getById.query({ id: 'ct-agent-isabella' })
    if (!agent?.capabilities) throw new Error('No capabilities found')
    const caps = Array.isArray(agent.capabilities) ? agent.capabilities : []
    if (!caps.includes('destination_guides')) {
      throw new Error('Expected destination_guides capability')
    }
  })

  await runTest('Agent', 'List agents by department (Writers Room)', async () => {
    const result = await dbPool.query(
      `SELECT id FROM departments WHERE company_id = $1 AND name = $2`,
      [CINQUETERRE_COMPANY_ID, 'Writers Room']
    )
    if (result.rows.length === 0) throw new Error('Writers Room department not found')

    const deptId = result.rows[0].id
    const agents = await trpcClient.agent.listByDepartment.query({ departmentId: deptId })
    if (agents.length !== 3) {
      throw new Error(`Expected 3 writers, found ${agents.length}`)
    }
  })
}

async function testWebsiteManagement() {
  logSection('6. Website Management API Tests')

  await runTest('Website', 'Get website by ID', async () => {
    const website = await trpcClient.website.getById.query({ id: CINQUETERRE_WEBSITE_ID })
    if (!website) throw new Error('Website not found')
    if (website.domain !== 'cinqueterre.travel') throw new Error('Domain mismatch')
  })

  await runTest('Website', 'List websites by company', async () => {
    const websites = await trpcClient.website.listByCompany.query({
      companyId: CINQUETERRE_COMPANY_ID
    })
    const cinqueterre = websites.find((w: any) => w.id === CINQUETERRE_WEBSITE_ID)
    if (!cinqueterre) throw new Error('Cinqueterre website not in list')
  })
}

async function testSitemapManagement() {
  logSection('7. Sitemap Management API Tests')

  await runTest('Sitemap', 'Get all pages for website', async () => {
    const pages = await trpcClient.sitemap.getPages.query({ websiteId: CINQUETERRE_WEBSITE_ID })
    if (pages.length !== 11) {
      throw new Error(`Expected 11 pages, found ${pages.length}`)
    }
  })

  await runTest('Sitemap', 'Get homepage', async () => {
    const result = await dbPool.query(
      'SELECT id FROM pages WHERE website_id = $1 AND slug = $2',
      [CINQUETERRE_WEBSITE_ID, '/']
    )
    if (result.rows.length === 0) throw new Error('Homepage not found')

    const pageId = result.rows[0].id
    const page = await trpcClient.sitemap.getPage.query({ id: pageId })
    if (!page) throw new Error('Homepage not found via API')
    if (page.title !== 'Cinque Terre Travel Guide') throw new Error('Homepage title mismatch')
  })

  await runTest('Sitemap', 'Verify page hierarchy', async () => {
    const pages = await trpcClient.sitemap.getPages.query({ websiteId: CINQUETERRE_WEBSITE_ID })
    const villagePages = pages.filter((p: any) => p.slug?.startsWith('/villages/'))
    if (villagePages.length !== 5) {
      throw new Error(`Expected 5 village pages, found ${villagePages.length}`)
    }
  })

  await runTest('Sitemap', 'Get page tree structure', async () => {
    const tree = await trpcClient.sitemap.getPageTree.query({ websiteId: CINQUETERRE_WEBSITE_ID })
    if (!tree) throw new Error('No page tree returned')
    if (!Array.isArray(tree)) throw new Error('Page tree is not an array')
  })
}

async function testEditorialTasks() {
  logSection('8. Editorial Task Management API Tests')

  await runTest('Editorial', 'Get all tasks for website', async () => {
    const tasks = await trpcClient.editorial.getTasks.query({ websiteId: CINQUETERRE_WEBSITE_ID })
    if (tasks.length !== 12) {
      throw new Error(`Expected 12 tasks, found ${tasks.length}`)
    }
  })

  await runTest('Editorial', 'Get task statistics', async () => {
    const stats = await trpcClient.editorial.getStatistics.query({
      websiteId: CINQUETERRE_WEBSITE_ID
    })
    if (!stats) throw new Error('No statistics returned')
    if (stats.total !== 12) throw new Error(`Expected total=12, got ${stats.total}`)
  })

  await runTest('Editorial', 'Get specific task (Monterosso Guide)', async () => {
    const task = await trpcClient.editorial.getTask.query({ id: 'ct-task-001' })
    if (!task) throw new Error('Task not found')
    if (!task.title.includes('Monterosso')) throw new Error('Task title mismatch')
    if (task.assigned_agent_id !== 'ct-agent-isabella') {
      throw new Error('Task assignment mismatch')
    }
  })

  await runTest('Editorial', 'Get tasks by status (in_progress)', async () => {
    const tasks = await trpcClient.editorial.getTasks.query({
      websiteId: CINQUETERRE_WEBSITE_ID
    })
    const inProgress = tasks.filter((t: any) => t.status === 'in_progress')
    if (inProgress.length !== 4) {
      throw new Error(`Expected 4 in_progress tasks, found ${inProgress.length}`)
    }
  })

  await runTest('Editorial', 'Get tasks by priority (high)', async () => {
    const tasks = await trpcClient.editorial.getTasks.query({
      websiteId: CINQUETERRE_WEBSITE_ID
    })
    const highPriority = tasks.filter((t: any) => t.priority === 'high')
    if (highPriority.length === 0) {
      throw new Error('No high priority tasks found')
    }
  })
}

async function testTaskPhases() {
  logSection('9. Task Phase Management API Tests')

  await runTest('Phases', 'Get phases for task', async () => {
    const phases = await trpcClient.editorial.getTaskPhases.query({ taskId: 'ct-task-001' })
    if (!phases) throw new Error('No phases returned')

    const phaseKeys = Object.keys(phases)
    if (phaseKeys.length === 0) throw new Error('Phases object is empty')

    // Check for expected phases
    const expectedPhases = ['research', 'outline', 'draft', 'edit', 'review', 'publish', 'optimize']
    const missingPhases = expectedPhases.filter(p => !phaseKeys.includes(p))
    if (missingPhases.length > 0) {
      throw new Error(`Missing phases: ${missingPhases.join(', ')}`)
    }
  })

  await runTest('Phases', 'Verify phase structure', async () => {
    const phases = await trpcClient.editorial.getTaskPhases.query({ taskId: 'ct-task-001' })

    const researchPhase = phases.research
    if (!researchPhase) throw new Error('Research phase not found')
    if (typeof researchPhase.completed !== 'boolean') {
      throw new Error('Phase completed field is not boolean')
    }
    if (typeof researchPhase.in_progress !== 'boolean') {
      throw new Error('Phase in_progress field is not boolean')
    }
  })

  await runTest('Phases', 'Verify phase progress data', async () => {
    const phases = await trpcClient.editorial.getTaskPhases.query({ taskId: 'ct-task-001' })

    // Find a completed phase
    const completedPhase = Object.values(phases).find((p: any) => p.completed)
    if (!completedPhase) throw new Error('No completed phases found')

    if (typeof completedPhase.progress !== 'number') {
      throw new Error('Phase progress is not a number')
    }
  })

  await runTest('Phases', 'Get phases for all tasks', async () => {
    const tasks = await trpcClient.editorial.getTasks.query({
      websiteId: CINQUETERRE_WEBSITE_ID
    })

    // Test first 3 tasks to verify phases endpoint works for multiple tasks
    const testTasks = tasks.slice(0, 3)
    for (const task of testTasks) {
      const phases = await trpcClient.editorial.getTaskPhases.query({ taskId: task.id })
      if (!phases || Object.keys(phases).length === 0) {
        throw new Error(`No phases found for task ${task.id}`)
      }
    }
  })
}

async function testBlueprintManagement() {
  logSection('10. Blueprint Management API Tests')

  await runTest('Blueprint', 'List blueprints by website', async () => {
    const blueprints = await trpcClient.blueprint.listByWebsite.query({
      websiteId: CINQUETERRE_WEBSITE_ID
    })
    if (blueprints.length !== 3) {
      throw new Error(`Expected 3 blueprints, found ${blueprints.length}`)
    }
  })

  await runTest('Blueprint', 'Get specific blueprint (Village Detail)', async () => {
    const result = await dbPool.query(
      'SELECT id FROM content_blueprints WHERE website_id = $1 AND name = $2',
      [CINQUETERRE_WEBSITE_ID, 'Village Detail Page']
    )
    if (result.rows.length === 0) throw new Error('Village Detail blueprint not found')

    const blueprintId = result.rows[0].id
    const blueprint = await trpcClient.blueprint.getById.query({ id: blueprintId })
    if (!blueprint) throw new Error('Blueprint not found via API')
    if (blueprint.name !== 'Village Detail Page') throw new Error('Blueprint name mismatch')
  })
}

async function testGitHubIntegration() {
  logSection('11. GitHub Integration API Tests')

  await runTest('GitHub', 'Create GitHub Issue endpoint exists', async () => {
    // Just verify the endpoint is available (will fail if no GitHub token configured)
    try {
      await trpcClient.editorial.createGitHubIssue.mutate({
        taskId: 'ct-task-001',
        websiteId: CINQUETERRE_WEBSITE_ID,
      })
      // If we get here, GitHub is configured
    } catch (error: any) {
      // Expected error if GitHub not configured
      if (error.message.includes('GitHub') || error.message.includes('token')) {
        // This is fine - endpoint exists but GitHub not configured
        return
      }
      throw error
    }
  }, false, 'GitHub may not be configured')

  await runTest('GitHub', 'Create GitHub PR endpoint exists', async () => {
    try {
      await trpcClient.editorial.createGitHubPR.mutate({
        taskId: 'ct-task-001',
        websiteId: CINQUETERRE_WEBSITE_ID,
      })
    } catch (error: any) {
      if (error.message.includes('GitHub') || error.message.includes('token')) {
        return
      }
      throw error
    }
  }, false, 'GitHub may not be configured')

  await runTest('GitHub', 'Sync from PR endpoint exists', async () => {
    try {
      await trpcClient.editorial.syncFromGitHubPR.mutate({
        taskId: 'ct-task-001',
        websiteId: CINQUETERRE_WEBSITE_ID,
      })
    } catch (error: any) {
      if (error.message.includes('GitHub') || error.message.includes('token') || error.message.includes('PR')) {
        return
      }
      throw error
    }
  }, false, 'GitHub may not be configured')
}

async function testTaskDependencies() {
  logSection('12. Task Dependency Tests')

  await runTest('Dependencies', 'Verify task dependencies exist', async () => {
    const result = await dbPool.query(
      `SELECT COUNT(*) as count FROM editorial_tasks
       WHERE website_id = $1 AND depends_on IS NOT NULL`,
      [CINQUETERRE_WEBSITE_ID]
    )
    const count = parseInt(result.rows[0].count)
    if (count === 0) {
      throw new Error('No task dependencies found')
    }
  })

  await runTest('Dependencies', 'Homepage blocks other tasks', async () => {
    const task = await trpcClient.editorial.getTask.query({ id: 'ct-task-011' })
    if (!task) throw new Error('Homepage task not found')
    if (!task.blocks || task.blocks.length === 0) {
      throw new Error('Homepage should block other tasks')
    }
  })

  await runTest('Dependencies', 'Hiking trail depends on village guides', async () => {
    const task = await trpcClient.editorial.getTask.query({ id: 'ct-task-006' })
    if (!task) throw new Error('Hiking trail task not found')
    if (!task.depends_on || task.depends_on.length === 0) {
      throw new Error('Hiking trail should depend on village guides')
    }
    if (task.depends_on.length !== 5) {
      throw new Error(`Expected 5 dependencies, found ${task.depends_on.length}`)
    }
  })
}

async function testSEOMetadata() {
  logSection('13. SEO Metadata Tests')

  await runTest('SEO', 'Tasks have SEO keywords', async () => {
    const tasks = await trpcClient.editorial.getTasks.query({
      websiteId: CINQUETERRE_WEBSITE_ID
    })
    const tasksWithSEO = tasks.filter((t: any) => t.seo_primary_keyword)
    if (tasksWithSEO.length === 0) {
      throw new Error('No tasks with SEO keywords found')
    }
  })

  await runTest('SEO', 'Tasks have word count targets', async () => {
    const tasks = await trpcClient.editorial.getTasks.query({
      websiteId: CINQUETERRE_WEBSITE_ID
    })
    const tasksWithWordCount = tasks.filter((t: any) => t.word_count_target)
    if (tasksWithWordCount.length === 0) {
      throw new Error('No tasks with word count targets found')
    }
  })

  await runTest('SEO', 'Village guides have secondary keywords', async () => {
    const task = await trpcClient.editorial.getTask.query({ id: 'ct-task-001' })
    if (!task) throw new Error('Task not found')
    if (!task.seo_secondary_keywords || task.seo_secondary_keywords.length === 0) {
      throw new Error('Village guide should have secondary keywords')
    }
  })
}

async function testAgentActivities() {
  logSection('14. Agent Activity Tests')

  await runTest('Activity', 'Agent activities exist', async () => {
    const result = await dbPool.query(
      `SELECT COUNT(*) as count FROM agent_activities aa
       JOIN agents a ON aa.agent_id = a.id
       WHERE a.id LIKE 'ct-agent-%'`
    )
    const count = parseInt(result.rows[0].count)
    if (count < 5) {
      throw new Error(`Expected at least 5 activities, found ${count}`)
    }
  })

  await runTest('Activity', 'Activities have proper structure', async () => {
    const result = await dbPool.query(
      `SELECT activity_type, description, metadata FROM agent_activities aa
       JOIN agents a ON aa.agent_id = a.id
       WHERE a.id LIKE 'ct-agent-%'
       LIMIT 1`
    )
    if (result.rows.length === 0) throw new Error('No activities found')

    const activity = result.rows[0]
    if (!activity.activity_type) throw new Error('Activity missing type')
    if (!activity.description) throw new Error('Activity missing description')
  })
}

async function testContentSuggestions() {
  logSection('15. Content Suggestion Tests')

  await runTest('Suggestions', 'Content suggestions exist', async () => {
    const result = await dbPool.query(
      `SELECT COUNT(*) as count FROM suggestions
       WHERE website_id = $1`,
      [CINQUETERRE_WEBSITE_ID]
    )
    const count = parseInt(result.rows[0].count)
    if (count < 5) {
      throw new Error(`Expected at least 5 suggestions, found ${count}`)
    }
  })

  await runTest('Suggestions', 'Suggestions have proper structure', async () => {
    const result = await dbPool.query(
      `SELECT title, description, suggested_by_agent_id, metadata FROM suggestions
       WHERE website_id = $1
       LIMIT 1`,
      [CINQUETERRE_WEBSITE_ID]
    )
    if (result.rows.length === 0) throw new Error('No suggestions found')

    const suggestion = result.rows[0]
    if (!suggestion.title) throw new Error('Suggestion missing title')
    if (!suggestion.description) throw new Error('Suggestion missing description')
    if (!suggestion.suggested_by_agent_id) throw new Error('Suggestion missing agent')
  })
}

// Print summary
function printSummary() {
  logSection('Test Summary')

  const passed = results.filter(r => r.status === 'pass')
  const failed = results.filter(r => r.status === 'fail')
  const skipped = results.filter(r => r.status === 'skip')

  log(`\nTotal Tests: ${results.length}`, 'cyan')
  log(`✓ Passed: ${passed.length}`, 'green')
  log(`✗ Failed: ${failed.length}`, failed.length > 0 ? 'red' : 'green')
  log(`⊘ Skipped: ${skipped.length}`, 'yellow')

  if (failed.length > 0) {
    log('\nFailed Tests:', 'red')
    failed.forEach(test => {
      log(`  • [${test.category}] ${test.name}`, 'red')
      if (test.error) {
        log(`    ${test.error}`, 'red')
      }
    })
  }

  // Summary by category
  log('\nResults by Category:', 'cyan')
  const categories = [...new Set(results.map(r => r.category))]
  categories.forEach(category => {
    const categoryTests = results.filter(r => r.category === category)
    const categoryPassed = categoryTests.filter(r => r.status === 'pass').length
    const categoryTotal = categoryTests.length
    const percentage = ((categoryPassed / categoryTotal) * 100).toFixed(1)
    const color = categoryPassed === categoryTotal ? 'green' : 'yellow'
    log(`  ${category}: ${categoryPassed}/${categoryTotal} (${percentage}%)`, color)
  })

  // Performance stats
  const testsWithDuration = results.filter(r => r.duration !== undefined)
  if (testsWithDuration.length > 0) {
    const totalDuration = testsWithDuration.reduce((sum, r) => sum + (r.duration || 0), 0)
    const avgDuration = totalDuration / testsWithDuration.length
    log(`\nPerformance:`, 'cyan')
    log(`  Total: ${totalDuration}ms`, 'blue')
    log(`  Average: ${avgDuration.toFixed(1)}ms per test`, 'blue')
  }

  // Exit code
  const exitCode = failed.length > 0 ? 1 : 0
  log(`\n${'='.repeat(80)}`)
  if (exitCode === 0) {
    log('✓ ALL TESTS PASSED', 'green')
  } else {
    log('✗ SOME TESTS FAILED', 'red')
  }
  log('='.repeat(80) + '\n')

  return exitCode
}

// Main test runner
async function main() {
  log('\n╔═══════════════════════════════════════════════════════════════════════════╗', 'cyan')
  log('║              Cinqueterre.travel - Comprehensive Feature Tests            ║', 'cyan')
  log('╚═══════════════════════════════════════════════════════════════════════════╝', 'cyan')

  try {
    initializeClients()

    await testDatabaseConnectivity()
    await testCompanyManagement()
    await testDepartmentManagement()
    await testRoleManagement()
    await testAgentManagement()
    await testWebsiteManagement()
    await testSitemapManagement()
    await testEditorialTasks()
    await testTaskPhases()
    await testBlueprintManagement()
    await testGitHubIntegration()
    await testTaskDependencies()
    await testSEOMetadata()
    await testAgentActivities()
    await testContentSuggestions()

    const exitCode = printSummary()

    await dbPool.end()
    process.exit(exitCode)

  } catch (error) {
    log('\n✗ Fatal Error:', 'red')
    console.error(error)
    await dbPool?.end()
    process.exit(1)
  }
}

// Run tests
main()
