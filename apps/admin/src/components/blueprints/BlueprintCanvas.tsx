/**
 * BlueprintCanvas Component
 * Sortable list of blueprint components
 */

import React, { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BlueprintComponent } from './BlueprintEditor'

interface BlueprintCanvasProps {
  components: BlueprintComponent[]
  onUpdateComponent: (id: string, updates: Partial<BlueprintComponent>) => void
  onRemoveComponent: (id: string) => void
}

export default function BlueprintCanvas({
  components,
  onUpdateComponent,
  onRemoveComponent,
}: BlueprintCanvasProps) {
  if (components.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
        <div className="text-6xl mb-4">🧩</div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Components Yet</h3>
        <p className="text-gray-600">
          Click components from the library to add them to your blueprint
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <span className="text-blue-600 text-xl">ℹ️</span>
          <div className="flex-1">
            <p className="text-sm text-blue-900 font-medium mb-1">Blueprint Preview</p>
            <p className="text-sm text-blue-700">
              This is how your page template will be structured. Drag components to reorder them.
            </p>
          </div>
        </div>
      </div>

      {components.map((component) => (
        <SortableComponentCard
          key={component.id}
          component={component}
          onUpdate={(updates) => onUpdateComponent(component.id, updates)}
          onRemove={() => onRemoveComponent(component.id)}
        />
      ))}
    </div>
  )
}

interface SortableComponentCardProps {
  component: BlueprintComponent
  onUpdate: (updates: Partial<BlueprintComponent>) => void
  onRemove: () => void
}

