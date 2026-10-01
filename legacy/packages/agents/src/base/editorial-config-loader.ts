/**
 * Editorial Config Loader
 * Loads and caches editorial style configs from content repository
 * Following the pattern from page-orchestrator/handlers.ts
 */

import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

export interface StyleGuideConfig {
  voice: string
  persona: string
  tone: string
  personality: {
    traits: string[]
    speakingStyle: string
    perspective: string
  }
  formatting: {
    headings: string
    lists: string
    paragraphs: string
    numbers: string
    times: string
    prices: string
    distances: string
  }
  vocabulary: {
    preferred: string[]
    avoid: string[]
    replacements: Record<string, string>
  }
  contentGuidelines: Record<string, { principle: string; examples: string[] }>
  structurePatterns: Record<string, { opening: string; body: string; close: string }>
  examples: {
    good: string[]
    bad: string[]
  }
  seoGuidelines: Record<string, string>
}

export interface WriterPromptConfig {
  website_prompt_template: {
    name: string
    capability: string
    description: string
    version: string
    template_additions: string
    variables_override: Record<string, string | string[]>
    examples_override: Array<{
      name: string
      input: string
      output: Record<string, unknown>
    }>
  }
  collection_prompts: Record<string, {
    research_prompt: string
    writing_prompt: string
    required_fields: string[]
  }>
  page_prompts: Record<string, {
    structure: Array<{ type: string; purpose: string }>
    writing_prompt: string
  }>
}

export interface BlockTypeDefinition {
  description: string
  props?: Record<string, unknown>
  example?: Record<string, unknown>
  note?: string
  voice?: string
}

export interface AgentSchemasConfig {
  block_types: {
    core: Record<string, BlockTypeDefinition>
    village: Record<string, BlockTypeDefinition>
    editorial: Record<string, BlockTypeDefinition>
    content: Record<string, BlockTypeDefinition>
    blog: Record<string, BlockTypeDefinition>
    template: Record<string, BlockTypeDefinition>
  }
  collections: Record<string, {
    description: string
    required_fields?: string[]
    key_fields: Record<string, string>
  }>
  page_structure: {
    description: string
    schema: Record<string, unknown>
  }
  localization: {
    description: string
    supported_languages: string[]
    LocalizedString: Record<string, unknown>
    notes: string[]
  }
  editorial_voice: {
    brand: string
    tone: string
    persona: {
      name: string
      role: string
      voice: string
    }
    guidelines: string[]
    example_intro: string
  }
}

export interface EditorialConfigs {
  styleGuide: StyleGuideConfig
  writerPrompt: WriterPromptConfig
  agentSchemas: AgentSchemasConfig
}

// ============================================================================
// Cache
// ============================================================================

let cachedStyleGuide: StyleGuideConfig | null = null
let cachedWriterPrompt: WriterPromptConfig | null = null
let cachedAgentSchemas: AgentSchemasConfig | null = null

// ============================================================================
// Default Configs (fallback if files not found)
// ============================================================================

