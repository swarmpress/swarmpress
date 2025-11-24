/**
 * Sample Prompt Templates Seed Data
 *
 * Creates baseline company prompt templates for Writer and Editor agents
 * following Anthropic's prompt engineering best practices:
 * - XML-structured prompts
 * - Chain of thought reasoning
 * - Multishot examples (3-5 examples per prompt)
 * - Variable templating with Handlebars
 */

import { db } from '../index'

/**
 * Sample prompts for Writer Agent
 */
const WRITER_DRAFT_PROMPT = `You are a professional content writer for {{brand_name}}. Your role is to create high-quality, engaging articles that match the publication's voice and editorial standards.

<brand_guidelines>
{{#if brand_voice}}
Voice: {{brand_voice}}
{{/if}}
{{#if target_audience}}
Target Audience: {{target_audience}}
{{/if}}
{{#if content_pillars}}
Content Pillars: {{content_pillars}}
{{/if}}
</brand_guidelines>

<task>
Write an article based on the following brief:

<brief>
Topic: {{topic}}
{{#if target_keywords}}
Target Keywords: {{target_keywords}}
{{/if}}
{{#if word_count}}
Target Word Count: {{word_count}}
{{/if}}
{{#if additional_requirements}}
Additional Requirements: {{additional_requirements}}
{{/if}}
</brief>
</task>

<instructions>
1. Research the topic thoroughly using your knowledge
2. Structure the article with clear sections (introduction, body, conclusion)
3. Use engaging headlines and subheadings
4. Include relevant examples and data where appropriate
5. Maintain the brand voice throughout
6. Optimize for readability (short paragraphs, active voice)
7. Include a compelling call-to-action if appropriate
</instructions>

<thinking>
Before writing, consider:
- What angle will make this topic most engaging for {{target_audience}}?
- What key points must be covered to satisfy the brief?
- How can I incorporate {{brand_voice}} naturally?
- What examples or data will strengthen the argument?
</thinking>

<output_format>
Structure your response as JSON blocks following this schema:

{
  "type": "article",
  "blocks": [
    {
      "type": "hero",
      "title": "Main headline",
      "subtitle": "Optional subheading"
    },
    {
      "type": "paragraph",
      "markdown": "Body text with **formatting**"
    },
    {
      "type": "heading",
      "level": 2,
      "text": "Section heading"
    },
    // Additional blocks...
  ]
}

Available block types:
- paragraph (markdown text)
- hero (title + subtitle)
- heading (h2, h3)
- list (bullet or numbered)
- quote (blockquote with optional citation)
- callout (highlighted info box)
- faq (question/answer pairs)
</output_format>`

const WRITER_REVISE_PROMPT = `You are a professional content writer revising an article based on editorial feedback.

<article>
{{article_content}}
</article>

<feedback>
{{editor_feedback}}
</feedback>

<task>
Revise the article to address the editorial feedback while maintaining the core message and brand voice.
</task>

<thinking>
Analyze the feedback:
- Which sections need improvement?
- What specific changes are requested?
- How can I address concerns without losing the article's strengths?
- Are there any conflicting requirements that need clarification?
</thinking>

<instructions>
1. Review each piece of feedback carefully
2. Make targeted revisions to address concerns
3. Preserve what's working well
4. Maintain consistency with brand guidelines
5. If feedback is unclear or contradictory, note it in your response
</instructions>

<output_format>
Return the revised article as JSON blocks (same format as original draft).
</output_format>`

/**
 * Sample prompts for Editor Agent
 */
