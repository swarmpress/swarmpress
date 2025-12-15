#!/usr/bin/env npx tsx
/**
 * Content Generation Script with Database-Stored Agent Personas
 *
 * Generates high-quality content for cinqueterre.travel using the agent personas
 * stored in the database. Each agent has a unique voice, writing style, and expertise.
 *
 * Usage:
 *   npx tsx scripts/generate-content-with-personas.ts [options]
 *
 * Options:
 *   --lang=en,de,fr,it  Languages to generate (default: en)
 *   --village=name      Filter by village (monterosso, vernazza, etc.)
 *   --page-type=type    Filter by page type (restaurants, hiking, etc.)
 *   --limit=N           Limit number of pages to process
 *   --dry-run           Show what would be generated without making changes
 *
 * Prerequisites:
 *   - Database running with agents table populated
 *   - ANTHROPIC_API_KEY environment variable set
 *   - DATABASE_URL environment variable (or uses default localhost)
 */

import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import { Pool } from 'pg'
import { getAgentForPageType, getAgentExpertise } from '../packages/shared/src/content/agent-page-mapping'
import { getLanguageGuidelines, type SupportedLanguage } from '../packages/agents/src/writer/language-guidelines'

// ============================================================================
// Types
// ============================================================================

interface DBAgent {
  name: string
  persona: string
  hobbies: string[] | null
  writing_style: {
    tone?: string
    vocabulary_level?: string
    sentence_length?: string
    formality?: string
    humor?: string
    emoji_usage?: string
    perspective?: string
    descriptive_style?: string
  } | null
  description: string | null
  role_name: string | null
}

interface LocalizedString {
  en?: string
  de?: string
  fr?: string
  it?: string
}

interface ContentBlock {
  type: string
  [key: string]: unknown
}

interface PageContent {
  id: string
  slug: LocalizedString
  title: LocalizedString
  page_type?: string
  seo?: {
    title?: LocalizedString
    description?: LocalizedString
    keywords?: LocalizedString | { [lang: string]: string[] }
  }
  body?: ContentBlock[]
  metadata?: Record<string, unknown>
}

interface CollectionItem {
  slug: string
  name: LocalizedString
  category?: string
  village?: string
  details?: {
    teaser?: LocalizedString
    description?: LocalizedString
  }
}

interface GenerationResult {
  page: string
  language: string
  agent: string
  success: boolean
  error?: string
  blocksGenerated?: number
}

// ============================================================================
// Configuration
// ============================================================================

const CONTENT_DIR = path.join(__dirname, '..', 'cinqueterre.travel', 'content')
const PAGES_DIR = path.join(CONTENT_DIR, 'pages')
const COLLECTIONS_DIR = path.join(CONTENT_DIR, 'collections')

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['en', 'de', 'fr', 'it']
const DELAY_BETWEEN_REQUESTS = 2000
const DELAY_BETWEEN_PAGES = 5000

// ============================================================================
// Database Functions
// ============================================================================

let agentsCache: Map<string, DBAgent> | null = null

async function loadAgentsFromDatabase(pool: Pool): Promise<Map<string, DBAgent>> {
  if (agentsCache) return agentsCache

  const result = await pool.query<DBAgent>(`
    SELECT
      a.name,
      a.persona,
      a.hobbies,
      a.writing_style,
      a.description,
      r.name as role_name
    FROM agents a
    LEFT JOIN roles r ON a.role_id = r.id
    WHERE a.status = 'active'
  `)

  agentsCache = new Map()
  for (const row of result.rows) {
    agentsCache.set(row.name, row)
  }

  console.log(`Loaded ${agentsCache.size} agents from database`)
  return agentsCache
}

