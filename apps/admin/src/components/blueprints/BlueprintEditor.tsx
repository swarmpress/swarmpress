/**
 * BlueprintEditor Component
 * Visual blueprint designer with drag-and-drop component builder
 */

import React, { useState, useEffect } from 'react'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'

import ComponentLibrary from './ComponentLibrary'
import BlueprintCanvas from './BlueprintCanvas'
import LinkingRulesEditor from './LinkingRulesEditor'
import SEOTemplateEditor from './SEOTemplateEditor'

interface BlueprintEditorProps {
  blueprintId?: string
}

export interface BlueprintComponent {
  id: string
  type: string
  variant?: string
  order: number
  required?: boolean
  required_fields?: string[]
  optional_fields?: string[]
  props?: Record<string, any>
  ai_hints?: {
    purpose?: string
    tone?: string
    min_words?: number
    max_words?: number
  }
}

export interface LinkingRules {
  min_links?: number
  max_links?: number
  min_total_links?: number
  max_total_links?: number
  must_link_to_page_type?: string[]
  forbidden_slugs?: string[]
}

export interface SEOTemplate {
  title_pattern?: string
  meta_description_pattern?: string
  required_keywords?: string[]
}

export interface Blueprint {
  id?: string
  page_type: string
  name: string
  description?: string
  version?: string
  layout?: string
  components: BlueprintComponent[]
  global_linking_rules?: LinkingRules
  seo_template?: SEOTemplate
}

