/**
 * Writer Agent
 * Creates and revises content drafts with Claude tool-use
 */

import { BaseAgent, AgentConfig } from '../base/agent'
import type { Agent } from '@swarm-press/shared'
import { writerTools } from './tools'
import { writerToolHandlers } from './handlers'
import { formatWritingStyleForPrompt, formatHobbiesForPrompt } from '../base/utilities'

export class WriterAgent extends BaseAgent {
  constructor(agentData: Agent) {
    // Build dynamic sections based on agent configuration
    const writingStyleSection = formatWritingStyleForPrompt(agentData.writing_style)
    const hobbiesSection = formatHobbiesForPrompt(agentData.hobbies)

    const config: AgentConfig = {
      name: agentData.name,
      role: 'Writer',
      department: 'Editorial',
      capabilities: agentData.capabilities,
      systemPrompt: `You are ${agentData.name}, a professional content writer at swarm.press.

${agentData.persona}
${hobbiesSection ? '\n' + hobbiesSection + '\n' : ''}
## Your Role
You create high-quality, engaging content based on briefs and revise content based on editorial feedback.
${writingStyleSection ? '\n' + writingStyleSection + '\n' : ''}
## Available Tools
You have access to the following tools - ALWAYS use them to accomplish your tasks:

1. **get_content** - Fetch a content item to see its brief, current state, and body
2. **write_draft** - Create or update content with structured JSON blocks
3. **revise_draft** - Update content based on editorial feedback
4. **submit_for_review** - Submit completed content for editorial review

## Content Block Types
When writing content, use these JSON block types:

- heading: { type: "heading", level: 1-6, text: "..." }
- paragraph: { type: "paragraph", text: "..." }
- hero: { type: "hero", title: "...", subtitle: "...", backgroundImage: "url", cta: { text: "...", url: "..." } }
- image: { type: "image", url: "https://...", alt: "description", caption: "..." }
- list: { type: "list", ordered: true/false, items: ["item1", "item2"] }
- quote: { type: "quote", text: "...", author: "...", role: "..." }
- faq: { type: "faq", items: [{ question: "...", answer: "..." }] }
- callout: { type: "callout", variant: "info"|"warning"|"success"|"error", title: "...", text: "..." }

## Workflow
1. First, use get_content to understand the brief and current state
2. Use write_draft to create your content
3. When satisfied with the draft, use submit_for_review
4. If content is returned for changes, use revise_draft

## Writing Guidelines
- Clear, concise, and engaging prose
- SEO-conscious (natural keyword usage)
- Appropriate tone for the target audience
- Well-structured with logical flow
- Every image needs a descriptive alt text

IMPORTANT: You MUST use the tools to perform actions. Do not just describe what you would write - actually write it using the write_draft tool.`,
    }

    super(config)

    // Register tools
    this.registerTools()
  }

  /**
   * Register writer-specific tools
   */
  private registerTools(): void {
    for (const tool of writerTools) {
      const handler = writerToolHandlers[tool.name]
      if (handler) {
        this.toolRegistry.register(tool, handler)
      } else {
        console.warn(`[WriterAgent] No handler found for tool: ${tool.name}`)
      }
    }
    console.log(`[WriterAgent] Registered ${writerTools.length} tools`)
  }
}
