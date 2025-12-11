/**
 * Init Command
 * Initializes swarm.press with default company, departments, roles, and agents
 */

import chalk from 'chalk'
import ora from 'ora'
import { api, checkApiConnection } from '../utils/api-client'
import { printSuccess, printError, printInfo, printHeader } from '../utils/formatters'

interface InitResult {
  companyId: string
  departmentIds: Record<string, string>
  roleIds: Record<string, string>
  agentIds: string[]
  websiteId: string
}

/**
 * Default organization structure for swarm.press
 */
const DEFAULT_COMPANY = {
  name: 'swarm.press Media House',
  description: 'Autonomous AI-powered publishing organization',
}

const DEFAULT_DEPARTMENTS = [
  { name: 'Editorial', description: 'Content review and quality assurance' },
  { name: 'Writers Room', description: 'Content creation and research' },
  { name: 'Engineering', description: 'Site building and deployment' },
  { name: 'Governance', description: 'CEO oversight and escalations' },
]

const DEFAULT_ROLES = [
  { name: 'Writer', department: 'Writers Room', description: 'Creates and drafts content' },
  { name: 'Editor', department: 'Editorial', description: 'Reviews and approves content' },
  { name: 'ChiefEditor', department: 'Editorial', description: 'Senior editorial oversight' },
  { name: 'EngineeringAgent', department: 'Engineering', description: 'Builds and deploys sites' },
  { name: 'SEOSpecialist', department: 'Engineering', description: 'Optimizes content for search' },
  { name: 'CEOAssistant', department: 'Governance', description: 'Manages escalations and summaries' },
]

const DEFAULT_AGENTS = [
  {
    name: 'Alice',
    role: 'Writer',
    persona: 'A creative and thorough content writer who specializes in engaging narratives',
    virtualEmail: 'alice@swarm-press.ai',
    capabilities: ['research_topic', 'write_draft', 'revise_draft', 'submit_for_review'],
  },
  {
    name: 'Bob',
    role: 'Editor',
    persona: 'A meticulous editor focused on quality, clarity, and accuracy',
    virtualEmail: 'bob@swarm-press.ai',
    capabilities: ['review_content', 'request_changes', 'approve_content', 'reject_content', 'escalate_to_ceo'],
  },
  {
    name: 'Charlie',
    role: 'EngineeringAgent',
    persona: 'A skilled engineer who ensures smooth site building and deployment',
    virtualEmail: 'charlie@swarm-press.ai',
    capabilities: ['prepare_build', 'validate_assets', 'publish_site'],
  },
  {
    name: 'Diana',
    role: 'CEOAssistant',
    persona: 'An organized assistant who summarizes tickets and organizes escalations',
    virtualEmail: 'diana@swarm-press.ai',
    capabilities: ['summarize_tickets', 'organize_escalations', 'notify_ceo'],
  },
]

const DEFAULT_WEBSITE = {
  title: 'My First Publication',
  domain: 'my-publication.swarm.press',
  description: 'A sample publication created by swarm.press',
}