export default function BlueprintEditor({ blueprintId }: BlueprintEditorProps) {
  const [blueprint, setBlueprint] = useState<Blueprint>({
    page_type: '',
    name: '',
    description: '',
    version: '1.0',
    layout: 'default',
    components: [],
    global_linking_rules: {},
    seo_template: {},
  })

  const [activeTab, setActiveTab] = useState<'components' | 'linking' | 'seo'>('components')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Load blueprint if editing
  useEffect(() => {
    if (blueprintId && blueprintId !== 'new') {
      loadBlueprint(blueprintId)
    }
  }, [blueprintId])

  async function loadBlueprint(id: string) {
    setIsLoading(true)
    try {
      // tRPC with SuperJSON requires input wrapped in {json: {...}}
      const response = await fetch(
        `/api/trpc/blueprint.getById?input=${encodeURIComponent(JSON.stringify({ json: { id } }))}`
      )
      const data = await response.json()
      // SuperJSON wraps response in result.data.json
      const rawBlueprint = data.result?.data?.json

      if (rawBlueprint) {
        // Database stores schema as JSONB, extract components and other fields from it
        const loadedBlueprint: Blueprint = {
          id: rawBlueprint.id,
          page_type: rawBlueprint.schema?.page_type || rawBlueprint.name?.toLowerCase().replace(/\s+/g, '_') || '',
          name: rawBlueprint.name,
          description: rawBlueprint.description,
          version: rawBlueprint.schema?.version || '1.0',
          layout: rawBlueprint.schema?.layout || 'default',
          components: (rawBlueprint.schema?.components || []).map((c: any, i: number) => ({
            id: c.id || `component-${i}`,
            type: c.type,
            variant: c.variant,
            order: c.order ?? i,
            required: c.required,
            required_fields: c.required_fields,
            optional_fields: c.optional_fields,
            props: c.props,
            ai_hints: c.ai_hints,
          })),
          global_linking_rules: rawBlueprint.schema?.global_linking_rules || {},
          seo_template: rawBlueprint.schema?.seo_template || {},
        }
        setBlueprint(loadedBlueprint)
      }
    } catch (error) {
      console.error('Failed to load blueprint:', error)
      alert('Failed to load blueprint')
    } finally {
      setIsLoading(false)
    }
  }

  async function saveBlueprint() {
    // Validation
    if (!blueprint.page_type.trim()) {
      alert('Please enter a page type')
      return
    }
    if (!blueprint.name.trim()) {
      alert('Please enter a blueprint name')
      return
    }

    setIsSaving(true)
    try {
      const url = blueprintId === 'new' ? '/api/blueprints' : `/api/blueprints/${blueprintId}`
      const method = blueprintId === 'new' ? 'POST' : 'PUT'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blueprint),
      })

      const data = await response.json()

      if (response.ok && data) {
        alert('Blueprint saved successfully!')
        if (blueprintId === 'new') {
          // Redirect to edit page
          window.location.href = `/blueprints/${data.id}`
        }
      } else {
        throw new Error(data.message || 'Failed to save blueprint')
      }
    } catch (error) {
      console.error('Failed to save blueprint:', error)
      alert(`Failed to save blueprint: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSaving(false)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (!over || active.id === over.id) return

    setBlueprint((prev) => {
      const oldIndex = prev.components.findIndex((c) => c.id === active.id)
      const newIndex = prev.components.findIndex((c) => c.id === over.id)

      if (oldIndex === -1 || newIndex === -1) return prev

      const newComponents = arrayMove(prev.components, oldIndex, newIndex)
      // Update order
      newComponents.forEach((c, i) => {
        c.order = i
      })

      return { ...prev, components: newComponents }
    })
  }

  function addComponent(type: string, variant?: string) {
    const newComponent: BlueprintComponent = {
      id: `component-${Date.now()}`,
      type,
      variant,
      order: blueprint.components.length,
      required: false,
      props: {},
    }

    setBlueprint((prev) => ({
      ...prev,
      components: [...prev.components, newComponent],
    }))
  }

  function updateComponent(id: string, updates: Partial<BlueprintComponent>) {
    setBlueprint((prev) => ({
      ...prev,
      components: prev.components.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }))
  }

  function removeComponent(id: string) {
    setBlueprint((prev) => ({
      ...prev,
      components: prev.components.filter((c) => c.id !== id),
    }))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-3 text-gray-600">Loading blueprint...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <input
                type="text"
                value={blueprint.name}
                onChange={(e) => setBlueprint({ ...blueprint, name: e.target.value })}
                placeholder="Blueprint Name"
                className="text-2xl font-bold border-0 focus:ring-0 p-0 w-full"
              />
              <div className="flex items-center gap-4 mt-2">
                <input
                  type="text"
                  value={blueprint.page_type}
                  onChange={(e) => setBlueprint({ ...blueprint, page_type: e.target.value })}
                  placeholder="page-type (e.g., article, landing)"
                  className="text-sm text-gray-600 border-0 focus:ring-0 p-0"
                />
                <input
                  type="text"
                  value={blueprint.version || ''}
                  onChange={(e) => setBlueprint({ ...blueprint, version: e.target.value })}
                  placeholder="Version"
                  className="text-sm text-gray-600 border-0 focus:ring-0 p-0 w-24"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/blueprints"
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              >
                Cancel
              </a>
              <button
                onClick={saveBlueprint}
                disabled={isSaving}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-400"
              >
                {isSaving ? 'Saving...' : 'Save Blueprint'}
              </button>
            </div>
          </div>

          {/* Description */}
          <textarea
            value={blueprint.description || ''}
            onChange={(e) => setBlueprint({ ...blueprint, description: e.target.value })}
            placeholder="Blueprint description..."
            className="w-full mt-4 text-sm text-gray-600 border-0 focus:ring-0 resize-none"
            rows={2}
          />

          {/* Tabs */}
          <div className="flex gap-6 mt-4 border-b -mb-px">
            <button
              onClick={() => setActiveTab('components')}
              className={`pb-3 px-1 border-b-2 font-medium transition-colors ${
                activeTab === 'components'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              🧩 Components ({blueprint.components.length})
            </button>
            <button
              onClick={() => setActiveTab('linking')}
              className={`pb-3 px-1 border-b-2 font-medium transition-colors ${
                activeTab === 'linking'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              🔗 Linking Rules
            </button>
            <button
              onClick={() => setActiveTab('seo')}
              className={`pb-3 px-1 border-b-2 font-medium transition-colors ${
                activeTab === 'seo'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              🎯 SEO Template
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {activeTab === 'components' && (
            <div className="grid grid-cols-12 gap-6">
              {/* Component Library */}
              <div className="col-span-3">
                <ComponentLibrary onAddComponent={addComponent} />
              </div>

              {/* Blueprint Canvas */}
              <div className="col-span-9">
                <SortableContext
                  items={blueprint.components.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <BlueprintCanvas
                    components={blueprint.components}
                    onUpdateComponent={updateComponent}
                    onRemoveComponent={removeComponent}
                  />
                </SortableContext>
              </div>
            </div>
          )}

          {activeTab === 'linking' && (
            <LinkingRulesEditor
              rules={blueprint.global_linking_rules || {}}
              onChange={(rules) => setBlueprint({ ...blueprint, global_linking_rules: rules })}
            />
          )}

          {activeTab === 'seo' && (
            <SEOTemplateEditor
              template={blueprint.seo_template || {}}
              onChange={(template) => setBlueprint({ ...blueprint, seo_template: template })}
            />
          )}
        </DndContext>
      </div>
    </div>
  )
}
