/**
 * Agent Commands
 * List agents and invoke agent capabilities
 */

import chalk from 'chalk'
import ora from 'ora'
import { api, checkApiConnection } from '../utils/api-client'
import {
  formatTable,
  formatStatus,
  formatId,
  printHeader,
  printError,
  printInfo,
  printWarning,
} from '../utils/formatters'

export const agentCommands = {
  /**
   * Invoke an agent tool directly
   */
  async invoke(agent: string, tool: string, payload?: string) {
    printHeader(`Invoke Agent: ${agent}`)

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
      // Find the agent
      spinner.start('Finding agent...')
      const { items: agents } = await api.agent.list.query()

      const targetAgent = agents.find((a: { name: string; id: string }) =>
        a.name.toLowerCase() === agent.toLowerCase() ||
        a.id === agent
      )

      if (!targetAgent) {
        spinner.fail(`Agent "${agent}" not found`)
        console.log()
        console.log(chalk.gray('Available agents:'))
        agents.forEach((a: { name: string; id: string }) => {
          console.log(chalk.gray(`  - ${a.name} (${a.id})`))
        })
        console.log()
        process.exit(1)
      }
      spinner.succeed(`Found agent: ${targetAgent.name}`)

      // Check if agent has the capability
      const capabilities = targetAgent.capabilities || []
      if (!capabilities.includes(tool)) {
        printWarning(`Agent "${targetAgent.name}" does not have capability "${tool}"`)
        console.log()
        console.log(chalk.gray('Available capabilities:'))
        capabilities.forEach((c: string) => console.log(chalk.gray(`  - ${c}`)))
        console.log()
      }

      // Parse payload if provided
      let parsedPayload: Record<string, unknown> = {}
      if (payload) {
        try {
          parsedPayload = JSON.parse(payload)
        } catch {
          printError('Invalid JSON payload')
          console.log(chalk.gray('Example: \'{"topic": "AI agents"}\''))
          process.exit(1)
        }
      }

      // Note: Direct agent invocation requires the agent package
      // For now, suggest using workflows instead
      printInfo('Direct agent invocation is not yet available via CLI')
      console.log()
      console.log(chalk.gray('For now, use workflows to trigger agent actions:'))
      console.log(chalk.gray('  swarmpress workflow:start content-production --contentId=<id>'))
      console.log()
      console.log(chalk.gray('Agent details:'))
      console.log(chalk.gray(`  ID:           ${targetAgent.id}`))
      console.log(chalk.gray(`  Name:         ${targetAgent.name}`))
      console.log(chalk.gray(`  Role:         ${targetAgent.role_id || 'N/A'}`))
      console.log(chalk.gray(`  Capabilities: ${capabilities.join(', ') || 'none'}`))
      console.log(chalk.gray(`  Tool:         ${tool}`))
      if (Object.keys(parsedPayload).length > 0) {
        console.log(chalk.gray(`  Payload:      ${JSON.stringify(parsedPayload)}`))
      }
      console.log()

    } catch (error) {
      spinner.fail('Failed to invoke agent')
      printError(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },

  /**
   * List all registered agents
   */
  async list() {
    printHeader('Registered Agents')

    // Check API connection
    const spinner = ora('Fetching agents...').start()
    const isConnected = await checkApiConnection()

    if (!isConnected) {
      spinner.fail('Cannot connect to API server')
      printError('Make sure the backend is running: pnpm --filter @swarm-press/backend dev')
      process.exit(1)
    }

    try {
      const { items: agents, total } = await api.agent.list.query()
      spinner.succeed(`Found ${total} agent(s)`)

      if (agents.length === 0) {
        printInfo('No agents found')
        console.log()
        console.log(chalk.gray('Create agents with:'))
        console.log(chalk.gray('  swarmpress init'))
        console.log()
        return
      }

      // Format as table
      const headers = ['ID', 'Name', 'Email', 'Status', 'Capabilities']
      const rows = agents.map((agent: {
        id: string
        name: string
        virtual_email?: string
        status?: string
        capabilities?: string[]
      }) => [
        formatId(agent.id),
        agent.name,
        agent.virtual_email || '-',
        formatStatus(agent.status || 'active'),
        (agent.capabilities || []).slice(0, 3).join(', ') + ((agent.capabilities?.length || 0) > 3 ? '...' : ''),
      ])

      console.log()
      console.log(formatTable(headers, rows, { truncate: 30 }))
      console.log()

      // Show detailed capabilities for each agent
      console.log(chalk.cyan('Agent Capabilities:'))
      console.log()
      agents.forEach((agent: { name: string; capabilities?: string[] }) => {
        console.log(chalk.bold(`  ${agent.name}:`))
        const caps = agent.capabilities || []
        if (caps.length === 0) {
          console.log(chalk.gray('    (no capabilities defined)'))
        } else {
          caps.forEach((cap: string) => console.log(chalk.gray(`    - ${cap}`)))
        }
        console.log()
      })

    } catch (error) {
      spinner.fail('Failed to list agents')
      printError(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
}
