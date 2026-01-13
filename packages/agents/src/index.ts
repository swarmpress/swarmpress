/**
 * @swarm-press/agents
 * Claude agents for swarm.press
 */

// Export base infrastructure
export * from './base'

// Export agent implementations
export * from './writer'
export * from './editor'
export * from './engineering'
export * from './ceo-assistant'
export * from './media'
export * from './media-selector'
export * from './qa'
export * from './linker'
export * from './page-orchestrator'
export * from './page-polish'

// Export research tools
export * from './tools/research/tool-registry'

// Export collection getters
export * from './getters'

// Register agents
import { registerAgent } from './base/factory'
import { loadEditorialConfigs } from './base/editorial-config-loader'
import { WriterAgent, initializeWriterAgent } from './writer'
import { EditorAgent } from './editor'
import { EngineeringAgent } from './engineering'
import { CEOAssistantAgent } from './ceo-assistant'
import { MediaAgent } from './media'
import { MediaSelectorAgent } from './media-selector'
import { QAAgent } from './qa'
import { LinkerAgent } from './linker'
import { PageOrchestratorAgent } from './page-orchestrator'
import { PagePolishAgent } from './page-polish'

/**
 * Initialize agent registry
 * Call this on application startup to register all agent types
 */
export async function initializeAgents() {
  // Pre-load editorial configs before registering agents
  // This ensures WriterAgent has access to the configs when instantiated
  await initializeWriterAgent()

  registerAgent('Writer', WriterAgent)
  registerAgent('Editor', EditorAgent)
  registerAgent('ChiefEditor', EditorAgent) // Same class, different role
  registerAgent('EngineeringAgent', EngineeringAgent)
  registerAgent('SEOSpecialist', EngineeringAgent) // Can share engineering tools
  registerAgent('CEOAssistant', CEOAssistantAgent)
  registerAgent('MediaCoordinator', MediaAgent)
  registerAgent('Media', MediaAgent) // Alias for convenience
  registerAgent('MediaSelector', MediaSelectorAgent)
  registerAgent('QA', QAAgent)
  registerAgent('Linker', LinkerAgent)
  registerAgent('PageOrchestrator', PageOrchestratorAgent)
  registerAgent('PagePolish', PagePolishAgent)

  console.log('✅ All agent types registered')
}
