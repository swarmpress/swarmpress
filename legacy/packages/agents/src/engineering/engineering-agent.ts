/**
 * Engineering Agent
 *
 * After the repo-canonical migration, the EngineeringAgent no longer
 * exposes build/deploy tools — each site repo's own GitHub Actions
 * workflow owns build+deploy. The agent now exposes the bidirectional
 * GitHub sync helpers, batch processing, and read-only website info.
 *
 * Deprecated tools (still on the prototype for backward compat, but NOT
 * registered as Claude tools — see deregistration list below):
 *   - validate_content
 *   - build_site
 *   - deploy_site
 *   - publish_website
 *   - build_from_github
 *
 * Active tools registered with Claude:
 *   - get_website_info
 *   - export_collection_to_github
 *   - import_collection_from_github
 *   - submit_batch_job
 *   - check_batch_status
 *   - list_batch_jobs
 */

import { BaseAgent, AgentConfig } from '../base/agent'
import type { Agent } from '@swarm-press/shared'
import { engineeringTools } from './tools'
import { engineeringToolHandlers } from './handlers'

/**
 * Tools that are deprecated post-repo-canonical migration and MUST NOT
 * be exposed to Claude. The handlers in `handlers.ts` remain so existing
 * code paths don't break, but the agent will not pick them up at runtime.
 */
const DEPRECATED_TOOL_NAMES = new Set<string>([
  'validate_content',
  'build_site',
  'deploy_site',
  'publish_website',
  'build_from_github',
])

export class EngineeringAgent extends BaseAgent {
  constructor(agentData: Agent) {
    const config: AgentConfig = {
      name: agentData.name,
      role: 'Engineer',
      department: 'Engineering',
      capabilities: agentData.capabilities,
      systemPrompt: `You are ${agentData.name}, an engineering agent at swarm.press.

${agentData.persona}

## Your Role
You support the editorial pipeline by syncing content between the database
and GitHub repositories, and by orchestrating batch content-generation
jobs. You DO NOT build or deploy sites — each site repository's own
\`.github/workflows/deploy.yml\` owns build+deploy. When content is merged
into the main branch of a site repo, the site repo's GitHub Actions
workflow builds the Astro site and deploys via \`actions/deploy-pages@v4\`.

## Available Tools
You have access to the following tools — ALWAYS use them to accomplish
your tasks:

1. **get_website_info** — Get website configuration and content statistics
2. **export_collection_to_github** — Export collection items from the
   database into a GitHub repository (one-way, useful for migrations and
   backups)
3. **import_collection_from_github** — Import collection items from a
   GitHub repository into the database (sync direction inverse of export)
4. **submit_batch_job** — Submit a batch job for bulk collection content
   generation (Anthropic Message Batches API, 50% cost reduction)
5. **check_batch_status** — Check status of a running batch job
6. **list_batch_jobs** — List batch jobs for a website

## Deprecated Tools (do NOT request these — they are no longer registered)
- ~~validate_content~~ — validation now happens in the site repo's
  GitHub Actions workflow
- ~~build_site~~ — replaced by the site repo's Actions deploy workflow
- ~~deploy_site~~ — replaced by the site repo's Actions deploy workflow
- ~~publish_website~~ — replaced by merging the editorial PR (which fires
  the site repo's deploy workflow)
- ~~build_from_github~~ — the platform no longer pulls repo content for
  local builds; builds happen inside GitHub Actions

## Workflow
- For inspecting website state: use \`get_website_info\`
- For migrating existing collection rows from the DB into the canonical
  repo: \`export_collection_to_github\`
- For backfilling DB rows from existing repo JSON: \`import_collection_from_github\`
- For bulk content generation: \`submit_batch_job\` then poll with
  \`check_batch_status\`

IMPORTANT: You MUST use the tools to perform actions. If a caller asks
you to "publish" or "deploy", explain that publication is triggered by
merging the editorial PR — there is no agent-side deploy step.`,
    }

    super(config)

    // Register tools
    this.registerTools()
  }

  /**
   * Register engineering-specific tools.
   *
   * Skips any tool listed in DEPRECATED_TOOL_NAMES; their handlers remain
   * in handlers.ts for backward compat but are not reachable as Claude
   * tools after the repo-canonical migration.
   */
  private registerTools(): void {
    let registered = 0
    let skipped = 0
    for (const tool of engineeringTools) {
      if (DEPRECATED_TOOL_NAMES.has(tool.name)) {
        skipped++
        continue
      }
      const handler = engineeringToolHandlers[tool.name]
      if (handler) {
        this.toolRegistry.register(tool, handler)
        registered++
      } else {
        console.warn(`[EngineeringAgent] No handler found for tool: ${tool.name}`)
      }
    }
    console.log(
      `[EngineeringAgent] Registered ${registered} tools (skipped ${skipped} deprecated)`
    )
  }
}
