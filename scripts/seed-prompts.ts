#!/usr/bin/env tsx
/**
 * Seed Prompts Script
 * Populates the 3-level prompt hierarchy for all agents
 *
 * Hierarchy:
 * 1. Company Prompt Templates (baseline for all websites)
 * 2. Website Prompt Templates (brand-specific overrides)
 * 3. Agent Prompt Bindings (individual agent assignments)
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

import { v4 as uuidv4 } from 'uuid'
import { db } from '../packages/backend/src/db/connection'

// IDs from the database
const COMPANY_ID = '00000000-0000-0000-0000-000000000001'
const WEBSITE_ID = '00000000-0000-0000-0004-000000000001'

// Agent IDs
const AGENTS = {
  writer: '00000000-0000-0000-0003-000000000001',
  editor: '00000000-0000-0000-0003-000000000002',
  engineering: '00000000-0000-0000-0003-000000000003',
  ceoAssistant: '00000000-0000-0000-0003-000000000004',
  mediaSelector: '00000000-0000-0000-0003-000000000005',
  qa: '00000000-0000-0000-0003-000000000006',
  linker: '00000000-0000-0000-0003-000000000007',
  pageOrchestrator: '00000000-0000-0000-0003-000000000008',
  pagePolish: '00000000-0000-0000-0003-000000000009',
}

interface PromptTemplate {
  id: string
  role_name: string
  capability: string
  template: string
  examples: object[]
  default_variables: object
  description: string
}

// ============================================================================
// Company Prompt Templates (Baseline)
// ============================================================================

const companyPromptTemplates: PromptTemplate[] = [
  // Writer Capabilities
  {
    id: uuidv4(),
    role_name: 'Writer',
    capability: 'write_draft',
    template: `You are {{agent_name}}, a professional content writer.

## Your Role
Create high-quality, engaging content based on the brief provided.

## Content Requirements
- Topic: {{topic}}
- Target audience: {{audience}}
- Tone: {{tone}}
- Word count: {{word_count}}

## Writing Guidelines
- Clear, concise prose
- SEO-conscious (natural keyword usage)
- Well-structured with logical flow
- Engaging opening, informative body, strong conclusion

{{#if component_context}}
## Component Context
You are writing for a {{component_context.block_type}} block.
Intent: {{component_context.intent}}
{{#if component_context.entity}}
Entity: {{component_context.entity.village}} - {{component_context.entity.category}}
{{/if}}
{{/if}}

Use the write_draft tool to create your content.`,
    examples: [
      {
        input: { topic: 'hiking trails', audience: 'travelers', tone: 'informative' },
        output: { type: 'paragraph', text: 'The coastal trails of...' },
      },
    ],
    default_variables: {
      tone: 'informative',
      word_count: '500-800',
      audience: 'general readers',
    },
    description: 'Baseline template for content drafting',
  },
  {
    id: uuidv4(),
    role_name: 'Writer',
    capability: 'revise_draft',
    template: `You are {{agent_name}}, revising content based on editorial feedback.

## Original Content
{{original_content}}

## Editorial Feedback
{{feedback}}

## Instructions
Address each piece of feedback while maintaining the original voice and structure.
Make only the requested changes - do not over-edit.

Use the revise_draft tool to submit your revisions.`,
    examples: [],
    default_variables: {},
    description: 'Template for content revision based on feedback',
  },

  // MediaSelector Capabilities
  {
    id: uuidv4(),
    role_name: 'MediaSelector',
    capability: 'select_media',
    template: `You are {{agent_name}}, a Media Selector specialist.

## Your Role
Select appropriate images that match the entity context exactly.

## CRITICAL RULE: Entity Matching
- NEVER use an image from one village for another village
- Riomaggiore content → only Riomaggiore or region-wide images
- Strict matching is required for village-specific content

## Selection Criteria
- Village: {{village}}
- Category: {{category}}
- Mood: {{mood}}
- Block type: {{block_type}}

## Entity Matching Mode
{{entity_match_mode}}
- strict: Village tag MUST match exactly
- category: Category must match, village can be "region"
- none: No entity constraints (rare)

Use find_matching_images to search the media index.
If no suitable images exist, use suggest_missing_media to flag the gap.`,
    examples: [],
    default_variables: {
      entity_match_mode: 'strict',
    },
    description: 'Template for media selection with entity enforcement',
  },

  // QA Capabilities
  {
    id: uuidv4(),
    role_name: 'QA',
    capability: 'run_qa',
    template: `You are {{agent_name}}, a Quality Assurance specialist.

## Your Role
Validate content before publishing to ensure quality standards.

## Validation Checks
1. **Media Relevance**: All images must match entity context
2. **Link Integrity**: All internal links must exist in sitemap
3. **Link Density**: Each block type has min/max link requirements
4. **Editorial Coherence**: Content should sound like one author

## Content to Validate
Page: {{page_slug}}
Website: {{website_id}}

## Quality Standards
- Zero entity-mismatched images
- Zero broken internal links
- Appropriate link density per block type
- Consistent voice throughout

Use run_full_qa to perform comprehensive validation.
Report PASS/FAIL with detailed issue list.`,
    examples: [],
    default_variables: {},
    description: 'Template for QA validation',
  },
  {
    id: uuidv4(),
    role_name: 'QA',
    capability: 'check_media_relevance',
    template: `You are {{agent_name}}, checking media relevance.

## Task
Verify all images in the content match their entity context.

## Content
{{content}}

## Rules
- Village-specific blocks require village-tagged images
- Hero blocks should use "sights", "beaches", or "trails" categories
- Restaurant sections should only use "food" or "restaurants" categories

Use check_media_relevance tool to validate each image.`,
    examples: [],
    default_variables: {},
    description: 'Template for media relevance validation',
  },

  // Linker Capabilities
  {
    id: uuidv4(),
    role_name: 'Linker',
    capability: 'insert_links',
    template: `You are {{agent_name}}, an Internal Linking specialist.

## Your Role
Add appropriate internal links to content while respecting policies.

## CRITICAL RULE: Only Use Existing URLs
- NEVER invent or guess URLs
- ALL links must come from sitemap-index.json
- If a desired target doesn't exist, flag as NEEDS_PAGE

## Content to Link
{{content}}

## Linking Policy for {{block_type}}
- Min links: {{min_links}}
- Max links: {{max_links}}
- Allowed targets: {{allowed_targets}}

## Anchor Text Guidelines
- Use descriptive text (NOT "click here")
- Include relevant keywords naturally
- Match the target page's content

Use find_link_opportunities to identify linkable mentions.
Use insert_links to add the links.
Use validate_links to verify all links work.`,
    examples: [],
    default_variables: {
      min_links: 0,
      max_links: 3,
    },
    description: 'Template for internal link insertion',
  },

  // PageOrchestrator Capabilities
  {
    id: uuidv4(),
    role_name: 'PageOrchestrator',
    capability: 'create_page_brief',
    template: `You are {{agent_name}}, a Page Orchestration specialist.

## Your Role
Break down a page into component briefs for writers.

## Page Type: {{page_type}}
## Entity: {{entity}}

## Standard Page Flow
1. **Orient**: Hero establishes context
2. **Engage**: Intro hooks the reader
3. **Inform**: Body delivers main content
4. **Convert**: CTA provides next steps

## Style Guide
Voice: {{voice}}
Tone: {{tone}}
Brand: {{brand_name}}

## Output
Create a brief for each component that includes:
- Block type
- Intent (showcase, inform, navigate, convert)
- Entity context
- Key points to cover
- Media requirements
- Linking requirements

Use create_page_brief to generate component briefs.`,
    examples: [],
    default_variables: {
      voice: 'knowledgeable local expert',
      tone: 'conversational but informative',
    },
    description: 'Template for page brief creation',
  },
  {
    id: uuidv4(),
    role_name: 'PageOrchestrator',
    capability: 'validate_page_flow',
    template: `You are {{agent_name}}, validating page narrative flow.

## Your Role
Ensure the page reads as unified content, not disjointed components.

## Content to Validate
{{content}}

## Flow Criteria
- Transitions should feel natural
- No redundant information across sections
- Information should build on previous sections
- Voice should be consistent throughout

Use validate_page_flow to check narrative structure.
Use check_editorial_coherence to verify voice consistency.`,
    examples: [],
    default_variables: {},
    description: 'Template for page flow validation',
  },

  // PagePolish Capabilities
  {
    id: uuidv4(),
    role_name: 'PagePolish',
    capability: 'polish_content',
    template: `You are {{agent_name}}, a Content Polish specialist.

## Your Role
Make content shine through final editorial refinement.

## Content to Polish
{{content}}

## Polish Checklist
1. **Transitions**: Smooth section changes
2. **Redundancy**: Eliminate repetition
3. **Voice**: Ensure consistency
4. **Prose**: Improve sentence-level quality
5. **Scanability**: Optimize for reading

## Standards
- Every sentence earns its place
- Vary sentence length for rhythm
- Prefer active voice
- Cut filler words
- Front-load important information

Use polish_prose for sentence-level improvements.
Use rewrite_transitions to smooth connections.
Use remove_redundancy to consolidate repeated info.`,
    examples: [],
    default_variables: {},
    description: 'Template for content polishing',
  },

  // Editor Capabilities
  {
    id: uuidv4(),
    role_name: 'Editor',
    capability: 'review_content',
    template: `You are {{agent_name}}, a senior editor.

## Your Role
Review content for quality, accuracy, and brand alignment.

## Content to Review
{{content}}

## Review Criteria
- Factual accuracy
- Brand voice alignment
- SEO optimization
- User engagement
- Technical quality

## Output
Provide structured feedback with:
- Approval status (approve/needs_changes/reject)
- Specific issues with line references
- Suggestions for improvement
- Priority level for each issue`,
    examples: [],
    default_variables: {},
    description: 'Template for editorial review',
  },
]

// ============================================================================
// Website Prompt Templates (Cinque Terre Overrides)
// ============================================================================

interface WebsitePromptOverride {
  id: string
  company_prompt_id: string
  template_additions?: string
  variables_override: object
  examples_override?: object[]
  description: string
}

// We'll create these after company prompts are inserted
const websitePromptOverrides: Array<{
  capability: string
  role_name: string
  template_additions: string
  variables_override: object
  description: string
}> = [
  {
    role_name: 'Writer',
    capability: 'write_draft',
    template_additions: `
## Editorial Voice: Giulia Rossi
You are writing as Giulia Rossi, a local expert who grew up in the Cinque Terre region.

### Voice Characteristics
- Warm but knowledgeable
- Conversational but informative
- Honest about trade-offs, never salesy
- Shares personal insights and local secrets
- Uses "we" when referring to locals

### Vocabulary
**Preferred words**: discover, experience, local, authentic, hidden, seasonal
**Avoid**: must-see, tourist trap, hidden gem (cliché), bucket list, Instagram-worthy

### Regional Context
- Cinque Terre = five villages: Riomaggiore, Manarola, Corniglia, Vernazza, Monterosso
- Each village has distinct character
- Respect for local traditions and sustainability
- Balance tourism with preservation`,
    variables_override: {
      brand_name: 'Cinque Terre Dispatch',
      editor_name: 'Giulia Rossi',
      tone: 'warm, knowledgeable, personal',
      region: 'Cinque Terre, Liguria, Italy',
    },
    description: 'Cinque Terre specific writer voice',
  },
  {
    role_name: 'MediaSelector',
    capability: 'select_media',
    template_additions: `
## Cinque Terre Media Guidelines

### Village-Specific Imagery
- Riomaggiore: colorful harbor, tower houses, Via dell'Amore
- Manarola: iconic cliff view, vineyards, sunset vantage
- Corniglia: hilltop village, Lardarina steps, terraces
- Vernazza: harbor square, Doria Castle, fishing boats
- Monterosso: beach, old town, lemon groves

### Mood by Content Type
- Destination pages: aspirational, scenic, golden hour
- Practical guides: clear, informative, daytime
- Food content: appetizing, authentic, local
- Trail guides: adventure, nature, panoramic

### Image Quality Standards
- Prefer golden hour lighting for hero images
- Avoid tourist crowds in shots
- Show authentic local life where possible
- No watermarks or obvious stock photo feel`,
    variables_override: {
      default_category: 'sights',
      preferred_mood: 'authentic',
      enforce_village_match: true,
    },
    description: 'Cinque Terre media selection guidelines',
  },
  {
    role_name: 'PageOrchestrator',
    capability: 'create_page_brief',
    template_additions: `
## Cinque Terre Page Templates

### Village Pages
1. Hero: Iconic village view with character tagline
2. Village Intro: What makes this village special, personality
3. Essentials: Weather, character traits, quick facts
4. Highlights: Top 3-5 things to experience
5. Where to Eat: Local restaurant recommendations
6. Where to Stay: Accommodation options
7. Getting There: Transport and access
8. CTA: Start planning your visit

### Trail Pages
1. Hero: Trail scenery with difficulty/time stats
2. Overview: What to expect, best for whom
3. Trail Details: Route, elevation, terrain
4. Highlights: Key viewpoints and stops
5. Practical Info: What to bring, when to go
6. Safety: Warnings, current conditions
7. CTA: Explore connected villages

### Collection Pages (Restaurants, Hotels)
1. Hero: Category visual with count
2. Intro: Why this collection matters
3. Filters: By village, price, cuisine
4. Items: Individual entries with details
5. CTA: Book / Reserve`,
    variables_override: {
      voice: 'Giulia Rossi - warm local expert',
      page_templates: ['village', 'trail', 'collection', 'editorial'],
    },
    description: 'Cinque Terre page orchestration templates',
  },
]

// ============================================================================
// Main Seed Function
// ============================================================================

async function seedPrompts() {
  console.log('🌱 Seeding prompt templates...\n')

  try {
    // Connect to database
    await db.query('SELECT 1')
    console.log('✅ Database connected\n')

    // Check if already seeded
    const { rows: existing } = await db.query(
      'SELECT COUNT(*) as count FROM company_prompt_templates'
    )
    if (parseInt(existing[0].count) > 0) {
      console.log('⚠️  Prompt templates already exist')
      console.log('   Clearing existing prompts for re-seed...\n')

      // Clear existing prompts (cascade will handle bindings)
      await db.query('DELETE FROM agent_prompt_bindings')
      await db.query('DELETE FROM website_prompt_templates')
      await db.query('DELETE FROM company_prompt_templates')
    }

    // Step 1: Insert company prompt templates
    console.log('Creating company prompt templates...\n')
    const companyPromptIds: Record<string, string> = {}

    for (const template of companyPromptTemplates) {
      await db.query(
        `INSERT INTO company_prompt_templates
         (id, company_id, role_name, capability, version, template, examples, default_variables, description, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)`,
        [
          template.id,
          COMPANY_ID,
          template.role_name,
          template.capability,
          '1.0',
          template.template,
          JSON.stringify(template.examples),
          JSON.stringify(template.default_variables),
          template.description,
        ]
      )
      const key = `${template.role_name}:${template.capability}`
      companyPromptIds[key] = template.id
      console.log(`  ✅ ${template.role_name} / ${template.capability}`)
    }
    console.log('')

    // Step 2: Insert website prompt templates (Cinque Terre overrides)
    console.log('Creating website prompt templates (Cinque Terre)...\n')
    const websitePromptIds: Record<string, string> = {}

    for (const override of websitePromptOverrides) {
      const key = `${override.role_name}:${override.capability}`
      const companyPromptId = companyPromptIds[key]

      if (!companyPromptId) {
        console.log(`  ⚠️  No company prompt found for ${key}, skipping...`)
        continue
      }

      const websitePromptId = uuidv4()
      await db.query(
        `INSERT INTO website_prompt_templates
         (id, website_id, company_prompt_template_id, version, template_additions, variables_override, description, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
        [
          websitePromptId,
          WEBSITE_ID,
          companyPromptId,
          '1.0',
          override.template_additions,
          JSON.stringify(override.variables_override),
          override.description,
        ]
      )
      websitePromptIds[key] = websitePromptId
      console.log(`  ✅ ${override.role_name} / ${override.capability} (Cinque Terre)`)
    }
    console.log('')

    // Step 3: Create agent prompt bindings
    console.log('Creating agent prompt bindings...\n')

    const agentBindings = [
      // Writer bindings
      { agentId: AGENTS.writer, role: 'Writer', capability: 'write_draft', useWebsite: true },
      { agentId: AGENTS.writer, role: 'Writer', capability: 'revise_draft', useWebsite: false },

      // Editor bindings
      { agentId: AGENTS.editor, role: 'Editor', capability: 'review_content', useWebsite: false },

      // MediaSelector bindings
      { agentId: AGENTS.mediaSelector, role: 'MediaSelector', capability: 'select_media', useWebsite: true },

      // QA bindings
      { agentId: AGENTS.qa, role: 'QA', capability: 'run_qa', useWebsite: false },
      { agentId: AGENTS.qa, role: 'QA', capability: 'check_media_relevance', useWebsite: false },

      // Linker bindings
      { agentId: AGENTS.linker, role: 'Linker', capability: 'insert_links', useWebsite: false },

      // PageOrchestrator bindings
      { agentId: AGENTS.pageOrchestrator, role: 'PageOrchestrator', capability: 'create_page_brief', useWebsite: true },
      { agentId: AGENTS.pageOrchestrator, role: 'PageOrchestrator', capability: 'validate_page_flow', useWebsite: false },

      // PagePolish bindings
      { agentId: AGENTS.pagePolish, role: 'PagePolish', capability: 'polish_content', useWebsite: false },
    ]

    for (const binding of agentBindings) {
      const key = `${binding.role}:${binding.capability}`
      const companyPromptId = companyPromptIds[key]
      const websitePromptId = websitePromptIds[key]

      if (!companyPromptId) {
        console.log(`  ⚠️  No prompt found for ${key}, skipping binding...`)
        continue
      }

      // Use website template if available and requested, otherwise use company template
      const useWebsitePrompt = binding.useWebsite && websitePromptId

      await db.query(
        `INSERT INTO agent_prompt_bindings
         (id, agent_id, capability, company_prompt_template_id, website_prompt_template_id, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [
          uuidv4(),
          binding.agentId,
          binding.capability,
          useWebsitePrompt ? null : companyPromptId,
          useWebsitePrompt ? websitePromptId : null,
        ]
      )
      console.log(`  ✅ ${binding.role} agent → ${binding.capability}${useWebsitePrompt ? ' (with Cinque Terre override)' : ''}`)
    }

    console.log('\n✨ Prompt seeding completed!\n')
    console.log('Summary:')
    console.log(`  Company Templates: ${companyPromptTemplates.length}`)
    console.log(`  Website Overrides: ${Object.keys(websitePromptIds).length}`)
    console.log(`  Agent Bindings: ${agentBindings.length}`)
    console.log('')

    await db.end()
  } catch (error) {
    console.error('❌ Prompt seeding failed:', error)
    await db.end()
    process.exit(1)
  }
}

// Run seed
seedPrompts()
