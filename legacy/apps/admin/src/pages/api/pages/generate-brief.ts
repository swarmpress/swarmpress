/**
 * Generate Brief API
 * Creates a content brief for a page based on its blueprint
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

    // Get the blueprint if assigned
    let blueprint = null
    if (page.blueprint_id) {
      try {
        blueprint = await trpc.blueprint.getById.query({ id: page.blueprint_id })
      } catch (e) {
        console.warn('Blueprint not found:', page.blueprint_id)
      }
    }

    // Build the brief
    const brief = buildBrief(page, blueprint)

    // Check if content already exists
    const existingContent = await trpc.content.listByPage.query({ pageId })

    if (existingContent.items.length > 0) {
      // Update existing content with new brief
      const contentId = existingContent.items[0].id
      await trpc.content.update.mutate({
        id: contentId,
        metadata: {
          ...existingContent.items[0].metadata,
          content_brief: brief,
        } as any,
      })
    } else {
      // Create new content item with brief
      await trpc.content.create.mutate({
        website_id: websiteId,
        page_id: pageId,
        title: page.title,
        status: 'brief_created',
        body: [],
        metadata: {
          content_brief: brief,
          language: 'en',
          pageType: page.page_type,
        } as any,
      })
    }

    return new Response(
      JSON.stringify({ success: true, brief }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error generating brief:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate brief',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

function buildBrief(page: any, blueprint: any): string {
  let brief = `# Content Brief: ${page.title}\n\n`
  brief += `## Page Overview\n`
  brief += `- **Page Type**: ${page.page_type || 'general'}\n`
  brief += `- **URL**: /${page.slug}\n`
  brief += `- **Status**: ${page.status}\n\n`

  if (blueprint?.schema?.components?.length > 0) {
    brief += `## Page Structure (from Blueprint: ${blueprint.name})\n\n`

    const components = [...blueprint.schema.components].sort((a: any, b: any) => a.order - b.order)

    for (const component of components) {
      const requiredLabel = component.required ? ' (Required)' : ' (Optional)'
      const typeName = component.type.split('-').map((w: string) =>
        w.charAt(0).toUpperCase() + w.slice(1)
      ).join(' ')

      brief += `### ${component.order + 1}. ${typeName}${requiredLabel}\n`

      if (component.variant) {
        brief += `**Variant**: ${component.variant}\n`
      }

      if (component.ai_hints?.purpose) {
        brief += `**Purpose**: ${component.ai_hints.purpose}\n`
      }
      if (component.ai_hints?.tone) {
        brief += `**Tone**: ${component.ai_hints.tone}\n`
      }
      if (component.ai_hints?.min_words || component.ai_hints?.max_words) {
        brief += `**Word count**: ${component.ai_hints.min_words || 50}-${component.ai_hints.max_words || 200} words\n`
      }

      brief += '\n'
    }

    // SEO guidance
    if (blueprint.schema?.seo_template) {
      brief += `## SEO Requirements\n`
      if (blueprint.schema.seo_template.required_keywords?.length) {
        brief += `- Include keywords: ${blueprint.schema.seo_template.required_keywords.join(', ')}\n`
      }
      if (blueprint.schema.seo_template.keyword_density) {
        brief += `- Target keyword density: ${blueprint.schema.seo_template.keyword_density}%\n`
      }
      brief += '\n'
    }

    // Linking guidance
    if (blueprint.schema?.global_linking_rules) {
      const rules = blueprint.schema.global_linking_rules
      brief += `## Internal Linking\n`
      if (rules.min_total_links) {
        brief += `- Include at least ${rules.min_total_links} internal links\n`
      }
      if (rules.max_total_links) {
        brief += `- No more than ${rules.max_total_links} internal links\n`
      }
      if (rules.must_link_to_page_type?.length) {
        brief += `- Must link to: ${rules.must_link_to_page_type.join(', ')} pages\n`
      }
      brief += '\n'
    }
  } else {
    // No blueprint - generic brief
    brief += `## Content Guidelines\n`
    brief += `Create comprehensive, helpful content for this page.\n\n`
    brief += `### Suggested Sections\n`
    brief += `1. **Hero Section**: Compelling headline and introduction\n`
    brief += `2. **Main Content**: Detailed information about the topic\n`
    brief += `3. **Key Features/Highlights**: Bullet points or feature list\n`
    brief += `4. **FAQ Section**: Common questions and answers\n`
    brief += `5. **Call to Action**: Encourage user engagement\n\n`
  }

  // Writing guidelines
  brief += `## Writing Guidelines\n`
  brief += `1. Write engaging, informative content\n`
  brief += `2. Use clear headings and subheadings\n`
  brief += `3. Include practical information when relevant\n`
  brief += `4. Make content scannable with bullet points\n`
  brief += `5. Ensure accuracy and consistency\n`

  return brief
}