function formatAgentForPrompt(agent: DBAgent, lang: string): string {
  const lines: string[] = []

  lines.push(`## Your Identity: ${agent.name}`)
  if (agent.role_name) {
    lines.push(`**Role:** ${agent.role_name}`)
  }
  lines.push('')
  lines.push('### Your Persona')
  lines.push(agent.persona)

  if (agent.hobbies && agent.hobbies.length > 0) {
    lines.push('')
    lines.push('### Your Personal Interests')
    lines.push(agent.hobbies.join(', '))
  }

  if (agent.writing_style) {
    lines.push('')
    lines.push('### Your Writing Style')
    const style = agent.writing_style

    const styleDescriptions: Record<string, Record<string, string>> = {
      tone: {
        professional: 'Maintain a polished, business-appropriate voice',
        casual: 'Write in a relaxed, everyday conversational manner',
        friendly: 'Be warm, approachable, and engaging',
        authoritative: 'Convey expertise and credibility with confidence',
        enthusiastic: 'Express genuine excitement and energy',
        formal: 'Use proper, conventional language',
      },
      vocabulary_level: {
        simple: 'Use everyday words accessible to all readers',
        moderate: 'Balance common and slightly sophisticated vocabulary',
        advanced: 'Employ rich, varied vocabulary',
        technical: 'Include specialized terminology where appropriate',
      },
      perspective: {
        first_person: 'Write using "I" and share personal experiences',
        second_person: 'Address the reader directly using "you"',
        third_person: 'Maintain objective distance, referring to "visitors" or "travelers"',
      },
      descriptive_style: {
        factual: 'Focus on concrete facts and practical information',
        evocative: 'Paint vivid pictures that stir emotions',
        poetic: 'Use lyrical, metaphorical language',
        practical: 'Emphasize actionable, useful information',
      },
    }

    if (style.tone && styleDescriptions.tone[style.tone]) {
      lines.push(`- **Tone:** ${styleDescriptions.tone[style.tone]}`)
    }
    if (style.vocabulary_level && styleDescriptions.vocabulary_level[style.vocabulary_level]) {
      lines.push(`- **Vocabulary:** ${styleDescriptions.vocabulary_level[style.vocabulary_level]}`)
    }
    if (style.perspective && styleDescriptions.perspective[style.perspective]) {
      lines.push(`- **Perspective:** ${styleDescriptions.perspective[style.perspective]}`)
    }
    if (style.descriptive_style && styleDescriptions.descriptive_style[style.descriptive_style]) {
      lines.push(`- **Description:** ${styleDescriptions.descriptive_style[style.descriptive_style]}`)
    }
    if (style.formality) {
      lines.push(`- **Formality:** ${style.formality.replace('_', ' ')}`)
    }
  }

  return lines.join('\n')
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getLocalizedText(value: unknown, lang: string): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const obj = value as LocalizedString
    return obj[lang as keyof LocalizedString] || obj.en || ''
  }
  return ''
}

function extractVillageFromPath(pagePath: string): string {
  const villages = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']
  for (const village of villages) {
    if (pagePath.toLowerCase().includes(village)) {
      return village
    }
  }
  return 'cinque-terre'
}

function extractPageTypeFromPath(pagePath: string): string {
  const filename = path.basename(pagePath, '.json')
  if (filename === 'index') {
    const parent = path.basename(path.dirname(pagePath))
    return parent === 'pages' ? 'overview' : parent
  }
  return filename
}

// ============================================================================
// Collection Loading
// ============================================================================

function loadCollections(village: string): Record<string, CollectionItem[]> {
  const collections: Record<string, CollectionItem[]> = {}
  const collectionTypes = ['pois', 'restaurants', 'accommodations', 'hikes', 'events']

  for (const type of collectionTypes) {
    const collectionPath = path.join(COLLECTIONS_DIR, type)
    if (!fs.existsSync(collectionPath)) continue

    const files = fs.readdirSync(collectionPath).filter(f => f.endsWith('.json') && !f.startsWith('_'))

    for (const file of files) {
      if (village && village !== 'cinque-terre' && !file.includes(village)) continue

      try {
        const content = JSON.parse(fs.readFileSync(path.join(collectionPath, file), 'utf-8'))
        if (content.items && Array.isArray(content.items)) {
          if (!collections[type]) collections[type] = []
          collections[type].push(...content.items.slice(0, 10))
        }
      } catch (e) {
        // Silently skip invalid files
      }
    }
  }

  return collections
}

