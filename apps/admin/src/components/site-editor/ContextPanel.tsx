'use client'

import { useState } from 'react'
import type { SiteDefinition, SitemapNode, ContentType, PromptTemplate, InlinePrompt } from '@swarm-press/shared'
import { TemplateCollectionPanel } from './panels/TemplateCollectionPanel'

// Helper to check if collection has pageStructure
function hasPageStructure(contentType: ContentType | undefined): boolean {
  return !!(contentType?.pageStructure?.pages && contentType.pageStructure.pages.length > 0)
}

// Helper to get localized string value
function getLocalizedValue(value: string | Record<string, string> | undefined, locale = 'en'): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value[locale] || ''
}

// Helper to set localized string value
function setLocalizedValue(
  current: string | Record<string, string> | undefined,
  newValue: string,
  locale = 'en'
): Record<string, string> {
  if (typeof current === 'string') {
    return { [locale]: newValue }
  }
  return { ...current, [locale]: newValue }
}
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { ScrollArea } from '../ui/scroll-area'
import { Separator } from '../ui/separator'
import { Badge } from '../ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible'
import {
  ChevronDown,
  Settings,
  FileText,
  Database,
  Globe,
  Sparkles,
  Search,
  Pencil,
  Eye,
  Link2,
  X,
} from 'lucide-react'
import { cn } from '../../lib/utils'

type SelectionData =
  | { type: 'none' }
  | { type: 'site'; data: SiteDefinition }
  | { type: 'page'; data: SitemapNode; contentType?: ContentType }
  | { type: 'collection'; data: SitemapNode; contentType?: ContentType }
  | { type: 'contentType'; data: ContentType }

interface ContextPanelProps {
  selection: SelectionData | null
  siteDefinition: SiteDefinition
  onUpdatePage: (nodeId: string, updates: Partial<SitemapNode>) => void
  onUpdateType: (typeId: string, updates: Partial<ContentType>) => void
  onUpdateSite: (updates: Partial<SiteDefinition>) => void
}

