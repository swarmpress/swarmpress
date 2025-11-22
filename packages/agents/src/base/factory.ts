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

    // Get agent class from registry
    const AgentClass = agentRegistry.get(agentData.role)
    if (!AgentClass) {
      console.error(`No agent class registered for role: ${agentData.role}`)
      return null
    }

    // Create instance
    const agent = new AgentClass(agentData)
    this.agentInstances.set(agentId, agent)

    return agent
  }

  /**
   * Get an agent by role (finds first agent with that role)
   */
  async getAgentByRole(role: string): Promise<BaseAgent | null> {
    const agents = await agentRepository.findByRole(role)
    if (agents.length === 0) {
      console.error(`No agent found with role: ${role}`)
      return null
    }

    return this.getAgent(agents[0].id)
  }

  /**
   * Create a new agent in the database
   */
  async createAgent(agentData: {
    name: string
    role: string
    department: string
    capabilities: string[]
    virtual_email: string
    status?: 'active' | 'inactive'
  }): Promise<Agent> {
    const agent = await agentRepository.create({
      ...agentData,
      status: agentData.status || 'active',
    })

    console.log(`Created agent: ${agent.name} (${agent.role})`)
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