function formatCollectionsForPrompt(collections: Record<string, CollectionItem[]>, lang: string): string {
  const sections: string[] = []

  for (const [type, items] of Object.entries(collections)) {
    if (items.length === 0) continue

    const itemList = items.slice(0, 8).map(item => {
      const name = getLocalizedText(item.name, lang) || item.slug
      const teaser = getLocalizedText(item.details?.teaser, lang)
      return `- **${name}**${item.category ? ` [${item.category}]` : ''}${teaser ? `: ${teaser.slice(0, 80)}...` : ''}`
    }).join('\n')

    sections.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)} (${items.length} items)\n${itemList}`)
  }

  return sections.length > 0 ? sections.join('\n\n') : 'No collection items available.'
}

// ============================================================================
// Content Analysis
// ============================================================================

function analyzeContentNeeds(page: PageContent, lang: SupportedLanguage): {
  needsGeneration: boolean
  existingBlocks: number
  missingTranslation: boolean
} {
  const body = page.body || []
  const existingBlocks = body.length

  let hasContent = false
  for (const block of body) {
    const textFields = ['title', 'subtitle', 'description', 'content', 'eyebrow']
    for (const field of textFields) {
      const value = block[field]
      if (value && typeof value === 'object') {
        const text = (value as LocalizedString)[lang]
        if (text && text.length > 10) {
          hasContent = true
          break
        }
      }
    }
    if (hasContent) break
  }

  if (lang === 'en') {
    return {
      needsGeneration: existingBlocks < 3 || !hasContent,
      existingBlocks,
      missingTranslation: false,
    }
  }

  return {
    needsGeneration: !hasContent,
    existingBlocks,
    missingTranslation: existingBlocks > 0 && !hasContent,
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildContentGenerationPrompt(
  page: PageContent,
  pagePath: string,
  lang: SupportedLanguage,
  agent: DBAgent,
  collections: Record<string, CollectionItem[]>,
  isTranslation: boolean = false
): string {
  const village = extractVillageFromPath(pagePath)
  const pageType = page.page_type || extractPageTypeFromPath(pagePath)
  const pageTitle = getLocalizedText(page.title, lang) || getLocalizedText(page.title, 'en')

  const agentSection = formatAgentForPrompt(agent, lang)
  const languageSection = getLanguageGuidelines(lang)
  const collectionsSection = formatCollectionsForPrompt(collections, lang)

  const languageNames: Record<SupportedLanguage, string> = {
    en: 'English',
    de: 'German',
    fr: 'French',
    it: 'Italian',
  }

  const existingContent = isTranslation && page.body
    ? `\n## Existing English Content (for reference)\n\`\`\`json\n${JSON.stringify(page.body, null, 2).slice(0, 2000)}...\n\`\`\``
    : ''

  return `You are generating content for a travel website about Cinque Terre, Italy.

${agentSection}

${languageSection}

## Your Task
${isTranslation
    ? `Translate and culturally adapt the existing content into ${languageNames[lang]}. Don't just translate literally—adapt the tone, references, and style for ${languageNames[lang]}-speaking travelers while maintaining your unique voice.`
    : `Create engaging, comprehensive content for the "${pageTitle}" page. Write as ${agent.name}, using your unique voice and perspective.`}

**CRITICAL: Write ALL content in ${languageNames[lang]} (${lang.toUpperCase()}).**

## Page Details
- **Page:** ${pageTitle}
- **Village:** ${village}
- **Page Type:** ${pageType}
- **Target Language:** ${languageNames[lang]}
- **Agent Expertise:** ${getAgentExpertise(agent.name)}

## Available Collection Data
Use this real data to make content specific and authentic:
${collectionsSection}

${existingContent}

## Content Structure Required
Generate content as a JSON array of content blocks. Each block must have a "type" field.

For localized text, use objects with language keys:
\`\`\`json
{
  "title": {
    "${lang}": "Your ${languageNames[lang]} title here"
  }
}
\`\`\`

## Block Types Available
- hero-section: Main banner (variant, title, subtitle, buttons, image)
- stats-section: Key statistics (stats array with value/label)
- content-section: Text content (title, subtitle, content with markdown)
- feature-section: Feature grid (features array with icon, title, description)
- faq-section: Q&A (items array with question/answer)
- testimonial-section: Quotes (quote, author, role)
- cta-section: Call to action (title, subtitle, buttons)
- bento-grid-section: Visual grid (items array)

## Guidelines
1. Write in YOUR unique voice as ${agent.name}—let your personality shine through
2. Use the collection data to mention SPECIFIC places, restaurants, trails, etc.
3. Be emotionally engaging, not just informative
4. Include practical tips naturally woven into the narrative
5. Don't be generic—be specific to ${village} and this page's topic

Now generate the content blocks as a JSON array. Output ONLY the JSON array, no explanations.`
}

