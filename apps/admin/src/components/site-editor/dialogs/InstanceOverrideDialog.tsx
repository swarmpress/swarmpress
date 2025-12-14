'use client'

import { useState, useEffect } from 'react'
import type {
  TemplatePage,
  InstanceOverride,
  InlinePrompt,
  SiteAIHints,
  PageOverride,
} from '@swarm-press/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { Textarea } from '../../ui/textarea'
import { Badge } from '../../ui/badge'
import { Separator } from '../../ui/separator'
import { ScrollArea } from '../../ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs'
import { Switch } from '../../ui/switch'
import { Checkbox } from '../../ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible'
import {
  ChevronDown,
  FileText,
  Plus,
  Trash2,
  Sparkles,
  Link2,
  AlertTriangle,
  Check,
} from 'lucide-react'
import { cn } from '../../../lib/utils'

// Helper to get localized string value
function getLocalizedValue(
  value: string | Record<string, string> | undefined,
  locale = 'en'
): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value[locale] || value['en'] || Object.values(value)[0] || ''
}

interface InstanceOverrideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instanceId: string
  instanceName?: string
  templatePages: TemplatePage[]
  existingOverride?: InstanceOverride
  locale: string
  onSave: (override: InstanceOverride) => void
}

export function InstanceOverrideDialog({
  open,
  onOpenChange,
  instanceId,
  instanceName,
  templatePages,
  existingOverride,
  locale,
  onSave,
}: InstanceOverrideDialogProps) {
  const [activeTab, setActiveTab] = useState('pages')

  // Local state for editing
  const [skipPages, setSkipPages] = useState<string[]>([])
  const [additionalPages, setAdditionalPages] = useState<TemplatePage[]>([])
  const [pageOverrides, setPageOverrides] = useState<Record<string, PageOverride>>({})

  // Initialize state from existing override when dialog opens
  useEffect(() => {
    if (open) {
      setSkipPages(existingOverride?.skipPages || [])
      setAdditionalPages(existingOverride?.additionalPages || [])
      setPageOverrides(existingOverride?.pageOverrides || {})
    }
  }, [open, existingOverride])

  // Check if page is skipped
  const isPageSkipped = (slug: string) => skipPages.includes(slug)

  // Toggle page skip
  const togglePageSkip = (slug: string) => {
    setSkipPages((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    )
  }

  // Check if page has override
  const hasPageOverride = (slug: string) => !!pageOverrides[slug]

  // Update page override
  const updatePageOverride = (slug: string, override: PageOverride | undefined) => {
    if (override) {
      setPageOverrides((prev) => ({ ...prev, [slug]: override }))
    } else {
      setPageOverrides((prev) => {
        const { [slug]: _, ...rest } = prev
        return rest
      })
    }
  }

  // Add additional page
  const addAdditionalPage = () => {
    const newPage: TemplatePage = {
      slug: `custom-page-${Date.now()}`,
      pageType: 'page',
      title: { [locale]: 'New Custom Page' },
      required: false,
    }
    setAdditionalPages((prev) => [...prev, newPage])
  }

  // Remove additional page
  const removeAdditionalPage = (index: number) => {
    setAdditionalPages((prev) => prev.filter((_, i) => i !== index))
  }

  // Update additional page
  const updateAdditionalPage = (index: number, updates: Partial<TemplatePage>) => {
    setAdditionalPages((prev) =>
      prev.map((page, i) => (i === index ? { ...page, ...updates } : page))
    )
  }

  // Calculate summary counts
  const skipCount = skipPages.length
  const additionalCount = additionalPages.length
  const overrideCount = Object.keys(pageOverrides).length
  const hasChanges = skipCount > 0 || additionalCount > 0 || overrideCount > 0

  // Handle save
  const handleSave = () => {
    const override: InstanceOverride = {
      instanceId,
      skipPages: skipPages.length > 0 ? skipPages : undefined,
      additionalPages: additionalPages.length > 0 ? additionalPages : undefined,
      pageOverrides: Object.keys(pageOverrides).length > 0 ? pageOverrides : undefined,
    }
    onSave(override)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Configure: {instanceName || instanceId}
            {hasChanges && (
              <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                {skipCount + additionalCount + overrideCount} changes
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Customize which pages are generated for this instance and override default settings.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pages" className="text-xs">
              <FileText className="h-3 w-3 mr-1" />
              Pages
              {skipCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {skipCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="additional" className="text-xs">
              <Plus className="h-3 w-3 mr-1" />
              Custom
              {additionalCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {additionalCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="prompts" className="text-xs">
              <Sparkles className="h-3 w-3 mr-1" />
              Prompts
              {overrideCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {overrideCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            {/* Pages Tab - Skip/Enable template pages */}
            <TabsContent value="pages" className="mt-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                Select which template pages should be generated for this instance.
                Unchecked pages will be skipped.
              </p>

              <div className="space-y-2">
                {templatePages.map((page) => {
                  const title = getLocalizedValue(page.title, locale)
                  const isSkipped = isPageSkipped(page.slug)
                  const hasBinding = !!page.collectionBinding
                  const hasPrompts = !!(page.prompts || page.ai_hints)
                  const isRequired = page.required !== false

                  return (
                    <div
                      key={page.slug}
                      className={cn(
                        'flex items-center gap-3 p-3 border rounded-lg transition-colors',
                        isSkipped ? 'bg-muted/50 border-dashed' : 'bg-background'
                      )}
                    >
                      <Checkbox
                        checked={!isSkipped}
                        onCheckedChange={() => togglePageSkip(page.slug)}
                        disabled={isRequired}
                      />
                      <FileText className={cn(
                        'h-4 w-4',
                        isSkipped ? 'text-muted-foreground' : 'text-foreground'
                      )} />
                      <div className="flex-1">
                        <div className={cn(
                          'font-medium text-sm',
                          isSkipped && 'line-through text-muted-foreground'
                        )}>
                          {title || page.slug}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          /{page.slug} &middot; {page.pageType}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {hasBinding && (
                          <span title="Has collection binding">
                            <Link2 className="h-3.5 w-3.5 text-orange-500" />
                          </span>
                        )}
                        {hasPrompts && (
                          <span title="Has AI prompts">
                            <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                          </span>
                        )}
                        {isRequired && (
                          <Badge variant="outline" className="text-[10px]">Required</Badge>
                        )}
                        {isSkipped && (
                          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                            Skipped
                          </Badge>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {skipCount > 0 && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span className="text-amber-800">
                    {skipCount} page{skipCount > 1 ? 's' : ''} will be skipped for this instance
                  </span>
                </div>
              )}
            </TabsContent>

            {/* Additional Pages Tab */}
            <TabsContent value="additional" className="mt-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                Add custom pages that only exist for this instance (not part of the template).
              </p>

              <div className="space-y-3">
                {additionalPages.map((page, index) => (
                  <AdditionalPageEditor
                    key={index}
                    page={page}
                    locale={locale}
                    onUpdate={(updates) => updateAdditionalPage(index, updates)}
                    onRemove={() => removeAdditionalPage(index)}
                  />
                ))}

                {additionalPages.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Plus className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No custom pages</p>
                    <p className="text-xs">Add pages specific to this instance</p>
                  </div>
                )}

                <Button variant="outline" className="w-full" onClick={addAdditionalPage}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Custom Page
                </Button>
              </div>
            </TabsContent>

            {/* Prompts Tab - Override prompts for specific pages */}
            <TabsContent value="prompts" className="mt-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                Override AI prompts for specific template pages. Leave empty to use the default template prompts.
              </p>

              <div className="space-y-2">
                {templatePages.map((page) => {
                  const title = getLocalizedValue(page.title, locale)
                  const override = pageOverrides[page.slug]
                  const hasOverride = !!override

                  return (
                    <PagePromptOverrideEditor
                      key={page.slug}
                      pageSlug={page.slug}
                      pageTitle={title || page.slug}
                      templatePrompts={page.prompts}
                      templateHints={page.ai_hints}
                      override={override}
                      onUpdate={(newOverride) => updatePageOverride(page.slug, newOverride)}
                    />
                  )
                })}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Check className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Additional Page Editor
// ============================================================================

interface AdditionalPageEditorProps {
  page: TemplatePage
  locale: string
  onUpdate: (updates: Partial<TemplatePage>) => void
  onRemove: () => void
}

function AdditionalPageEditor({
  page,
  locale,
  onUpdate,
  onRemove,
}: AdditionalPageEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const title = getLocalizedValue(page.title, locale)

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 p-3 bg-muted/30">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <ChevronDown className={cn(
            'h-4 w-4 transition-transform',
            !isExpanded && '-rotate-90'
          )} />
          <FileText className="h-4 w-4 text-green-600" />
          <span className="font-medium text-sm">{title || page.slug}</span>
          <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">
            Custom
          </Badge>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {isExpanded && (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`slug-${page.slug}`} className="text-xs">Slug</Label>
              <Input
                id={`slug-${page.slug}`}
                value={page.slug}
                onChange={(e) => onUpdate({ slug: e.target.value })}
                className="h-8 text-sm font-mono"
              />
            </div>
            <div>
              <Label htmlFor={`title-${page.slug}`} className="text-xs">Title</Label>
              <Input
                id={`title-${page.slug}`}
                value={title}
                onChange={(e) => onUpdate({ title: { ...page.title as Record<string, string>, [locale]: e.target.value } })}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`pageType-${page.slug}`} className="text-xs">Page Type</Label>
            <Input
              id={`pageType-${page.slug}`}
              value={page.pageType}
              onChange={(e) => onUpdate({ pageType: e.target.value })}
              className="h-8 text-sm"
              placeholder="e.g., content-page"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Page Prompt Override Editor
// ============================================================================

interface PagePromptOverrideEditorProps {
  pageSlug: string
  pageTitle: string
  templatePrompts?: InlinePrompt
  templateHints?: SiteAIHints
  override?: PageOverride
  onUpdate: (override: PageOverride | undefined) => void
}

function PagePromptOverrideEditor({
  pageSlug,
  pageTitle,
  templatePrompts,
  templateHints,
  override,
  onUpdate,
}: PagePromptOverrideEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasOverride = !!(override?.prompts || override?.ai_hints)

  const updateOverride = (updates: Partial<PageOverride>) => {
    onUpdate({ ...override, ...updates })
  }

  const clearOverride = () => {
    onUpdate(undefined)
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={cn(
        'border rounded-lg overflow-hidden transition-colors',
        hasOverride && 'border-purple-200 bg-purple-50/50'
      )}>
        <CollapsibleTrigger className="flex items-center gap-2 p-3 w-full text-left hover:bg-muted/50">
          <ChevronDown className={cn(
            'h-4 w-4 transition-transform',
            !isExpanded && '-rotate-90'
          )} />
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 font-medium text-sm">{pageTitle}</span>
          {hasOverride ? (
            <Badge variant="outline" className="text-[10px] bg-purple-100 text-purple-700 border-purple-200">
              <Sparkles className="h-2.5 w-2.5 mr-0.5" />
              Custom prompts
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Using template defaults</span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-3 border-t space-y-3">
            {/* Show inherited values */}
            {(templatePrompts?.writingPrompt || templateHints?.purpose) && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                <span className="font-medium">Template defaults:</span>
                {templateHints?.purpose && (
                  <p className="mt-1">Purpose: {templateHints.purpose}</p>
                )}
                {templatePrompts?.writingPrompt && (
                  <p className="mt-1 truncate">Writing: {templatePrompts.writingPrompt.slice(0, 100)}...</p>
                )}
              </div>
            )}

            {/* Override fields */}
            <div>
              <Label htmlFor={`purpose-${pageSlug}`} className="text-xs">Purpose Override</Label>
              <Textarea
                id={`purpose-${pageSlug}`}
                value={override?.ai_hints?.purpose || ''}
                onChange={(e) => updateOverride({
                  ai_hints: { ...override?.ai_hints, purpose: e.target.value || undefined }
                })}
                placeholder={templateHints?.purpose || 'Override the purpose for this instance...'}
                rows={2}
                className="text-xs"
              />
            </div>

            <div>
              <Label htmlFor={`writing-${pageSlug}`} className="text-xs">Writing Prompt Override</Label>
              <Textarea
                id={`writing-${pageSlug}`}
                value={override?.prompts?.writingPrompt || ''}
                onChange={(e) => updateOverride({
                  prompts: { ...override?.prompts, writingPrompt: e.target.value || undefined }
                })}
                placeholder={templatePrompts?.writingPrompt || 'Override writing instructions...'}
                rows={3}
                className="text-xs font-mono"
              />
            </div>

            <div>
              <Label htmlFor={`tone-${pageSlug}`} className="text-xs">Tone Override</Label>
              <Input
                id={`tone-${pageSlug}`}
                value={override?.ai_hints?.tone || ''}
                onChange={(e) => updateOverride({
                  ai_hints: { ...override?.ai_hints, tone: e.target.value || undefined }
                })}
                placeholder={templateHints?.tone || 'e.g., informative, casual'}
                className="text-xs"
              />
            </div>

            {hasOverride && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={clearOverride}
              >
                Clear overrides (use template defaults)
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
