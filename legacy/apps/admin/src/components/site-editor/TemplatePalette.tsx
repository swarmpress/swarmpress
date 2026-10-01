'use client'

import { useState } from 'react'
import type { PageTemplate } from '@swarm-press/shared'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { ScrollArea } from '../ui/scroll-area'
import {
  Home,
  Grid,
  MapPin,
  Compass,
  Moon,
  Sun,
  Layers,
  Plus,
} from 'lucide-react'
import { cn } from '../../lib/utils'

interface TemplatePaletteProps {
  templates: Record<string, PageTemplate>
  onSelectTemplate: (templateId: string, template: PageTemplate) => void
  selectedTag?: string
  onTagFilter?: (tag: string | undefined) => void
}

// Icon mapping for template icons
const iconMap: Record<string, React.ElementType> = {
  home: Home,
  grid: Grid,
  'map-pin': MapPin,
  compass: Compass,
}

export function TemplatePalette({
  templates,
  onSelectTemplate,
  selectedTag,
  onTagFilter,
}: TemplatePaletteProps) {
  const templateList = Object.entries(templates)

  // Collect all unique tags
  const allTags = Array.from(
    new Set(templateList.flatMap(([_, t]) => t.tags || []))
  ).sort()

  // Filter templates by tag
  const filteredTemplates = selectedTag
    ? templateList.filter(([_, t]) => t.tags?.includes(selectedTag))
    : templateList

  return (
    <div className="flex flex-col h-full">
      {/* Tag Filters */}
      {allTags.length > 0 && (
        <div className="p-3 border-b">
          <div className="flex flex-wrap gap-1">
            <Badge
              variant={selectedTag === undefined ? 'default' : 'outline'}
              className="cursor-pointer text-xs"
              onClick={() => onTagFilter?.(undefined)}
            >
              All
            </Badge>
            {allTags.map((tag) => (
              <Badge
                key={tag}
                variant={selectedTag === tag ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => onTagFilter?.(tag === selectedTag ? undefined : tag)}
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Templates Grid */}
      <ScrollArea className="flex-1">
        <div className="p-3 grid gap-3">
          {filteredTemplates.map(([id, template]) => (
            <TemplateCard
              key={id}
              template={template}
              onSelect={() => onSelectTemplate(id, template)}
            />
          ))}
          {filteredTemplates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No templates found
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

interface TemplateCardProps {
  template: PageTemplate
  onSelect: () => void
}

function TemplateCard({ template, onSelect }: TemplateCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const Icon = iconMap[template.icon || 'layers'] || Layers
  const isDark = template.design?.theme === 'dark'

  return (
    <div
      className={cn(
        'relative rounded-lg border overflow-hidden cursor-pointer transition-all',
        'hover:border-primary hover:shadow-md',
        isDark ? 'bg-neutral-900 border-neutral-700' : 'bg-white border-slate-200'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSelect}
    >
      {/* Preview Area */}
      <div
        className={cn(
          'aspect-[16/10] flex items-center justify-center',
          isDark ? 'bg-neutral-950' : 'bg-slate-50'
        )}
      >
        {template.previewImage ? (
          <img
            src={template.previewImage}
            alt={template.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Icon className={cn('h-8 w-8', isDark ? 'text-neutral-500' : 'text-slate-400')} />
            <span className={cn('text-xs', isDark ? 'text-neutral-500' : 'text-slate-400')}>
              {template.sections.length} sections
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className={cn('p-3', isDark ? 'text-white' : 'text-slate-900')}>
        <div className="flex items-center gap-2 mb-1">
          <Icon className={cn('h-4 w-4', isDark ? 'text-orange-400' : 'text-slate-600')} />
          <span className="font-medium text-sm">{template.name}</span>
          {isDark ? (
            <Moon className="h-3 w-3 text-orange-400 ml-auto" />
          ) : (
            <Sun className="h-3 w-3 text-amber-500 ml-auto" />
          )}
        </div>
        {template.description && (
          <p className={cn('text-xs line-clamp-2', isDark ? 'text-neutral-400' : 'text-slate-500')}>
            {template.description}
          </p>
        )}
        {template.tags && template.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {template.tags.slice(0, 3).map((tag: string) => (
              <Badge
                key={tag}
                variant="outline"
                className={cn(
                  'text-[10px] px-1.5 py-0',
                  isDark ? 'border-neutral-600 text-neutral-400' : ''
                )}
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Hover Overlay */}
      {isHovered && (
        <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Use Template
          </Button>
        </div>
      )}
    </div>
  )
}

// Section preview mini-display
export function TemplateSectionPreview({ template }: { template: PageTemplate }) {
  return (
    <div className="flex flex-col gap-1 p-2 bg-muted/50 rounded">
      {template.sections.map((section) => (
        <div
          key={section.id}
          className={cn(
            'h-2 rounded-sm',
            section.required ? 'bg-primary/60' : 'bg-muted-foreground/30'
          )}
          style={{
            width: section.type.includes('hero')
              ? '100%'
              : section.type.includes('cta')
              ? '60%'
              : '80%',
          }}
          title={section.label || section.type}
        />
      ))}
    </div>
  )
}
