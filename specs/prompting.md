# Prompt Engineering & Management System Specification

**Version:** 1.0.0
**Status:** Draft
**Last Updated:** 2025-11-24
**Authors:** System Architecture Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [System Overview](#system-overview)
4. [Three-Level Prompt Hierarchy](#three-level-prompt-hierarchy)
5. [Database Schema](#database-schema)
6. [Prompt Template Format](#prompt-template-format)
7. [Prompt Resolution Algorithm](#prompt-resolution-algorithm)
8. [Variable Merging & Priority](#variable-merging--priority)
9. [Examples Management](#examples-management)
10. [API Design](#api-design)
11. [Admin UI Requirements](#admin-ui-requirements)
12. [Bootstrap & Migration](#bootstrap--migration)
13. [Testing Strategy](#testing-strategy)
14. [Monitoring & Analytics](#monitoring--analytics)
15. [Version Control & Deployment](#version-control--deployment)
16. [Security Considerations](#security-considerations)
17. [Performance Optimization](#performance-optimization)
18. [Future Enhancements](#future-enhancements)

---

## Executive Summary

The Prompt Engineering & Management System is the **core quality control mechanism** for swarm.press. Since all content generation is powered by Claude AI agents, the quality of prompts directly determines the quality of generated websites.

This specification defines a three-level hierarchical prompt system that balances:
- **Company-wide standards** (baseline quality and ethics)
- **Website-specific customization** (brand voice and niche expertise)
- **Agent-level personalization** (individual writing styles)

The system provides version control, A/B testing, performance monitoring, and inheritance mechanisms to ensure consistent quality while allowing flexibility.

---

## Problem Statement

### Current Challenges

1. **No Prompt Management**: Prompts are currently hardcoded in agent implementations
2. **No Version Control**: Cannot track prompt changes over time or rollback bad versions
3. **No Multi-Tenancy Support**: Each website needs different brand voices and expertise
4. **No Quality Metrics**: Cannot measure which prompts produce better content
5. **No A/B Testing**: Cannot systematically improve prompts through experimentation
6. **No Agent Customization**: Cannot tailor prompts to individual agent strengths

### Impact on Business

- **Quality Inconsistency**: Different agents produce wildly different quality
- **Slow Iteration**: Changing prompts requires code deploys
- **Poor Scalability**: Adding websites or agents requires manual prompt duplication
- **No Optimization**: Cannot identify and improve low-performing prompts
- **Risk of Regression**: Prompt changes may inadvertently reduce quality

---

## System Overview

### Core Principles

1. **Hierarchy with Inheritance**: Company → Website → Agent
2. **Version Everything**: All prompts are versioned and immutable
3. **Measure Everything**: All prompt executions are logged with quality metrics
4. **Gradual Rollout**: New prompt versions can be tested on subset of agents
5. **Explicit Bindings**: Agents explicitly bind to prompt templates
6. **XML-Structured Templates**: Use XML for clear structure and parseability

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                   Prompt Management System                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Company    │  │   Website    │  │    Agent     │     │
│  │   Prompts    │─▶│   Prompts    │─▶│   Bindings   │     │
│  │  (Baseline)  │  │  (Override)  │  │  (Custom)    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                   ┌────────▼────────┐                       │
│                   │ Prompt Resolver │                       │
│                   │   (Runtime)     │                       │
│                   └────────┬────────┘                       │
│                            │                                 │
│                   ┌────────▼────────┐                       │
│                   │  Claude Agent   │                       │
│                   │   Execution     │                       │
│                   └────────┬────────┘                       │
│                            │                                 │
│                   ┌────────▼────────┐                       │
│                   │   Performance   │                       │
│                   │    Logging      │                       │
│                   └─────────────────┘                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Three-Level Prompt Hierarchy

### Level 1: Company Prompts (Baseline)

**Purpose**: Define organization-wide standards for each role and capability.

**Scope**: Applies to ALL websites and agents unless explicitly overridden.

**Examples**:
- All Writers must fact-check claims
- All Editors must provide constructive feedback
- All content must follow journalistic ethics

**Characteristics**:
- Versioned and immutable
- Approved by CEO or CTO
- Applied by default to new websites
- Cannot be deleted if in use
- Include baseline examples of quality

**Storage Location**: `company_prompt_templates` table

**When to Create**:
- When defining a new role (Writer, Editor, etc.)
- When adding a new capability (write_draft, review_content)
- When updating company-wide standards

### Level 2: Website Prompts (Brand Override)

**Purpose**: Customize prompts for specific publication brand, voice, and niche.

**Scope**: Applies to all agents assigned to this website.

**Examples**:
- Travel blog: Add destination research, practical tips, sensory descriptions
- Tech blog: Add specification tables, benchmark data, product comparisons
- Food blog: Add recipe formatting, cooking techniques, ingredient sourcing

**Characteristics**:
- Extends (not replaces) company baseline
- Can add instructions, examples, and variables
- Can override specific variables (tone, expertise)
- Versioned per website
- Approved by Chief Editor for that website

**Storage Location**: `website_prompt_templates` table

**When to Create**:
- When launching a new website with unique voice
- When changing editorial direction for a website
- When performance data shows company baseline insufficient

### Level 3: Agent Bindings (Individual Customization)

**Purpose**: Fine-tune prompts for individual agent strengths and styles.

**Scope**: Applies only to specific agent instance.

**Examples**:
- Elena: Narrative storytelling style
- James: Data-driven analytical style
- Maria: Conversational approachable style

**Characteristics**:
- Links agent to either company or website prompt
- Adds custom variables (not template changes)
- Can be changed frequently for optimization
- Lightweight—just variable overrides

**Storage Location**: `agent_prompt_bindings` table

**When to Create**:
- When creating a new agent
- When reassigning agent to different website
- When A/B testing agent configurations
- When optimizing based on performance data

---

## Database Schema

### Core Tables

```sql
-- =============================================================================
-- Level 1: Company Prompt Templates (Baseline)
-- =============================================================================

CREATE TABLE company_prompt_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,  -- 'writer', 'editor', 'seo', 'ceo_assistant', etc.
  capability TEXT NOT NULL,  -- 'write_draft', 'review_content', 'optimize_seo', etc.
  version TEXT NOT NULL,  -- Semantic versioning: "1.0.0", "1.1.0", "2.0.0"

  -- Prompt content (XML format)
  template TEXT NOT NULL,

  -- Examples for multishot prompting
  examples JSONB DEFAULT '[]'::jsonb,

  -- Default variables for this role/capability
  default_variables JSONB DEFAULT '{}'::jsonb,

  -- Metadata
  description TEXT,
  changelog TEXT,  -- What changed in this version
  created_by_user_id UUID,  -- Human who created/approved this
  approved_by_user_id UUID,  -- CEO/CTO approval
  approved_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT FALSE,  -- Must be explicitly activated
  is_deprecated BOOLEAN DEFAULT FALSE,
  deprecation_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(company_id, role_name, capability, version)
);

CREATE INDEX idx_company_prompts_company ON company_prompt_templates(company_id);
CREATE INDEX idx_company_prompts_role ON company_prompt_templates(role_name);
CREATE INDEX idx_company_prompts_active ON company_prompt_templates(company_id, is_active) WHERE is_active = TRUE;

-- =============================================================================
-- Level 2: Website Prompt Templates (Brand Override)
-- =============================================================================

CREATE TABLE website_prompt_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  company_prompt_template_id UUID NOT NULL REFERENCES company_prompt_templates(id) ON DELETE RESTRICT,
  version TEXT NOT NULL,  -- Website-specific versioning

  -- Override options (NULL = inherit from company)
  template_override TEXT,  -- Complete replacement (rarely used)
  template_additions TEXT,  -- Appended to company template (common)

  -- Override examples (merged with company examples)
  examples_override JSONB DEFAULT '[]'::jsonb,

  -- Override variables (merged with company defaults)
  variables_override JSONB DEFAULT '{}'::jsonb,

  -- Metadata
  description TEXT,
  changelog TEXT,
  created_by_user_id UUID,
  approved_by_user_id UUID,  -- Chief Editor for this website
  approved_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT FALSE,
  is_deprecated BOOLEAN DEFAULT FALSE,
  deprecation_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(website_id, company_prompt_template_id, version)
);

CREATE INDEX idx_website_prompts_website ON website_prompt_templates(website_id);
CREATE INDEX idx_website_prompts_company ON website_prompt_templates(company_prompt_template_id);
CREATE INDEX idx_website_prompts_active ON website_prompt_templates(website_id, is_active) WHERE is_active = TRUE;

-- =============================================================================
-- Level 3: Agent Prompt Bindings (Individual Assignment)
-- =============================================================================

CREATE TABLE agent_prompt_bindings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,  -- Must match agent's capabilities array

  -- Bind to EITHER company or website prompt (not both)
  company_prompt_template_id UUID REFERENCES company_prompt_templates(id) ON DELETE RESTRICT,
  website_prompt_template_id UUID REFERENCES website_prompt_templates(id) ON DELETE RESTRICT,

  -- Agent-level variable customizations (lightweight)
  custom_variables JSONB DEFAULT '{}'::jsonb,

  -- A/B testing support
  ab_test_group TEXT,  -- 'control', 'variant_a', 'variant_b', etc.
  ab_test_weight DECIMAL(3,2) DEFAULT 1.0,  -- 0.0 to 1.0 (probability of selection)

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(agent_id, capability),

  -- Must bind to exactly one prompt source
  CONSTRAINT binding_source_check CHECK (
    (company_prompt_template_id IS NOT NULL AND website_prompt_template_id IS NULL) OR
    (company_prompt_template_id IS NULL AND website_prompt_template_id IS NOT NULL)
  ),

  -- A/B test weight must be valid
  CONSTRAINT ab_test_weight_check CHECK (ab_test_weight >= 0.0 AND ab_test_weight <= 1.0)
);

CREATE INDEX idx_agent_bindings_agent ON agent_prompt_bindings(agent_id);
CREATE INDEX idx_agent_bindings_capability ON agent_prompt_bindings(capability);
CREATE INDEX idx_agent_bindings_company_prompt ON agent_prompt_bindings(company_prompt_template_id);
CREATE INDEX idx_agent_bindings_website_prompt ON agent_prompt_bindings(website_prompt_template_id);

-- =============================================================================
-- Prompt Execution Logging (Performance Tracking)
-- =============================================================================

CREATE TABLE prompt_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Context
  agent_id UUID NOT NULL REFERENCES agents(id),
  capability TEXT NOT NULL,
  company_prompt_template_id UUID REFERENCES company_prompt_templates(id),
  website_prompt_template_id UUID REFERENCES website_prompt_templates(id),

  -- Input/Output
  input_variables JSONB NOT NULL,
  final_prompt_hash TEXT NOT NULL,  -- Hash of final rendered prompt (for cache)
  output TEXT,

  -- Performance metrics
  tokens_used INTEGER,
  latency_ms INTEGER,
  claude_model TEXT,  -- 'claude-sonnet-4-5', etc.

  -- Quality metrics (filled in later by human or automated review)
  quality_score DECIMAL(3,2),  -- 0.0 to 5.0
  quality_rated_by TEXT,  -- 'human', 'ai_review', 'editor_approval'
  quality_rated_at TIMESTAMPTZ,
  quality_feedback TEXT,

  -- Content outcomes (filled in during workflow)
  content_id UUID REFERENCES content_items(id),
  content_status TEXT,  -- 'draft', 'approved', 'published', 'rejected'
  revision_count INTEGER DEFAULT 0,  -- How many revisions needed

  -- Error tracking
  error_occurred BOOLEAN DEFAULT FALSE,
  error_message TEXT,

  -- A/B testing
  ab_test_group TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prompt_executions_agent ON prompt_executions(agent_id);
CREATE INDEX idx_prompt_executions_capability ON prompt_executions(capability);
CREATE INDEX idx_prompt_executions_company_prompt ON prompt_executions(company_prompt_template_id);
CREATE INDEX idx_prompt_executions_website_prompt ON prompt_executions(website_prompt_template_id);
CREATE INDEX idx_prompt_executions_quality ON prompt_executions(quality_score) WHERE quality_score IS NOT NULL;
CREATE INDEX idx_prompt_executions_date ON prompt_executions(created_at DESC);
CREATE INDEX idx_prompt_executions_content ON prompt_executions(content_id);

-- =============================================================================
-- Prompt Performance Summary (Materialized View for Dashboard)
-- =============================================================================

CREATE MATERIALIZED VIEW prompt_performance_summary AS
SELECT
  COALESCE(cpt.id, wpt.company_prompt_template_id) as prompt_id,
  COALESCE(cpt.role_name, cpt2.role_name) as role_name,
  COALESCE(cpt.capability, cpt2.capability) as capability,
  pe.website_prompt_template_id,
  w.title as website_name,

  -- Execution stats
  COUNT(*) as total_executions,
  COUNT(*) FILTER (WHERE pe.error_occurred = FALSE) as successful_executions,
  COUNT(*) FILTER (WHERE pe.error_occurred = TRUE) as failed_executions,

  -- Quality metrics
  AVG(pe.quality_score) as avg_quality_score,
  STDDEV(pe.quality_score) as quality_stddev,
  COUNT(*) FILTER (WHERE pe.quality_score >= 4.0) as high_quality_count,
  COUNT(*) FILTER (WHERE pe.quality_score < 3.0) as low_quality_count,

  -- Performance metrics
  AVG(pe.tokens_used) as avg_tokens,
  AVG(pe.latency_ms) as avg_latency_ms,

  -- Content outcomes
  AVG(pe.revision_count) as avg_revisions,
  COUNT(*) FILTER (WHERE pe.content_status = 'published') as published_count,
  COUNT(*) FILTER (WHERE pe.content_status = 'rejected') as rejected_count,

  -- Time range
  MIN(pe.created_at) as first_execution,
  MAX(pe.created_at) as last_execution

FROM prompt_executions pe
LEFT JOIN company_prompt_templates cpt ON pe.company_prompt_template_id = cpt.id
LEFT JOIN website_prompt_templates wpt ON pe.website_prompt_template_id = wpt.id
LEFT JOIN company_prompt_templates cpt2 ON wpt.company_prompt_template_id = cpt2.id
LEFT JOIN websites w ON wpt.website_id = w.id
WHERE pe.created_at > NOW() - INTERVAL '90 days'
GROUP BY prompt_id, role_name, capability, pe.website_prompt_template_id, w.title;

CREATE UNIQUE INDEX idx_prompt_perf_summary_id ON prompt_performance_summary(prompt_id, COALESCE(website_prompt_template_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Refresh this view hourly
CREATE OR REPLACE FUNCTION refresh_prompt_performance_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY prompt_performance_summary;
END;
$$ LANGUAGE plpgsql;
```

---

## Prompt Template Format

### XML Structure

All prompt templates use XML format for clarity and parseability. The structure follows Anthropic's best practices.

```xml
<prompt
  version="1.0.0"
  role="writer"
  capability="write_draft"
  xmlns="https://swarm.press/schemas/prompt/v1">

  <!-- System prompt: Who is the agent and what is their role? -->
  <system>
    You are {{agent_name}}, a professional {{role_name}} for {{website_name}}.
    Your persona: {{agent_persona}}

    {{#if website_description}}
    About {{website_name}}: {{website_description}}
    {{/if}}
  </system>

  <!-- Core instructions: What should the agent do? -->
  <instructions>
    Your task is to write a high-quality {{content_type}} based on the brief provided.

    Follow these steps:
    1. Analyze the brief and identify key points
    2. Research the topic (if research provided, use it)
    3. Plan your structure and outline
    4. Write the content following our standards
    5. Self-review for quality before submitting

    {{#if additional_instructions}}
    Additional requirements:
    {{additional_instructions}}
    {{/if}}
  </instructions>

  <!-- Input data: What information does the agent receive? -->
  <input>
    <brief>{{brief_content}}</brief>

    {{#if research_data}}
    <research>{{research_data}}</research>
    {{/if}}

    {{#if target_keywords}}
    <seo_keywords>{{target_keywords}}</seo_keywords>
    {{/if}}
  </input>

  <!-- Examples: Show the agent what good looks like -->
  <examples>
    <example quality="excellent">
      <brief>{{example_brief_1}}</brief>
      <output>{{example_output_1}}</output>
      <reasoning>Why this is excellent: {{example_reasoning_1}}</reasoning>
    </example>

    <example quality="good">
      <brief>{{example_brief_2}}</brief>
      <output>{{example_output_2}}</output>
      <reasoning>Why this is good: {{example_reasoning_2}}</reasoning>
    </example>

    <example quality="poor">
      <brief>{{example_brief_3}}</brief>
      <output>{{example_output_3}}</output>
      <reasoning>Why this is poor: {{example_reasoning_3}}</reasoning>
    </example>
  </examples>

  <!-- Output format: How should the agent structure its response? -->
  <output_format>
    First, think through your approach in <thinking> tags:
    <thinking>
      1. Brief analysis: [Key points from brief]
      2. Target audience: [Who are we writing for?]
      3. Tone and style: [What approach to take?]
      4. Structure plan: [How to organize content?]
      5. Key messages: [What must be communicated?]
    </thinking>

    Then, output your content in <content> tags as a JSON blocks array:
    <content>
      [
        {
          "type": "hero",
          "title": "...",
          "subtitle": "..."
        },
        {
          "type": "paragraph",
          "markdown": "..."
        },
        ...
      ]
    </content>
  </output_format>

  <!-- Quality standards: What defines good output? -->
  <quality_standards>
    Your content must meet these standards:
    - Factual accuracy: All claims must be verifiable
    - Readability: {{reading_level}} reading level
    - Engagement: Hook reader in first 100 words
    - Structure: Clear sections with descriptive headings
    - Length: {{min_word_count}} to {{max_word_count}} words
    - Tone: {{tone}}
    - Style: {{writing_style}}

    {{#if quality_checklist}}
    Quality checklist:
    {{quality_checklist}}
    {{/if}}
  </quality_standards>

</prompt>
```

### Variable Templating

Use Handlebars syntax for variables:

```handlebars
{{variable_name}}                    <!-- Simple variable -->
{{agent_name}} - {{role_name}}      <!-- Multiple variables -->
{{#if condition}}...{{/if}}         <!-- Conditional -->
{{#each items}}...{{/each}}         <!-- Iteration -->
```

### Template Inheritance

Website templates extend company templates using special syntax:

```xml
<prompt_extension
  extends="company://writer/write_draft/v1.0.0"
  version="1.0.0"
  website="cinqueterre">

  <!-- Append to instructions section -->
  <instructions_append>
    Additional requirements for travel content:
    6. Include practical travel tips (transportation, timing, costs)
    7. Describe sensory experiences (sights, sounds, tastes)
    8. Add local insights and cultural context
    9. Mention accessibility considerations
  </instructions_append>

  <!-- Override specific variables -->
  <variables_override>
    <tone>casual but informative</tone>
    <expertise>travel and tourism</expertise>
    <target_audience>adventure travelers and culture enthusiasts</target_audience>
  </variables_override>

  <!-- Add website-specific examples -->
  <examples_append>
    <example quality="excellent">
      <brief>Write about hidden gems in Monterosso</brief>
      <output>
        Beyond the crowded beaches, Monterosso harbors secrets...
        [Travel-focused, sensory, practical]
      </output>
      <reasoning>Perfect blend of inspiration and practical guidance</reasoning>
    </example>
  </examples_append>

</prompt_extension>
```

---

## Prompt Resolution Algorithm

The Prompt Resolver walks the hierarchy to build the final prompt sent to Claude.

### Resolution Steps

```typescript
interface ResolvedPrompt {
  // Final merged content
  template: string
  examples: Example[]
  variables: Record<string, any>

  // Metadata for tracking
  company_prompt_id: string
  company_version: string
  website_prompt_id?: string
  website_version?: string
  agent_customizations: Record<string, any>
  resolution_path: string[]  // ["company:1.0.0", "website:1.2.0", "agent:elena"]
}

async function resolvePrompt(
  agentId: string,
  capability: string,
  runtimeVariables: Record<string, any>
): Promise<ResolvedPrompt> {

  // Step 1: Get agent binding
  const binding = await db.agentPromptBindings.findOne({
    where: { agent_id: agentId, capability, is_active: true },
    include: ['company_prompt_template', 'website_prompt_template', 'agent']
  })

  if (!binding) {
    throw new PromptBindingNotFoundError(
      `Agent ${agentId} has no binding for capability ${capability}`
    )
  }

  // Step 2: Determine resolution path
  let resolved: ResolvedPrompt

  if (binding.website_prompt_template_id) {
    // Website-specific path: Company → Website → Agent
    resolved = await resolveWebsitePath(
      binding.website_prompt_template_id,
      binding.custom_variables,
      runtimeVariables
    )
  } else {
    // Direct company path: Company → Agent
    resolved = await resolveCompanyPath(
      binding.company_prompt_template_id!,
      binding.custom_variables,
      runtimeVariables
    )
  }

  // Step 3: Add agent metadata
  resolved.variables.agent_name = binding.agent.name
  resolved.variables.agent_persona = binding.agent.persona
  resolved.variables.agent_id = binding.agent.id

  return resolved
}
```

### Website Path Resolution

```typescript
async function resolveWebsitePath(
  websitePromptId: string,
  agentVariables: Record<string, any>,
  runtimeVariables: Record<string, any>
): Promise<ResolvedPrompt> {

  // Load website prompt with parent company prompt
  const websitePrompt = await db.websitePromptTemplates.findById(websitePromptId, {
    include: ['company_prompt_template', 'website']
  })

  const companyPrompt = websitePrompt.company_prompt_template

  // Merge templates
  let template: string
  if (websitePrompt.template_override) {
    // Complete override (rare)
    template = websitePrompt.template_override
  } else {
    // Extend company template (common)
    template = mergeXmlTemplates(
      companyPrompt.template,
      websitePrompt.template_additions
    )
  }

  // Merge examples (website examples come after company examples)
  const examples = [
    ...parseExamples(companyPrompt.examples),
    ...parseExamples(websitePrompt.examples_override)
  ]

  // Merge variables with priority: runtime > agent > website > company
  const variables = {
    ...companyPrompt.default_variables,        // Priority 1 (lowest)
    ...websitePrompt.variables_override,       // Priority 2
    ...agentVariables,                         // Priority 3
    ...runtimeVariables,                       // Priority 4 (highest)

    // Add website context
    website_id: websitePrompt.website.id,
    website_name: websitePrompt.website.title,
    website_description: websitePrompt.website.description
  }

  return {
    template,
    examples,
    variables,
    company_prompt_id: companyPrompt.id,
    company_version: companyPrompt.version,
    website_prompt_id: websitePrompt.id,
    website_version: websitePrompt.version,
    agent_customizations: agentVariables,
    resolution_path: [
      `company:${companyPrompt.version}`,
      `website:${websitePrompt.version}`,
      `agent:custom`
    ]
  }
}
```

### XML Template Merging

```typescript
function mergeXmlTemplates(
  baseTemplate: string,
  additions: string | null
): string {

  if (!additions) return baseTemplate

  const base = parseXml(baseTemplate)
  const additionsXml = parseXml(`<additions>${additions}</additions>`)

  // Merge each section
  for (const section of ['instructions', 'quality_standards', 'examples']) {
    const baseSection = base.querySelector(section)
    const addSection = additionsXml.querySelector(`${section}_append`)

    if (baseSection && addSection) {
      baseSection.innerHTML += '\n\n' + addSection.innerHTML
    }
  }

  return serializeXml(base)
}
```

### Variable Rendering

```typescript
function renderPrompt(
  template: string,
  variables: Record<string, any>
): string {

  // Use Handlebars for variable substitution
  const compiled = Handlebars.compile(template, {
    noEscape: true,  // Don't HTML-escape
    strict: true     // Throw error on missing variables
  })

  try {
    return compiled(variables)
  } catch (error) {
    throw new PromptRenderError(
      `Failed to render prompt: ${error.message}`,
      { template, variables, error }
    )
  }
}
```

---

## Variable Merging & Priority

### Priority Order (Highest to Lowest)

1. **Runtime Variables**: Passed when calling agent (e.g., `brief_content`, `research_data`)
2. **Agent Custom Variables**: Agent-specific customizations (e.g., `writing_style`)
3. **Website Override Variables**: Website-specific (e.g., `tone`, `expertise`)
4. **Company Default Variables**: Baseline defaults (e.g., `reading_level`)

### Example Merge

```typescript
// Company defaults
{
  reading_level: '8th grade',
  tone: 'professional',
  min_word_count: 600,
  max_word_count: 1200,
  writing_style: 'AP Style'
}

// Website overrides (Cinqueterre)
{
  tone: 'casual but informative',           // Override
  expertise: 'travel and tourism',          // Add new
  target_audience: 'adventure travelers'    // Add new
  // reading_level, word counts inherited
}

// Agent customizations (Elena)
{
  writing_style: 'narrative storytelling',  // Override
  preferred_structure: 'story arc'          // Add new
}

// Runtime variables
{
  brief_content: 'Write about Monterosso beaches',
  target_keywords: ['Monterosso', 'Cinque Terre', 'beach']
}

// Final merged result
{
  reading_level: '8th grade',               // From company
  tone: 'casual but informative',           // From website
  min_word_count: 600,                      // From company
  max_word_count: 1200,                     // From company
  writing_style: 'narrative storytelling',  // From agent
  expertise: 'travel and tourism',          // From website
  target_audience: 'adventure travelers',   // From website
  preferred_structure: 'story arc',         // From agent
  brief_content: 'Write about Monterosso beaches',  // Runtime
  target_keywords: ['Monterosso', 'Cinque Terre', 'beach']  // Runtime
}
```

### Conflict Resolution Rules

1. **Simple Override**: Later priority completely replaces earlier value
2. **Array Merge**: Arrays are concatenated (examples, keywords)
3. **Object Merge**: Objects are deep-merged
4. **Null/Undefined**: Treated as "no override" (inherits parent)

---

## Examples Management

### Example Structure

```typescript
interface PromptExample {
  id: string
  quality: 'excellent' | 'good' | 'acceptable' | 'poor'
  brief: string          // Input that was given
  output: string         // What the agent produced
  reasoning: string      // Why this is good/bad
  context?: {
    website?: string
    date?: string
    agent?: string
  }
}
```

### Example Sources

1. **Curated Examples**: Manually created by humans as training data
2. **Production Examples**: Real outputs that scored highly
3. **Negative Examples**: Real outputs that scored poorly (for learning)

### Example Storage

```jsonb
{
  "examples": [
    {
      "id": "ex-001",
      "quality": "excellent",
      "brief": "Write about sustainable travel practices",
      "output": "// Full article content here",
      "reasoning": "Perfect balance of education and inspiration. Clear actionable tips. Engages emotions while staying factual. Proper sourcing.",
      "context": {
        "website": "Cinqueterre Travel",
        "quality_score": 4.8,
        "published": true,
        "date": "2025-10-15"
      }
    },
    {
      "id": "ex-002",
      "quality": "poor",
      "brief": "Write about Monterosso beaches",
      "output": "// Generic, uninspired content",
      "reasoning": "Too generic. No sensory details. Missing practical information. Reads like AI output without personality.",
      "context": {
        "quality_score": 2.1,
        "revision_count": 3
      }
    }
  ]
}
```

### Building Example Library

```typescript
// Automatically add high-quality production outputs as examples
async function captureExampleFromProduction(executionId: string) {
  const execution = await db.promptExecutions.findById(executionId, {
    include: ['content_item']
  })

  // Only capture excellent outputs
  if (execution.quality_score < 4.5) return
  if (execution.content_status !== 'published') return

  const example: PromptExample = {
    id: `prod-${executionId}`,
    quality: 'excellent',
    brief: execution.input_variables.brief_content,
    output: execution.output,
    reasoning: `Published with ${execution.quality_score}/5.0 quality. ${execution.quality_feedback}`,
    context: {
      website: execution.content_item.website.title,
      date: execution.created_at,
      agent: execution.agent.name,
      quality_score: execution.quality_score
    }
  }

  // Add to prompt's example library
  await addExampleToPrompt(execution.website_prompt_template_id, example)
}
```

---

## API Design

### Prompt Management API

```typescript
// packages/backend/src/api/routers/prompt.router.ts

export const promptRouter = router({

  // ========================================
  // Company Prompts (Level 1)
  // ========================================

  // List all company prompts
  'company.list': publicProcedure
    .input(z.object({
      company_id: z.string().uuid(),
      role_name: z.string().optional(),
      capability: z.string().optional(),
      include_deprecated: z.boolean().default(false)
    }))
    .query(async ({ input }) => {
      return await promptService.listCompanyPrompts(input)
    }),

  // Get specific company prompt version
  'company.getVersion': publicProcedure
    .input(z.object({
      company_id: z.string().uuid(),
      role_name: z.string(),
      capability: z.string(),
      version: z.string()
    }))
    .query(async ({ input }) => {
      return await promptService.getCompanyPromptVersion(input)
    }),

  // Create new company prompt version
  'company.createVersion': publicProcedure
    .input(z.object({
      company_id: z.string().uuid(),
      role_name: z.string(),
      capability: z.string(),
      version: z.string(),
      template: z.string(),
      examples: z.array(ExampleSchema).optional(),
      default_variables: z.record(z.any()).optional(),
      description: z.string().optional(),
      changelog: z.string().optional()
    }))
    .mutation(async ({ input, ctx }) => {
      return await promptService.createCompanyPromptVersion(input, ctx.user_id)
    }),

  // Activate specific version (makes it the default)
  'company.activateVersion': publicProcedure
    .input(z.object({
      prompt_id: z.string().uuid()
    }))
    .mutation(async ({ input, ctx }) => {
      return await promptService.activateCompanyPrompt(input.prompt_id, ctx.user_id)
    }),

  // ========================================
  // Website Prompts (Level 2)
  // ========================================

  // List website prompt overrides
  'website.list': publicProcedure
    .input(z.object({
      website_id: z.string().uuid()
    }))
    .query(async ({ input }) => {
      return await promptService.listWebsitePrompts(input.website_id)
    }),

  // Create website prompt override
  'website.createOverride': publicProcedure
    .input(z.object({
      website_id: z.string().uuid(),
      company_prompt_template_id: z.string().uuid(),
      version: z.string(),
      template_override: z.string().optional(),
      template_additions: z.string().optional(),
      examples_override: z.array(ExampleSchema).optional(),
      variables_override: z.record(z.any()).optional(),
      description: z.string().optional()
    }))
    .mutation(async ({ input, ctx }) => {
      return await promptService.createWebsitePromptOverride(input, ctx.user_id)
    }),

  // ========================================
  // Agent Bindings (Level 3)
  // ========================================

  // Get agent's current bindings
  'agent.getBindings': publicProcedure
    .input(z.object({
      agent_id: z.string().uuid()
    }))
    .query(async ({ input }) => {
      return await promptService.getAgentBindings(input.agent_id)
    }),

  // Create or update agent binding
  'agent.bindPrompt': publicProcedure
    .input(z.object({
      agent_id: z.string().uuid(),
      capability: z.string(),
      company_prompt_template_id: z.string().uuid().optional(),
      website_prompt_template_id: z.string().uuid().optional(),
      custom_variables: z.record(z.any()).optional()
    }))
    .mutation(async ({ input }) => {
      return await promptService.bindAgentToPrompt(input)
    }),

  // ========================================
  // Resolution & Execution
  // ========================================

  // Resolve final prompt for agent (debugging/preview)
  'resolve': publicProcedure
    .input(z.object({
      agent_id: z.string().uuid(),
      capability: z.string(),
      runtime_variables: z.record(z.any()).optional()
    }))
    .query(async ({ input }) => {
      return await promptResolver.resolvePrompt(
        input.agent_id,
        input.capability,
        input.runtime_variables || {}
      )
    }),

  // ========================================
  // Performance Analytics
  // ========================================

  // Get prompt performance metrics
  'performance.get': publicProcedure
    .input(z.object({
      prompt_id: z.string().uuid(),
      time_range: z.enum(['7d', '30d', '90d']).default('30d')
    }))
    .query(async ({ input }) => {
      return await promptAnalytics.getPerformanceMetrics(input)
    }),

  // Compare prompt versions
  'performance.compare': publicProcedure
    .input(z.object({
      prompt_ids: z.array(z.string().uuid()).min(2).max(5),
      metric: z.enum(['quality_score', 'tokens_used', 'revision_count'])
    }))
    .query(async ({ input }) => {
      return await promptAnalytics.comparePrompts(input)
    })
})
```

---

## Admin UI Requirements

### Dashboard: Prompt Management

```
┌────────────────────────────────────────────────────────────────┐
│  Prompt Management                                    [+ Create]│
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Company: Acme Media Group                                     │
│                                                                 │
│  ┌─ Writer Role ────────────────────────────────────────────┐ │
│  │                                                            │ │
│  │  write_draft                                              │ │
│  │  ├─ v2.1.0 (Active) ⭐ 4.2/5 quality  📊 1,247 uses      │ │
│  │  │   [View] [Edit] [Performance] [Deactivate]            │ │
│  │  ├─ v2.0.0 ⭐ 3.8/5 quality  📊 892 uses                 │ │
│  │  │   [View] [Performance] [Reactivate]                   │ │
│  │  └─ v1.9.0 (Deprecated)                                  │ │
│  │                                                            │ │
│  │  revise_draft                                             │ │
│  │  └─ v1.8.0 (Active) ⚠️ 3.5/5 quality  📊 531 uses        │ │
│  │      [View] [Edit] [Performance] [Deactivate]            │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Editor Role ──────────────────────────────────────────────┐│
│  │                                                            ││
│  │  review_content                                           ││
│  │  └─ v3.0.0 (Active) ⭐ 4.8/5 quality  📊 2,103 uses      ││
│  │      [View] [Edit] [Performance] [Deactivate]            ││
│  │                                                            ││
│  └────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

### Page: Edit Prompt Template

```
┌────────────────────────────────────────────────────────────────┐
│  Edit Company Prompt: Writer → write_draft                     │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Version: 2.1.0                        Status: [Active ▼]      │
│  Created: 2025-10-15                   By: John Smith          │
│  Approved: 2025-10-20                  By: Jane CEO            │
│                                                                 │
│  ┌─ Metadata ────────────────────────────────────────────────┐ │
│  │ Description:                                               │ │
│  │ ┌────────────────────────────────────────────────────────┐│ │
│  │ │ Enhanced version with better chain-of-thought prompting││ │
│  │ │ and more diverse examples.                             ││ │
│  │ └────────────────────────────────────────────────────────┘│ │
│  │                                                            │ │
│  │ Changelog:                                                 │ │
│  │ ┌────────────────────────────────────────────────────────┐│ │
│  │ │ - Added <thinking> tags for structured reasoning       ││ │
│  │ │ - Included 2 new examples (travel, tech)               ││ │
│  │ │ - Enhanced quality_standards section                   ││ │
│  │ └────────────────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Template ─────────────────────────────────────────────────┐│
│  │ <prompt version="2.1.0" role="writer">                    ││
│  │   <system>                                                 ││
│  │     You are {{agent_name}}, a professional writer...      ││
│  │   </system>                                                ││
│  │   ...                                                      ││
│  │ </prompt>                                                  ││
│  │                                                            ││
│  │ [Format XML] [Validate] [Preview with Variables]          ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─ Examples ─────────────────────────────────────────────────┐│
│  │ [Excellent] Brief: Write about sustainable travel          ││
│  │ Output: Sustainable travel isn't just a trend...           ││
│  │ Reasoning: Perfect balance of education and inspiration    ││
│  │ [View Full] [Edit] [Remove]                                ││
│  │                                                            ││
│  │ [Good] Brief: Review the iPhone 15 Pro                     ││
│  │ Output: The A17 Pro chip delivers measurable improvements..││
│  │ [View Full] [Edit] [Remove]                                ││
│  │                                                            ││
│  │ [+ Add Example]                                            ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─ Default Variables ───────────────────────────────────────┐ │
│  │ reading_level: "8th grade"                                 │ │
│  │ tone: "professional"                                       │ │
│  │ min_word_count: 600                                        │ │
│  │ max_word_count: 1200                                       │ │
│  │ writing_style: "AP Style"                                  │ │
│  │                                                            │ │
│  │ [Edit Variables]                                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Websites Using This ─────────────────────────────────────┐ │
│  │ ✓ Cinqueterre Travel (with overrides)                     │ │
│  │ ✓ TechReview Blog (with overrides)                        │ │
│  │ ✓ Food & Culture (baseline only)                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [Cancel]  [Save Draft]  [Save & Activate]                     │
└────────────────────────────────────────────────────────────────┘
```

### Page: Prompt Performance

```
┌────────────────────────────────────────────────────────────────┐
│  Prompt Performance: Writer → write_draft v2.1.0               │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Time Range: [Last 30 Days ▼]                                  │
│                                                                 │
│  ┌─ Overview ────────────────────────────────────────────────┐ │
│  │                                                            │ │
│  │  Total Executions: 1,247                                  │ │
│  │  Success Rate: 98.4%                                       │ │
│  │  Avg Quality Score: 4.2 / 5.0  ⭐⭐⭐⭐                    │ │
│  │  Avg Tokens Used: 2,341                                   │ │
│  │  Avg Latency: 3.2s                                        │ │
│  │  Published Rate: 87.3%                                     │ │
│  │  Avg Revisions: 1.2                                       │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Quality Over Time ───────────────────────────────────────┐ │
│  │     5.0 ┤                                                  │ │
│  │     4.5 ┤     ╭─╮  ╭───╮                                  │ │
│  │     4.0 ┤   ╭─╯ ╰──╯   ╰─╮                                │ │
│  │     3.5 ┤───╯           ╰──                               │ │
│  │     3.0 ┤                                                  │ │
│  │         └─────────────────────────                        │ │
│  │          Week 1  Week 2  Week 3  Week 4                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ By Website ──────────────────────────────────────────────┐ │
│  │ Cinqueterre Travel:  4.5/5.0  (521 uses) ⭐⭐⭐⭐⭐       │ │
│  │ TechReview Blog:     4.1/5.0  (398 uses) ⭐⭐⭐⭐         │ │
│  │ Food & Culture:      3.8/5.0  (328 uses) ⭐⭐⭐⭐         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Top Issues ──────────────────────────────────────────────┐ │
│  │ • 12 instances of excessive length (>1500 words)          │ │
│  │ • 8 instances of missing citations                        │ │
│  │ • 5 instances of inappropriate tone                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Recent Examples ─────────────────────────────────────────┐ │
│  │ 2025-11-23 | Quality: 4.8 | "Best beaches in Monterosso" │ │
│  │ 2025-11-23 | Quality: 4.2 | "iPhone 15 Pro review"       │ │
│  │ 2025-11-22 | Quality: 2.1 | "Sustainable travel tips"    │ │
│  │            └─ [View] [Use as Negative Example]            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [Export Data] [Compare with Other Versions]                   │
└────────────────────────────────────────────────────────────────┘
```

---

## Bootstrap & Migration

### Initial Setup Script

```typescript
// scripts/bootstrap-prompts.ts

import { db } from '../packages/backend/src/db/connection'
import { readFileSync } from 'fs'
import { glob } from 'glob'

interface PromptDefinition {
  company_id: string
  role_name: string
  capability: string
  version: string
  template_file: string
  examples_file?: string
  variables?: Record<string, any>
  description?: string
}

const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    company_id: 'acme-media',
    role_name: 'writer',
    capability: 'write_draft',
    version: '1.0.0',
    template_file: 'prompts/templates/company/writer/write-draft-v1.0.0.xml',
    examples_file: 'prompts/examples/writer/write-draft-examples.json',
    variables: {
      reading_level: '8th grade',
      tone: 'professional',
      min_word_count: 600,
      max_word_count: 1200,
      writing_style: 'AP Style'
    },
    description: 'Baseline prompt for all writer agents to draft articles'
  },
  {
    company_id: 'acme-media',
    role_name: 'editor',
    capability: 'review_content',
    version: '1.0.0',
    template_file: 'prompts/templates/company/editor/review-content-v1.0.0.xml',
    examples_file: 'prompts/examples/editor/review-examples.json',
    variables: {
      review_criteria: ['accuracy', 'clarity', 'engagement', 'structure'],
      feedback_style: 'constructive and specific'
    },
    description: 'Baseline prompt for editorial review workflow'
  }
]

async function bootstrapPrompts() {
  console.log('📝 Bootstrapping prompt templates...\n')

  for (const def of PROMPT_DEFINITIONS) {
    console.log(`Creating ${def.role_name}/${def.capability} v${def.version}...`)

    // Load template file
    const template = readFileSync(def.template_file, 'utf8')

    // Load examples if provided
    let examples = []
    if (def.examples_file) {
      examples = JSON.parse(readFileSync(def.examples_file, 'utf8'))
    }

    // Create company prompt template
    const prompt = await db.companyPromptTemplates.create({
      company_id: def.company_id,
      role_name: def.role_name,
      capability: def.capability,
      version: def.version,
      template,
      examples,
      default_variables: def.variables || {},
      description: def.description,
      is_active: true,  // First version is auto-activated
      created_by_user_id: 'system',
      approved_by_user_id: 'system',
      approved_at: new Date()
    })

    console.log(`  ✓ Created prompt ${prompt.id}`)
  }

  console.log('\n✅ Prompt bootstrapping complete!')
}

// Run if executed directly
if (require.main === module) {
  bootstrapPrompts()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Bootstrap failed:', error)
      process.exit(1)
    })
}
```

### Migration from Hardcoded Prompts

```typescript
// scripts/migrate-hardcoded-prompts.ts

/**
 * Extract prompts from existing agent code and create prompt templates
 */
async function migrateHardcodedPrompts() {
  console.log('🔄 Migrating hardcoded prompts to template system...\n')

  // 1. Find all agent implementations
  const agentFiles = await glob('packages/agents/src/agents/*.ts')

  for (const file of agentFiles) {
    const content = readFileSync(file, 'utf8')

    // 2. Extract prompt strings (basic regex - adjust as needed)
    const promptMatches = content.matchAll(/claude\.messages\.create\({[\s\S]*?system:\s*[`'"]([\s\S]*?)[`'"]/g)

    for (const match of promptMatches) {
      const hardcodedPrompt = match[1]

      // 3. Create prompt template
      const prompt = await createPromptFromHardcoded(hardcodedPrompt, file)

      console.log(`  ✓ Migrated prompt from ${file} → ${prompt.id}`)
    }
  }

  console.log('\n✅ Migration complete!')
  console.log('⚠️  Manual review required: Check all migrated prompts')
}

async function createPromptFromHardcoded(hardcodedPrompt: string, sourceFile: string) {
  // Parse agent name and capability from file path
  const agentName = path.basename(sourceFile, '.ts')
  const capability = inferCapabilityFromPrompt(hardcodedPrompt)

  // Wrap in XML structure
  const template = `
<prompt version="1.0.0" role="${agentName}" capability="${capability}">
  <system>${hardcodedPrompt}</system>
  <instructions>
    <!-- TODO: Add structured instructions -->
  </instructions>
  <examples>
    <!-- TODO: Add examples -->
  </examples>
</prompt>
  `.trim()

  return await db.companyPromptTemplates.create({
    company_id: 'default',
    role_name: agentName,
    capability,
    version: '1.0.0',
    template,
    examples: [],
    default_variables: {},
    description: `Migrated from ${sourceFile}`,
    is_active: false,  // Requires manual review
    created_by_user_id: 'migration-script'
  })
}
```

---

## Testing Strategy

### Unit Tests: Prompt Resolution

```typescript
// packages/backend/src/services/__tests__/prompt-resolver.test.ts

describe('PromptResolver', () => {
  describe('resolvePrompt', () => {
    it('resolves company-only path correctly', async () => {
      // Setup
      const companyPrompt = await createTestCompanyPrompt({
        role_name: 'writer',
        capability: 'write_draft',
        default_variables: { tone: 'professional' }
      })

      const agent = await createTestAgent({
        custom_variables: { writing_style: 'AP Style' }
      })

      await bindAgentToCompanyPrompt(agent.id, companyPrompt.id)

      // Execute
      const resolved = await promptResolver.resolvePrompt(
        agent.id,
        'write_draft',
        { brief_content: 'Test brief' }
      )

      // Assert
      expect(resolved.variables).toEqual({
        tone: 'professional',           // From company
        writing_style: 'AP Style',      // From agent
        brief_content: 'Test brief'     // Runtime
      })
      expect(resolved.resolution_path).toContain('company:1.0.0')
    })

    it('resolves website override path correctly', async () => {
      const companyPrompt = await createTestCompanyPrompt({
        default_variables: { tone: 'professional' }
      })

      const websitePrompt = await createTestWebsitePrompt({
        company_prompt_template_id: companyPrompt.id,
        variables_override: { tone: 'casual' }
      })

      const agent = await createTestAgent()
      await bindAgentToWebsitePrompt(agent.id, websitePrompt.id)

      const resolved = await promptResolver.resolvePrompt(agent.id, 'write_draft')

      expect(resolved.variables.tone).toBe('casual')  // Website override wins
      expect(resolved.resolution_path).toContain('website:1.0.0')
    })

    it('merges examples from company and website', async () => {
      const companyPrompt = await createTestCompanyPrompt({
        examples: [{ id: 'ex-1', quality: 'excellent', /*...*/ }]
      })

      const websitePrompt = await createTestWebsitePrompt({
        company_prompt_template_id: companyPrompt.id,
        examples_override: [{ id: 'ex-2', quality: 'good', /*...*/ }]
      })

      const agent = await createTestAgent()
      await bindAgentToWebsitePrompt(agent.id, websitePrompt.id)

      const resolved = await promptResolver.resolvePrompt(agent.id, 'write_draft')

      expect(resolved.examples).toHaveLength(2)
      expect(resolved.examples.map(e => e.id)).toEqual(['ex-1', 'ex-2'])
    })
  })
})
```

### Integration Tests: Agent Execution

```typescript
// packages/agents/__tests__/writer-agent.integration.test.ts

describe('WriterAgent with Prompt System', () => {
  it('executes with resolved prompt', async () => {
    // Setup complete prompt hierarchy
    const company = await createTestCompany()
    const website = await createTestWebsite({ company_id: company.id })
    const companyPrompt = await createTestCompanyPrompt({
      company_id: company.id,
      role_name: 'writer',
      capability: 'write_draft'
    })
    const websitePrompt = await createTestWebsitePrompt({
      website_id: website.id,
      company_prompt_template_id: companyPrompt.id
    })
    const agent = await createTestAgent({
      name: 'Elena',
      role_id: 'writer'
    })
    await bindAgentToWebsitePrompt(agent.id, 'write_draft', websitePrompt.id)

    // Execute
    const result = await writerAgent.writeDraft({
      agent_id: agent.id,
      brief_content: 'Write about Cinque Terre hiking trails'
    })

    // Assert
    expect(result).toHaveProperty('content')
    expect(result.content).toBeInstanceOf(Array)  // JSON blocks

    // Verify execution was logged
    const execution = await db.promptExecutions.findOne({
      where: { agent_id: agent.id, capability: 'write_draft' }
    })
    expect(execution).toBeDefined()
    expect(execution.website_prompt_template_id).toBe(websitePrompt.id)
  })
})
```

### E2E Tests: Full Workflow

```typescript
// test/e2e/prompt-management.test.ts

describe('Prompt Management E2E', () => {
  it('creates and uses new prompt version', async () => {
    // 1. CEO creates new prompt version
    const newPrompt = await api.post('/api/prompts/company/create', {
      company_id: testCompanyId,
      role_name: 'writer',
      capability: 'write_draft',
      version: '2.0.0',
      template: improvedTemplate,
      description: 'Improved with chain-of-thought prompting'
    })

    // 2. CEO activates new version
    await api.post(`/api/prompts/company/${newPrompt.id}/activate`)

    // 3. Agent executes with new prompt
    const result = await api.post('/api/agents/execute', {
      agent_id: testAgentId,
      capability: 'write_draft',
      variables: { brief_content: 'Test' }
    })

    // 4. Verify new prompt was used
    const execution = await api.get(`/api/prompts/executions/${result.execution_id}`)
    expect(execution.company_prompt_template_id).toBe(newPrompt.id)
    expect(execution.company_version).toBe('2.0.0')
  })

  it('A/B tests two prompt versions', async () => {
    // Setup: 50% of agents use v1.0.0, 50% use v2.0.0
    await setupABTest({
      capability: 'write_draft',
      control_version: '1.0.0',
      variant_version: '2.0.0',
      traffic_split: 0.5
    })

    // Execute multiple times
    const results = []
    for (let i = 0; i < 100; i++) {
      const result = await executeWriter({ brief: `Test ${i}` })
      results.push(result)
    }

    // Verify traffic split
    const controlCount = results.filter(r => r.prompt_version === '1.0.0').length
    const variantCount = results.filter(r => r.prompt_version === '2.0.0').length

    expect(controlCount).toBeGreaterThan(40)
    expect(controlCount).toBeLessThan(60)
    expect(variantCount).toBeGreaterThan(40)
    expect(variantCount).toBeLessThan(60)
  })
})
```

---

## Monitoring & Analytics

### Performance Metrics

Track these metrics for every prompt execution:

1. **Quality Metrics**:
   - Quality score (0-5 from human/AI review)
   - Published vs rejected rate
   - Revision count before approval
   - Editor satisfaction ratings

2. **Performance Metrics**:
   - Token usage (input + output)
   - Latency (time to generate)
   - Error rate
   - Timeout rate

3. **Business Metrics**:
   - Content published per day
   - Time from brief to publish
   - Cost per article (tokens × price)
   - Agent productivity

### Analytics Queries

```sql
-- Top performing prompts by quality
SELECT
  cpt.role_name,
  cpt.capability,
  cpt.version,
  AVG(pe.quality_score) as avg_quality,
  COUNT(*) as executions,
  COUNT(*) FILTER (WHERE pe.content_status = 'published') as published_count
FROM prompt_executions pe
JOIN company_prompt_templates cpt ON pe.company_prompt_template_id = cpt.id
WHERE pe.created_at > NOW() - INTERVAL '30 days'
  AND pe.quality_score IS NOT NULL
GROUP BY cpt.role_name, cpt.capability, cpt.version
HAVING COUNT(*) > 20  -- Minimum sample size
ORDER BY avg_quality DESC
LIMIT 10;

-- Prompts with highest revision rates (need improvement)
SELECT
  cpt.role_name,
  cpt.capability,
  cpt.version,
  AVG(pe.revision_count) as avg_revisions,
  STDDEV(pe.revision_count) as revision_stddev,
  COUNT(*) as executions
FROM prompt_executions pe
JOIN company_prompt_templates cpt ON pe.company_prompt_template_id = cpt.id
WHERE pe.created_at > NOW() - INTERVAL '30 days'
GROUP BY cpt.role_name, cpt.capability, cpt.version
HAVING COUNT(*) > 20
ORDER BY avg_revisions DESC
LIMIT 10;

-- Cost analysis by prompt
SELECT
  cpt.role_name,
  cpt.capability,
  cpt.version,
  AVG(pe.tokens_used) as avg_tokens,
  COUNT(*) as executions,
  (AVG(pe.tokens_used) * COUNT(*) * 0.000003) as estimated_cost_usd  -- Claude pricing
FROM prompt_executions pe
JOIN company_prompt_templates cpt ON pe.company_prompt_template_id = cpt.id
WHERE pe.created_at > NOW() - INTERVAL '30 days'
GROUP BY cpt.role_name, cpt.capability, cpt.version
ORDER BY estimated_cost_usd DESC;

-- A/B test results
SELECT
  pe.ab_test_group,
  COUNT(*) as executions,
  AVG(pe.quality_score) as avg_quality,
  AVG(pe.tokens_used) as avg_tokens,
  AVG(pe.revision_count) as avg_revisions,
  COUNT(*) FILTER (WHERE pe.content_status = 'published') * 100.0 / COUNT(*) as publish_rate
FROM prompt_executions pe
WHERE pe.ab_test_group IS NOT NULL
  AND pe.created_at > NOW() - INTERVAL '7 days'
GROUP BY pe.ab_test_group
ORDER BY avg_quality DESC;
```

### Real-time Monitoring

```typescript
// packages/backend/src/services/prompt-monitor.service.ts

export class PromptMonitor {

  /**
   * Alert if prompt quality drops below threshold
   */
  async checkQualityAlerts() {
    const recentExecutions = await db.promptExecutions.findAll({
      where: {
        created_at: { $gte: subHours(new Date(), 6) },
        quality_score: { $ne: null }
      },
      include: ['company_prompt_template']
    })

    // Group by prompt
    const byPrompt = groupBy(recentExecutions, 'company_prompt_template_id')

    for (const [promptId, executions] of Object.entries(byPrompt)) {
      if (executions.length < 10) continue  // Minimum sample

      const avgQuality = mean(executions.map(e => e.quality_score))
      const prompt = executions[0].company_prompt_template

      // Alert if quality drops below 3.5
      if (avgQuality < 3.5) {
        await this.sendAlert({
          severity: 'high',
          title: `Low prompt quality detected`,
          message: `Prompt ${prompt.role_name}/${prompt.capability} v${prompt.version} has avg quality ${avgQuality.toFixed(2)} (last 6h)`,
          action_url: `/admin/prompts/${promptId}/performance`
        })
      }
    }
  }

  /**
   * Alert if error rate spikes
   */
  async checkErrorRateAlerts() {
    const recentExecutions = await db.promptExecutions.findAll({
      where: {
        created_at: { $gte: subHours(new Date(), 1) }
      }
    })

    const errorRate = recentExecutions.filter(e => e.error_occurred).length / recentExecutions.length

    // Alert if error rate > 10%
    if (errorRate > 0.10) {
      await this.sendAlert({
        severity: 'critical',
        title: `High prompt error rate`,
        message: `${(errorRate * 100).toFixed(1)}% of prompt executions failed in last hour`,
        action_url: `/admin/system/errors`
      })
    }
  }
}

// Run monitors every 15 minutes
setInterval(() => {
  promptMonitor.checkQualityAlerts()
  promptMonitor.checkErrorRateAlerts()
}, 15 * 60 * 1000)
```

---

## Version Control & Deployment

### Versioning Strategy

Use **Semantic Versioning** for prompts:

- **Major (X.0.0)**: Breaking changes (complete rewrite, different output format)
- **Minor (1.X.0)**: Enhancements (new instructions, additional examples)
- **Patch (1.0.X)**: Bug fixes (typo corrections, clarifications)

### Git-Based Version Control

Store prompt templates in Git for version history:

```
prompts/
├── templates/
│   ├── company/
│   │   ├── writer/
│   │   │   ├── write-draft-v1.0.0.xml
│   │   │   ├── write-draft-v1.1.0.xml
│   │   │   ├── write-draft-v2.0.0.xml
│   │   │   └── revise-draft-v1.0.0.xml
│   │   └── editor/
│   │       └── review-content-v1.0.0.xml
│   └── websites/
│       ├── cinqueterre/
│       │   └── writer-write-draft-override-v1.0.0.xml
│       └── techreview/
│           └── writer-write-draft-override-v1.0.0.xml
├── examples/
│   ├── writer/
│   │   └── write-draft-examples.json
│   └── editor/
│       └── review-examples.json
└── README.md
```

### Deployment Process

```typescript
// scripts/deploy-prompt-version.ts

/**
 * Deploy a new prompt version from Git to production database
 */
async function deployPromptVersion(options: {
  role: string
  capability: string
  version: string
  auto_activate?: boolean
}) {
  console.log(`🚀 Deploying ${options.role}/${options.capability} v${options.version}...`)

  // 1. Load template from Git
  const templatePath = `prompts/templates/company/${options.role}/${options.capability}-v${options.version}.xml`
  const template = readFileSync(templatePath, 'utf8')

  // 2. Load examples
  const examplesPath = `prompts/examples/${options.role}/${options.capability}-examples.json`
  const examples = JSON.parse(readFileSync(examplesPath, 'utf8'))

  // 3. Validate template
  const validation = validatePromptTemplate(template)
  if (!validation.valid) {
    throw new Error(`Invalid template: ${validation.errors.join(', ')}`)
  }

  // 4. Create database record
  const prompt = await db.companyPromptTemplates.create({
    company_id: DEFAULT_COMPANY_ID,
    role_name: options.role,
    capability: options.capability,
    version: options.version,
    template,
    examples,
    is_active: options.auto_activate || false,
    created_by_user_id: 'deployment-script',
    description: extractDescriptionFromTemplate(template)
  })

  console.log(`  ✓ Created prompt template ${prompt.id}`)

  // 5. Auto-activate if requested
  if (options.auto_activate) {
    await activatePromptVersion(prompt.id)
    console.log(`  ✓ Activated as default version`)
  } else {
    console.log(`  ⚠️  Requires manual activation`)
  }

  console.log(`\n✅ Deployment complete!`)
}

// Usage:
// npm run deploy-prompt -- --role=writer --capability=write_draft --version=2.1.0 --auto-activate
```

### Rollback Procedure

```typescript
// scripts/rollback-prompt.ts

async function rollbackPrompt(options: {
  role: string
  capability: string
  to_version: string
  reason: string
}) {
  console.log(`⏪ Rolling back ${options.role}/${options.capability} to v${options.to_version}...`)
  console.log(`Reason: ${options.reason}`)

  // 1. Find target version
  const targetPrompt = await db.companyPromptTemplates.findOne({
    where: {
      role_name: options.role,
      capability: options.capability,
      version: options.to_version
    }
  })

  if (!targetPrompt) {
    throw new Error(`Version ${options.to_version} not found`)
  }

  // 2. Deactivate current version
  await db.companyPromptTemplates.update(
    { is_active: false },
    { where: { role_name: options.role, capability: options.capability, is_active: true } }
  )

  // 3. Activate target version
  await db.companyPromptTemplates.update(
    { is_active: true },
    { where: { id: targetPrompt.id } }
  )

  // 4. Log rollback event
  await db.promptRollbacks.create({
    from_version: getCurrentVersion(options.role, options.capability),
    to_version: options.to_version,
    reason: options.reason,
    performed_by: 'rollback-script',
    performed_at: new Date()
  })

  console.log(`✅ Rollback complete! Now using v${options.to_version}`)
}
```

---

## Security Considerations

### Prompt Injection Prevention

1. **Input Sanitization**: Escape user input before injecting into prompts
2. **Template Validation**: Validate XML structure before saving
3. **Variable Whitelisting**: Only allow known variables in templates
4. **Output Filtering**: Detect and block malicious output patterns

```typescript
function sanitizeUserInput(input: string): string {
  // Remove XML tags
  let sanitized = input.replace(/<[^>]*>/g, '')

  // Escape prompt injection attempts
  sanitized = sanitized.replace(/\{\{/g, '\\{\\{')
  sanitized = sanitized.replace(/\}\}/g, '\\}\\}')

  // Remove system prompt attempts
  const dangerousPatterns = [
    /ignore previous instructions/i,
    /you are now/i,
    /system:/i,
    /disregard all/i
  ]

  for (const pattern of dangerousPatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]')
  }

  return sanitized
}
```

### Access Control

```typescript
// Who can modify prompts?
const PROMPT_PERMISSIONS = {
  'company_prompts:create': ['ceo', 'cto'],
  'company_prompts:activate': ['ceo', 'cto'],
  'website_prompts:create': ['chief_editor', 'ceo'],
  'website_prompts:activate': ['chief_editor', 'ceo'],
  'agent_bindings:modify': ['chief_editor', 'tech_lead'],
  'prompts:view': ['all']  // Anyone can view
}

function canModifyCompanyPrompt(userId: string): boolean {
  const user = getUserById(userId)
  return PROMPT_PERMISSIONS['company_prompts:create'].includes(user.role)
}
```

### Audit Logging

```typescript
// Log all prompt modifications
await db.promptAuditLog.create({
  prompt_id: prompt.id,
  action: 'activate',
  performed_by_user_id: userId,
  previous_state: { is_active: false },
  new_state: { is_active: true },
  reason: 'Improved quality scores in A/B test',
  timestamp: new Date()
})
```

---

## Performance Optimization

### Caching Strategy

```typescript
// Cache resolved prompts to avoid repeated resolution
const promptCache = new LRUCache<string, ResolvedPrompt>({
  max: 1000,  // Cache up to 1000 prompts
  ttl: 1000 * 60 * 60  // 1 hour TTL
})

async function getCachedPrompt(
  agentId: string,
  capability: string,
  runtimeVariables: Record<string, any>
): Promise<ResolvedPrompt> {

  // Generate cache key (exclude runtime variables)
  const cacheKey = `${agentId}:${capability}`

  let resolved = promptCache.get(cacheKey)
  if (!resolved) {
    resolved = await promptResolver.resolvePrompt(agentId, capability, {})
    promptCache.set(cacheKey, resolved)
  }

  // Merge runtime variables (not cached)
  return {
    ...resolved,
    variables: {
      ...resolved.variables,
      ...runtimeVariables
    }
  }
}
```

### Database Optimization

```sql
-- Indexes for fast lookup
CREATE INDEX idx_agent_bindings_lookup ON agent_prompt_bindings(agent_id, capability, is_active);
CREATE INDEX idx_company_prompts_lookup ON company_prompt_templates(company_id, role_name, capability, is_active);
CREATE INDEX idx_website_prompts_lookup ON website_prompt_templates(website_id, is_active);

-- Partial indexes for active prompts only
CREATE INDEX idx_company_prompts_active_only ON company_prompt_templates(id) WHERE is_active = TRUE;
CREATE INDEX idx_website_prompts_active_only ON website_prompt_templates(id) WHERE is_active = TRUE;
```

### Parallel Execution Tracking

```typescript
// Log prompt executions asynchronously (don't block agent execution)
async function executeWithLogging(
  agent: Agent,
  capability: string,
  variables: Record<string, any>
): Promise<any> {

  const startTime = Date.now()

  try {
    // Execute agent (fast path)
    const result = await agent.execute(capability, variables)

    // Log asynchronously (slow path - don't await)
    logPromptExecution({
      agent_id: agent.id,
      capability,
      variables,
      result,
      latency: Date.now() - startTime
    }).catch(error => {
      console.error('Failed to log prompt execution:', error)
    })

    return result
  } catch (error) {
    // Log error asynchronously
    logPromptExecution({
      agent_id: agent.id,
      capability,
      variables,
      error: error.message,
      latency: Date.now() - startTime
    }).catch(err => {
      console.error('Failed to log prompt execution error:', error)
    })

    throw error
  }
}
```

---

## Future Enhancements

### Phase 2: Advanced Features

1. **Automated Prompt Optimization**:
   - Use Claude to analyze low-performing prompts and suggest improvements
   - A/B test variations automatically
   - Auto-generate examples from high-quality production outputs

2. **Prompt Marketplace**:
   - Share prompts across companies
   - Rate and review prompts
   - Import best-practice prompts from community

3. **Multi-Model Support**:
   - Support different Claude models (Opus, Sonnet, Haiku)
   - Route capabilities to optimal models (Haiku for simple, Opus for complex)
   - Cost optimization based on capability complexity

4. **Prompt Chaining IDE**:
   - Visual editor for multi-step prompt chains
   - Drag-and-drop workflow builder
   - Preview intermediate outputs

5. **Fine-Tuning Integration**:
   - Export prompt examples for fine-tuning datasets
   - Track fine-tuned model performance vs prompt engineering
   - Hybrid approach: fine-tuned models + prompt templates

### Phase 3: AI-Powered Prompt Management

1. **Prompt Performance Prediction**:
   - ML model predicts quality before execution
   - Suggest optimal prompt for each task
   - Flag low-confidence prompts for human review

2. **Automated Regression Detection**:
   - Continuous quality monitoring
   - Alert on statistically significant quality drops
   - Auto-rollback on critical regressions

3. **Intelligent Example Selection**:
   - Dynamically select most relevant examples for each task
   - Personalize examples based on agent performance history
   - Balance positive and negative examples

---

## Appendix A: Prompt Template Examples

### Example 1: Writer - write_draft (Company Baseline)

```xml
<prompt version="1.0.0" role="writer" capability="write_draft">
  <system>
    You are {{agent_name}}, a professional writer for {{website_name}}.
    Your persona: {{agent_persona}}

    {{#if website_description}}
    About {{website_name}}: {{website_description}}
    {{/if}}
  </system>

  <instructions>
    Your task is to write a high-quality article based on the brief provided below.

    Follow these steps:
    1. Carefully read and analyze the brief
    2. Identify the key points and main message
    3. Research additional context if needed
    4. Plan your structure (introduction, body, conclusion)
    5. Write engaging, accurate, well-structured content
    6. Self-review for quality before submitting

    Follow these writing principles:
    - Start with a compelling hook in the first 100 words
    - Use clear, descriptive headings for sections
    - Support claims with evidence or examples
    - Write at {{reading_level}} reading level
    - Maintain {{tone}} tone throughout
    - Include {{min_word_count}} to {{max_word_count}} words
    - Follow {{writing_style}} style guide
  </instructions>

  <brief>{{brief_content}}</brief>

  {{#if research_data}}
  <research>{{research_data}}</research>
  {{/if}}

  {{#if target_keywords}}
  <seo_keywords>{{target_keywords}}</seo_keywords>
  {{/if}}

  <examples>
    <example quality="excellent">
      <brief>Write an article about sustainable travel practices</brief>
      <output>[Full article with structured JSON blocks]</output>
      <reasoning>Excellent because: Compelling hook, well-researched facts, actionable tips, balanced tone between inspiring and practical, proper citations, engaging narrative flow.</reasoning>
    </example>

    <example quality="good">
      <brief>Write a guide to getting around Monterosso</brief>
      <output>[Article content]</output>
      <reasoning>Good because: Clear structure, practical information, appropriate tone. Could improve with more sensory details and local insights.</reasoning>
    </example>

    <example quality="poor">
      <brief>Write about Italian cuisine in Liguria</brief>
      <output>[Generic content]</output>
      <reasoning>Poor because: Too generic, lacks specific examples, no authentic voice, reads like template content, missing proper structure.</reasoning>
    </example>
  </examples>

  <output_format>
    First, think through your approach in <thinking> tags:
    <thinking>
      1. Brief analysis: [What is the core message?]
      2. Target audience: [Who am I writing for?]
      3. Tone selection: [What tone is appropriate?]
      4. Structure plan: [How should I organize this?]
      5. Key points: [What must I communicate?]
      6. Hook strategy: [How do I grab attention?]
    </thinking>

    Then, output your article as JSON blocks array in <article> tags:
    <article>
      [
        {
          "type": "hero",
          "title": "Main Article Title",
          "subtitle": "Compelling subtitle"
        },
        {
          "type": "paragraph",
          "markdown": "Opening paragraph with hook..."
        },
        {
          "type": "heading",
          "level": 2,
          "text": "Section Title"
        },
        {
          "type": "paragraph",
          "markdown": "Section content..."
        }
      ]
    </article>
  </output_format>

  <quality_standards>
    Your article must meet these standards before submission:

    ✓ Factual Accuracy: All claims are verifiable and properly sourced
    ✓ Engagement: Opening hooks reader within first 100 words
    ✓ Structure: Clear sections with descriptive headings
    ✓ Readability: Written at {{reading_level}} level
    ✓ Length: Between {{min_word_count}} and {{max_word_count}} words
    ✓ Tone: Consistent {{tone}} tone throughout
    ✓ Style: Follows {{writing_style}} guidelines
    ✓ Grammar: Zero grammatical errors
    ✓ Value: Provides actionable insights or valuable information
  </quality_standards>
</prompt>
```

### Example 2: Cinqueterre - write_draft (Website Override)

```xml
<prompt_extension extends="company://writer/write_draft/v1.0.0" version="1.0.0">
  <instructions_append>

    Additional requirements for travel content:

    7. Include practical travel tips in every article:
       - How to get there (transportation options with costs)
       - Best times to visit (seasons, months, times of day)
       - Budget considerations (costs, value tips)
       - What to bring (essentials, recommendations)

    8. Engage the senses:
       - Describe what readers will see, hear, smell, taste
       - Paint vivid pictures with specific details
       - Use sensory language to transport readers

    9. Add local expertise:
       - Include insider tips and hidden gems
       - Mention local customs and etiquette
       - Reference authentic local experiences

    10. Accessibility information:
        - Note wheelchair accessibility
        - Mention family-friendliness
        - Highlight any physical requirements (steep hills, etc.)
  </instructions_append>

  <variables_override>
    <tone>casual but informative</tone>
    <expertise>travel and tourism</expertise>
    <target_audience>adventure travelers and culture enthusiasts</target_audience>
    <required_sections>["Getting There", "When to Visit", "Budget Tips", "Local Insights"]</required_sections>
  </variables_override>

  <examples_append>
    <example quality="excellent">
      <brief>Write about hidden beaches near Monterosso</brief>
      <output>
        [
          {
            "type": "hero",
            "title": "Secret Shores: Hidden Beaches Beyond Monterosso's Crowds",
            "subtitle": "Discover secluded coves where locals swim"
          },
          {
            "type": "paragraph",
            "markdown": "The sound of waves lapping against ancient rocks echoes through the narrow passageway. It's 7 AM, and you're one of only three people on this pristine stretch of pebble beach—a 10-minute walk from Monterosso's packed main beach, yet a world apart. This is Guvano Beach, and you've just discovered why locals have kept it quiet for decades..."
          },
          ...
        ]
      </output>
      <reasoning>Perfect travel content: Sensory opening, insider knowledge, practical details (timing, directions), authentic voice, local perspective. Balances inspiration with actionable information.</reasoning>
    </example>
  </examples_append>
</prompt_extension>
```

---

## Appendix B: Glossary

- **Prompt Template**: XML document defining structure and instructions for Claude
- **Company Prompt**: Baseline prompt used across all websites
- **Website Prompt**: Brand-specific override of company prompt
- **Agent Binding**: Link between agent and prompt template
- **Prompt Resolution**: Process of merging hierarchy into final prompt
- **Variable Merging**: Combining variables from multiple levels with priority
- **Example**: Sample input/output pair showing desired behavior
- **Chain of Thought**: Prompting technique using <thinking> tags
- **Multishot Prompting**: Including multiple examples in prompt
- **Quality Score**: 0-5 rating of agent output quality
- **A/B Testing**: Comparing two prompt versions statistically
- **Prompt Execution**: Single invocation of agent with specific prompt

---

**End of Specification**

This specification is a living document and will be updated as the system evolves.

For questions or clarifications, contact the System Architecture Team.
