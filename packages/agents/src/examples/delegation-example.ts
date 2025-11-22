/**
 * Agent Delegation Example
 * Demonstrates how agents can delegate tasks to each other
 */

import { initializeAgents, agentFactory } from '../index'
import type { AgentContext } from '../base/agent'

/**
 * Example: Writer agent delegates to Editor agent
 */
export async function exampleWriterToEditor() {
  console.log('\n=== Writer to Editor Delegation Example ===\n')

  // Initialize agent registry
  initializeAgents()

  // Get writer agent
  const writerAgent = await agentFactory.getAgentByRole('Writer')
  if (!writerAgent) {
    console.error('Writer agent not found')
    return
  }

  // Create a context
  const context: AgentContext = {
    agentId: 'writer-001',
    taskId: 'task-001',
  }

  // Writer creates content and then wants editor to review
  console.log('Writer: Creating draft...')

  // In a real scenario, the writer would use their tools to create content
  // Then delegate to editor for review
  const editorPrompt = `Please review the content with ID content-123.
Check for quality, grammar, and adherence to editorial standards.`

  console.log('Writer: Delegating to Editor for review...')

  // Demonstrate delegation (commented out as it requires actual agent instances)
  /*
  const editorResponse = await (writerAgent as any).delegateToAgent(
    'Editor',
    editorPrompt,
    context
  )

  console.log('Editor response:', editorResponse)
  */

  console.log('Delegation mechanism ready (requires database and agent instances)')
}

/**
 * Example: Editor escalates to CEO Assistant
 */
export async function exampleEditorToCEOAssistant() {
  console.log('\n=== Editor to CEO Assistant Delegation Example ===\n')

  initializeAgents()

  // Get editor agent
  const editorAgent = await agentFactory.getAgentByRole('Editor')
  if (!editorAgent) {
    console.error('Editor agent not found')
    return
  }

  const context: AgentContext = {
    agentId: 'editor-001',
    taskId: 'task-002',
  }

  console.log('Editor: Found high-risk content requiring CEO approval...')

  // Editor would use escalate_to_ceo tool to create a question ticket
  // CEO Assistant would then organize and summarize for CEO

  console.log(
    'Editor creates question ticket via escalate_to_ceo tool (requires database)'
  )
  console.log('CEO Assistant can then summarize all tickets for CEO dashboard')
}

/**
 * Delegation workflow example
 */
export function demonstrateDelegationPattern() {
  console.log('\n=== Agent Delegation Pattern ===\n')

  console.log(`
Agent delegation works as follows:

1. Agent A encounters a task outside its capabilities
2. Agent A calls delegateToAgent(role, task, context)
3. AgentFactory finds an agent with the target role
4. Target Agent B executes the delegated task
5. Result is returned to Agent A
6. Agent A continues with the response

Example delegations in agent.press:
- Writer → Editor: Submit content for review
- Editor → CEO: Escalate high-risk content
- Editor → Writer: Request revisions
- Engineering → Writer: Report deployment issues
- Any Agent → CEOAssistant: Escalate blockers

The delegation is transparent and maintains the audit trail
through the AgentContext that is passed along.
`)
}

// Run examples if called directly
if (require.main === module) {
  demonstrateDelegationPattern()
  // These would require database connection:
  // exampleWriterToEditor()
  // exampleEditorToCEOAssistant()
}
