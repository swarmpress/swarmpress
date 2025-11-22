import { Agent } from '@agent-press/shared'
import { BaseRepository } from '../base-repository'

/**
 * Repository for Agent entities
 */
export class AgentRepository extends BaseRepository<Agent> {
  constructor() {
    super('agents')
  }

  /**
   * Find agent by virtual email
   */
  async findByEmail(virtualEmail: string): Promise<Agent | null> {
    return this.findOneBy('virtual_email', virtualEmail)
  }

  /**
   * Find agents by role
   */
  async findByRole(roleId: string): Promise<Agent[]> {
    return this.findBy('role_id', roleId)
  }

  /**
   * Find agents by department
   */
  async findByDepartment(departmentId: string): Promise<Agent[]> {
    return this.findBy('department_id', departmentId)
  }

  /**
   * Check if agent has capability
   */
  async hasCapability(agentId: string, capability: string): Promise<boolean> {
    const agent = await this.findById(agentId)
    if (!agent) return false

    const capabilities = agent.capabilities as string[]
    return capabilities.includes(capability)
  }
}

export const agentRepository = new AgentRepository()