function SortableComponentCard({ component, onUpdate, onRemove }: SortableComponentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: component.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const componentIcons: Record<string, string> = {
    hero: '🎯',
    paragraph: '📝',
    heading: '📌',
    list: '📋',
    quote: '💬',
    image: '🖼️',
    gallery: '🎨',
    video: '🎬',
    cta: '🎯',
    form: '📝',
    accordion: '📁',
    tabs: '📑',
    faq: '❓',
    table: '📊',
    pricing: '💰',
    timeline: '⏱️',
    breadcrumbs: '🍞',
    'related-links': '🔗',
    'author-bio': '👤',
    'collection-embed': '📦',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white rounded-lg border-2 border-gray-200 hover:border-blue-300 transition-colors"
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
        >
          ⋮⋮
        </button>

        <span className="text-2xl">{componentIcons[component.type] || '🧩'}</span>

        <div className="flex-1">
          <div className="font-medium text-gray-900 capitalize">
            {component.type.replace('-', ' ')}
          </div>
          <div className="text-xs text-gray-500">Order: {component.order + 1}</div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={component.required || false}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            className="rounded text-blue-600 focus:ring-blue-500"
          />
          <span className="text-gray-700">Required</span>
        </label>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-2 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
        >
          {isExpanded ? '▼' : '▶'}
        </button>

        <button
          onClick={onRemove}
          className="p-2 text-red-400 hover:text-red-600 rounded-md hover:bg-red-50"
        >
          🗑️
        </button>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-4">
          {/* Collection Embed Specific Fields */}
          {component.type === 'collection-embed' && (
            <div className="bg-blue-50 rounded-md border border-blue-200 p-4 space-y-4">
              <h4 className="text-sm font-medium text-blue-900 mb-2">Collection Settings</h4>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Collection Type
                </label>
                <input
                  type="text"
                  value={component.props?.collectionType || ''}
                  onChange={(e) =>
                    onUpdate({ props: { ...component.props, collectionType: e.target.value } })
                  }
                  placeholder="e.g., events, pois, articles"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">The collection type identifier</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Heading
                </label>
                <input
                  type="text"
                  value={component.props?.heading || ''}
                  onChange={(e) =>
                    onUpdate({ props: { ...component.props, heading: e.target.value } })
                  }
                  placeholder="e.g., Upcoming Events, Featured Locations"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Layout
                  </label>
                  <select
                    value={component.props?.display?.layout || 'grid'}
                    onChange={(e) =>
                      onUpdate({
                        props: {
                          ...component.props,
                          display: { ...component.props?.display, layout: e.target.value },
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="grid">Grid</option>
                    <option value="list">List</option>
                    <option value="carousel">Carousel</option>
                    <option value="compact">Compact</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Columns
                  </label>
                  <select
                    value={component.props?.display?.columns || 3}
                    onChange={(e) =>
                      onUpdate({
                        props: {
                          ...component.props,
                          display: { ...component.props?.display, columns: parseInt(e.target.value) },
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Max Items
                  </label>
                  <input
                    type="number"
                    value={component.props?.maxItems || ''}
                    onChange={(e) =>
                      onUpdate({
                        props: { ...component.props, maxItems: parseInt(e.target.value) || undefined },
                      })
                    }
                    placeholder="12"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Image Aspect
                  </label>
                  <select
                    value={component.props?.display?.imageAspect || 'landscape'}
                    onChange={(e) =>
                      onUpdate({
                        props: {
                          ...component.props,
                          display: { ...component.props?.display, imageAspect: e.target.value },
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="landscape">Landscape (4:3)</option>
                    <option value="video">Video (16:9)</option>
                    <option value="square">Square (1:1)</option>
                    <option value="portrait">Portrait (3:4)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={component.props?.display?.showImage !== false}
                    onChange={(e) =>
                      onUpdate({
                        props: {
                          ...component.props,
                          display: { ...component.props?.display, showImage: e.target.checked },
                        },
                      })
                    }
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Show Images</span>
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={component.props?.display?.showSummary !== false}
                    onChange={(e) =>
                      onUpdate({
                        props: {
                          ...component.props,
                          display: { ...component.props?.display, showSummary: e.target.checked },
                        },
                      })
                    }
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Show Summary</span>
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={component.props?.display?.showDate !== false}
                    onChange={(e) =>
                      onUpdate({
                        props: {
                          ...component.props,
                          display: { ...component.props?.display, showDate: e.target.checked },
                        },
                      })
                    }
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Show Date</span>
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={component.props?.showViewAll !== false}
                    onChange={(e) =>
                      onUpdate({
                        props: { ...component.props, showViewAll: e.target.checked },
                      })
                    }
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Show "View All" Link</span>
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={component.props?.publishedOnly !== false}
                    onChange={(e) =>
                      onUpdate({
                        props: { ...component.props, publishedOnly: e.target.checked },
                      })
                    }
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Published Only</span>
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={component.props?.featuredOnly === true}
                    onChange={(e) =>
                      onUpdate({
                        props: { ...component.props, featuredOnly: e.target.checked },
                      })
                    }
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Featured Only</span>
                </label>
              </div>
            </div>
          )}

          {/* Variant (for non-collection-embed) */}
          {component.type !== 'collection-embed' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Variant
            </label>
            <input
              type="text"
              value={component.variant || ''}
              onChange={(e) => onUpdate({ variant: e.target.value })}
              placeholder="e.g., centered, wide, compact"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>
          )}

          {/* Required Fields */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Required Fields (comma-separated)
            </label>
            <input
              type="text"
              value={component.required_fields?.join(', ') || ''}
              onChange={(e) =>
                onUpdate({ required_fields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
              }
              placeholder="e.g., title, description, image"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Optional Fields */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Optional Fields (comma-separated)
            </label>
            <input
              type="text"
              value={component.optional_fields?.join(', ') || ''}
              onChange={(e) =>
                onUpdate({ optional_fields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
              }
              placeholder="e.g., subtitle, cta_text, background_color"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* AI Hints */}
          <div className="bg-white rounded-md border border-gray-200 p-3">
            <h4 className="text-sm font-medium text-gray-900 mb-3">AI Generation Hints</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Purpose</label>
                <input
                  type="text"
                  value={component.ai_hints?.purpose || ''}
                  onChange={(e) =>
                    onUpdate({ ai_hints: { ...component.ai_hints, purpose: e.target.value } })
                  }
                  placeholder="e.g., Introduce the main topic"
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Tone</label>
                <input
                  type="text"
                  value={component.ai_hints?.tone || ''}
                  onChange={(e) =>
                    onUpdate({ ai_hints: { ...component.ai_hints, tone: e.target.value } })
                  }
                  placeholder="e.g., professional, casual, enthusiastic"
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Min Words</label>
                  <input
                    type="number"
                    value={component.ai_hints?.min_words || ''}
                    onChange={(e) =>
                      onUpdate({
                        ai_hints: { ...component.ai_hints, min_words: parseInt(e.target.value) || undefined },
                      })
                    }
                    placeholder="50"
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Max Words</label>
                  <input
                    type="number"
                    value={component.ai_hints?.max_words || ''}
                    onChange={(e) =>
                      onUpdate({
                        ai_hints: { ...component.ai_hints, max_words: parseInt(e.target.value) || undefined },
                      })
                    }
                    placeholder="200"
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
