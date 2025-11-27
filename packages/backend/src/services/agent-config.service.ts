/**
 * Agent Configuration Service
 *
 * Loads and caches complete agent runtime configurations from database.
 * This is the central service that agents use to get their configuration,
 * including system prompts resolved through the 3-level hierarchy.
 */

import { db } from '../db'
import { agentRepository } from '../db/repositories/agent-repository'
import { resolveAndRender, selectBindingWithABTest } from './prompt-resolver.service'
import type {
  Agent,
  AgentCapability,
  WritingStyle,
  ModelConfig,
} from '@swarm-press/shared'

// ============================================================================
// Types
// ============================================================================

/**
 * Default model configurations by role type
 */
export const DEFAULT_MODEL_CONFIGS: Record<string, ModelConfig> = {
  writer: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.9,
    max_tokens: 8192,
  },
  editor: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.4,
    max_tokens: 4096,
  },
  engineering: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.2,
    max_tokens: 4096,
  },
  ceo_assistant: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.5,
    max_tokens: 4096,
  },
  default: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.7,
    max_tokens: 4096,
  },
}

/**
 * Complete runtime configuration for an agent
 * This is everything an agent needs to execute
 */
export interface AgentRuntimeConfig {
  // Identity
  agentId: string
  name: string
  role: string
  roleName: string
  department: string
  departmentName: string
  persona: string
  virtualEmail: string

  // Personality
  hobbies?: string[]
  writingStyle?: WritingStyle

  // Capabilities
  capabilities: AgentCapability[]
  enabledCapabilities: string[]

  // Model configuration (merged: agent > role defaults)
  modelConfig: {
    model: string
    temperature: number
    maxTokens: number
    topP?: number
  }

  // Resolved system prompts (capability -> prompt)
  systemPrompts: Map<string, string>

  // Metadata
  status: string
  loadedAt: Date
}

/**
 * Cache entry with TTL tracking
 */
interface CacheEntry {
  config: AgentRuntimeConfig
  expires: number
}

// ============================================================================
// Cache Implementation
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

class AgentConfigCache {
  private cache = new Map<string, CacheEntry>()

  get(agentId: string): AgentRuntimeConfig | null {
    const entry = this.cache.get(agentId)
    if (!entry) return null

    if (Date.now() > entry.expires) {
      this.cache.delete(agentId)
      return null
    }

    return entry.config
  }

  set(agentId: string, config: AgentRuntimeConfig): void {
    this.cache.set(agentId, {
      config,
      expires: Date.now() + CACHE_TTL_MS,
    })
  }

  invalidate(agentId: string): void {
    this.cache.delete(agentId)
  }

  invalidateAll(): void {
    this.cache.clear()
  }
}

const configCache = new AgentConfigCache()

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Load complete runtime configuration for an agent
 *
 * @param agentId - UUID of the agent
 * @param websiteId - Optional website context for prompt resolution
 * @param capabilities - Optional list of capabilities to resolve prompts for
 */