export async function initCommand() {
  printHeader('swarm.press Initialization')

  // Check API connection
  const spinner = ora('Checking API server connection...').start()
  const isConnected = await checkApiConnection()

  if (!isConnected) {
    spinner.fail('Cannot connect to API server')
    printError('Make sure the backend is running: pnpm --filter @swarm-press/backend dev')
    process.exit(1)
  }
  spinner.succeed('API server is running')

  const result: InitResult = {
    companyId: '',
    departmentIds: {},
    roleIds: {},
    agentIds: [],
    websiteId: '',
  }

  try {
    // Step 1: Create company
    spinner.start('Creating company...')
    try {
      const company = await api.company.create.mutate(DEFAULT_COMPANY)
      result.companyId = company.id
      spinner.succeed(`Created company: ${chalk.cyan(company.name)} (${company.id})`)
    } catch (error: unknown) {
      const err = error as { message?: string }
      if (err.message?.includes('already exists')) {
        spinner.warn('Company already exists, fetching existing...')
        const { items } = await api.company.list.query()
        if (items.length > 0) {
          result.companyId = items[0].id
          printInfo(`Using existing company: ${items[0].name}`)
        }
      } else {
        throw error
      }
    }

    // Step 2: Create departments
    spinner.start('Creating departments...')
    for (const dept of DEFAULT_DEPARTMENTS) {
      try {
        const department = await api.department.create.mutate({
          ...dept,
          companyId: result.companyId,
        })
        result.departmentIds[dept.name] = department.id
      } catch (error: unknown) {
        const err = error as { message?: string }
        if (err.message?.includes('already exists')) {
          // Fetch existing department
          const { items } = await api.department.list.query({ companyId: result.companyId })
          const existing = items.find((d: { name: string }) => d.name === dept.name)
          if (existing) {
            result.departmentIds[dept.name] = existing.id
          }
        } else {
          throw error
        }
      }
    }
    spinner.succeed(`Created ${Object.keys(result.departmentIds).length} departments`)

    // Step 3: Create roles
    spinner.start('Creating roles...')
    for (const role of DEFAULT_ROLES) {
      const departmentId = result.departmentIds[role.department]
      if (!departmentId) {
        console.warn(`  ⚠️  Department ${role.department} not found, skipping role ${role.name}`)
        continue
      }

      try {
        const createdRole = await api.role.create.mutate({
          name: role.name,
          description: role.description,
          departmentId,
        })
        result.roleIds[role.name] = createdRole.id
      } catch (error: unknown) {
        const err = error as { message?: string }
        if (err.message?.includes('already exists')) {
          const { items } = await api.role.list.query({ departmentId })
          const existing = items.find((r: { name: string }) => r.name === role.name)
          if (existing) {
            result.roleIds[role.name] = existing.id
          }
        } else {
          throw error
        }
      }
    }
    spinner.succeed(`Created ${Object.keys(result.roleIds).length} roles`)

    // Step 4: Create agents
    spinner.start('Creating agents...')
    for (const agent of DEFAULT_AGENTS) {
      const roleId = result.roleIds[agent.role]
      const roleDef = DEFAULT_ROLES.find(r => r.name === agent.role)
      const departmentId = roleDef ? result.departmentIds[roleDef.department] : undefined

      if (!roleId || !departmentId) {
        console.warn(`  ⚠️  Role ${agent.role} not found, skipping agent ${agent.name}`)
        continue
      }

      try {
        const createdAgent = await api.agent.create.mutate({
          name: agent.name,
          roleId,
          departmentId,
          persona: agent.persona,
          virtualEmail: agent.virtualEmail,
          capabilities: agent.capabilities,
        })
        result.agentIds.push(createdAgent.id)
      } catch (error: unknown) {
        const err = error as { message?: string }
        if (err.message?.includes('already exists')) {
          printInfo(`  Agent ${agent.name} already exists, skipping`)
        } else {
          throw error
        }
      }
    }
    spinner.succeed(`Created ${result.agentIds.length} agents`)

    // Step 5: Create default website
    spinner.start('Creating default website...')
    try {
      const website = await api.website.create.mutate(DEFAULT_WEBSITE)
      result.websiteId = website.id
      spinner.succeed(`Created website: ${chalk.cyan(website.title)}`)
    } catch (error: unknown) {
      const err = error as { message?: string }
      if (err.message?.includes('already exists')) {
        spinner.warn('Website already exists')
        const { items } = await api.website.list.query()
        if (items.length > 0) {
          result.websiteId = items[0].id
          printInfo(`Using existing website: ${items[0].title || items[0].name}`)
        }
      } else {
        throw error
      }
    }

    // Success summary
    console.log()
    printSuccess('swarm.press initialized successfully!')
    console.log()
    console.log(chalk.gray('Resources created:'))
    console.log(chalk.gray(`  Company:     ${result.companyId}`))
    console.log(chalk.gray(`  Departments: ${Object.keys(result.departmentIds).length}`))
    console.log(chalk.gray(`  Roles:       ${Object.keys(result.roleIds).length}`))
    console.log(chalk.gray(`  Agents:      ${result.agentIds.length}`))
    console.log(chalk.gray(`  Website:     ${result.websiteId}`))
    console.log()
    console.log(chalk.cyan('Next steps:'))
    console.log(chalk.gray('  1. swarmpress content:create "My First Article"'))
    console.log(chalk.gray('  2. swarmpress workflow:start content-production --contentId=<id>'))
    console.log(chalk.gray('  3. swarmpress events:tail'))
    console.log()

  } catch (error) {
    spinner.fail('Initialization failed')
    printError(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
