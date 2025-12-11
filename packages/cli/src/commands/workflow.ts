/**
 * Workflow Commands
 * Start and manage Temporal workflows
 */

import chalk from 'chalk'
import ora from 'ora'
import { api, checkApiConnection } from '../utils/api-client'
import {
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
} from '../utils/formatters'

type WorkflowType = 'content-production' | 'editorial-review' | 'publishing' | 'full-pipeline'

export const workflowCommands = {
  /**
   * Start a workflow
   */
  async start(
    workflow: string,
    options: {
      contentId?: string
      writerAgentId?: string
      editorAgentId?: string
      seoAgentId?: string
      engineeringAgentId?: string
      websiteId?: string
      brief?: string
    }
  ) {
    printHeader(`Start Workflow: ${workflow}`)

    // Validate workflow type
    const validWorkflows: WorkflowType[] = ['content-production', 'editorial-review', 'publishing', 'full-pipeline']
    if (!validWorkflows.includes(workflow as WorkflowType)) {
      printError(`Invalid workflow: ${workflow}`)
      console.log()
      console.log(chalk.gray('Available workflows:'))
      validWorkflows.forEach(w => console.log(chalk.gray(`  - ${w}`)))
      console.log()
      process.exit(1)
    }

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
      // Check Temporal connection
      spinner.start('Checking Temporal connection...')
      const { connected, message } = await api.workflow.status.query()

      if (!connected) {
        spinner.fail('Temporal not connected')
        printWarning(message)
        printError('Make sure Temporal is running: docker-compose up -d')
        process.exit(1)
      }
      spinner.succeed('Temporal connected')

      // Fetch required resources if not provided
      let contentId = options.contentId
      let writerAgentId = options.writerAgentId
      let editorAgentId = options.editorAgentId
      let seoAgentId = options.seoAgentId
      let engineeringAgentId = options.engineeringAgentId
      let websiteId = options.websiteId
      let brief = options.brief

      // Get content if not provided
      if (!contentId && workflow !== 'full-pipeline') {
        spinner.start('Fetching content items...')
        const { items } = await api.content.list.query({ limit: 1 })

        if (items.length === 0) {
          spinner.fail('No content items found')
          printError('Create content first: swarmpress content:create "My Article"')
          process.exit(1)
        }

        contentId = items[0].id
        spinner.succeed(`Using content: ${contentId}`)
      }

      // Get agents if not provided
      if (!writerAgentId || !editorAgentId || !engineeringAgentId || !seoAgentId) {
        spinner.start('Fetching agents...')
        const { items: agents } = await api.agent.list.query()

        if (agents.length === 0) {
          spinner.fail('No agents found')
          printError('Run "swarmpress init" first to create agents')
          process.exit(1)
        }

        // Find agents by capability
        if (!writerAgentId) {
          const writer = agents.find((a: { capabilities?: string[] }) =>
            a.capabilities?.includes('write_draft')
          )
          writerAgentId = writer?.id || agents[0].id
        }

        if (!editorAgentId) {
          const editor = agents.find((a: { capabilities?: string[] }) =>
            a.capabilities?.includes('review_content')
          )
          editorAgentId = editor?.id || agents[0].id
        }

        if (!engineeringAgentId) {
          const engineer = agents.find((a: { capabilities?: string[] }) =>
            a.capabilities?.includes('publish_site')
          )
          engineeringAgentId = engineer?.id || agents[0].id
        }

        if (!seoAgentId) {
          // SEO agent might not exist, use engineering agent
          seoAgentId = engineeringAgentId
        }

        spinner.succeed('Agents resolved')
      }

      // Get website if not provided (for publishing)
      if (!websiteId && (workflow === 'publishing' || workflow === 'full-pipeline')) {
        spinner.start('Fetching websites...')
        const { items: websites } = await api.website.list.query()

        if (websites.length === 0) {
          spinner.fail('No websites found')
          printError('Run "swarmpress init" first to create a website')
          process.exit(1)
        }

        websiteId = websites[0].id
        spinner.succeed(`Using website: ${websiteId}`)
      }

      // Default brief if not provided
      if (!brief) {
        brief = 'Write an engaging article on the given topic.'
      }

      // Start the workflow
      spinner.start(`Starting ${workflow} workflow...`)

      let result: {
        success: boolean
        workflowId?: string
        runId?: string
        pipelineId?: string
        message?: string
      }

      switch (workflow as WorkflowType) {
        case 'content-production':
          result = await api.workflow.startContentProduction.mutate({
            contentId: contentId!,
            writerAgentId: writerAgentId!,
            brief,
          })
          break

        case 'editorial-review':
          result = await api.workflow.startEditorialReview.mutate({
            contentId: contentId!,
            editorAgentId: editorAgentId!,
          })
          break

        case 'publishing':
          result = await api.workflow.startPublishing.mutate({
            contentId: contentId!,
            websiteId: websiteId!,
            seoAgentId: seoAgentId!,
            engineeringAgentId: engineeringAgentId!,
          })
          break

        case 'full-pipeline':
          result = await api.workflow.startFullPipeline.mutate({
            contentId: contentId!,
            websiteId: websiteId!,
            writerAgentId: writerAgentId!,
            editorAgentId: editorAgentId!,
            seoAgentId: seoAgentId!,
            engineeringAgentId: engineeringAgentId!,
            brief,
          })
          break

        default:
          throw new Error(`Unknown workflow: ${workflow}`)
      }

      spinner.succeed('Workflow started')

      console.log()
      printSuccess(`${workflow} workflow started successfully!`)
      console.log()
      console.log(chalk.gray('Workflow details:'))
      console.log(chalk.gray(`  Workflow ID: ${result.workflowId || result.pipelineId}`))
      if (result.runId) {
        console.log(chalk.gray(`  Run ID:      ${result.runId}`))
      }
      console.log(chalk.gray(`  Content:     ${contentId}`))
      console.log()
      console.log(chalk.cyan('Monitor progress:'))
      console.log(chalk.gray('  swarmpress events:tail'))
      console.log(chalk.gray('  Open Temporal UI: http://localhost:8233'))
      console.log()

    } catch (error) {
      spinner.fail('Failed to start workflow')
      printError(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },

  /**
   * List running workflows / check status
   */
  async list() {
    printHeader('Workflow Status')

    // Check API connection
    const spinner = ora('Checking Temporal status...').start()
    const isConnected = await checkApiConnection()

    if (!isConnected) {
      spinner.fail('Cannot connect to API server')
      printError('Make sure the backend is running: pnpm --filter @swarm-press/backend dev')
      process.exit(1)
    }

    try {
      const { connected, message } = await api.workflow.status.query()

      if (connected) {
        spinner.succeed('Temporal connected')
        console.log()
        printSuccess(message)
      } else {
        spinner.warn('Temporal not connected')
        printWarning(message)
      }

      console.log()
      printInfo('To view running workflows, open Temporal UI:')
      console.log(chalk.gray('  http://localhost:8233'))
      console.log()
      printInfo('Available workflow commands:')
      console.log(chalk.gray('  swarmpress workflow:start content-production'))
      console.log(chalk.gray('  swarmpress workflow:start editorial-review'))
      console.log(chalk.gray('  swarmpress workflow:start publishing'))
      console.log(chalk.gray('  swarmpress workflow:start full-pipeline'))
      console.log()

    } catch (error) {
      spinner.fail('Failed to check status')
      printError(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
}