export async function loadAgentConfig(
  agentId: string,
  websiteId?: string,
  capabilities?: string[]
): Promise<AgentRuntimeConfig> {
  // Check cache first
  const cacheKey = websiteId ? `${agentId}:${websiteId}` : agentId
  const cached = configCache.get(cacheKey)
  if (cached) {
    return cached
  }

  // Load agent from database
  const agent = await agentRepository.findById(agentId)
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`)
  }

  // Load role and department info
  const roleInfo = await loadRoleInfo(agent.role_id)
  const deptInfo = await loadDepartmentInfo(agent.department_id)

  // Parse and normalize capabilities
  const parsedCapabilities = parseCapabilities(agent.capabilities)
  const enabledCapabilities = parsedCapabilities
    .filter((c) => c.enabled)
    .map((c) => c.name)

  // Determine which capabilities to resolve prompts for
  const capsToResolve = capabilities || enabledCapabilities

  // Merge model config: agent-specific > role defaults > global defaults
  const roleType = roleInfo.name.toLowerCase().replace(/\s+/g, '_')
  const roleDefaults = DEFAULT_MODEL_CONFIGS[roleType] || DEFAULT_MODEL_CONFIGS.default
  const agentModelConfig = agent.model_config as ModelConfig | undefined

  const modelConfig = {
    model: agentModelConfig?.model || roleDefaults.model || 'claude-sonnet-4-5-20250929',
    temperature: agentModelConfig?.temperature ?? roleDefaults.temperature ?? 0.7,
    maxTokens: agentModelConfig?.max_tokens || roleDefaults.max_tokens || 4096,
    topP: agentModelConfig?.top_p,
  }

  // Resolve system prompts for each capability
  const systemPrompts = new Map<string, string>()

  for (const capability of capsToResolve) {
    try {
      const { prompt } = await resolveAndRender({
        agent_id: agentId,
        capability,
        runtime_variables: {
          agent_name: agent.name,
          persona: agent.persona,
          hobbies_section: formatHobbiesForPrompt(agent.hobbies as string[] | undefined),
          writing_style_section: formatWritingStyleForPrompt(agent.writing_style as WritingStyle | undefined),
        },
      })
      systemPrompts.set(capability, prompt)
    } catch (error) {
      // Log but don't fail - prompt may not exist yet
      console.warn(
        `[AgentConfigService] Could not resolve prompt for agent ${agent.name}, capability ${capability}:`,
        error instanceof Error ? error.message : error
      )
    }
  }

  // Build runtime config
  const runtimeConfig: AgentRuntimeConfig = {
    agentId: agent.id,
    name: agent.name,
    role: agent.role_id,
    roleName: roleInfo.name,
    department: agent.department_id,
    departmentName: deptInfo.name,
    persona: agent.persona,
    virtualEmail: agent.virtual_email,
    hobbies: agent.hobbies as string[] | undefined,
    writingStyle: agent.writing_style as WritingStyle | undefined,
    capabilities: parsedCapabilities,
    enabledCapabilities,
    modelConfig,
    systemPrompts,
    status: agent.status || 'active',
    loadedAt: new Date(),
  }

  // Cache and return
  configCache.set(cacheKey, runtimeConfig)
  return runtimeConfig
}

/**
 * Get system prompt for a specific capability
 * Falls back to generating a basic prompt if not in database
 */
export async function getSystemPromptForCapability(
  agentId: string,
  capability: string,
  websiteId?: string
): Promise<string> {
  const config = await loadAgentConfig(agentId, websiteId, [capability])

  const prompt = config.systemPrompts.get(capability)
  if (prompt) {
    return prompt
  }

  // Generate fallback prompt
  return generateFallbackPrompt(config, capability)
}

/**
 * Invalidate cached config for an agent
 * Call this when agent settings are updated
 */
export function invalidateAgentConfig(agentId: string, websiteId?: string): void {
  if (websiteId) {
    configCache.invalidate(`${agentId}:${websiteId}`)
  }
  configCache.invalidate(agentId)
}

/**
 * Invalidate all cached configs
 * Call this when global settings change
 */
export function invalidateAllConfigs(): void {
  configCache.invalidateAll()
}

// ============================================================================
// Helper Functions
// ============================================================================

interface RoleInfo {
  id: string
  name: string
  description: string
}

interface DepartmentInfo {
  id: string
  name: string
  description: string
}

async function loadRoleInfo(roleId: string): Promise<RoleInfo> {
  const result = await db.query<RoleInfo>(
    'SELECT id, name, description FROM roles WHERE id = $1',
    [roleId]
  )
  if (result.rows.length === 0) {
    return { id: roleId, name: 'Unknown', description: '' }
  }
  return result.rows[0]
}

async function loadDepartmentInfo(departmentId: string): Promise<DepartmentInfo> {
  const result = await db.query<DepartmentInfo>(
    'SELECT id, name, description FROM departments WHERE id = $1',
    [departmentId]
  )
  if (result.rows.length === 0) {
    return { id: departmentId, name: 'Unknown', description: '' }
  }
  return result.rows[0]
}

/**
 * Parse capabilities array which can contain strings or objects
 */
function parseCapabilities(
  capabilities: (string | AgentCapability)[]
): AgentCapability[] {
  return capabilities.map((cap) => {
    if (typeof cap === 'string') {
      return { name: cap as AgentCapability['name'], enabled: true }
    }
    return cap
  })
}

/**
 * Format hobbies into a prompt section
 */
function formatHobbiesForPrompt(hobbies?: string[]): string {
  if (!hobbies || hobbies.length === 0) {
    return ''
  }

  return `## Personal Interests
Your hobbies and interests that influence your perspective: ${hobbies.join(', ')}.
Let these interests subtly inform your writing style and the examples or analogies you use.`
}

/**
 * Format writing style into a prompt section
 */
function formatWritingStyleForPrompt(writingStyle?: WritingStyle): string {
  if (!writingStyle) {
    return ''
  }

  const sections: string[] = []

  const STYLE_DESCRIPTIONS = {
    tone: {
      professional: 'Maintain a polished, business-appropriate voice',
      casual: 'Write in a relaxed, everyday conversational manner',
      friendly: 'Be warm, approachable, and engaging',
      authoritative: 'Project confidence and deep expertise',
      conversational: 'Write as if having a direct dialogue with the reader',
      enthusiastic: 'Convey excitement and passion about the topic',
      formal: 'Use proper language structures and maintain professional distance',
      playful: 'Incorporate wit, creativity, and a light-hearted approach',
    },
    vocabulary_level: {
      simple: 'Use basic, everyday words accessible to all readers',
      moderate: 'Balance common language with some specialized terms',
      advanced: 'Include sophisticated vocabulary and nuanced language',
      technical: 'Use industry-specific terminology where appropriate',
    },
    sentence_length: {
      short: 'Keep sentences concise and punchy',
      medium: 'Use moderate sentence lengths',
      long: 'Craft detailed, flowing sentences with multiple clauses',
      varied: 'Mix short and long sentences for rhythm and engagement',
    },
    formality: {
      very_informal: 'Use slang, contractions, and very casual expressions',
      informal: 'Write casually with contractions and relaxed grammar',
      neutral: 'Balance between formal and informal registers',
      formal: 'Use proper grammar, avoid contractions',
      very_formal: 'Employ highly structured, traditional language',
    },
    humor: {
      none: 'Keep content serious and straightforward',
      subtle: 'Include occasional light touches and gentle wit',
      moderate: 'Regularly incorporate humor to engage readers',
      frequent: 'Make humor a key element of the writing style',
    },
    emoji_usage: {
      never: 'Do not use any emojis',
      rarely: 'Use emojis sparingly, only for strong emphasis',
      sometimes: 'Include emojis occasionally to add visual interest',
      often: 'Regularly use emojis to enhance expression',
    },
    perspective: {
      first_person: 'Write from "I/we" perspective',
      second_person: 'Address the reader directly with "you"',
      third_person: 'Use "he/she/they" for objective style',
    },
    descriptive_style: {
      factual: 'Focus on facts, data, and concrete information',
      evocative: 'Paint vivid pictures with sensory details',
      poetic: 'Use literary devices, metaphors, and lyrical language',
      practical: 'Emphasize actionable information and utility',
    },
  } as const

  if (writingStyle.tone) {
    sections.push(`- **Tone**: ${writingStyle.tone} - ${STYLE_DESCRIPTIONS.tone[writingStyle.tone]}`)
  }
  if (writingStyle.vocabulary_level) {
    sections.push(`- **Vocabulary**: ${writingStyle.vocabulary_level} - ${STYLE_DESCRIPTIONS.vocabulary_level[writingStyle.vocabulary_level]}`)
  }
  if (writingStyle.sentence_length) {
    sections.push(`- **Sentence Structure**: ${writingStyle.sentence_length} - ${STYLE_DESCRIPTIONS.sentence_length[writingStyle.sentence_length]}`)
  }
  if (writingStyle.formality) {
    sections.push(`- **Formality**: ${writingStyle.formality.replace('_', ' ')} - ${STYLE_DESCRIPTIONS.formality[writingStyle.formality]}`)
  }
  if (writingStyle.humor) {
    sections.push(`- **Humor**: ${writingStyle.humor} - ${STYLE_DESCRIPTIONS.humor[writingStyle.humor]}`)
  }
  if (writingStyle.emoji_usage) {
    sections.push(`- **Emoji Usage**: ${writingStyle.emoji_usage} - ${STYLE_DESCRIPTIONS.emoji_usage[writingStyle.emoji_usage]}`)
  }
  if (writingStyle.perspective) {
    sections.push(`- **Perspective**: ${writingStyle.perspective.replace('_', ' ')} - ${STYLE_DESCRIPTIONS.perspective[writingStyle.perspective]}`)
  }
  if (writingStyle.descriptive_style) {
    sections.push(`- **Descriptive Style**: ${writingStyle.descriptive_style} - ${STYLE_DESCRIPTIONS.descriptive_style[writingStyle.descriptive_style]}`)
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
 * Generate a basic fallback prompt when database prompt doesn't exist
 */
function generateFallbackPrompt(config: AgentRuntimeConfig, capability: string): string {
  const hobbiesSection = formatHobbiesForPrompt(config.hobbies)
  const writingStyleSection = formatWritingStyleForPrompt(config.writingStyle)

  return `You are ${config.name}, a ${config.roleName} in the ${config.departmentName} department at swarm.press.

${config.persona}
${hobbiesSection ? '\n' + hobbiesSection + '\n' : ''}
${writingStyleSection ? '\n' + writingStyleSection + '\n' : ''}
## Your Current Task: ${capability}

Execute this capability according to your role and the guidelines above.

IMPORTANT: You MUST use the tools available to you to perform actions.`
}

// ============================================================================
// Exports
// ============================================================================

export const agentConfigService = {
  loadAgentConfig,
  getSystemPromptForCapability,
  invalidateAgentConfig,
  invalidateAllConfigs,
  DEFAULT_MODEL_CONFIGS,
}
