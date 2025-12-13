/**
 * BlueprintSelector Component
 * Select and preview blueprints for a page
 */

import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'

interface Blueprint {
  id: string
  name: string
  description?: string
  schema?: {
    page_type?: string
    components?: Array<{
      id: string
      type: string
      variant?: string
      order: number
      required?: boolean
      ai_hints?: {
        purpose?: string
        tone?: string
        min_words?: number
        max_words?: number
      }
    }>
    seo_template?: {
      title_pattern?: string
      meta_description_pattern?: string
      required_keywords?: string[]
    }
    global_linking_rules?: {
      min_total_links?: number
      max_total_links?: number
      must_link_to_page_type?: string[]
    }
  }
}

interface BlueprintSelectorProps {
  blueprints: Blueprint[]
  selectedBlueprintId?: string
  onSelect: (blueprintId: string) => void
}

const componentIcons: Record<string, string> = {
  hero: '🎯',
  header: '📋',
  features: '🧩',
  content: '📝',
  cta: '📣',
  stats: '📊',
  testimonials: '💬',
  faq: '❓',
  team: '👥',
  pricing: '💰',
  newsletter: '📧',
  contact: '📮',
  footer: '🦶',
  collection: '📦',
  gallery: '🖼️',
  blog: '📰',
}

export default function BlueprintSelector({
  blueprints,
  selectedBlueprintId,
  onSelect,
}: BlueprintSelectorProps) {
  const selectedBlueprint = blueprints.find((b) => b.id === selectedBlueprintId)

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Blueprint List */}
      <div className="col-span-1 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Select Blueprint</CardTitle>
            <CardDescription>
              Choose a page template to define structure
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* No Blueprint option */}
            <button
              onClick={() => onSelect('')}
              className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                !selectedBlueprintId
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📄</span>
                <div>
                  <div className="font-medium text-gray-900">No Blueprint</div>
                  <div className="text-sm text-gray-500">Custom page structure</div>
                </div>
              </div>
            </button>

            {blueprints.map((blueprint) => (
              <button
                key={blueprint.id}
                onClick={() => onSelect(blueprint.id)}
                className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                  selectedBlueprintId === blueprint.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📐</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {blueprint.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {blueprint.schema?.components?.length || 0} sections
                    </div>
                  </div>
                  {selectedBlueprintId === blueprint.id && (
                    <span className="text-blue-600">✓</span>
                  )}
                </div>
              </button>
            ))}

            <div className="pt-4 border-t">
              <a
                href="/blueprints/new"
                className="flex items-center justify-center gap-2 w-full p-3 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <span>+</span>
                <span>Create New Blueprint</span>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Blueprint Preview */}
      <div className="col-span-2">
        {selectedBlueprint ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{selectedBlueprint.name}</CardTitle>
                  {selectedBlueprint.description && (
                    <CardDescription className="mt-1">
                      {selectedBlueprint.description}
                    </CardDescription>
                  )}
                </div>
                <a
                  href={`/blueprints/${selectedBlueprint.id}`}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Edit Blueprint →
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Components Preview */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-3">Page Structure</h4>
                <div className="space-y-2">
                  {(selectedBlueprint.schema?.components || [])
                    .sort((a, b) => a.order - b.order)
                    .map((component, index) => (
                      <div
                        key={component.id}
                        className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                      >
                        <span className="text-gray-400 text-sm w-6">
                          {index + 1}.
                        </span>
                        <span className="text-xl">
                          {componentIcons[component.type] || '📦'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 capitalize">
                              {component.type.replace(/-/g, ' ')}
                            </span>
                            {component.variant && (
                              <Badge variant="outline" className="text-xs">
                                {component.variant}
                              </Badge>
                            )}
                            {component.required && (
                              <Badge variant="secondary" className="text-xs">
                                Required
                              </Badge>
                            )}
                          </div>
                          {component.ai_hints?.purpose && (
                            <p className="text-sm text-gray-500 truncate">
                              {component.ai_hints.purpose}
                            </p>
                          )}
                        </div>
                        {component.ai_hints && (
                          <div className="text-xs text-gray-400">
                            {component.ai_hints.min_words}-{component.ai_hints.max_words} words
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {/* SEO Template */}
              {selectedBlueprint.schema?.seo_template && (
                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">SEO Template</h4>
                  <div className="space-y-2 text-sm">
                    {selectedBlueprint.schema.seo_template.title_pattern && (
                      <div className="flex items-start gap-2">
                        <span className="text-gray-500 w-24">Title:</span>
                        <code className="text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                          {selectedBlueprint.schema.seo_template.title_pattern}
                        </code>
                      </div>
                    )}
                    {selectedBlueprint.schema.seo_template.required_keywords?.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-gray-500 w-24">Keywords:</span>
                        <div className="flex flex-wrap gap-1">
                          {selectedBlueprint.schema.seo_template.required_keywords.map((kw: string) => (
                            <Badge key={kw} variant="outline" className="text-xs">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Linking Rules */}
              {selectedBlueprint.schema?.global_linking_rules && (
                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Linking Rules</h4>
                  <div className="space-y-1 text-sm text-gray-600">
                    {selectedBlueprint.schema.global_linking_rules.min_total_links && (
                      <p>
                        Minimum {selectedBlueprint.schema.global_linking_rules.min_total_links} internal links
                      </p>
                    )}
                    {selectedBlueprint.schema.global_linking_rules.max_total_links && (
                      <p>
                        Maximum {selectedBlueprint.schema.global_linking_rules.max_total_links} internal links
                      </p>
                    )}
                    {selectedBlueprint.schema.global_linking_rules.must_link_to_page_type?.length > 0 && (
                      <p>
                        Must link to: {selectedBlueprint.schema.global_linking_rules.must_link_to_page_type.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="text-6xl mb-4">📄</div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Blueprint Selected</h3>
              <p className="text-gray-500 mb-6">
                Select a blueprint from the left to define this page's structure,
                or create content manually without a template.
              </p>
              <a
                href="/blueprints"
                className="text-blue-600 hover:text-blue-700"
              >
                Browse all blueprints →
              </a>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