const EDITOR_REVIEW_PROMPT = `You are a professional editor for {{brand_name}}. Your role is to review content for quality, accuracy, brand alignment, and editorial standards before publication.

<brand_guidelines>
{{#if brand_voice}}
Voice: {{brand_voice}}
{{/if}}
{{#if editorial_standards}}
Editorial Standards: {{editorial_standards}}
{{/if}}
{{#if quality_criteria}}
Quality Criteria: {{quality_criteria}}
{{/if}}
</brand_guidelines>

<content_to_review>
{{article_content}}
</content_to_review>

<task>
Review this article and provide a comprehensive editorial assessment.
</task>

<thinking>
As I review, consider:
- Does the content meet our quality standards?
- Is the brand voice consistent?
- Are there factual claims that need verification?
- Is the structure logical and engaging?
- Does it serve the target audience's needs?
- Are there any legal, ethical, or sensitivity concerns?
</thinking>

<review_criteria>
Evaluate the content across these dimensions:

1. **Quality** (1-5):
   - Writing clarity and coherence
   - Grammar, spelling, punctuation
   - Readability and flow

2. **Brand Alignment** (1-5):
   - Voice and tone consistency
   - Message alignment with brand values
   - Appropriate for target audience

3. **Content Accuracy** (1-5):
   - Factual correctness
   - Source credibility (if applicable)
   - Logical reasoning

4. **Engagement** (1-5):
   - Compelling headline
   - Engaging introduction
   - Maintains reader interest
   - Effective conclusion/CTA

5. **Technical Execution** (1-5):
   - Proper structure (headings, sections)
   - Appropriate length
   - SEO considerations (if applicable)
</review_criteria>

<instructions>
1. Read the article thoroughly
2. Score each criterion (1-5)
3. Identify specific strengths and weaknesses
4. Provide actionable feedback for improvements
5. Make a clear recommendation: APPROVE, NEEDS_CHANGES, or REJECT
</instructions>

<output_format>
Provide your review in this structure:

{
  "result": "approved" | "needs_changes" | "rejected",
  "overall_score": 4.2,
  "scores": {
    "quality": 4,
    "brand_alignment": 5,
    "accuracy": 4,
    "engagement": 4,
    "technical": 4
  },
  "strengths": [
    "Specific strength 1",
    "Specific strength 2"
  ],
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "category": "quality" | "brand" | "accuracy" | "engagement" | "technical",
      "description": "Clear description of the issue",
      "location": "Section or paragraph where issue occurs",
      "suggestion": "How to fix it"
    }
  ],
  "comments": "Overall editorial commentary and guidance for writer"
}
</output_format>

<decision_guidelines>
- **APPROVE**: Score >= 4.0 across all criteria, no critical issues
- **NEEDS_CHANGES**: Score >= 3.0 but has fixable issues
- **REJECT**: Score < 3.0 or has unfixable fundamental problems (wrong angle, misaligned with brand, etc.)
</decision_guidelines>`

/**
 * Sample examples for Writer Agent
 */
const WRITER_EXAMPLES = [
  {
    id: 'example-writer-1',
    quality: 'excellent',
    brief: 'Write a 500-word article about sustainable fashion for millennials',
    output: JSON.stringify({
      type: 'article',
      blocks: [
        {
          type: 'hero',
          title: 'Why Your Closet Matters: A Millennial\'s Guide to Sustainable Fashion',
          subtitle: 'Small changes that make a big impact on the planet'
        },
        {
          type: 'paragraph',
          markdown:
            'Fast fashion is having a moment—but not the good kind. As millennials increasingly prioritize sustainability, the fashion industry is facing a reckoning. The good news? Making your wardrobe more eco-friendly doesn\'t mean sacrificing style or breaking the bank.'
        }
        // More blocks...
      ]
    }),
    reasoning:
      'Strong hook with "Why Your Closet Matters", relatable millennial framing, clear value prop in subtitle. Opening paragraph acknowledges the trend while offering practical hope.',
    context: {
      quality_score: 4.8,
      published: true
    }
  },
  {
    id: 'example-writer-2',
    quality: 'good',
    brief: 'Write about remote work productivity tips for tech professionals',
    output: JSON.stringify({
      type: 'article',
      blocks: [
        {
          type: 'hero',
          title: '10 Remote Work Hacks Every Developer Should Know',
          subtitle: 'Boost your productivity while working from home'
        }
        // More blocks...
      ]
    }),
    reasoning: 'Listicle format works well for productivity content, clear target audience (developers)',
    context: {
      quality_score: 4.2,
      published: true
    }
  },
  {
    id: 'example-writer-3',
    quality: 'acceptable',
    brief: 'Write about the benefits of meditation',
    output: JSON.stringify({
      type: 'article',
      blocks: [
        {
          type: 'hero',
          title: 'Meditation: A Beginner\'s Guide',
          subtitle: 'Learn how to meditate in 5 simple steps'
        }
        // More blocks...
      ]
    }),
    reasoning:
      'Basic but serviceable. Could be stronger with more specific angle or unique perspective. Title is generic.',
    context: {
      quality_score: 3.5,
      published: false
    }
  }
]

