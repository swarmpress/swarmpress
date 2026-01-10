'use client'

import { useState, useMemo } from 'react'
import type { SiteDefinition, SitemapNode, ContentType } from '@swarm-press/shared'
import { getLocalizedValue, getCollectionId, isCollectionNode } from '@swarm-press/shared'
import { ChevronRight, ChevronDown, Database, Sparkles, Filter } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../ui/collapsible'

interface CollectionsPanelProps {
  siteDefinition: SiteDefinition
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}

interface CollectionListItemProps {
  node: SitemapNode
  contentType: ContentType | undefined
  locale: string
  isSelected: boolean
  onClick: () => void
}

function CollectionListItem({
  node,
  contentType,
  locale,
  isSelected,
  onClick,
}: CollectionListItemProps) {
  const title = getLocalizedValue(node.data?.title, locale) || contentType?.name || 'Untitled Collection'
  const hasFilter = node.data?.filter && Object.keys(node.data.filter).length > 0
  const hasPrompts = node.data?.prompts || contentType?.prompts
  const isTemplate = node.data?.isTemplate

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors',
        'hover:bg-muted',
        isSelected && 'bg-accent text-accent-foreground'
      )}
    >
      <Database className="h-4 w-4 text-orange-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        {contentType && (
          <div className="text-xs text-muted-foreground truncate">
            {contentType.name}
          </div>
        )}
      </div>

      {/* Indicators */}
      <div className="flex items-center gap-1 shrink-0">
        {hasFilter && (
          <Filter className="h-3 w-3 text-muted-foreground" />
        )}
        {isTemplate && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
            Template
          </Badge>
        )}
        {hasPrompts && (
          <Sparkles className="h-3 w-3 text-purple-500" />
        )}
      </div>
    </button>
  )
}

export function CollectionsPanel({
  siteDefinition,
  selectedNodeId,
  onSelectNode,
}: CollectionsPanelProps) {
  const [isOpen, setIsOpen] = useState(true)

  const locale = siteDefinition.defaultLocale || 'en'

  // Filter collection nodes
  const collectionNodes = useMemo(
    () => siteDefinition.sitemap.nodes.filter(n => isCollectionNode(n.type)),
    [siteDefinition.sitemap.nodes]
  )

  // Get content types for collections
  const collectionTypes = useMemo(() => {
    const types: Record<string, ContentType> = {}
    if (siteDefinition.types.collections) {
      Object.entries(siteDefinition.types.collections).forEach(([id, type]) => {
        types[`collection:${id}`] = type
      })
    }
    return types
  }, [siteDefinition.types.collections])

  // Group collections by type
  const groupedCollections = useMemo(() => {
    const groups = new Map<string, SitemapNode[]>()

    collectionNodes.forEach(node => {
      const typeId = node.type
      if (!groups.has(typeId)) {
        groups.set(typeId, [])
      }
      groups.get(typeId)!.push(node)
    })

    // Sort nodes within each group
    groups.forEach((nodes) => {
      nodes.sort((a, b) => {
        const titleA = getLocalizedValue(a.data?.title, locale) || ''
        const titleB = getLocalizedValue(b.data?.title, locale) || ''
        return titleA.localeCompare(titleB)
      })
    })

    return groups
  }, [collectionNodes, locale])

  if (collectionNodes.length === 0) {
    return null
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full flex items-center gap-2 p-3 border-t hover:bg-muted transition-colors">
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Database className="h-4 w-4 text-orange-500" />
        <span className="font-semibold text-sm">Collections</span>
        <Badge variant="secondary" className="ml-auto text-xs">
          {collectionNodes.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
          {Array.from(groupedCollections).map(([typeId, nodes]) => {
            const contentType = collectionTypes[typeId]
            const collectionId = getCollectionId(typeId)

            return (
              <div key={typeId}>
                {/* Type Header (only if multiple types) */}
                {groupedCollections.size > 1 && (
                  <div className="text-xs text-muted-foreground px-3 py-1 font-medium uppercase tracking-wider">
                    {contentType?.name || collectionId || typeId}
                  </div>
                )}

                {/* Collection Items */}
                {nodes.map(node => (
                  <CollectionListItem
                    key={node.id}
                    node={node}
                    contentType={contentType}
                    locale={locale}
                    isSelected={selectedNodeId === node.id}
                    onClick={() => onSelectNode(node.id)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
