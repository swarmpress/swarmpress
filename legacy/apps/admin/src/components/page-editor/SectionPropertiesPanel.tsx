'use client'

import { useState } from 'react'
import type { PageSection, InlinePrompt, CollectionSource } from '@swarm-press/shared'
import { getSectionDefinition } from '@swarm-press/shared'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { PromptsEditor } from './PromptsEditor'
import type { AssignedAgentInfo } from './PromptsEditor'
import { CollectionEditor } from './CollectionEditor'
import { SlugPicker } from './SlugPicker'
import {
  Settings,
  Sparkles,
  Database,
  FileJson,
  LayoutTemplate,
} from 'lucide-react'

interface SectionPropertiesPanelProps {
  section: PageSection | null
  onUpdateSection: (updates: Partial<PageSection>) => void
  onUpdatePrompts: (prompts: InlinePrompt | undefined) => void
  onUpdateCollectionSource: (source: CollectionSource | undefined) => void
  /** Assigned agents for the current page */
  assignedAgents?: AssignedAgentInfo[]
  /** Inherited perspective from page/parent */
  inheritedPerspective?: 'first_person' | 'second_person' | 'third_person'
  /** Website ID for API calls */
  websiteId?: string
}

export function SectionPropertiesPanel({
  section,
  onUpdateSection,
  onUpdatePrompts,
  onUpdateCollectionSource,
  assignedAgents,
  inheritedPerspective = 'third_person',
  websiteId,
}: SectionPropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState('general')

  if (!section) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <LayoutTemplate className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="font-medium text-muted-foreground">No Section Selected</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Select a section from the list to edit its properties
        </p>
      </div>
    )
  }

  const definition = getSectionDefinition(section.type)
  const supportsCollections = definition?.supportsCollections ?? false

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">
          {definition?.label || section.type}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          {section.variant || 'Default variant'}
        </p>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="w-full justify-start px-4 py-2 h-auto border-b rounded-none bg-transparent">
          <TabsTrigger
            value="general"
            className="text-xs data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800"
          >
            <Settings className="h-3 w-3 mr-1.5" />
            General
          </TabsTrigger>
          <TabsTrigger
            value="prompts"
            className="text-xs data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800"
          >
            <Sparkles className="h-3 w-3 mr-1.5" />
            Prompts
          </TabsTrigger>
          {supportsCollections && (
            <TabsTrigger
              value="collection"
              className="text-xs data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800"
            >
              <Database className="h-3 w-3 mr-1.5" />
              Collection
            </TabsTrigger>
          )}
          <TabsTrigger
            value="content"
            className="text-xs data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800"
          >
            <FileJson className="h-3 w-3 mr-1.5" />
            Content
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto">
          {/* General Tab */}
          <TabsContent value="general" className="p-4 m-0 space-y-4">
            {/* Section ID */}
            <div className="space-y-2">
              <Label htmlFor="section-id" className="text-xs">
                Section ID
              </Label>
              <Input
                id="section-id"
                value={section.id}
                className="h-8 text-sm font-mono"
                disabled
              />
              <p className="text-[10px] text-muted-foreground">
                Auto-generated unique identifier
              </p>
            </div>

            {/* Variant Selection */}
            <div className="space-y-2">
              <Label className="text-xs">Variant</Label>
              <Select
                value={section.variant || definition?.defaultVariant}
                onValueChange={(value) => onUpdateSection({ variant: value })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select variant" />
                </SelectTrigger>
                <SelectContent>
                  {definition?.variants.map((variant) => (
                    <SelectItem key={variant.id} value={variant.id}>
                      {variant.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Locked Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="locked" className="text-xs">
                  Locked
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Prevent accidental edits
                </p>
              </div>
              <Switch
                id="locked"
                checked={section.locked ?? false}
                onCheckedChange={(checked) =>
                  onUpdateSection({ locked: checked })
                }
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes" className="text-xs">
                Internal Notes
              </Label>
              <textarea
                id="notes"
                value={section.notes || ''}
                onChange={(e) => onUpdateSection({ notes: e.target.value })}
                className="w-full h-20 px-3 py-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Add notes for editors..."
              />
            </div>
          </TabsContent>

          {/* Prompts Tab */}
          <TabsContent value="prompts" className="p-4 m-0">
            <PromptsEditor
              prompts={section.prompts}
              aiHints={section.ai_hints}
              onChange={(prompts, aiHints) => {
                onUpdatePrompts(prompts)
                if (aiHints !== undefined) {
                  onUpdateSection({ ai_hints: aiHints })
                }
              }}
              assignedAgents={assignedAgents}
              inheritedPerspective={inheritedPerspective}
              sectionType={section.type}
            />
          </TabsContent>

          {/* Collection Tab */}
          {supportsCollections && (
            <TabsContent value="collection" className="p-4 m-0">
              {section.type === 'collection-with-interludes' ? (
                /* Special editor for collection-with-interludes */
                <SlugPicker
                  collectionType={(section.content as Record<string, unknown>)?.collectionType as string || ''}
                  selectedSlugs={(section.content as Record<string, unknown>)?.slugs as string[] || []}
                  village={(section.content as Record<string, unknown>)?.village as string | undefined}
                  availableCollectionTypes={definition?.collectionTypes || []}
                  websiteId={websiteId || ''}
                  onCollectionTypeChange={(type) => {
                    const content = section.content as Record<string, unknown> || {}
                    onUpdateSection({
                      content: { ...content, collectionType: type, type: 'collection-with-interludes' }
                    })
                  }}
                  onVillageChange={(village) => {
                    const content = section.content as Record<string, unknown> || {}
                    onUpdateSection({
                      content: { ...content, village, type: 'collection-with-interludes' }
                    })
                  }}
                  onSlugsChange={(slugs) => {
                    const content = section.content as Record<string, unknown> || {}
                    onUpdateSection({
                      content: { ...content, slugs, type: 'collection-with-interludes' }
                    })
                  }}
                />
              ) : (
                /* Standard collection editor for other section types */
                <CollectionEditor
                  collectionSource={section.collectionSource}
                  availableCollections={definition?.collectionTypes || []}
                  onChange={onUpdateCollectionSource}
                />
              )}
            </TabsContent>
          )}

          {/* Content Tab (JSON) */}
          <TabsContent value="content" className="p-4 m-0">
            <div className="space-y-2">
              <Label className="text-xs">Content (JSON)</Label>
              <p className="text-[10px] text-muted-foreground mb-2">
                Raw section content data. Edit with caution.
              </p>
              <ContentJsonEditor
                content={section.content}
                onChange={(content) => onUpdateSection({ content })}
              />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

// Simple JSON editor for content tab
function ContentJsonEditor({
  content,
  onChange,
}: {
  content?: Record<string, unknown>
  onChange: (content: Record<string, unknown>) => void
}) {
  const [value, setValue] = useState(JSON.stringify(content || {}, null, 2))
  const [error, setError] = useState<string | null>(null)

  const handleChange = (newValue: string) => {
    setValue(newValue)
    try {
      const parsed = JSON.parse(newValue)
      setError(null)
      onChange(parsed)
    } catch (e) {
      setError('Invalid JSON')
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full h-64 px-3 py-2 text-sm font-mono border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        spellCheck={false}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
