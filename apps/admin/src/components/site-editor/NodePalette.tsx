'use client'

import { useState } from 'react'
import type { ContentType } from '@swarm-press/shared'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import { Separator } from '../ui/separator'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible'
import {
  ChevronDown,
  ChevronRight,
  Search,
  FileText,
  Database,
  Plus,
  GripVertical,
  Sparkles,
  Settings,
} from 'lucide-react'
import { cn } from '../../lib/utils'

interface NodePaletteProps {
  types: Record<string, ContentType>
  onAddPage: (typeId: string, position?: { x: number; y: number }) => void
  onSelectType: (typeId: string) => void
}

export function NodePalette({ types, onAddPage, onSelectType }: NodePaletteProps) {
  const [search, setSearch] = useState('')
  const [pageTypesOpen, setPageTypesOpen] = useState(true)
  const [entityTypesOpen, setEntityTypesOpen] = useState(true)

  // Separate page types from entity types
  const pageTypes = Object.entries(types).filter(([_, type]) => type.kind === 'page')
  const entityTypes = Object.entries(types).filter(([_, type]) => type.kind === 'entity')

  // Filter by search
  const filterTypes = (types: [string, ContentType][]) => {
    if (!search) return types
    const searchLower = search.toLowerCase()
    return types.filter(
      ([id, type]) =>
        id.toLowerCase().includes(searchLower) ||
        type.name.toLowerCase().includes(searchLower)
    )
  }

  const filteredPageTypes = filterTypes(pageTypes)
  const filteredEntityTypes = filterTypes(entityTypes)

  const handleDragStart = (e: React.DragEvent, typeId: string, kind: 'page' | 'entity') => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify({ typeId, kind }))
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="w-64 border-r bg-background flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="font-semibold text-sm mb-3">Content Types</h2>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search types..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
      </div>

      {/* Types List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* Page Types */}
          <Collapsible open={pageTypesOpen} onOpenChange={setPageTypesOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-start px-2 h-9">
                {pageTypesOpen ? (
                  <ChevronDown className="h-4 w-4 mr-2" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-2" />
                )}
                <FileText className="h-4 w-4 mr-2" />
                <span className="flex-1 text-left">Page Types</span>
                <span className="text-xs text-muted-foreground">{filteredPageTypes.length}</span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-4 space-y-1 mt-1">
                {filteredPageTypes.map(([id, type]) => (
                  <TypeItem
                    key={id}
                    id={id}
                    type={type}
                    onAdd={() => onAddPage(id)}
                    onSelect={() => onSelectType(id)}
                    onDragStart={(e) => handleDragStart(e, id, 'page')}
                  />
                ))}
                {filteredPageTypes.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-1">No page types found</p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Separator className="my-2" />

          {/* Entity Types */}
          <Collapsible open={entityTypesOpen} onOpenChange={setEntityTypesOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-start px-2 h-9">
                {entityTypesOpen ? (
                  <ChevronDown className="h-4 w-4 mr-2" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-2" />
                )}
                <Database className="h-4 w-4 mr-2" />
                <span className="flex-1 text-left">Entity Types</span>
                <span className="text-xs text-muted-foreground">{filteredEntityTypes.length}</span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-4 space-y-1 mt-1">
                {filteredEntityTypes.map(([id, type]) => (
                  <TypeItem
                    key={id}
                    id={id}
                    type={type}
                    onSelect={() => onSelectType(id)}
                    onDragStart={(e) => handleDragStart(e, id, 'entity')}
                  />
                ))}
                {filteredEntityTypes.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-1">No entity types found</p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>

      {/* Footer: Add New Type */}
      <div className="p-3 border-t">
        <Button variant="outline" size="sm" className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          New Content Type
        </Button>
      </div>
    </div>
  )
}

interface TypeItemProps {
  id: string
  type: ContentType
  onAdd?: () => void
  onSelect: () => void
  onDragStart: (e: React.DragEvent) => void
}

function TypeItem({ id, type, onAdd, onSelect, onDragStart }: TypeItemProps) {
  const hasPrompts = type.prompts || type.ai_hints

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab',
        'hover:bg-muted transition-colors',
        'active:cursor-grabbing'
      )}
      style={{ borderLeft: `3px solid ${type.color || '#94a3b8'}` }}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      <span className="text-sm">{type.icon || '📄'}</span>
      <span className="flex-1 text-sm truncate">{type.name}</span>
      {hasPrompts && (
        <Sparkles className="h-3 w-3 text-purple-500 shrink-0" />
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
          title="Edit type"
        >
          <Settings className="h-3 w-3" />
        </Button>
        {onAdd && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
            title="Add page"
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}
