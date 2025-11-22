/**
 * @agent-press/agents
 * Claude agents for agent.press
 */

// Export base infrastructure
export * from './base'

// Export agent implementations
export * from './writer'
export * from './editor'
export * from './engineering'
export * from './ceo-assistant'

// Register agents
import { registerAgent } from './base/factory'
import { WriterAgent } from './writer'
import { EditorAgent } from './editor'
import { EngineeringAgent } from './engineering'
import { CEOAssistantAgent } from './ceo-assistant'

/**
 * Initialize agent registry
 * Call this on application startup to register all agent types
 */
export function initializeAgents() {
  registerAgent('Writer', WriterAgent)
  registerAgent('Editor', EditorAgent)
  registerAgent('ChiefEditor', EditorAgent) // Same class, different role
  registerAgent('EngineeringAgent', EngineeringAgent)
  registerAgent('SEOSpecialist', EngineeringAgent) // Can share engineering tools
  registerAgent('CEOAssistant', CEOAssistantAgent)

  console.log('✅ All agent types registered')
}
