/**
 * Generate Content API
 * Triggers the content generation workflow for a page
 */

import type { APIRoute } from 'astro'
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@swarm-press/backend'
import SuperJSON from 'superjson'

const trpc = createTRPCProxyClient<AppRouter>({
  transformer: SuperJSON,
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/api/trpc',
    }),
  ],
})

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { pageId, websiteId } = body

    if (!pageId || !websiteId) {
      return new Response(
        JSON.stringify({ success: false, error: 'pageId and websiteId are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get the page
    const page = await trpc.sitemap.getById.query({ id: pageId })
    if (!page) {
      return new Response(
        JSON.stringify({ success: false, error: 'Page not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get existing content with brief
    const existingContent = await trpc.content.listByPage.query({ pageId })

    if (existingContent.items.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Generate a brief first' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const content = existingContent.items[0]
    const brief = content.metadata?.content_brief

    if (!brief) {
      return new Response(
        JSON.stringify({ success: false, error: 'No brief found. Generate a brief first.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get blueprint for structure
    let blueprint = null
    if (page.blueprint_id) {
      try {
        blueprint = await trpc.blueprint.getById.query({ id: page.blueprint_id })
      } catch (e) {
        console.warn('Blueprint not found:', page.blueprint_id)
      }
    }

    // Generate content blocks based on blueprint or default structure
    const contentBlocks = generateContentBlocks(page, blueprint, brief)

    // Update content with generated blocks
    await trpc.content.update.mutate({
      id: content.id,
      body: contentBlocks,
      status: 'draft',
    })

    return new Response(
      JSON.stringify({ success: true, message: 'Content generated successfully' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error generating content:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate content',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

function generateContentBlocks(page: any, blueprint: any, brief: string): any[] {
  const blocks: any[] = []

  if (blueprint?.schema?.components?.length > 0) {
    // Generate blocks based on blueprint structure
    const components = [...blueprint.schema.components].sort((a: any, b: any) => a.order - b.order)

    for (const component of components) {
      const block = generateBlockFromComponent(component, page)
      if (block) {
        blocks.push(block)
      }
    }
  } else {
    // Default structure without blueprint
    blocks.push({
      type: 'hero',
      title: { en: page.title },
      subtitle: { en: `Discover everything about ${page.title}` },
    })

    blocks.push({
      type: 'paragraph',
      content: `[AI: Write an engaging introduction for ${page.title}. This content should be replaced by the AI writer agent with actual content based on the brief.]`,
    })

    blocks.push({
      type: 'features',
      title: { en: 'Key Highlights' },
      features: [
        {
          title: { en: 'Feature 1' },
          description: { en: '[AI: Describe first key feature]' },
          icon: 'star',
        },
        {
          title: { en: 'Feature 2' },
          description: { en: '[AI: Describe second key feature]' },
          icon: 'heart',
        },
        {
          title: { en: 'Feature 3' },
          description: { en: '[AI: Describe third key feature]' },
          icon: 'check',
        },
      ],
    })

    blocks.push({
      type: 'faq',
      title: { en: 'Frequently Asked Questions' },
      items: [
        {
          question: { en: '[AI: Common question 1]' },
          answer: { en: '[AI: Answer to question 1]' },
        },
        {
          question: { en: '[AI: Common question 2]' },
          answer: { en: '[AI: Answer to question 2]' },
        },
      ],
    })
  }

  return blocks
}

function generateBlockFromComponent(component: any, page: any): any {
  const { type, variant, ai_hints } = component

  switch (type) {
    case 'hero':
      return {
        type: 'hero',
        variant,
        title: { en: page.title },
        subtitle: { en: ai_hints?.purpose || `Welcome to ${page.title}` },
        cta: {
          text: { en: 'Learn More' },
          href: '#main-content',
        },
      }

    case 'features':
      return {
        type: 'features',
        variant,
        title: { en: 'Key Features' },
        features: [
          {
            title: { en: '[AI: Feature 1 title]' },
            description: { en: '[AI: Feature 1 description]' },
            icon: 'star',
          },
          {
            title: { en: '[AI: Feature 2 title]' },
            description: { en: '[AI: Feature 2 description]' },
            icon: 'heart',
          },
          {
            title: { en: '[AI: Feature 3 title]' },
            description: { en: '[AI: Feature 3 description]' },
            icon: 'check',
          },
        ],
      }

    case 'content':
      return {
        type: 'paragraph',
        content: `[AI: Write content based on purpose: "${ai_hints?.purpose || 'Provide detailed information'}". Tone: ${ai_hints?.tone || 'professional'}. Word count: ${ai_hints?.min_words || 100}-${ai_hints?.max_words || 300} words.]`,
      }

    case 'stats':
      return {
        type: 'stats',
        variant,
        stats: [
          { value: '100+', label: { en: '[AI: Stat 1]' } },
          { value: '50+', label: { en: '[AI: Stat 2]' } },
          { value: '24/7', label: { en: '[AI: Stat 3]' } },
        ],
      }

    case 'faq':
      return {
        type: 'faq',
        variant,
        title: { en: 'Frequently Asked Questions' },
        items: [
          {
            question: { en: '[AI: Question 1 about ' + page.title + ']' },
            answer: { en: '[AI: Answer 1]' },
          },
          {
            question: { en: '[AI: Question 2 about ' + page.title + ']' },
            answer: { en: '[AI: Answer 2]' },
          },
        ],
      }

    case 'testimonials':
      return {
        type: 'testimonials',
        variant,
        testimonials: [
          {
            quote: { en: '[AI: Generate testimonial quote]' },
            author: 'Happy Customer',
            role: { en: 'Visitor' },
          },
        ],
      }

    case 'cta':
      return {
        type: 'cta',
        variant,
        title: { en: ai_hints?.purpose || 'Ready to Get Started?' },
        description: { en: '[AI: Write compelling CTA description]' },
        primaryButton: {
          text: { en: 'Get Started' },
          href: '#',
        },
      }

    case 'collection':
      return {
        type: 'collection',
        variant,
        heading: { en: 'Related Items' },
        emptyMessage: { en: 'No items found' },
      }

    default:
      return {
        type: 'paragraph',
        content: `[AI: Generate ${type} content. Purpose: ${ai_hints?.purpose || 'informational'}]`,
      }
  }
}
