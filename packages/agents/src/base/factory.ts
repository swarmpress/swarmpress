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

    // Note: Agent entity has role_id (UUID), not role name
    // For now, we'll look up by agent name/capabilities to determine agent class
    // TODO: Improve agent class resolution (perhaps use role lookup table)
    const AgentClass = this.getAgentClassFromData(agentData)
    if (!AgentClass) {
      console.error(`Unable to determine agent class for agent: ${agentData.name}`)
      return null
    }

    // Create instance
    const agent = new AgentClass(agentData)
    this.agentInstances.set(agentId, agent)

    return agent
  }

  /**
   * Determine agent class from agent data
   * This is a temporary solution - ideally we'd use role lookup
   */
  private getAgentClassFromData(agentData: Agent): AgentConstructor | null {
    // Try to find by name pattern
    const name = agentData.name.toLowerCase()
    if (name.includes('writer')) {
      return agentRegistry.get('Writer') || null
    }
    if (name.includes('editor')) {
      return agentRegistry.get('Editor') || null
    }
    if (name.includes('engineering') || name.includes('engineer')) {
      return agentRegistry.get('Engineering') || null
    }
    if (name.includes('ceo') || name.includes('assistant')) {
      return agentRegistry.get('CEOAssistant') || null
    }

    // Fallback: check capabilities
    if (agentData.capabilities.includes('content_writing')) {
      return agentRegistry.get('Writer') || null
    }
    if (agentData.capabilities.includes('editorial_review')) {
      return agentRegistry.get('Editor') || null
    }

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
