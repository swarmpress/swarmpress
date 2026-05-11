/**
 * Events Commands
 * Tail the event stream in real-time
 */

import chalk from 'chalk'
import ora from 'ora'
import { printHeader, printError, printInfo } from '../utils/formatters'

// Dynamic import for event-bus to handle environment loading
async function loadEventBus() {
  // Ensure environment is loaded
  const dotenv = await import('dotenv')
  dotenv.config()

  const { eventBus, subscribeAll, subscribe } = await import('@swarm-press/event-bus')
  return { eventBus, subscribeAll, subscribe }
}

interface CloudEvent {
  specversion: string
  type: string
  source: string
  subject?: string
  id: string
  time?: string
  datacontenttype?: string
  data?: unknown
}

/**
 * Format event type with color coding
 */
function formatEventType(type: string): string {
  const typeColors: Record<string, (s: string) => string> = {
    // Content events
    'content.created': chalk.green,
    'content.submittedForReview': chalk.yellow,
    'content.needsChanges': chalk.red,
    'content.approved': chalk.green,
    'content.published': chalk.cyan,

    // Task events
    'task.created': chalk.blue,
    'task.completed': chalk.green,

    // Ticket events
    'ticket.created': chalk.magenta,
    'ticket.answered': chalk.cyan,
    'ticket.closed': chalk.gray,

    // Deploy events
    'deploy.started': chalk.yellow,
    'deploy.success': chalk.green,
    'deploy.failed': chalk.red,
  }

  const colorFn = typeColors[type] ?? chalk.white
  return colorFn(type)
}

/**
 * Format event data for display
 */
function formatEventData(data: unknown): string {
  if (!data) return ''

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return ''

    return entries
      .map(([key, value]) => {
        const formattedValue = typeof value === 'string'
          ? value.length > 50 ? value.substring(0, 47) + '...' : value
          : JSON.stringify(value)
        return `${chalk.gray(key)}=${formattedValue}`
      })
      .join(' ')
  }

  return String(data)
}

export const eventsCommands = {
  /**
   * Tail the event stream in real-time
   */
  async tail(options: { filter?: string }) {
    printHeader('Event Stream')

    const spinner = ora('Connecting to NATS event bus...').start()

    try {
      const { eventBus, subscribeAll, subscribe } = await loadEventBus()

      // Connect to NATS
      await eventBus.connect()
      spinner.succeed('Connected to NATS event bus')

      console.log()
      if (options.filter) {
        printInfo(`Filter: ${options.filter}`)
      }
      console.log(chalk.gray('Listening for events... (Press Ctrl+C to stop)'))
      console.log()
      console.log(chalk.gray('─'.repeat(80)))
      console.log()

      // Event counter
      let eventCount = 0

      // Handler for events
      const handleEvent = async (event: CloudEvent) => {
        eventCount++

        // Apply filter if specified
        if (options.filter && !event.type.includes(options.filter)) {
          return
        }

        const timestamp = event.time ? new Date(event.time).toLocaleTimeString() : new Date().toLocaleTimeString()
        const eventType = formatEventType(event.type)
        const source = chalk.gray(event.source)
        const subject = event.subject ? chalk.cyan(event.subject) : ''
        const data = formatEventData(event.data)

        // Format: [TIME] EVENT_TYPE subject source
        //         data
        console.log(
          `${chalk.gray(`[${timestamp}]`)} ${eventType}` +
          (subject ? ` ${subject}` : '') +
          ` ${source}`
        )

        if (data) {
          console.log(`  ${data}`)
        }

        console.log()
      }

      // Subscribe to events
      if (options.filter) {
        await subscribe(options.filter, handleEvent)
      } else {
        await subscribeAll(handleEvent)
      }

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log()
        console.log(chalk.gray('─'.repeat(80)))
        console.log()
        printInfo(`Received ${eventCount} events`)
        console.log()

        spinner.start('Closing connection...')
        await eventBus.close()
        spinner.succeed('Connection closed')

        process.exit(0)
      })

      // Keep the process running
      await new Promise(() => {})

    } catch (error) {
      spinner.fail('Failed to connect to event bus')
      printError(error instanceof Error ? error.message : String(error))
      console.log()
      console.log(chalk.gray('Make sure NATS is running:'))
      console.log(chalk.gray('  docker-compose up -d'))
      console.log()
      console.log(chalk.gray('Check NATS_URL in your .env file'))
      console.log()
      process.exit(1)
    }
  },
}
