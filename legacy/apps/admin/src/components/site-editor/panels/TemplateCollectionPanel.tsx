'use client'

import { useState } from 'react'
import type {
  SiteDefinition,
  SitemapNode,
  ContentType,
  TemplatePage,
  InstanceOverride,
  InlinePrompt,
  SiteAIHints,
} from '@swarm-press/shared'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { Textarea } from '../../ui/textarea'
import { Badge } from '../../ui/badge'
import { Separator } from '../../ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs'
import { Switch } from '../../ui/switch'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible'
import {
  ChevronDown,
  ChevronRight,
  Layers,
  FileText,
  Users,
  Sparkles,
  Link2,
  Plus,
  Settings,
  AlertCircle,
} from 'lucide-react'
import { cn } from '../../../lib/utils'
import { InstanceOverrideDialog } from '../dialogs/InstanceOverrideDialog'

// Helper to get localized string value
function getLocalizedValue(
  value: string | Record<string, string> | undefined,
  locale = 'en'
): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value[locale] || value['en'] || Object.values(value)[0] || ''
}

interface TemplateCollectionPanelProps {
  node: SitemapNode
  contentType: ContentType
  siteDefinition: SiteDefinition
  onUpdate: (updates: Partial<SitemapNode>) => void
  onUpdateType: (updates: Partial<ContentType>) => void
}

export function TemplateCollectionPanel({
  node,
  contentType,
  siteDefinition,
  onUpdate,
  onUpdateType,
}: TemplateCollectionPanelProps) {
  const [activeTab, setActiveTab] = useState('structure')

  // Dialog state for instance override configuration
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedInstance, setSelectedInstance] = useState<{
    id: string
    name?: string
    override?: InstanceOverride
  } | null>(null)

  // Get template pages from contentType
  const templatePages = contentType.pageStructure?.pages || []

  // Get instance overrides from node data
  const instanceOverrides = node.data?.instanceOverrides || []

  // Helper to update nested node data
  const updateNodeData = (dataUpdates: Record<string, unknown>) => {
    onUpdate({ data: { ...node.data, ...dataUpdates } })
  }

  // Open dialog for an instance
  const openInstanceDialog = (instanceId: string, instanceName?: string) => {
    const existingOverride = instanceOverrides.find((o: InstanceOverride) => o.instanceId === instanceId)
    setSelectedInstance({ id: instanceId, name: instanceName, override: existingOverride })
    setDialogOpen(true)
  }

  // Handle saving override from dialog
  const handleSaveOverride = (override: InstanceOverride) => {
    const existingIndex = instanceOverrides.findIndex((o: InstanceOverride) => o.instanceId === override.instanceId)
    let newOverrides: InstanceOverride[]

    // Check if override has any actual content
    const hasContent = override.skipPages?.length || override.additionalPages?.length ||
                       (override.pageOverrides && Object.keys(override.pageOverrides).length)

    if (hasContent) {
      if (existingIndex >= 0) {
        // Update existing
        newOverrides = instanceOverrides.map((o: InstanceOverride, i: number) =>
          i === existingIndex ? override : o
        )
      } else {
        // Add new
        newOverrides = [...instanceOverrides, override]
      }
    } else {
      // Remove if no content
      newOverrides = instanceOverrides.filter((o: InstanceOverride) => o.instanceId !== override.instanceId)
    }

    updateNodeData({ instanceOverrides: newOverrides })
  }

  // Helper to update pageStructure
  const updatePageStructure = (structureUpdates: Partial<NonNullable<typeof contentType.pageStructure>>) => {
    onUpdateType({
      pageStructure: {
        pages: contentType.pageStructure?.pages || [],
        ...contentType.pageStructure,
        ...structureUpdates,
      },
    })
  }

  // Collection type name from node.type (e.g., "collection:villages" -> "villages")
  const collectionTypeName = node.type.replace('collection:', '')

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Layers className="h-5 w-5 text-purple-600" />
        <div className="flex-1">
          <h3 className="font-semibold">{contentType.name || collectionTypeName}</h3>
          <p className="text-xs text-muted-foreground">Template Collection</p>
        </div>
        <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
          {templatePages.length} pages
        </Badge>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="structure" className="text-xs">
            <FileText className="h-3 w-3 mr-1" />
            Structure
          </TabsTrigger>
          <TabsTrigger value="instances" className="text-xs">
            <Users className="h-3 w-3 mr-1" />
            Instances
          </TabsTrigger>
          <TabsTrigger value="prompts" className="text-xs">
            <Sparkles className="h-3 w-3 mr-1" />
            AI
          </TabsTrigger>
        </TabsList>

        {/* Structure Tab */}
        <TabsContent value="structure" className="mt-4 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-3">
              These template pages are automatically created for each collection instance.
            </p>

            {/* URL Pattern */}
            <div className="mb-4">
              <Label htmlFor="url-pattern" className="text-xs">URL Pattern</Label>
              <Input
                id="url-pattern"
                value={contentType.pageStructure?.urlPattern || '/{locale}/{instance.slug}/{page.slug}'}
                onChange={(e) => updatePageStructure({ urlPattern: e.target.value })}
                placeholder="/{locale}/{instance.slug}/{page.slug}"
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Placeholders: {'{locale}'}, {'{instance.slug}'}, {'{instance.id}'}, {'{page.slug}'}
              </p>
            </div>

            <Separator className="my-3" />

            {/* Template Pages List */}
            <div className="space-y-2">
              <Label className="text-xs">Template Pages</Label>
              {templatePages.map((page, index) => (
                <TemplatePageItem
                  key={page.slug}
                  page={page}
                  index={index}
                  locale={siteDefinition.defaultLocale}
                />
              ))}

              {templatePages.length === 0 && (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  No template pages defined
                </div>
              )}

              <Button variant="outline" size="sm" className="w-full mt-2">
                <Plus className="h-3 w-3 mr-1" />
                Add Template Page
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Instances Tab */}
        <TabsContent value="instances" className="mt-4 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-3">
              Configure per-instance overrides. You can skip pages, add custom pages, or customize prompts for specific instances.
            </p>

            {/* Instance Overrides List */}
            <div className="space-y-2">
              {instanceOverrides.length > 0 ? (
                instanceOverrides.map((override: InstanceOverride) => (
                  <InstanceOverrideItem
                    key={override.instanceId}
                    override={override}
                    templatePages={templatePages}
                    locale={siteDefinition.defaultLocale}
                    onUpdate={(updatedOverride) => {
                      const newOverrides = instanceOverrides.map((o: InstanceOverride) =>
                        o.instanceId === override.instanceId ? updatedOverride : o
                      )
                      updateNodeData({ instanceOverrides: newOverrides })
                    }}
                    onRemove={() => {
                      const newOverrides = instanceOverrides.filter(
                        (o: InstanceOverride) => o.instanceId !== override.instanceId
                      )
                      updateNodeData({ instanceOverrides: newOverrides })
                    }}
                    onConfigure={() => openInstanceDialog(override.instanceId)}
                  />
                ))
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No instance overrides configured</p>
                  <p className="text-xs mt-1">All instances use the default template</p>
                </div>
              )}

              <Button variant="outline" size="sm" className="w-full mt-2">
                <Plus className="h-3 w-3 mr-1" />
                Add Instance Override
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Prompts Tab */}
        <TabsContent value="prompts" className="mt-4 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-3">
              Default prompts applied to all template pages. Individual pages can override these settings.
            </p>

            <DefaultPromptsEditor
              prompts={contentType.pageStructure?.defaultPrompts}
              aiHints={contentType.ai_hints}
              onUpdatePrompts={(prompts) => updatePageStructure({ defaultPrompts: prompts })}
              onUpdateHints={(hints) => onUpdateType({ ai_hints: hints })}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Instance Override Dialog */}
      {selectedInstance && (
        <InstanceOverrideDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          instanceId={selectedInstance.id}
          instanceName={selectedInstance.name}
          templatePages={templatePages}
          existingOverride={selectedInstance.override}
          locale={siteDefinition.defaultLocale}
          onSave={handleSaveOverride}
        />
      )}
    </div>
  )
}