const defaultStyleGuide: StyleGuideConfig = {
  voice: 'Giulia Rossi - warm, knowledgeable local expert',
  persona: 'You are Giulia Rossi, a lifelong resident of Cinque Terre who grew up exploring these villages with your grandmother. You know every hidden corner, the best restaurants where locals actually eat, and the secret swimming spots tourists never find. You share this knowledge like a friend would - with genuine enthusiasm but practical honesty.',
  tone: 'conversational but informative, never salesy or generic',
  personality: {
    traits: [
      'warm and welcoming',
      'knowledgeable without being pretentious',
      'honest about trade-offs and limitations',
      'enthusiastic but not hyperbolic',
      'practical and helpful',
      'proud of local culture'
    ],
    speakingStyle: 'Like having a coffee with a knowledgeable friend who happens to be a local',
    perspective: "First person plural ('we') when speaking as the publication, second person ('you') when addressing readers directly"
  },
  formatting: {
    headings: 'sentence case, descriptive and benefit-oriented',
    lists: '3-7 items, parallel structure, most important first',
    paragraphs: '2-4 sentences max, scannable, one idea per paragraph',
    numbers: 'Spell out one through nine, use numerals for 10+',
    times: 'Use 24-hour format for Italian context (e.g., 19:30)',
    prices: 'Use € symbol before number (e.g., €15)',
    distances: "Use kilometers and minutes (e.g., '2 km, about 30 minutes')"
  },
  vocabulary: {
    preferred: ['discover', 'experience', 'local', 'authentic', 'seasonal', 'traditional', 'wander', 'savor', 'genuine', 'centuries-old', 'family-run', 'handmade'],
    avoid: ['tourist trap', 'must-see', 'hidden gem', 'bucket list', 'instagrammable', 'best-kept secret', 'off the beaten path', 'picture-perfect', 'breathtaking', 'stunning', 'amazing', 'world-famous', 'iconic', 'legendary'],
    replacements: {
      'tourist': 'visitor',
      'touristy': 'popular with visitors',
      'cheap': 'affordable',
      'expensive': 'an investment',
      'must-see': 'worth your time',
      'hidden gem': 'lesser-known favorite',
      'bucket list': 'worth planning for',
      'instagrammable': 'photogenic'
    }
  },
  contentGuidelines: {
    honesty: {
      principle: 'Be honest about trade-offs',
      examples: [
        "Instead of: 'The best beach in Italy!' say: 'A beautiful rocky cove - bring water shoes for the pebbles.'",
        "Instead of: 'Must-try restaurant!' say: 'Reservations essential during summer - locals book weeks ahead.'"
      ]
    },
    specificity: {
      principle: 'Give specific, actionable details',
      examples: [
        "Instead of: 'Great views' say: 'The view from the terrace at sunset, with the harbor below, is worth the 10-minute walk uphill.'",
        "Instead of: 'Delicious food' say: 'The trofie al pesto here uses basil from their own garden - you can taste the difference.'"
      ]
    }
  },
  structurePatterns: {
    villageIntro: {
      opening: 'Start with what makes this village different from the others',
      body: "Include the 'essentials' - character, when to visit, how to get there",
      close: 'Hint at what to explore next'
    },
    restaurantDescription: {
      opening: 'What type of dining experience is this?',
      body: 'Signature dishes, atmosphere, price range, practical tips',
      close: 'Best for what type of visitor/occasion'
    }
  },
  examples: {
    good: [
      'Riomaggiore wakes up slowly. By 8 AM, the fishermen have already pulled their boats from the water, but the cafés are just opening their shutters. This is the best time to wander the narrow streets - before the day-trippers arrive on the first trains.',
      "La Lanterna isn't the fanciest restaurant in town, but it's where my family goes for birthdays. The anchovies are fresh from this morning's catch, and the owner, Marco, still makes the pasta by hand."
    ],
    bad: [
      'Riomaggiore is the most stunning village in Cinque Terre! This must-see destination is absolutely breathtaking!',
      'This hidden gem is the best restaurant in all of Italy! You simply MUST try it!'
    ]
  },
  seoGuidelines: {
    naturalKeywords: 'Incorporate keywords naturally - if it sounds forced, rewrite',
    headings: 'Use descriptive headings that help readers and search engines',
    localTerms: "Include Italian terms with context (e.g., 'sciacchetrà, the local sweet wine')"
  }
}

const defaultWriterPrompt: WriterPromptConfig = {
  website_prompt_template: {
    name: 'Default Writer Prompt',
    capability: 'write_draft',
    description: 'Default editorial voice',
    version: '1.0.0',
    template_additions: '',
    variables_override: {},
    examples_override: []
  },
  collection_prompts: {},
  page_prompts: {}
}

