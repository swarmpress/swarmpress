/**
 * Repository exports
 * Centralized access to all database repositories
 */

export * from './company-repository'
export * from './department-repository'
export * from './role-repository'
export * from './content-repository'
export * from './agent-repository'
export * from './task-repository'
export * from './question-ticket-repository'
export * from './website-repository'

// Re-export commonly used repositories
export { companyRepository } from './company-repository'
export { departmentRepository } from './department-repository'
export { roleRepository } from './role-repository'
export { contentRepository } from './content-repository'
export { agentRepository } from './agent-repository'
export { taskRepository } from './task-repository'
export { questionTicketRepository } from './question-ticket-repository'
export { websiteRepository } from './website-repository'
