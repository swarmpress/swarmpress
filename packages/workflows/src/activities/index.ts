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
} from '@swarm-press/backend/dist/db/repositories'
import { events } from '@swarm-press/event-bus'
import {
  syncContentToGitHub,
  syncApprovalToGitHub,
  syncRejectionToGitHub,
  syncPublishToGitHub,
  syncQuestionToGitHub,
  syncTaskToGitHub,
  getGitHubMapping,
} from '@swarm-press/github-integration'

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
        taskType: 'write_content',
        description: params.task,
        context: { contentId: params.contentId, websiteId: params.websiteId },
      },
      {
        agentId: params.agentId,
        taskId: params.taskId,
        contentId: params.contentId, // Pass contentId for tool context
        websiteId: params.websiteId, // Pass websiteId for external tools
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
        contentId: params.contentId, // Pass contentId for tool context
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
        websiteId: params.websiteId, // Pass websiteId for tool context
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

// ============================================================================
// GitHub Sync Activities
// ============================================================================

/**
 * Sync content to GitHub - creates a PR for editorial review
 * Called when content transitions to in_editorial_review
 */
export async function syncContentToGitHubActivity(params: {
  contentId: string
}): Promise<{ success: boolean; prNumber?: number; prUrl?: string; error?: string }> {
  try {
    await syncContentToGitHub(params.contentId)
    const mapping = getGitHubMapping('content', params.contentId)
    return {
      success: true,
      prNumber: mapping?.github_number,
      prUrl: mapping?.github_url,
    }
  } catch (error) {
    console.error(`[GitHub] Failed to sync content ${params.contentId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync to GitHub',
    }
  }
}

/**
 * Sync approval to GitHub - approves the PR
 * Called when editor approves content
 */
export async function syncApprovalToGitHubActivity(params: {
  contentId: string
  approvalMessage: string
  agentId: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    await syncApprovalToGitHub(params.contentId, params.approvalMessage, params.agentId)
    return { success: true }
  } catch (error) {
    console.error(`[GitHub] Failed to sync approval for ${params.contentId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync approval',
    }
  }
}

/**
 * Sync rejection/changes request to GitHub
 * Called when editor requests changes
 */
export async function syncRejectionToGitHubActivity(params: {
  contentId: string
  feedback: string
  agentId: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    await syncRejectionToGitHub(params.contentId, params.feedback, params.agentId)
    return { success: true }
  } catch (error) {
    console.error(`[GitHub] Failed to sync rejection for ${params.contentId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync rejection',
    }
  }
}

/**
 * Sync publish to GitHub - merges the PR
 * Called when content is published
 */
export async function syncPublishToGitHubActivity(params: {
  contentId: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    await syncPublishToGitHub(params.contentId)
    return { success: true }
  } catch (error) {
    console.error(`[GitHub] Failed to sync publish for ${params.contentId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync publish',
    }
  }
}

/**
 * Sync question ticket to GitHub - creates an issue
 * Called when an agent escalates to CEO
 */
export async function syncQuestionToGitHubActivity(params: {
  ticketId: string
}): Promise<{ success: boolean; issueNumber?: number; issueUrl?: string; error?: string }> {
  try {
    await syncQuestionToGitHub(params.ticketId)
    const mapping = getGitHubMapping('ticket', params.ticketId)
    return {
      success: true,
      issueNumber: mapping?.github_number,
      issueUrl: mapping?.github_url,
    }
  } catch (error) {
    console.error(`[GitHub] Failed to sync question ${params.ticketId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync question',
    }
  }
}

/**
 * Sync task to GitHub - creates an issue for the task
 * Called when a task is created for an agent
 */
export async function syncTaskToGitHubActivity(params: {
  taskId: string
}): Promise<{ success: boolean; issueNumber?: number; issueUrl?: string; error?: string }> {
  try {
    await syncTaskToGitHub(params.taskId)
    const mapping = getGitHubMapping('task', params.taskId)
    return {
      success: true,
      issueNumber: mapping?.github_number,
      issueUrl: mapping?.github_url,
    }
  } catch (error) {
    console.error(`[GitHub] Failed to sync task ${params.taskId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync task',
    }
  }
}

/**
 * Log agent activity to GitHub PR as a comment
 * Tracks each agent step in the workflow chain
 */
export async function logAgentActivityToGitHub(params: {
  contentId: string
  agentId: string
  agentName: string
  activity: string
  details?: string
  result?: 'success' | 'failure' | 'pending'
}): Promise<{ success: boolean; error?: string }> {
  try {
    const mapping = getGitHubMapping('content', params.contentId)
    if (!mapping) {
      // No PR exists yet, skip logging
      console.log(`[GitHub] No PR mapping for content ${params.contentId}, skipping activity log`)
      return { success: true }
    }

    // Import addPRComment from github-integration
    const { addPRComment } = await import('@swarm-press/github-integration')

    const resultEmoji = params.result === 'success' ? '✅' : params.result === 'failure' ? '❌' : '⏳'
    const timestamp = new Date().toISOString()

    const comment = `## ${resultEmoji} Agent Activity: ${params.agentName}

**Activity:** ${params.activity}
**Agent ID:** \`${params.agentId}\`
**Timestamp:** ${timestamp}
${params.details ? `\n### Details\n${params.details}` : ''}
${params.result ? `\n**Result:** ${params.result}` : ''}`

    await addPRComment(mapping.github_number, comment)

    return { success: true }
  } catch (error) {
    console.error(`[GitHub] Failed to log activity for ${params.contentId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to log activity',
    }
  }
}

// ============================================================================
// Re-export from separate activity files
// ============================================================================

export * from './research'
export * from './brief-generator'
export * from './page-content-linker'

// Batch Processing Activities
export * from './batch'

// GitHub Export/Import Activities
export * from './github-export'

// Site Build Activities
export * from './site-build'

// Page Content Generation Activities
export * from './page-content-generation'
