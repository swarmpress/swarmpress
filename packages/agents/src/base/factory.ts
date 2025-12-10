/**
 * Agent Factory
 * Creates and manages agent instances
 */

import { BaseAgent } from './agent'
import { agentRepository } from '@swarm-press/backend'
import type { Agent } from '@swarm-press/shared'

// ============================================================================
// Agent Registry
// ============================================================================

type AgentConstructor = new (agentData: Agent) => BaseAgent

const agentRegistry = new Map<string, AgentConstructor>()

/**
 * Register an agent class
 */
export function registerAgent(role: string, AgentClass: AgentConstructor) {
  agentRegistry.set(role, AgentClass)
  console.log(`Registered agent: ${role}`)
}

// ============================================================================
// Agent Factory
// ============================================================================

export class AgentFactory {
  private static instance: AgentFactory
  private agentInstances = new Map<string, BaseAgent>()

  private constructor() {}

  public static getInstance(): AgentFactory {
    if (!AgentFactory.instance) {
      AgentFactory.instance = new AgentFactory()
    }
    return AgentFactory.instance
  }

  /**
   * Create or get an agent instance by ID
   */
  async getAgent(agentId: string): Promise<BaseAgent | null> {
    // Check cache
    if (this.agentInstances.has(agentId)) {
      return this.agentInstances.get(agentId)!
    }

    // Load from database
    const agentData = await agentRepository.findById(agentId)
    if (!agentData) {
      console.error(`Agent not found: ${agentId}`)
      return null
    }

    // Determine agent class from capabilities
    const AgentClass = this.getAgentClassFromData(agentData)
    if (!AgentClass) {
      console.error(`Unable to determine agent class for agent: ${agentData.name}`)
      console.error(`  Capabilities: ${JSON.stringify(agentData.capabilities)}`)
      return null
    }

    // Create instance
    const agent = new AgentClass(agentData)
    this.agentInstances.set(agentId, agent)

    return agent
  }

  /**
   * Create a fresh agent instance by ID (not cached)
   * Use this for concurrent/isolated workflows to avoid conversation history collisions
   */
  async getFreshAgent(agentId: string): Promise<BaseAgent | null> {
    // Load from database
    const agentData = await agentRepository.findById(agentId)
    if (!agentData) {
      console.error(`Agent not found: ${agentId}`)
      return null
    }

    // Determine agent class from capabilities
    const AgentClass = this.getAgentClassFromData(agentData)
    if (!AgentClass) {
      console.error(`Unable to determine agent class for agent: ${agentData.name}`)
      console.error(`  Capabilities: ${JSON.stringify(agentData.capabilities)}`)
      return null
    }

    // Create instance (NOT cached - fresh for this invocation)
    const agent = new AgentClass(agentData)
    return agent
  }

  /**
   * Determine agent class from agent capabilities
   */
  private getAgentClassFromData(agentData: Agent): AgentConstructor | null {
    // Check capabilities - can be strings OR objects with {name, enabled, config}
    const hasCapability = (cap: string) => {
      if (!agentData.capabilities || !Array.isArray(agentData.capabilities)) {
        console.log(`[Factory] Agent ${agentData.name} capabilities not array:`, typeof agentData.capabilities, agentData.capabilities)
        return false
      }
      const found = agentData.capabilities.some((c: any) => {
        if (typeof c === 'string') return c === cap
        if (typeof c === 'object' && c !== null && c.name) return c.name === cap
        return false
      })
      console.log(`[Factory] Agent ${agentData.name} hasCapability(${cap}): ${found}`)
      return found
    }

    console.log(`[Factory] Resolving agent ${agentData.name}, capabilities:`, JSON.stringify(agentData.capabilities))

    // Writer capabilities
    if (hasCapability('content_writing') || hasCapability('write_draft')) {
      const AgentClass = agentRegistry.get('Writer')
      if (AgentClass) {
        console.log(`Resolved agent ${agentData.name} to Writer class via capability`)
        return AgentClass
      }
    }

    // Editor capabilities
    if (hasCapability('editorial_review') || hasCapability('review_content')) {
      const AgentClass = agentRegistry.get('Editor') || agentRegistry.get('ChiefEditor')
      if (AgentClass) {
        console.log(`Resolved agent ${agentData.name} to Editor class via capability`)
        return AgentClass
      }
    }

    // Engineering capabilities
    if (hasCapability('prepare_build') || hasCapability('publish_site')) {
      const AgentClass = agentRegistry.get('EngineeringAgent')
      if (AgentClass) {
        console.log(`Resolved agent ${agentData.name} to EngineeringAgent class via capability`)
        return AgentClass
      }
    }

    // SEO capabilities
    if (hasCapability('seo_optimization') || hasCapability('keyword_research')) {
      const AgentClass = agentRegistry.get('SEOSpecialist') || agentRegistry.get('EngineeringAgent')
      if (AgentClass) {
        console.log(`Resolved agent ${agentData.name} to SEO class via capability`)
        return AgentClass
      }
    }

    // CEO Assistant capabilities
    if (hasCapability('ceo_support') || hasCapability('summarize_tickets')) {
      const AgentClass = agentRegistry.get('CEOAssistant')
      if (AgentClass) {
        console.log(`Resolved agent ${agentData.name} to CEOAssistant class via capability`)
        return AgentClass
      }
    }

    // No matching class found
    console.warn(`No matching agent class for capabilities: ${JSON.stringify(agentData.capabilities)}`)
    return null
  }

  /**
   * Get an agent by role ID (finds first agent with that role_id)
   */
  async getAgentByRole(roleId: string): Promise<BaseAgent | null> {
    const agents = await agentRepository.findByRole(roleId)
    if (agents.length === 0) {
      console.error(`No agent found with role_id: ${roleId}`)
      return null
    }

    const firstAgent = agents[0]
    if (!firstAgent) {
      return null
    }

    return this.getAgent(firstAgent.id)
  }

  /**
   * Create a new agent in the database
   * Note: Agent schema requires role_id and department_id (UUIDs), not names
   */
  async createAgent(agentData: {
    name: string
    role_id: string
    department_id: string
    persona: string
    capabilities: string[]
    virtual_email: string
    description?: string
  }): Promise<Agent> {
    const agent = await agentRepository.create(agentData)

    console.log(`Created agent: ${agent.name}`)
    return agent
  }

  /**
   * Clear agent cache (useful for testing)
   */
  clearCache() {
    this.agentInstances.clear()
  }
}

export const agentFactory = AgentFactory.getInstance()
