#!/usr/bin/env node

/**
 * swarmpress CLI
 * Operator CLI for swarm.press - autonomous publishing platform
 */

import { Command } from 'commander'
import { initCommand } from './commands/init'
import { contentCommands } from './commands/content'
import { workflowCommands } from './commands/workflow'
import { agentCommands } from './commands/agent'
import { eventsCommands } from './commands/events'

// Load environment variables
import 'dotenv/config'

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
  .option('-s, --status <status>', 'Filter by status (idea, draft, in_editorial_review, published, etc.)')
  .option('-w, --websiteId <id>', 'Filter by website ID')
  .action((options) => contentCommands.list(options))

// Workflow commands
program
  .command('workflow:start')
  .description('Start a workflow')
  .argument('<workflow>', 'Workflow name: content-production, editorial-review, publishing, full-pipeline')
  .option('--contentId <id>', 'Content ID to process')
  .option('--websiteId <id>', 'Website ID for publishing')
  .option('--writerAgentId <id>', 'Writer agent ID')
  .option('--editorAgentId <id>', 'Editor agent ID')
  .option('--engineeringAgentId <id>', 'Engineering agent ID')
  .option('--seoAgentId <id>', 'SEO agent ID')
  .option('--brief <text>', 'Content brief for writer')
  .action((workflow, options) => workflowCommands.start(workflow, options))

program
  .command('workflow:list')
  .description('Check Temporal workflow status')
  .action(workflowCommands.list)

// Agent commands
program
  .command('agent:invoke')
  .description('Invoke an agent tool directly')
  .argument('<agent>', 'Agent name or ID')
  .argument('<tool>', 'Tool/capability name')
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
  .option('-f, --filter <pattern>', 'Filter events by type pattern (e.g., content, task, deploy)')
  .action((options) => eventsCommands.tail(options))

// Parse command line arguments
program.parse()