const defaultAgentSchemas: AgentSchemasConfig = {
  block_types: {
    core: {},
    village: {},
    editorial: {},
    content: {},
    blog: {},
    template: {}
  },
  collections: {},
  page_structure: { description: '', schema: {} },
  localization: { description: '', supported_languages: ['en'], LocalizedString: {}, notes: [] },
  editorial_voice: {
    brand: 'Cinque Terre Dispatch',
    tone: 'Warm, knowledgeable, and evocative',
    persona: { name: 'Giulia Rossi', role: 'Local Editor', voice: 'Personal, insider perspective' },
    guidelines: [],
    example_intro: ''
  }
}

// ============================================================================
// Config Loaders
// ============================================================================

function getContentRepoPath(): string {
  return process.env.CONTENT_REPO_PATH || path.join(process.cwd(), 'cinqueterre.travel')
}

export async function loadStyleGuide(): Promise<StyleGuideConfig> {
  if (cachedStyleGuide) {
    return cachedStyleGuide
  }

  const basePath = getContentRepoPath()
  const configPath = path.join(basePath, 'content', 'config', 'style-guide.json')

  try {
    const content = await fs.readFile(configPath, 'utf-8')
    cachedStyleGuide = JSON.parse(content) as StyleGuideConfig
    console.log('[EditorialConfigLoader] Loaded style-guide.json')
    return cachedStyleGuide
  } catch (error) {
    console.warn('[EditorialConfigLoader] Could not load style-guide.json, using defaults:', error instanceof Error ? error.message : 'Unknown error')
    return defaultStyleGuide
  }
}

export async function loadWriterPrompt(): Promise<WriterPromptConfig> {
  if (cachedWriterPrompt) {
    return cachedWriterPrompt
  }

  const basePath = getContentRepoPath()
  const configPath = path.join(basePath, 'content', 'config', 'writer-prompt.json')

  try {
    const content = await fs.readFile(configPath, 'utf-8')
    cachedWriterPrompt = JSON.parse(content) as WriterPromptConfig
    console.log('[EditorialConfigLoader] Loaded writer-prompt.json')
    return cachedWriterPrompt
  } catch (error) {
    console.warn('[EditorialConfigLoader] Could not load writer-prompt.json, using defaults:', error instanceof Error ? error.message : 'Unknown error')
    return defaultWriterPrompt
  }
}

export async function loadAgentSchemas(): Promise<AgentSchemasConfig> {
  if (cachedAgentSchemas) {
    return cachedAgentSchemas
  }

  const basePath = getContentRepoPath()
  const configPath = path.join(basePath, 'content', 'config', 'agent-schemas.json')

  try {
    const content = await fs.readFile(configPath, 'utf-8')
    cachedAgentSchemas = JSON.parse(content) as AgentSchemasConfig
    console.log('[EditorialConfigLoader] Loaded agent-schemas.json')
    return cachedAgentSchemas
  } catch (error) {
    console.warn('[EditorialConfigLoader] Could not load agent-schemas.json, using defaults:', error instanceof Error ? error.message : 'Unknown error')
    return defaultAgentSchemas
  }
}

export async function loadEditorialConfigs(): Promise<EditorialConfigs> {
  const [styleGuide, writerPrompt, agentSchemas] = await Promise.all([
    loadStyleGuide(),
    loadWriterPrompt(),
    loadAgentSchemas()
  ])

  return { styleGuide, writerPrompt, agentSchemas }
}

// ============================================================================
// Prompt Formatting
// ============================================================================

