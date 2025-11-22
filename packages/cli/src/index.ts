#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { initCommand } from './commands/init'
import { contentCommands } from './commands/content'
import { workflowCommands } from './commands/workflow'
import { agentCommands } from './commands/agent'
import { eventsCommands } from './commands/events'

const program = new Command()

program
  .name('swarmpress')
  .description('Operator CLI for swarm.press - autonomous publishing platform')
  .version('0.1.0')

// Init command
program
  .command('init')
  .description('Initialize swarm.press with default company, departments, roles, and agents')
  .action(initCommand)

// Content commands
program
  .command('content:create')
  .description('Create a new content item')
  .argument('[title]', 'Content title')
  .action(contentCommands.create)

program
  .command('content:list')
  .description('List all content items')
  .option('-s, --status <status>', 'Filter by status')
  .action(contentCommands.list)

// Workflow commands
program
  .command('workflow:start')
  .description('Start a workflow')
  .argument('<workflow>', 'Workflow name (content-production, editorial-review, publishing)')
  .option('--briefId <id>', 'Brief ID for content production workflow')
  .action(workflowCommands.start)

program
  .command('workflow:list')
  .description('List running workflows')
  .action(workflowCommands.list)

// Agent commands
program
  .command('agent:invoke')
  .description('Invoke an agent tool directly')
  .argument('<agent>', 'Agent name (WriterAgent, EditorAgent, etc.)')
  .argument('<tool>', 'Tool name')
  .argument('[payload]', 'JSON payload')
  .action(agentCommands.invoke)

program
  .command('agent:list')
  .description('List all registered agents')
  .action(agentCommands.list)

// Events commands
program
  .command('events:tail')
  .description('Tail the event stream in real-time')
  .option('-f, --filter <pattern>', 'Filter events by type pattern')
  .action(eventsCommands.tail)

// Error handling
program.exitOverride()

try {
  program.parse()
} catch (error) {
  if (error instanceof Error) {
    console.error(chalk.red('Error:'), error.message)
  }
  process.exit(1)
}
