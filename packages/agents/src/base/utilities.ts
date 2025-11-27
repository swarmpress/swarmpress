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
import type { ContentItem, Task, QuestionTicket, WritingStyle } from '@swarm-press/shared'

// ============================================================================
// Writing Style Utilities
// ============================================================================

/**
 * Human-readable descriptions for writing style settings
 */
const STYLE_DESCRIPTIONS = {
  tone: {
    professional: 'Maintain a polished, business-appropriate voice with expertise and credibility',
    casual: 'Write in a relaxed, everyday conversational manner',
    friendly: 'Be warm, approachable, and engaging like talking to a friend',
    authoritative: 'Project confidence and deep expertise on the subject',
    conversational: 'Write as if having a direct dialogue with the reader',
    enthusiastic: 'Convey excitement and passion about the topic',
    formal: 'Use proper language structures and maintain professional distance',
    playful: 'Incorporate wit, creativity, and a light-hearted approach',
  },
  vocabulary_level: {
    simple: 'Use basic, everyday words accessible to all readers',
    moderate: 'Balance common language with some specialized terms',
    advanced: 'Include sophisticated vocabulary and nuanced language',
    technical: 'Use industry-specific terminology and jargon where appropriate',
  },
  sentence_length: {
    short: 'Keep sentences concise and punchy (under 15 words)',
    medium: 'Use moderate sentence lengths (15-25 words)',
    long: 'Craft detailed, flowing sentences with multiple clauses',
    varied: 'Mix short and long sentences for rhythm and engagement',
  },
  formality: {
    very_informal: 'Use slang, contractions, and very casual expressions',
    informal: 'Write casually with contractions and relaxed grammar',
    neutral: 'Balance between formal and informal registers',
    formal: 'Use proper grammar, avoid contractions, maintain professionalism',
    very_formal: 'Employ highly structured, traditional language conventions',
  },
  humor: {
    none: 'Keep content serious and straightforward',
    subtle: 'Include occasional light touches and gentle wit',
    moderate: 'Regularly incorporate humor to engage readers',
    frequent: 'Make humor a key element of the writing style',
  },
  emoji_usage: {
    never: 'Do not use any emojis in the content',
    rarely: 'Use emojis sparingly, only for strong emphasis',
    sometimes: 'Include emojis occasionally to add visual interest',
    often: 'Regularly use emojis to enhance expression and engagement',
  },
  perspective: {
    first_person: 'Write from "I/we" perspective (personal, immersive)',
    second_person: 'Address the reader directly with "you" (engaging, instructional)',
    third_person: 'Use "he/she/they" for objective, journalistic style',
  },
  descriptive_style: {
    factual: 'Focus on facts, data, and concrete information',
    evocative: 'Paint vivid pictures with sensory details and atmosphere',
    poetic: 'Use literary devices, metaphors, and lyrical language',
    practical: 'Emphasize actionable information and utility',
  },
} as const

/**
 * Format an agent's writing_style configuration into a human-readable prompt section
 * This is used to instruct the LLM on how to write content
 */
export function formatWritingStyleForPrompt(writingStyle?: WritingStyle): string {
  if (!writingStyle) {
    return ''
  }

  const sections: string[] = []

  // Build writing instructions from configured style
  if (writingStyle.tone) {
    const desc = STYLE_DESCRIPTIONS.tone[writingStyle.tone]
    sections.push(`- **Tone**: ${writingStyle.tone} - ${desc}`)
  }

  if (writingStyle.vocabulary_level) {
    const desc = STYLE_DESCRIPTIONS.vocabulary_level[writingStyle.vocabulary_level]
    sections.push(`- **Vocabulary**: ${writingStyle.vocabulary_level} - ${desc}`)
  }

  if (writingStyle.sentence_length) {
    const desc = STYLE_DESCRIPTIONS.sentence_length[writingStyle.sentence_length]
    sections.push(`- **Sentence Structure**: ${writingStyle.sentence_length} - ${desc}`)
  }

  if (writingStyle.formality) {
    const desc = STYLE_DESCRIPTIONS.formality[writingStyle.formality]
    sections.push(`- **Formality**: ${writingStyle.formality.replace('_', ' ')} - ${desc}`)
  }

  if (writingStyle.humor) {
    const desc = STYLE_DESCRIPTIONS.humor[writingStyle.humor]
    sections.push(`- **Humor**: ${writingStyle.humor} - ${desc}`)
  }

  if (writingStyle.emoji_usage) {
    const desc = STYLE_DESCRIPTIONS.emoji_usage[writingStyle.emoji_usage]
    sections.push(`- **Emoji Usage**: ${writingStyle.emoji_usage} - ${desc}`)
  }

  if (writingStyle.perspective) {
    const desc = STYLE_DESCRIPTIONS.perspective[writingStyle.perspective]
    sections.push(`- **Perspective**: ${writingStyle.perspective.replace('_', ' ')} - ${desc}`)
  }

  if (writingStyle.descriptive_style) {
    const desc = STYLE_DESCRIPTIONS.descriptive_style[writingStyle.descriptive_style]
    sections.push(`- **Descriptive Style**: ${writingStyle.descriptive_style} - ${desc}`)
  }

  if (sections.length === 0) {
    return ''
  }

  return `## Writing Style Configuration
Apply these specific style guidelines to all content you create:

${sections.join('\n')}

These settings define your unique voice. Ensure every piece of content consistently reflects these characteristics.`
}

/**
 * Format hobbies/interests into a prompt section for personality context
 */
export function formatHobbiesForPrompt(hobbies?: string[]): string {
  if (!hobbies || hobbies.length === 0) {
    return ''
  }

  return `## Personal Interests
Your hobbies and interests that influence your perspective: ${hobbies.join(', ')}.
Let these interests subtly inform your writing style and the examples or analogies you use.`
}

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
  type: 'create_brief' | 'write_draft' | 'revise_draft' | 'editorial_review' | 'seo_optimization' | 'generate_media' | 'prepare_build' | 'publish_site'
  agent_id: string
  content_id?: string
  website_id?: string
  notes?: string
}): Promise<Task> {
  const task = await taskRepository.create({
    ...taskData,
    status: 'planned',
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
  subject: string
  body: string
  created_by_agent_id: string
  target: 'CEO' | 'ChiefEditor' | 'TechnicalLead'
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