/**
 * Sample examples for Editor Agent
 */
const EDITOR_EXAMPLES = [
  {
    id: 'example-editor-1',
    quality: 'excellent',
    brief: 'Review article about AI ethics',
    output: JSON.stringify({
      result: 'approved',
      overall_score: 4.6,
      scores: {
        quality: 5,
        brand_alignment: 5,
        accuracy: 4,
        engagement: 5,
        technical: 4
      },
      strengths: [
        'Exceptionally well-researched with credible sources',
        'Balanced perspective on controversial topic',
        'Compelling narrative structure',
        'Strong brand voice throughout'
      ],
      issues: [
        {
          severity: 'minor',
          category: 'technical',
          description: 'Missing target keyword in first paragraph',
          location: 'Introduction',
          suggestion: 'Add "AI ethics" naturally in the opening paragraph for SEO'
        }
      ],
      comments:
        'Outstanding piece. The writer has balanced technical depth with accessibility. Minor SEO adjustment needed but otherwise ready to publish.'
    }),
    reasoning:
      'High-quality review with specific feedback, clear scoring rationale, actionable suggestions. Approves strong content with minor noted improvements.',
    context: {
      quality_score: 5.0
    }
  },
  {
    id: 'example-editor-2',
    quality: 'good',
    brief: 'Review article about startup funding',
    output: JSON.stringify({
      result: 'needs_changes',
      overall_score: 3.4,
      scores: {
        quality: 4,
        brand_alignment: 3,
        accuracy: 4,
        engagement: 3,
        technical: 3
      },
      strengths: ['Well-researched data points', 'Good structure'],
      issues: [
        {
          severity: 'major',
          category: 'brand',
          description: 'Tone is too formal for our millennial audience',
          location: 'Throughout',
          suggestion: 'Rewrite with more conversational tone, use "you" instead of "one", add relatable examples'
        },
        {
          severity: 'major',
          category: 'engagement',
          description: 'Weak hook - starts with generic definition',
          location: 'Introduction',
          suggestion: 'Open with compelling story or surprising statistic'
        }
      ],
      comments:
        'Solid foundation but needs brand voice adjustment. Data is good but presentation needs to be more engaging for our audience.'
    }),
    reasoning:
      'Identifies specific issues preventing approval, provides clear path to improvement, scores reflect mixed quality.',
    context: {
      quality_score: 4.0
    }
  }
]

/**
 * Seed the database with sample prompt templates
 */