// ============================================================================
// Content Generation
// ============================================================================

async function generateContent(
  client: Anthropic,
  pool: Pool,
  page: PageContent,
  pagePath: string,
  lang: SupportedLanguage,
  isTranslation: boolean = false
): Promise<ContentBlock[] | null> {
  const pageType = page.page_type || extractPageTypeFromPath(pagePath)
  const agentName = getAgentForPageType(pageType)

  const agents = await loadAgentsFromDatabase(pool)
  const agent = agents.get(agentName)

  if (!agent) {
    console.warn(`Agent "${agentName}" not found in database`)
    return null
  }

  const village = extractVillageFromPath(pagePath)
  const collections = loadCollections(village)

  const prompt = buildContentGenerationPrompt(page, pagePath, lang, agent, collections, isTranslation)

  console.log(`  [${agentName}] Generating ${lang.toUpperCase()} content...`)

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    })

    const textContent = response.content.find(c => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from API')
    }

    const jsonMatch = textContent.text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('No JSON array found in response')
    }

    const blocks = JSON.parse(jsonMatch[0]) as ContentBlock[]

    if (!Array.isArray(blocks)) {
      throw new Error('Response is not an array')
    }

    for (const block of blocks) {
      if (!block.type) {
        throw new Error('Block missing type field')
      }
    }

    return blocks
  } catch (error) {
    console.error(`  [${agentName}] Error:`, error instanceof Error ? error.message : error)
    return null
  }
}

// ============================================================================
// Page Processing
// ============================================================================