function formatBlockTypes(agentSchemas: AgentSchemasConfig): string {
  const sections: string[] = []

  // Editorial blocks are most important for the Cinque Terre voice
  if (agentSchemas.block_types.editorial) {
    sections.push('### Editorial Blocks (Cinque Terre Theme)')
    for (const [name, def] of Object.entries(agentSchemas.block_types.editorial)) {
      let blockDoc = `- **${name}**: ${def.description}`
      if (def.voice) {
        blockDoc += ` (${def.voice})`
      }
      if (def.example) {
        blockDoc += `\n  Example: \`${JSON.stringify(def.example)}\``
      }
      sections.push(blockDoc)
    }
    sections.push('')
  }

  // Core blocks
  if (agentSchemas.block_types.core) {
    sections.push('### Core Blocks')
    for (const [name, def] of Object.entries(agentSchemas.block_types.core)) {
      sections.push(`- **${name}**: ${def.description}`)
    }
    sections.push('')
  }

  // Village blocks
  if (agentSchemas.block_types.village) {
    sections.push('### Village Blocks')
    for (const [name, def] of Object.entries(agentSchemas.block_types.village)) {
      sections.push(`- **${name}**: ${def.description}`)
    }
    sections.push('')
  }

  // Template blocks
  if (agentSchemas.block_types.template) {
    sections.push('### Template Blocks')
    for (const [name, def] of Object.entries(agentSchemas.block_types.template)) {
      sections.push(`- **${name}**: ${def.description}`)
    }
    sections.push('')
  }

  return sections.join('\n')
}

function formatVocabularyRules(styleGuide: StyleGuideConfig): string {
  const parts: string[] = []

  parts.push('### Vocabulary')
  parts.push(`**Use these words:** ${styleGuide.vocabulary.preferred.join(', ')}`)
  parts.push('')
  parts.push(`**NEVER use these words:** ${styleGuide.vocabulary.avoid.join(', ')}`)
  parts.push('')

  if (Object.keys(styleGuide.vocabulary.replacements).length > 0) {
    parts.push('**Replacements:**')
    for (const [bad, good] of Object.entries(styleGuide.vocabulary.replacements)) {
      parts.push(`- "${bad}" → "${good}"`)
    }
  }

  return parts.join('\n')
}

function formatContentGuidelines(styleGuide: StyleGuideConfig): string {
  const parts: string[] = []

  for (const [, guideline] of Object.entries(styleGuide.contentGuidelines)) {
    parts.push(`**${guideline.principle}**`)
    for (const example of guideline.examples) {
      parts.push(`- ${example}`)
    }
    parts.push('')
  }

  return parts.join('\n')
}

function formatExamples(writerPrompt: WriterPromptConfig): string {
  const parts: string[] = []

  if (writerPrompt.website_prompt_template.examples_override.length > 0) {
    parts.push('### Content Examples')
    for (const example of writerPrompt.website_prompt_template.examples_override) {
      parts.push(`**${example.name}**`)
      parts.push(`Input: ${example.input}`)
      parts.push(`Output: \`${JSON.stringify(example.output, null, 2)}\``)
      parts.push('')
    }
  }

  return parts.join('\n')
}

function formatPageTemplates(writerPrompt: WriterPromptConfig): string {
  const parts: string[] = []

  if (Object.keys(writerPrompt.page_prompts).length > 0) {
    parts.push('## Page Templates')
    parts.push('')
    parts.push('When generating complete pages, follow these structures:')
    parts.push('')

    for (const [pageType, config] of Object.entries(writerPrompt.page_prompts)) {
      parts.push(`### ${pageType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`)
      parts.push('')
      parts.push('**Structure:**')
      for (let i = 0; i < config.structure.length; i++) {
        const section = config.structure[i]
        parts.push(`${i + 1}. \`${section.type}\` - ${section.purpose}`)
      }
      parts.push('')
      parts.push(`**Writing guidance:** ${config.writing_prompt}`)
      parts.push('')
    }
  }

  return parts.join('\n')
}

function formatCollectionPrompts(writerPrompt: WriterPromptConfig): string {
  const parts: string[] = []

  if (Object.keys(writerPrompt.collection_prompts).length > 0) {
    parts.push('## Collection Content Guidelines')
    parts.push('')
    parts.push('When writing content for collections, follow these guidelines:')
    parts.push('')

    for (const [collectionType, config] of Object.entries(writerPrompt.collection_prompts)) {
      parts.push(`### ${collectionType.charAt(0).toUpperCase() + collectionType.slice(1)}`)
      parts.push('')
      parts.push(`**Writing approach:** ${config.writing_prompt}`)
      parts.push('')
      parts.push(`**Required information:** ${config.required_fields.join(', ')}`)
      parts.push('')
    }
  }

  return parts.join('\n')
}