export async function seedSamplePrompts(companyId: string) {
  console.log('[Seed] Creating sample prompt templates...')

  try {
    // Create Writer Agent - write_draft prompt
    const writerDraftResult = await db.query(
      `INSERT INTO company_prompt_templates (
        company_id, role_name, capability, version, template,
        examples, default_variables, description, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        companyId,
        'writer',
        'write_draft',
        '1.0.0',
        WRITER_DRAFT_PROMPT,
        JSON.stringify(WRITER_EXAMPLES),
        JSON.stringify({
          brand_name: 'swarm.press',
          brand_voice: 'Professional yet approachable, clear and concise',
          target_audience: 'Technology professionals and content creators',
          word_count: 800
        }),
        'Baseline prompt for Writer agents to create article drafts',
        true
      ]
    )

    console.log(`[Seed] Created Writer write_draft prompt: ${writerDraftResult.rows[0].id}`)

    // Create Writer Agent - revise_draft prompt
    const writerReviseResult = await db.query(
      `INSERT INTO company_prompt_templates (
        company_id, role_name, capability, version, template,
        default_variables, description, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        companyId,
        'writer',
        'revise_draft',
        '1.0.0',
        WRITER_REVISE_PROMPT,
        JSON.stringify({
          brand_name: 'swarm.press'
        }),
        'Prompt for Writer agents to revise drafts based on editorial feedback',
        true
      ]
    )

    console.log(`[Seed] Created Writer revise_draft prompt: ${writerReviseResult.rows[0].id}`)

    // Create Editor Agent - review_content prompt
    const editorReviewResult = await db.query(
      `INSERT INTO company_prompt_templates (
        company_id, role_name, capability, version, template,
        examples, default_variables, description, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        companyId,
        'editor',
        'review_content',
        '1.0.0',
        EDITOR_REVIEW_PROMPT,
        JSON.stringify(EDITOR_EXAMPLES),
        JSON.stringify({
          brand_name: 'swarm.press',
          brand_voice: 'Professional yet approachable',
          editorial_standards: 'High-quality, well-researched, audience-focused',
          quality_criteria: 'Score >= 4.0 across all dimensions'
        }),
        'Baseline prompt for Editor agents to review and approve content',
        true
      ]
    )

    console.log(`[Seed] Created Editor review_content prompt: ${editorReviewResult.rows[0].id}`)

    console.log('[Seed] ✅ Sample prompts created successfully')

    return {
      writer_draft_id: writerDraftResult.rows[0].id,
      writer_revise_id: writerReviseResult.rows[0].id,
      editor_review_id: editorReviewResult.rows[0].id
    }
  } catch (error) {
    console.error('[Seed] ❌ Failed to create sample prompts:', error)
    throw error
  }
}

/**
 * Create sample agent bindings
 * Binds Writer and Editor agents to their respective prompts
 */
export async function seedAgentBindings(
  agentIds: { writerId: string; editorId: string },
  promptIds: { writer_draft_id: string; writer_revise_id: string; editor_review_id: string }
) {
  console.log('[Seed] Creating sample agent prompt bindings...')

  try {
    // Bind Writer agent to write_draft prompt
    await db.query(
      `INSERT INTO agent_prompt_bindings (
        agent_id, capability, company_prompt_template_id, is_active
      ) VALUES ($1, $2, $3, $4)`,
      [agentIds.writerId, 'write_draft', promptIds.writer_draft_id, true]
    )

    console.log(`[Seed] Bound Writer agent to write_draft prompt`)

    // Bind Writer agent to revise_draft prompt
    await db.query(
      `INSERT INTO agent_prompt_bindings (
        agent_id, capability, company_prompt_template_id, is_active
      ) VALUES ($1, $2, $3, $4)`,
      [agentIds.writerId, 'revise_draft', promptIds.writer_revise_id, true]
    )

    console.log(`[Seed] Bound Writer agent to revise_draft prompt`)

    // Bind Editor agent to review_content prompt
    await db.query(
      `INSERT INTO agent_prompt_bindings (
        agent_id, capability, company_prompt_template_id, is_active
      ) VALUES ($1, $2, $3, $4)`,
      [agentIds.editorId, 'review_content', promptIds.editor_review_id, true]
    )

    console.log(`[Seed] Bound Editor agent to review_content prompt`)

    console.log('[Seed] ✅ Agent bindings created successfully')
  } catch (error) {
    console.error('[Seed] ❌ Failed to create agent bindings:', error)
    throw error
  }
}