export function ContextPanel({
  selection,
  siteDefinition,
  onUpdatePage,
  onUpdateType,
  onUpdateSite,
}: ContextPanelProps) {
  if (!selection || selection.type === 'none') {
    return (
      <div className="w-80 border-l bg-background p-4">
        <div className="text-center text-muted-foreground py-8">
          <Settings className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select a node to edit</p>
          <p className="text-xs mt-1">or click the canvas for site settings</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-80 border-l bg-background flex flex-col h-full">
      <ScrollArea className="flex-1">
        {selection.type === 'site' && (
          <SiteSettingsPanel
            site={selection.data}
            onUpdate={onUpdateSite}
          />
        )}
        {selection.type === 'page' && (
          <PageNodePanel
            node={selection.data}
            contentType={selection.contentType}
            siteDefinition={siteDefinition}
            onUpdate={(updates) => onUpdatePage(selection.data.id, updates)}
          />
        )}
        {selection.type === 'collection' && (
          hasPageStructure(selection.contentType) ? (
            <TemplateCollectionPanel
              node={selection.data}
              contentType={selection.contentType!}
              siteDefinition={siteDefinition}
              onUpdate={(updates) => onUpdatePage(selection.data.id, updates)}
              onUpdateType={(updates) => {
                const typeId = selection.data.type
                onUpdateType(typeId, updates)
              }}
            />
          ) : (
            <CollectionNodePanel
              node={selection.data}
              contentType={selection.contentType}
              onUpdate={(updates) => onUpdatePage(selection.data.id, updates)}
            />
          )
        )}
        {selection.type === 'contentType' && (
          <ContentTypePanel
            type={selection.data}
            onUpdate={(updates) => onUpdateType(selection.data.id, updates)}
          />
        )}
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// Site Settings Panel
// ============================================================================

function SiteSettingsPanel({
  site,
  onUpdate,
}: {
  site: SiteDefinition
  onUpdate: (updates: Partial<SiteDefinition>) => void
}) {
  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="font-semibold flex items-center gap-2 mb-4">
          <Globe className="h-4 w-4" />
          Site Settings
        </h3>

        <div className="space-y-4">
          <div>
            <Label htmlFor="site-name">Site Name</Label>
            <Input
              id="site-name"
              value={site.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="site-description">Description</Label>
            <Textarea
              id="site-description"
              value={site.description || ''}
              onChange={(e) => onUpdate({ description: e.target.value })}
              rows={3}
            />
          </div>

          <div>
            <Label>Default Locale</Label>
            <Select
              value={site.defaultLocale}
              onValueChange={(value) => onUpdate({ defaultLocale: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {site.locales.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {locale.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Locales</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {site.locales.map((locale) => (
                <Badge key={locale} variant="secondary">
                  {locale}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Agent Config */}
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-sm font-medium">
          <ChevronDown className="h-4 w-4" />
          <Sparkles className="h-4 w-4" />
          Agent Configuration
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-research">Auto Research</Label>
            <input
              id="auto-research"
              type="checkbox"
              checked={site.agentConfig?.contentProduction?.autoResearch ?? true}
              onChange={(e) =>
                onUpdate({
                  agentConfig: {
                    ...site.agentConfig,
                    contentProduction: {
                      ...site.agentConfig?.contentProduction,
                      autoResearch: e.target.checked,
                    },
                  },
                })
              }
              className="h-4 w-4"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="seo-enabled">SEO Enabled</Label>
            <input
              id="seo-enabled"
              type="checkbox"
              checked={site.agentConfig?.seo?.enabled ?? true}
              onChange={(e) =>
                onUpdate({
                  agentConfig: {
                    ...site.agentConfig,
                    seo: {
                      ...site.agentConfig?.seo,
                      enabled: e.target.checked,
                    },
                  },
                })
              }
              className="h-4 w-4"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="require-approval">Require Approval</Label>
            <input
              id="require-approval"
              type="checkbox"
              checked={site.agentConfig?.publishing?.requireApproval ?? true}
              onChange={(e) =>
                onUpdate({
                  agentConfig: {
                    ...site.agentConfig,
                    publishing: {
                      ...site.agentConfig?.publishing,
                      requireApproval: e.target.checked,
                    },
                  },
                })
              }
              className="h-4 w-4"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* Stats */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>Version: {site.version}</p>
        <p>Page Types: {Object.keys(site.types.pages || {}).length}</p>
        <p>Collection Types: {Object.keys(site.types.collections || {}).length}</p>
        <p>Sitemap Nodes: {site.sitemap.nodes.length}</p>
        {site.updatedAt && <p>Updated: {new Date(site.updatedAt).toLocaleString()}</p>}
      </div>
    </div>
  )
}

// ============================================================================
// Page Node Panel
// ============================================================================

function PageNodePanel({
  node,
  contentType,
  siteDefinition,
  onUpdate,
}: {
  node: SitemapNode
  contentType?: ContentType
  siteDefinition: SiteDefinition
  onUpdate: (updates: Partial<SitemapNode>) => void
}) {
  const [activeTab, setActiveTab] = useState('general')

  // Helper to update nested data
  const updateData = (dataUpdates: Record<string, any>) => {
    onUpdate({ data: { ...node.data, ...dataUpdates } })
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{contentType?.icon || '📄'}</span>
        <div className="flex-1">
          <h3 className="font-semibold">{getLocalizedValue(node.data?.title) || node.data?.slug || 'Untitled'}</h3>
          <p className="text-xs text-muted-foreground">{contentType?.name || node.type}</p>
        </div>
        <Badge variant="outline">{node.data?.status || 'draft'}</Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="prompts">
            <Sparkles className="h-3 w-3 mr-1" />
            AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <div>
            <Label htmlFor="page-slug">Slug</Label>
            <Input
              id="page-slug"
              value={node.data?.slug || ''}
              onChange={(e) => updateData({ slug: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="page-title">Title (EN)</Label>
            <Input
              id="page-title"
              value={getLocalizedValue(node.data?.title)}
              onChange={(e) =>
                updateData({ title: setLocalizedValue(node.data?.title, e.target.value) })
              }
            />
          </div>

          <div>
            <Label>Status</Label>
            <Select
              value={node.data?.status || 'draft'}
              onValueChange={(value) => updateData({ status: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="in_review">In Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Content Type</Label>
            <Select
              value={node.type}
              onValueChange={(value) => onUpdate({ type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {siteDefinition.types.pages && Object.entries(siteDefinition.types.pages)
                  .map(([id, type]) => (
                    <SelectItem key={id} value={id}>
                      {type.icon} {type.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </TabsContent>

        <TabsContent value="prompts" className="mt-4">
          <PromptEditor
            prompts={node.data?.prompts}
            aiHints={contentType?.ai_hints}
            inheritedPrompts={contentType?.prompts}
            inheritedHints={contentType?.ai_hints}
            onUpdate={(prompts, aiHints) =>
              updateData({ prompts })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================================================
// Collection Node Panel
// ============================================================================

function CollectionNodePanel({
  node,
  contentType,
  onUpdate,
}: {
  node: SitemapNode
  contentType?: ContentType
  onUpdate: (updates: Partial<SitemapNode>) => void
}) {
  // Helper to update nested data
  const updateData = (dataUpdates: Record<string, any>) => {
    onUpdate({ data: { ...node.data, ...dataUpdates } })
  }

  // Get collection type name from node.type (e.g., "collection:restaurants" -> "restaurants")
  const collectionType = node.type.replace('collection:', '')

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <Database className="h-5 w-5 text-orange-500" />
        <div className="flex-1">
          <h3 className="font-semibold">{contentType?.name || collectionType}</h3>
          <p className="text-xs text-muted-foreground">Collection</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Entity Type</Label>
          <div className="flex items-center gap-2 mt-1">
            <span>{contentType?.icon}</span>
            <span className="text-sm">{contentType?.name || collectionType}</span>
          </div>
        </div>

        <Separator />

        <div>
          <Label className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Filter
          </Label>
          <p className="text-xs text-muted-foreground mt-1 mb-2">
            Filter which items appear in this collection
          </p>
          <Textarea
            value={node.data?.filter ? JSON.stringify(node.data.filter, null, 2) : ''}
            onChange={(e) => {
              try {
                const filter = e.target.value ? JSON.parse(e.target.value) : undefined
                updateData({ filter })
              } catch {
                // Invalid JSON, ignore
              }
            }}
            placeholder='{ "village": "Monterosso" }'
            rows={4}
            className="font-mono text-xs"
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Content Type Panel
// ============================================================================

function ContentTypePanel({
  type,
  onUpdate,
}: {
  type: ContentType
  onUpdate: (updates: Partial<ContentType>) => void
}) {
  const [activeTab, setActiveTab] = useState('general')

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{type.icon || '📄'}</span>
        <div className="flex-1">
          <h3 className="font-semibold">{type.name}</h3>
          <p className="text-xs text-muted-foreground">
            {type.kind === 'entity' ? 'Entity Type' : 'Page Type'}
          </p>
        </div>
        <Badge
          variant="outline"
          style={{ backgroundColor: type.color ? `${type.color}20` : undefined }}
        >
          {type.kind}
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="prompts">
            <Sparkles className="h-3 w-3 mr-1" />
            AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <div>
            <Label htmlFor="type-name">Name</Label>
            <Input
              id="type-name"
              value={type.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="type-icon">Icon</Label>
            <Input
              id="type-icon"
              value={type.icon || ''}
              onChange={(e) => onUpdate({ icon: e.target.value })}
              placeholder="📄"
            />
          </div>

          <div>
            <Label htmlFor="type-color">Color</Label>
            <div className="flex gap-2">
              <Input
                id="type-color"
                type="color"
                value={type.color || '#3b82f6'}
                onChange={(e) => onUpdate({ color: e.target.value })}
                className="w-12 h-9 p-1"
              />
              <Input
                value={type.color || ''}
                onChange={(e) => onUpdate({ color: e.target.value })}
                placeholder="#3b82f6"
                className="flex-1"
              />
            </div>
          </div>

          <div>
            <Label>Kind</Label>
            <Select
              value={type.kind}
              onValueChange={(value) => onUpdate({ kind: value as 'page' | 'entity' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="page">Page</SelectItem>
                <SelectItem value="entity">Entity</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TabsContent>

        <TabsContent value="schema" className="mt-4">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {type.kind === 'page'
                ? 'Define sections that make up this page type'
                : 'Define fields for this entity type'}
            </p>

            {type.kind === 'page' && type.schema?.sections && (
              <div className="space-y-2">
                <Label>Sections</Label>
                {type.schema.sections.map((section, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm"
                  >
                    <span className="flex-1">{section.type}</span>
                    {section.required && (
                      <Badge variant="secondary" className="text-xs">
                        Required
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            {type.kind === 'entity' && type.schema?.fields && (
              <div className="space-y-2">
                <Label>Fields</Label>
                {type.schema.fields.map((field, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm"
                  >
                    <span className="flex-1 font-mono">{field.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {field.type}
                    </Badge>
                    {field.required && (
                      <Badge variant="secondary" className="text-xs">
                        Required
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" className="w-full">
              Edit Schema
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="prompts" className="mt-4">
          <PromptEditor
            prompts={type.prompts}
            aiHints={type.ai_hints}
            onUpdate={(prompts, aiHints) =>
              onUpdate({ prompts, ai_hints: aiHints })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================================================
// Prompt Editor (Shared Component)
// ============================================================================

interface PromptEditorProps {
  prompts?: PromptTemplate
  aiHints?: { purpose?: string; tone?: string; audience?: string; contentGuidelines?: string[] }
  inheritedPrompts?: PromptTemplate
  inheritedHints?: { purpose?: string; tone?: string; audience?: string; contentGuidelines?: string[] }
  onUpdate: (
    prompts: PromptTemplate | undefined,
    aiHints: { purpose?: string; tone?: string; audience?: string; contentGuidelines?: string[] } | undefined
  ) => void
}

function PromptEditor({
  prompts,
  aiHints,
  inheritedPrompts,
  inheritedHints,
  onUpdate,
}: PromptEditorProps) {
  const [mode, setMode] = useState<'quick' | 'advanced'>('quick')

  // Check if using reference or inline prompts
  const isReference = prompts && 'type' in prompts && prompts.type === 'reference'
  const inlinePrompts = (isReference ? undefined : prompts) as InlinePrompt | undefined

  const effectiveHints = aiHints || inheritedHints
  const effectivePrompts = inlinePrompts || (inheritedPrompts && !('type' in inheritedPrompts) ? inheritedPrompts : undefined)

  const updateHints = (updates: Partial<typeof aiHints>) => {
    onUpdate(prompts, { ...aiHints, ...updates })
  }

  const updateInlinePrompts = (updates: Partial<InlinePrompt>) => {
    const newPrompts: InlinePrompt = { ...inlinePrompts, ...updates }
    onUpdate(newPrompts, aiHints)
  }

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'quick' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('quick')}
        >
          Quick Setup
        </Button>
        <Button
          variant={mode === 'advanced' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('advanced')}
        >
          Advanced
        </Button>
      </div>

      {/* Inherited indicator */}
      {(inheritedPrompts || inheritedHints) && !prompts && !aiHints && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted p-2 rounded-md">
          <Link2 className="h-3 w-3" />
          <span>Inheriting from content type defaults</span>
        </div>
      )}

      {mode === 'quick' ? (
        <div className="space-y-4">
          <div>
            <Label htmlFor="ai-purpose">Purpose</Label>
            <Textarea
              id="ai-purpose"
              value={aiHints?.purpose || ''}
              onChange={(e) => updateHints({ purpose: e.target.value })}
              placeholder={inheritedHints?.purpose || 'What is this content for?'}
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="ai-tone">Tone</Label>
            <Input
              id="ai-tone"
              value={aiHints?.tone || ''}
              onChange={(e) => updateHints({ tone: e.target.value })}
              placeholder={inheritedHints?.tone || 'e.g., informative, friendly, professional'}
            />
          </div>

          <div>
            <Label htmlFor="ai-audience">Target Audience</Label>
            <Input
              id="ai-audience"
              value={aiHints?.audience || ''}
              onChange={(e) => updateHints({ audience: e.target.value })}
              placeholder={inheritedHints?.audience || 'e.g., tourists, locals, families'}
            />
          </div>

          <div>
            <Label>Content Guidelines</Label>
            <Textarea
              value={aiHints?.contentGuidelines?.join('\n') || ''}
              onChange={(e) =>
                updateHints({
                  contentGuidelines: e.target.value.split('\n').filter(Boolean),
                })
              }
              placeholder={
                inheritedHints?.contentGuidelines?.join('\n') ||
                'One guideline per line...\nInclude local tips\nMention accessibility'
              }
              rows={4}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label htmlFor="system-prompt">System Prompt</Label>
            <Textarea
              id="system-prompt"
              value={inlinePrompts?.systemPrompt || ''}
              onChange={(e) => updateInlinePrompts({ systemPrompt: e.target.value })}
              placeholder={effectivePrompts?.systemPrompt || 'Base instructions for the AI agent...'}
              rows={4}
              className="font-mono text-xs"
            />
          </div>

          <div>
            <Label htmlFor="research-prompt">Research Prompt</Label>
            <Textarea
              id="research-prompt"
              value={inlinePrompts?.researchPrompt || ''}
              onChange={(e) => updateInlinePrompts({ researchPrompt: e.target.value })}
              placeholder={effectivePrompts?.researchPrompt || 'How should the agent research this topic?'}
              rows={3}
              className="font-mono text-xs"
            />
          </div>

          <div>
            <Label htmlFor="writing-prompt">Writing Prompt</Label>
            <Textarea
              id="writing-prompt"
              value={inlinePrompts?.writingPrompt || ''}
              onChange={(e) => updateInlinePrompts({ writingPrompt: e.target.value })}
              placeholder={effectivePrompts?.writingPrompt || 'How should the agent write this content?'}
              rows={3}
              className="font-mono text-xs"
            />
          </div>

          <div>
            <Label htmlFor="review-prompt">Review Prompt</Label>
            <Textarea
              id="review-prompt"
              value={inlinePrompts?.reviewPrompt || ''}
              onChange={(e) => updateInlinePrompts({ reviewPrompt: e.target.value })}
              placeholder={effectivePrompts?.reviewPrompt || 'How should the editor review this content?'}
              rows={3}
              className="font-mono text-xs"
            />
          </div>

          <Separator />

          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
              <ChevronDown className="h-4 w-4" />
              Style & Constraints
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="min-words">Min Words</Label>
                  <Input
                    id="min-words"
                    type="number"
                    value={inlinePrompts?.minWordCount || ''}
                    onChange={(e) =>
                      updateInlinePrompts({
                        minWordCount: e.target.value ? parseInt(e.target.value) : undefined,
                      })
                    }
                    placeholder="500"
                  />
                </div>
                <div>
                  <Label htmlFor="max-words">Max Words</Label>
                  <Input
                    id="max-words"
                    type="number"
                    value={inlinePrompts?.maxWordCount || ''}
                    onChange={(e) =>
                      updateInlinePrompts({
                        maxWordCount: e.target.value ? parseInt(e.target.value) : undefined,
                      })
                    }
                    placeholder="2000"
                  />
                </div>
              </div>

              <div>
                <Label>Tone</Label>
                <Input
                  value={inlinePrompts?.tone || ''}
                  onChange={(e) => updateInlinePrompts({ tone: e.target.value })}
                  placeholder="informative, welcoming"
                />
              </div>

              <div>
                <Label>Perspective</Label>
                <Select
                  value={inlinePrompts?.perspective || ''}
                  onValueChange={(value) =>
                    updateInlinePrompts({
                      perspective: value as InlinePrompt['perspective'],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select perspective" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first_person">First Person (We/I)</SelectItem>
                    <SelectItem value="second_person">Second Person (You)</SelectItem>
                    <SelectItem value="third_person">Third Person (They)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Keywords (SEO)</Label>
                <Input
                  value={inlinePrompts?.keywords?.join(', ') || ''}
                  onChange={(e) =>
                    updateInlinePrompts({
                      keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean),
                    })
                  }
                  placeholder="cinque terre, hiking, italy"
                />
              </div>

              <div>
                <Label>Things to Avoid</Label>
                <Textarea
                  value={inlinePrompts?.avoid?.join('\n') || ''}
                  onChange={(e) =>
                    updateInlinePrompts({
                      avoid: e.target.value.split('\n').filter(Boolean),
                    })
                  }
                  placeholder="One per line..."
                  rows={3}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
              <ChevronDown className="h-4 w-4" />
              Variables
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <p className="text-xs text-muted-foreground mb-2">
                Variables are replaced at runtime. Use {'{variable_name}'} in prompts.
              </p>
              <Textarea
                value={
                  inlinePrompts?.variables
                    ? JSON.stringify(inlinePrompts.variables, null, 2)
                    : ''
                }
                onChange={(e) => {
                  try {
                    const variables = e.target.value ? JSON.parse(e.target.value) : undefined
                    updateInlinePrompts({ variables })
                  } catch {
                    // Invalid JSON
                  }
                }}
                placeholder='{ "city": "Monterosso", "region": "Cinque Terre" }'
                rows={4}
                className="font-mono text-xs"
              />
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Clear overrides button */}
      {(prompts || aiHints) && (inheritedPrompts || inheritedHints) && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => onUpdate(undefined, undefined)}
        >
          <X className="h-4 w-4 mr-2" />
          Clear overrides (use inherited)
        </Button>
      )}
    </div>
  )
}