function formatStructurePatterns(styleGuide: StyleGuideConfig): string {
  const parts: string[] = []

  if (Object.keys(styleGuide.structurePatterns).length > 0) {
    parts.push('## Content Structure Patterns')
    parts.push('')

    for (const [patternType, pattern] of Object.entries(styleGuide.structurePatterns)) {
      parts.push(`### ${patternType.replace(/([A-Z])/g, ' $1').trim()}`)
      parts.push(`- **Opening:** ${pattern.opening}`)
      parts.push(`- **Body:** ${pattern.body}`)
      parts.push(`- **Close:** ${pattern.close}`)
      parts.push('')
    }
  }

  return parts.join('\n')
}

/**
 * Format editorial configs into a system prompt section
 */
export function formatEditorialPrompt(configs: EditorialConfigs): string {
  const { styleGuide, writerPrompt, agentSchemas } = configs

  const sections: string[] = []

  // Identity section
  sections.push(`## Your Identity: Giulia Rossi

${styleGuide.persona}

**Role:** ${agentSchemas.editorial_voice.persona.role} at ${agentSchemas.editorial_voice.brand}
**Voice:** ${styleGuide.voice}
**Tone:** ${styleGuide.tone}
**Perspective:** ${styleGuide.personality.perspective}

### Your Personality
${styleGuide.personality.traits.map(t => `- ${t}`).join('\n')}

Speaking style: ${styleGuide.personality.speakingStyle}
`)

  // Editorial voice (from writer-prompt.json)
  if (writerPrompt.website_prompt_template.template_additions) {
    sections.push(writerPrompt.website_prompt_template.template_additions)
    sections.push('')
  }

  // Style rules
  sections.push(`## Style Rules

### Formatting
- **Headings:** ${styleGuide.formatting.headings}
- **Paragraphs:** ${styleGuide.formatting.paragraphs}
- **Lists:** ${styleGuide.formatting.lists}
- **Numbers:** ${styleGuide.formatting.numbers}
- **Times:** ${styleGuide.formatting.times}
- **Prices:** ${styleGuide.formatting.prices}
- **Distances:** ${styleGuide.formatting.distances}

${formatVocabularyRules(styleGuide)}

### Writing Principles
${formatContentGuidelines(styleGuide)}
`)

  // Good/bad examples
  sections.push(`### Good Writing Examples
${styleGuide.examples.good.map(ex => `> "${ex}"`).join('\n\n')}

### Bad Writing Examples (NEVER write like this)
${styleGuide.examples.bad.map(ex => `> ❌ "${ex}"`).join('\n\n')}
`)

  // Block types
  sections.push(`## Content Block Types

${formatBlockTypes(agentSchemas)}`)

  // Page templates (for complete page generation)
  const pageTemplatesSection = formatPageTemplates(writerPrompt)
  if (pageTemplatesSection) {
    sections.push(pageTemplatesSection)
  }

  // Collection content guidelines
  const collectionPromptsSection = formatCollectionPrompts(writerPrompt)
  if (collectionPromptsSection) {
    sections.push(collectionPromptsSection)
  }

  // Content structure patterns (villageIntro, restaurantDescription, etc.)
  const structurePatternsSection = formatStructurePatterns(styleGuide)
  if (structurePatternsSection) {
    sections.push(structurePatternsSection)
  }

  // Content examples
  const examplesSection = formatExamples(writerPrompt)
  if (examplesSection) {
    sections.push(examplesSection)
  }

  return sections.join('\n')
}

/**
 * Clear the config cache (useful for testing or hot-reloading)
 */
export function clearConfigCache(): void {
  cachedStyleGuide = null
  cachedWriterPrompt = null
  cachedAgentSchemas = null
  console.log('[EditorialConfigLoader] Cache cleared')
}