// ============================================================================
// Template Page Item
// ============================================================================

interface TemplatePageItemProps {
  page: TemplatePage
  index: number
  locale: string
}

function TemplatePageItem({ page, index, locale }: TemplatePageItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const title = getLocalizedValue(page.title, locale)
  const hasBinding = !!page.collectionBinding
  const hasPrompts = !!(page.prompts || page.ai_hints)
  const isRequired = page.required !== false

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 p-2 hover:bg-muted/50 text-left"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className={cn('flex-1 text-sm truncate', !isRequired && 'italic text-muted-foreground')}>
          {title || page.slug}
        </span>
        {hasBinding && (
          <span title="Collection binding">
            <Link2 className="h-3 w-3 text-orange-500" />
          </span>
        )}
        {hasPrompts && (
          <span title="AI prompts">
            <Sparkles className="h-3 w-3 text-purple-500" />
          </span>
        )}
        {!isRequired && (
          <Badge variant="outline" className="text-[10px]">Optional</Badge>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t bg-muted/30 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Slug:</span>{' '}
              <span className="font-mono">{page.slug}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Type:</span>{' '}
              <span>{page.pageType}</span>
            </div>
          </div>

          {hasBinding && (
            <div className="text-xs">
              <span className="text-muted-foreground">Binding:</span>{' '}
              <span className="font-mono text-orange-600">{page.collectionBinding?.collection}</span>
            </div>
          )}

          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 text-xs flex-1">
              <Settings className="h-3 w-3 mr-1" />
              Edit
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Instance Override Item
// ============================================================================

interface InstanceOverrideItemProps {
  override: InstanceOverride
  templatePages: TemplatePage[]
  locale: string
  onUpdate: (override: InstanceOverride) => void
  onRemove: () => void
  onConfigure: () => void
}

function InstanceOverrideItem({
  override,
  templatePages,
  locale,
  onUpdate,
  onRemove,
  onConfigure,
}: InstanceOverrideItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const skipCount = override.skipPages?.length || 0
  const additionalCount = override.additionalPages?.length || 0
  const overrideCount = Object.keys(override.pageOverrides || {}).length

  const hasCustomizations = skipCount > 0 || additionalCount > 0 || overrideCount > 0

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 p-2 hover:bg-muted/50 text-left"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="flex-1 text-sm font-medium">{override.instanceId}</span>
        {hasCustomizations && (
          <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-700 border-orange-200">
            {skipCount + additionalCount + overrideCount} changes
          </Badge>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t bg-muted/30 space-y-3">
          {/* Skipped Pages */}
          <div>
            <Label className="text-xs">Skip Pages</Label>
            <div className="space-y-1 mt-1">
              {templatePages.map((page) => {
                const isSkipped = override.skipPages?.includes(page.slug) || false
                const title = getLocalizedValue(page.title, locale)

                return (
                  <div key={page.slug} className="flex items-center gap-2">
                    <Switch
                      checked={!isSkipped}
                      onCheckedChange={(checked) => {
                        const newSkipPages = checked
                          ? (override.skipPages || []).filter((s) => s !== page.slug)
                          : [...(override.skipPages || []), page.slug]
                        onUpdate({ ...override, skipPages: newSkipPages })
                      }}
                    />
                    <span className={cn('text-xs', isSkipped && 'line-through text-muted-foreground')}>
                      {title || page.slug}
                    </span>
                    {isSkipped && (
                      <AlertCircle className="h-3 w-3 text-amber-500" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Additional Pages */}
          {additionalCount > 0 && (
            <div>
              <Label className="text-xs">Additional Pages</Label>
              <div className="space-y-1 mt-1">
                {override.additionalPages?.map((page) => (
                  <div key={page.slug} className="flex items-center gap-2 text-xs">
                    <Plus className="h-3 w-3 text-green-500" />
                    <span>{getLocalizedValue(page.title, locale) || page.slug}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 text-xs flex-1" onClick={onConfigure}>
              <Settings className="h-3 w-3 mr-1" />
              Configure
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Default Prompts Editor
// ============================================================================

interface DefaultPromptsEditorProps {
  prompts?: InlinePrompt
  aiHints?: SiteAIHints
  onUpdatePrompts: (prompts: InlinePrompt | undefined) => void
  onUpdateHints: (hints: SiteAIHints | undefined) => void
}

function DefaultPromptsEditor({
  prompts,
  aiHints,
  onUpdatePrompts,
  onUpdateHints,
}: DefaultPromptsEditorProps) {
  const updatePrompts = (updates: Partial<InlinePrompt>) => {
    onUpdatePrompts({ ...prompts, ...updates })
  }

  const updateHints = (updates: Partial<SiteAIHints>) => {
    onUpdateHints({ ...aiHints, ...updates })
  }

  return (
    <div className="space-y-4">
      {/* Quick hints */}
      <div>
        <Label htmlFor="purpose" className="text-xs">Purpose</Label>
        <Textarea
          id="purpose"
          value={aiHints?.purpose || ''}
          onChange={(e) => updateHints({ purpose: e.target.value })}
          placeholder="What is this collection for?"
          rows={2}
          className="text-xs"
        />
      </div>

      <div>
        <Label htmlFor="tone" className="text-xs">Tone</Label>
        <Input
          id="tone"
          value={aiHints?.tone || ''}
          onChange={(e) => updateHints({ tone: e.target.value })}
          placeholder="e.g., informative, friendly"
          className="text-xs"
        />
      </div>

      <div>
        <Label htmlFor="audience" className="text-xs">Target Audience</Label>
        <Input
          id="audience"
          value={aiHints?.audience || ''}
          onChange={(e) => updateHints({ audience: e.target.value })}
          placeholder="e.g., tourists, locals"
          className="text-xs"
        />
      </div>

      <Separator />

      {/* Advanced prompts */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium">
          <ChevronDown className="h-3 w-3" />
          Advanced Prompts
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          <div>
            <Label htmlFor="writing-prompt" className="text-xs">Writing Prompt</Label>
            <Textarea
              id="writing-prompt"
              value={prompts?.writingPrompt || ''}
              onChange={(e) => updatePrompts({ writingPrompt: e.target.value })}
              placeholder="How should the agent write content for this collection?"
              rows={3}
              className="text-xs font-mono"
            />
          </div>

          <div>
            <Label htmlFor="research-prompt" className="text-xs">Research Prompt</Label>
            <Textarea
              id="research-prompt"
              value={prompts?.researchPrompt || ''}
              onChange={(e) => updatePrompts({ researchPrompt: e.target.value })}
              placeholder="How should the agent research this content?"
              rows={3}
              className="text-xs font-mono"
            />
          </div>

          <div>
            <Label className="text-xs">Keywords (SEO)</Label>
            <Input
              value={aiHints?.keywords?.join(', ') || ''}
              onChange={(e) =>
                updateHints({
                  keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean),
                })
              }
              placeholder="keyword1, keyword2"
              className="text-xs"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
