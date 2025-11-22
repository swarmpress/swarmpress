/**
 * Agent Utilities
 * Common utilities for agents to interact with the system
 */

import {
  contentRepository,
  taskRepository,
  questionTicketRepository,
} from '@swarm-press/backend'
import { events } from '@swarm-press/event-bus'
import type { ContentItem, Task, QuestionTicket } from '@swarm-press/shared'

// ============================================================================
// Content Utilities
// ============================================================================

export async function getContentItem(contentId: string): Promise<ContentItem | null> {
  return await contentRepository.findById(contentId)
}

export async function updateContentBody(
  contentId: string,
  body: any[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const updated = await contentRepository.update(contentId, { body })
    return { success: !!updated }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function transitionContent(
  contentId: string,
  event: string,
  actor: string,
  actorId: string,
  metadata?: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  return await contentRepository.transition(contentId, event, actor, actorId, metadata)
}

// ============================================================================
// Task Utilities
// ============================================================================

export async function getTask(taskId: string): Promise<Task | null> {
  return await taskRepository.findById(taskId)
}

export async function getTasksForAgent(agentId: string): Promise<Task[]> {
  return await taskRepository.findByAgent(agentId)
}

export async function createTask(taskData: {
  type: string
  title: string
  description: string
  agent_id: string
  content_id?: string
  priority?: 'low' | 'medium' | 'high'
}): Promise<Task> {
  const task = await taskRepository.create({
    ...taskData,
    status: 'planned',
    priority: taskData.priority || 'medium',
  })

  // Publish event
  await events.taskCreated(task.id, task.agent_id, task.type)

  return task
}

export async function transitionTask(
  taskId: string,
  event: string,
  actor: string,
  actorId: string
): Promise<{ success: boolean; error?: string }> {
  return await taskRepository.transition(taskId, event, actor, actorId)
}

// ============================================================================
// Question Ticket Utilities
// ============================================================================

export async function createQuestionTicket(ticketData: {
  question: string
  context: string
  created_by_agent_id: string
  target: string
  content_id?: string
  task_id?: string
}): Promise<QuestionTicket> {
  const ticket = await questionTicketRepository.create({
    ...ticketData,
    status: 'open',
  })

  // Publish event
  await events.ticketCreated(ticket.id, ticket.created_by_agent_id, ticket.target)

  return ticket
}

export async function getQuestionTicket(ticketId: string): Promise<QuestionTicket | null> {
  return await questionTicketRepository.findById(ticketId)
}

export async function answerQuestionTicket(
  ticketId: string,
  answer: string,
  answerAgentId: string,
  actor: string
): Promise<{ success: boolean; error?: string }> {
  const result = await questionTicketRepository.answer(ticketId, answerAgentId, answer, actor)

  if (result.success) {
    // Publish event
    await events.ticketAnswered(ticketId, answerAgentId)
  }

  return result
}

// ============================================================================
// Content Block Utilities
// ============================================================================

export function createParagraphBlock(text: string) {
  return {
    type: 'paragraph' as const,
    text,
  }
}

export function createHeadingBlock(level: 1 | 2 | 3 | 4 | 5 | 6, text: string) {
  return {
    type: 'heading' as const,
    level,
    text,
  }
}

export function createHeroBlock(
  headline: string,
  subheadline?: string,
  imageUrl?: string,
  ctaText?: string,
  ctaUrl?: string
) {
  return {
    type: 'hero' as const,
    headline,
    subheadline,
    imageUrl,
    ctaText,
    ctaUrl,
  }
}

export function createImageBlock(url: string, alt: string, caption?: string) {
  return {
    type: 'image' as const,
    url,
    alt,
    caption,
  }
}

export function createListBlock(
  items: Array<{ text: string; subItems?: string[] }>,
  ordered: boolean = false
) {
  return {
    type: 'list' as const,
    items,
    ordered,
  }
}

export function createQuoteBlock(text: string, author?: string, source?: string) {
  return {
    type: 'quote' as const,
    text,
    author,
    source,
  }
}

export function createCalloutBlock(
  text: string,
  variant: 'info' | 'warning' | 'success' | 'error' = 'info'
) {
  return {
    type: 'callout' as const,
    text,
    variant,
  }
}

export function createFAQBlock(items: Array<{ question: string; answer: string }>) {
  return {
    type: 'faq' as const,
    items,
  }
}

// ============================================================================
// Validation Utilities
// ============================================================================

export function validateContentBlocks(blocks: any[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!Array.isArray(blocks)) {
    return { valid: false, errors: ['Content body must be an array'] }
  }

  blocks.forEach((block, index) => {
    if (!block.type) {
      errors.push(`Block ${index}: Missing 'type' field`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}
