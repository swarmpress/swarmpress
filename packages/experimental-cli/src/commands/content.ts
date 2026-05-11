/**
 * Content Commands
 * Create and list content items
 */

import chalk from 'chalk'
import ora from 'ora'
import { api, checkApiConnection } from '../utils/api-client'
import {
  formatTable,
  formatStatus,
  formatId,
  formatTimestamp,
  printHeader,
  printSuccess,
  printError,
  printInfo,
} from '../utils/formatters'

export const contentCommands = {
  /**
   * Create a new content item
   */
  async create(title?: string) {
    printHeader('Create Content')

    // Check API connection
    const spinner = ora('Connecting to API...').start()
    const isConnected = await checkApiConnection()

    if (!isConnected) {
      spinner.fail('Cannot connect to API server')
      printError('Make sure the backend is running: pnpm --filter @swarm-press/backend dev')
      process.exit(1)
    }
    spinner.succeed('Connected')

    try {
      // Get list of websites to select from
      spinner.start('Fetching websites...')
      const { items: websites } = await api.website.list.query()

      if (websites.length === 0) {
        spinner.fail('No websites found')
        printError('Run "swarmpress init" first to create a website')
        process.exit(1)
      }
      spinner.succeed(`Found ${websites.length} website(s)`)

      // Get list of agents to select author
      spinner.start('Fetching agents...')
      const { items: agents } = await api.agent.list.query()

      if (agents.length === 0) {
        spinner.fail('No agents found')
        printError('Run "swarmpress init" first to create agents')
        process.exit(1)
      }
      spinner.succeed(`Found ${agents.length} agent(s)`)

      // Use first website and first writer agent by default
      const websiteId = websites[0].id
      const writerAgent = agents.find((a: { capabilities?: string[] }) =>
        a.capabilities?.includes('write_draft')
      ) || agents[0]

      // Create content
      spinner.start('Creating content...')
      const content = await api.content.create.mutate({
        type: 'article',
        websiteId,
        authorAgentId: writerAgent.id,
        metadata: {
          title: title || 'Untitled Content',
          tags: [],
        },
      })
      spinner.succeed('Content created')

      console.log()
      printSuccess(`Content created successfully!`)
      console.log()
      console.log(chalk.gray('Content details:'))
      console.log(chalk.gray(`  ID:       ${content.id}`))
      console.log(chalk.gray(`  Type:     ${content.type}`))
      console.log(chalk.gray(`  Status:   ${content.status}`))
      console.log(chalk.gray(`  Website:  ${websiteId}`))
      console.log(chalk.gray(`  Author:   ${writerAgent.name}`))
      console.log()
      console.log(chalk.cyan('Next steps:'))
      console.log(chalk.gray(`  1. Start content production workflow:`))
      console.log(chalk.gray(`     swarmpress workflow:start content-production --contentId=${content.id}`))
      console.log()

    } catch (error) {
      spinner.fail('Failed to create content')
      printError(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },

  /**
   * List all content items
   */
  async list(options: { status?: string; websiteId?: string }) {
    printHeader('Content Items')

    // Check API connection
    const spinner = ora('Fetching content...').start()
    const isConnected = await checkApiConnection()

    if (!isConnected) {
      spinner.fail('Cannot connect to API server')
      printError('Make sure the backend is running: pnpm --filter @swarm-press/backend dev')
      process.exit(1)
    }

    try {
      const queryParams: {
        status?: 'idea' | 'planned' | 'brief_created' | 'draft' | 'in_editorial_review' | 'needs_changes' | 'approved' | 'scheduled' | 'published' | 'archived'
        websiteId?: string
        limit?: number
      } = {
        limit: 50,
      }

      if (options.status) {
        queryParams.status = options.status as typeof queryParams.status
      }
      if (options.websiteId) {
        queryParams.websiteId = options.websiteId
      }

      const { items, total } = await api.content.list.query(queryParams)
      spinner.succeed(`Found ${total} content item(s)`)

      if (items.length === 0) {
        printInfo('No content items found')
        console.log()
        console.log(chalk.gray('Create your first content item:'))
        console.log(chalk.gray('  swarmpress content:create "My First Article"'))
        console.log()
        return
      }

      // Format as table
      const headers = ['ID', 'Type', 'Status', 'Author', 'Created']
      const rows = items.map((item: {
        id: string
        type: string
        status: string
        author_agent_id?: string
        created_at?: string | Date
        metadata?: { title?: string }
      }) => [
        formatId(item.id),
        item.type,
        formatStatus(item.status),
        item.author_agent_id ? formatId(item.author_agent_id) : '-',
        formatTimestamp(item.created_at),
      ])

      console.log()
      console.log(formatTable(headers, rows))
      console.log()

      if (options.status) {
        printInfo(`Filtered by status: ${options.status}`)
      }

      console.log(chalk.gray(`Showing ${items.length} of ${total} items`))
      console.log()

    } catch (error) {
      spinner.fail('Failed to list content')
      printError(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
}
