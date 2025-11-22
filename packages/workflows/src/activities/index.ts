/**
 * Temporal Activities
 * Activities that will be called by workflows
 *
 * Activities are synchronous functions that can call external services,
 * including Claude agents via the Claude Agent SDK
 */

import { agentFactory, initializeAgents } from '@swarm-press/agents'
import {
  contentRepository,
  taskRepository,
  questionTicketRepository,
} from '@swarm-press/backend'
import { events } from '@swarm-press/event-bus'

// Initialize agents on first import
let agentsInitialized = false

async function ensureAgentsInitialized() {
  if (!agentsInitialized) {
    initializeAgents()
    agentsInitialized = true
  }
}

// ============================================================================
// Agent Activities
// ============================================================================

/**
 * Invoke Writer Agent
 */
export async function invokeWriterAgent(params: {
  agentId: string
  task: string
  contentId?: string
  taskId?: string
}): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    await ensureAgentsInitialized()

    const agent = await agentFactory.getAgent(params.agentId)
    if (!agent) {
      return { success: false, error: `Agent ${params.agentId} not found` }
    }

    const response = await agent.execute(
      {
        taskType: 'write_content',
        description: params.task,
        context: { contentId: params.contentId },
      },
      {
        agentId: params.agentId,
        taskId: params.taskId,
      }
    )

    return {
      success: response.success,
      result: response.data || response.content,
      error: response.error,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Invoke Editor Agent
 */
export async function invokeEditorAgent(params: {
  agentId: string
  task: string
  contentId: string
  taskId?: string
}): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    await ensureAgentsInitialized()

    const agent = await agentFactory.getAgent(params.agentId)
    if (!agent) {
      return { success: false, error: `Agent ${params.agentId} not found` }
    }

    const response = await agent.execute(
      {
        taskType: 'editorial_review',
        description: params.task,
        context: { contentId: params.contentId },
      },
      {
        agentId: params.agentId,
        taskId: params.taskId,
      }
    )

    return {
      success: response.success,
      result: response.data || response.content,
      error: response.error,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Invoke SEO Agent
 */
export async function invokeSEOAgent(params: {
  agentId: string
  task: string
  contentId: string
  taskId?: string
}): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    await ensureAgentsInitialized()

    const agent = await agentFactory.getAgent(params.agentId)
    if (!agent) {
      return { success: false, error: `Agent ${params.agentId} not found` }
    }

    const response = await agent.execute(
      {
        taskType: 'seo_optimization',
        description: params.task,
        context: { contentId: params.contentId },
      },
      {
        agentId: params.agentId,
        taskId: params.taskId,
      }
    )

    return {
      success: response.success,
      result: response.data || response.content,
      error: response.error,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Invoke Engineering Agent
 */
export async function invokeEngineeringAgent(params: {
  agentId: string
  task: string
  contentId?: string
  websiteId?: string
  taskId?: string
}): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    await ensureAgentsInitialized()

    const agent = await agentFactory.getAgent(params.agentId)
    if (!agent) {
      return { success: false, error: `Agent ${params.agentId} not found` }
    }

    const response = await agent.execute(
      {
        taskType: 'prepare_build',
        description: params.task,
        context: { contentId: params.contentId, websiteId: params.websiteId },
      },
      {
        agentId: params.agentId,
        taskId: params.taskId,
      }
    )

    return {
      success: response.success,
      result: response.data || response.content,
      error: response.error,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Database Activities
// ============================================================================

/**
 * Get Content Item
 */
export async function getContentItem(contentId: string): Promise<any> {
  const content = await contentRepository.findById(contentId)
  return content
}

/**
 * Update Content Item
 */
export async function updateContentItem(
  contentId: string,
  updates: any
): Promise<{ success: boolean; error?: string }> {
  try {
    const updated = await contentRepository.update(contentId, updates)
    return { success: !!updated }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Transition Content State
 */
export async function transitionContentState(params: {
  contentId: string
  event: string
  actor: string
  actorId: string
  metadata?: Record<string, unknown>
}): Promise<{ success: boolean; error?: string }> {
  return await contentRepository.transition(
    params.contentId,
    params.event,
    params.actor,
    params.actorId,
    params.metadata
  )
}

/**
 * Create Task
 */
export async function createTask(taskData: {
  type: 'create_brief' | 'write_draft' | 'revise_draft' | 'editorial_review' | 'seo_optimization' | 'generate_media' | 'prepare_build' | 'publish_site'
  agent_id: string
  content_id?: string
  website_id?: string
  notes?: string
}): Promise<{ taskId: string }> {
  const task = await taskRepository.create({
    ...taskData,
    status: 'planned',
  })

  await events.taskCreated(task.id, task.agent_id, task.type)

  return { taskId: task.id }
}

/**
 * Create Question Ticket
 */
export async function createQuestionTicket(ticketData: {
  subject: string
  body: string
  created_by_agent_id: string
  target: 'CEO' | 'ChiefEditor' | 'TechnicalLead'
}): Promise<{ ticketId: string }> {
  const ticket = await questionTicketRepository.create({
    ...ticketData,
    status: 'open',
  })

  await events.ticketCreated(ticket.id, ticket.created_by_agent_id, ticket.target)

  return { ticketId: ticket.id }
}

// ============================================================================
// Event Publishing Activities
// ============================================================================

/**
 * Publish Content Event
 */
export async function publishContentEvent(params: {
  type: string
  contentId: string
  data: any
}): Promise<void> {
  const eventTypeMap: Record<string, Function> = {
    'content.created': events.contentCreated,
    'content.submittedForReview': events.contentSubmittedForReview,
    'content.needsChanges': events.contentNeedsChanges,
    'content.approved': events.contentApproved,
    'content.scheduled': events.contentScheduled,
    'content.published': events.contentPublished,
  }

  const eventFn = eventTypeMap[params.type]
  if (eventFn) {
    await eventFn(...Object.values(params.data))
  }
}

/**
 * Publish Task Event
 */
export async function publishTaskEvent(params: {
  type: string
  taskId: string
  data: any
}): Promise<void> {
  if (params.type === 'task.created') {
    await events.taskCreated(params.taskId, params.data.agent_id, params.data.type)
  } else if (params.type === 'task.completed') {
    await events.taskCompleted(params.taskId, params.data.completed_by)
  }
}

/**
 * Publish Deploy Event
 */
export async function publishDeployEvent(params: {
  type: string
  contentId: string
  data: any
}): Promise<void> {
  if (params.type === 'deploy.success') {
    await events.deploySuccess(params.contentId, params.data.url)
  } else if (params.type === 'deploy.failed') {
    await events.deployFailed(params.contentId, params.data.error)
  }
}
