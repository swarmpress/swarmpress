/**
 * YAML Service
 * Handles YAML serialization/deserialization for GitHub sync
 */

import * as yaml from 'js-yaml'
import type { Page, Blueprint, ContentModel } from '@swarm-press/shared'

/**
 * Serialize page to YAML format
 */
export function serializePageToYAML(page: Page): string {
  const yamlData = {
    id: page.id,
    slug: page.slug,
    title: page.title,
    page_type: page.page_type,
    status: page.status,
    priority: page.priority,
    parent_id: page.parent_id || null,
    order_index: page.order_index,
    blueprint_id: page.blueprint_id || null,
    content_model_id: page.content_model_id || null,
    topics: page.topics || [],
    seo: {
      primary_keyword: page.seo_profile?.primary_keyword || null,
      secondary_keywords: page.seo_profile?.secondary_keywords || [],
      intent: page.seo_profile?.intent || null,
      meta_description: page.seo_profile?.meta_description || null,
      canonical: page.seo_profile?.canonical || null,
      freshness_score: page.seo_profile?.freshness_score || null,
    },
    internal_links: {
      outgoing: (page.internal_links?.outgoing || []).map((link) => ({
        to: link.to,
        anchor: link.anchor,
        confidence: link.confidence || null,
      })),
      incoming: (page.internal_links?.incoming || []).map((link) => ({
        from: link.from,
        anchor: link.anchor,
      })),
    },
    owners: page.owners || {},
    metadata: {
      created_at: page.created_at,
      updated_at: page.updated_at,
    },
  }

  return yaml.dump(yamlData, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  })
}

/**
 * Deserialize YAML to page data
 */
export function deserializeYAMLToPage(yamlContent: string): Partial<Page> {
  const data = yaml.load(yamlContent) as any

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    page_type: data.page_type,
    status: data.status,
    priority: data.priority || 'medium',
    parent_id: data.parent_id,
    order_index: data.order_index || 0,
    blueprint_id: data.blueprint_id,
    content_model_id: data.content_model_id,
    topics: data.topics || [],
    seo_profile: {
      primary_keyword: data.seo?.primary_keyword,
      secondary_keywords: data.seo?.secondary_keywords || [],
      intent: data.seo?.intent,
      meta_description: data.seo?.meta_description,
      canonical: data.seo?.canonical,
      freshness_score: data.seo?.freshness_score,
    },
    internal_links: {
      outgoing: data.internal_links?.outgoing || [],
      incoming: data.internal_links?.incoming || [],
    },
    owners: data.owners || {},
  }
}

/**
 * Serialize blueprint to YAML format
 */
export function serializeBlueprintToYAML(blueprint: Blueprint): string {
  const yamlData = {
    id: blueprint.id,
    page_type: blueprint.page_type,
    name: blueprint.name,
    description: blueprint.description || null,
    version: blueprint.version || '1.0',
    layout: blueprint.layout || 'default',
    components: blueprint.components.map((comp) => ({
      type: comp.type,
      variant: comp.variant || null,
      order: comp.order,
      required: comp.required || false,
      required_fields: comp.required_fields || [],
      optional_fields: comp.optional_fields || [],
      ai_hints: comp.ai_hints || null,
      props: comp.props || {},
    })),
    linking_rules: blueprint.global_linking_rules || {},
    seo_template: blueprint.seo_template || {},
    metadata: {
      created_at: blueprint.created_at,
      updated_at: blueprint.updated_at,
    },
  }

  return yaml.dump(yamlData, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  })
}

/**
 * Deserialize YAML to blueprint data
 */
export function deserializeYAMLToBlueprint(yamlContent: string): Partial<Blueprint> {
  const data = yaml.load(yamlContent) as any

  return {
    id: data.id,
    page_type: data.page_type,
    name: data.name,
    description: data.description,
    version: data.version || '1.0',
    layout: data.layout || 'default',
    components: (data.components || []).map((comp: any, index: number) => ({
      id: `component-${index}`,
      type: comp.type,
      variant: comp.variant,
      order: comp.order || index,
      required: comp.required || false,
      required_fields: comp.required_fields || [],
      optional_fields: comp.optional_fields || [],
      ai_hints: comp.ai_hints || {},
      props: comp.props || {},
    })),
    global_linking_rules: data.linking_rules || {},
    seo_template: data.seo_template || {},
  }
}

/**
 * Serialize content model to YAML format
 */
export function serializeContentModelToYAML(model: ContentModel): string {
  const yamlData = {
    id: model.id,
    model_id: model.model_id,
    name: model.name,
    kind: model.kind,
    description: model.description || null,
    version: model.version || '1.0',
    fields: model.fields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      description: field.description || null,
      required: field.required || false,
      default: field.default || null,
      validations: field.validations || {},
      ai_hints: field.ai_hints || null,
    })),
    relations: model.relations || [],
    ai_guidance: model.ai_guidance || {},
    metadata: {
      created_at: model.created_at,
      updated_at: model.updated_at,
    },
  }

  return yaml.dump(yamlData, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  })
}

/**
 * Deserialize YAML to content model data
 */
export function deserializeYAMLToContentModel(yamlContent: string): Partial<ContentModel> {
  const data = yaml.load(yamlContent) as any

  return {
    id: data.id,
    model_id: data.model_id,
    name: data.name,
    kind: data.kind,
    description: data.description,
    version: data.version || '1.0',
    fields: data.fields || [],
    relations: data.relations || [],
    computed_fields: [],
    data_sources: [],
    ai_guidance: data.ai_guidance || {},
    tenants: {},
    validation: {},
    lifecycle: {},
    history: [],
  }
}

/**
 * Generate sitemap index YAML (lists all pages)
 */
export function generateSitemapIndex(pages: Page[]): string {
  const index = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    total_pages: pages.length,
    pages: pages.map((page) => ({
      id: page.id,
      slug: page.slug,
      title: page.title,
      page_type: page.page_type,
      status: page.status,
      file: `content/pages/${page.slug}.yaml`,
    })),
  }

  return yaml.dump(index, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  })
}