async function processPage(
  client: Anthropic,
  pool: Pool,
  pagePath: string,
  languages: SupportedLanguage[],
  dryRun: boolean = false
): Promise<GenerationResult[]> {
  const results: GenerationResult[] = []
  const fullPath = path.join(PAGES_DIR, pagePath)

  if (!fs.existsSync(fullPath)) {
    console.warn(`Page not found: ${pagePath}`)
    return results
  }

  const page = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as PageContent
  const pageType = page.page_type || extractPageTypeFromPath(pagePath)
  const agentName = getAgentForPageType(pageType)

  console.log(`\nProcessing: ${pagePath}`)
  console.log(`  Agent: ${agentName}`)
  console.log(`  Page Type: ${pageType}`)

  for (const lang of languages) {
    const analysis = analyzeContentNeeds(page, lang)

    if (!analysis.needsGeneration) {
      console.log(`  [${lang.toUpperCase()}] Already has content, skipping`)
      results.push({
        page: pagePath,
        language: lang,
        agent: agentName,
        success: true,
        blocksGenerated: 0,
      })
      continue
    }

    if (dryRun) {
      console.log(`  [${lang.toUpperCase()}] Would generate content (dry run)`)
      results.push({
        page: pagePath,
        language: lang,
        agent: agentName,
        success: true,
        blocksGenerated: 0,
      })
      continue
    }

    const isTranslation = lang !== 'en' && analysis.missingTranslation
    const blocks = await generateContent(client, pool, page, pagePath, lang, isTranslation)

    if (blocks) {
      if (!page.body) page.body = []

      if (lang === 'en') {
        page.body = blocks
      } else {
        // Merge translations into existing blocks
        for (let i = 0; i < blocks.length && i < page.body.length; i++) {
          const newBlock = blocks[i]
          const existingBlock = page.body[i]

          for (const [key, value] of Object.entries(newBlock)) {
            if (key === 'type') continue
            if (typeof value === 'object' && value !== null && lang in (value as object)) {
              if (!existingBlock[key]) existingBlock[key] = {}
              if (typeof existingBlock[key] === 'object') {
                (existingBlock[key] as LocalizedString)[lang] = (value as LocalizedString)[lang]
              }
            }
          }
        }
      }

      fs.writeFileSync(fullPath, JSON.stringify(page, null, 2), 'utf-8')
      console.log(`  [${lang.toUpperCase()}] Generated ${blocks.length} blocks`)

      results.push({
        page: pagePath,
        language: lang,
        agent: agentName,
        success: true,
        blocksGenerated: blocks.length,
      })
    } else {
      results.push({
        page: pagePath,
        language: lang,
        agent: agentName,
        success: false,
        error: 'Generation failed',
      })
    }

    await sleep(DELAY_BETWEEN_REQUESTS)
  }

  return results
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const options: Record<string, string> = {}

  for (const arg of args) {
    const [key, value] = arg.replace('--', '').split('=')
    options[key] = value || 'true'
  }

  const languages = (options.lang?.split(',') || ['en']) as SupportedLanguage[]
  const villageFilter = options.village
  const pageTypeFilter = options['page-type']
  const limit = parseInt(options.limit) || Infinity
  const dryRun = options['dry-run'] === 'true'

  console.log('='.repeat(60))
  console.log('Content Generation with Database Agent Personas')
  console.log('='.repeat(60))
  console.log(`Languages: ${languages.join(', ')}`)
  console.log(`Village Filter: ${villageFilter || 'all'}`)
  console.log(`Page Type Filter: ${pageTypeFilter || 'all'}`)
  console.log(`Limit: ${limit === Infinity ? 'none' : limit}`)
  console.log(`Dry Run: ${dryRun}`)
  console.log('')

  // Initialize clients
  const client = new Anthropic()
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://swarmpress:swarmpress@localhost:5432/swarmpress'
  })

  try {
    // Verify database connection and load agents
    await loadAgentsFromDatabase(pool)

    // Find pages to process
    const pageFiles: string[] = []

    function scanDir(dir: string, prefix: string = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          scanDir(path.join(dir, entry.name), `${prefix}${entry.name}/`)
        } else if (entry.name.endsWith('.json')) {
          const pagePath = `${prefix}${entry.name}`
          if (villageFilter && !pagePath.toLowerCase().includes(villageFilter.toLowerCase())) {
            continue
          }
          pageFiles.push(pagePath)
        }
      }
    }

    scanDir(PAGES_DIR)

    // Filter by page type if specified
    let filteredPages = pageFiles
    if (pageTypeFilter) {
      filteredPages = pageFiles.filter(p => {
        const page = JSON.parse(fs.readFileSync(path.join(PAGES_DIR, p), 'utf-8'))
        const pageType = page.page_type || extractPageTypeFromPath(p)
        return pageType.toLowerCase().includes(pageTypeFilter.toLowerCase())
      })
    }

    const pagesToProcess = filteredPages.slice(0, limit)

    console.log(`Found ${pageFiles.length} pages, processing ${pagesToProcess.length}`)
    console.log('')

    // Process pages
    const allResults: GenerationResult[] = []

    for (let i = 0; i < pagesToProcess.length; i++) {
      const pagePath = pagesToProcess[i]
      console.log(`[${i + 1}/${pagesToProcess.length}]`)

      const results = await processPage(client, pool, pagePath, languages, dryRun)
      allResults.push(...results)

      if (i < pagesToProcess.length - 1) {
        await sleep(DELAY_BETWEEN_PAGES)
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('Generation Summary')
    console.log('='.repeat(60))

    const successful = allResults.filter(r => r.success)
    const failed = allResults.filter(r => !r.success)
    const totalBlocks = successful.reduce((sum, r) => sum + (r.blocksGenerated || 0), 0)

    console.log(`Total pages processed: ${pagesToProcess.length}`)
    console.log(`Successful generations: ${successful.length}`)
    console.log(`Failed generations: ${failed.length}`)
    console.log(`Total blocks generated: ${totalBlocks}`)

    const byAgent: Record<string, number> = {}
    for (const result of successful) {
      byAgent[result.agent] = (byAgent[result.agent] || 0) + (result.blocksGenerated || 0)
    }

    console.log('\nBlocks by Agent:')
    for (const [agent, count] of Object.entries(byAgent)) {
      console.log(`  ${agent}: ${count} blocks`)
    }

    if (failed.length > 0) {
      console.log('\nFailed Pages:')
      for (const result of failed) {
        console.log(`  ${result.page} [${result.language}]: ${result.error}`)
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch(console.error)
