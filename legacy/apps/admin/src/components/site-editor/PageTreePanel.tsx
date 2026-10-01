'use client'

import { useState, useMemo, useCallback } from 'react'
import type { SiteDefinition, ContentType } from '@swarm-press/shared'
import { getAllTypes } from '@swarm-press/shared'
import { Search, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { PageTreeNode } from './PageTreeNode'
import {
  buildPageTree,
  filterTree,
  getAllNodeIds,
  getAncestorIds,
} from './tree-utils'

interface PageTreePanelProps {
  siteDefinition: SiteDefinition
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  onDoubleClickNode: (nodeId: string) => void
  onAddPage?: (parentId: string | null) => void
}

export function PageTreePanel({
  siteDefinition,
  selectedNodeId,
  onSelectNode,
  onDoubleClickNode,
  onAddPage,
}: PageTreePanelProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set())
  const [searchQuery, setSearchQuery] = useState('')

  const locale = siteDefinition.defaultLocale || 'en'
  const locales = siteDefinition.locales || [locale]

  // Build content types map
  const contentTypes = useMemo(() => getAllTypes(siteDefinition), [siteDefinition])

  // Build tree from flat nodes
  const fullTree = useMemo(
    () => buildPageTree(
      siteDefinition.sitemap.nodes,
      siteDefinition.sitemap.edges || [],
      locale
    ),
    [siteDefinition.sitemap.nodes, siteDefinition.sitemap.edges, locale]
  )

  // Filter tree by search query
  const displayTree = useMemo(
    () => filterTree(fullTree, searchQuery, locale),
    [fullTree, searchQuery, locale]
  )

  // Auto-expand nodes when searching
  useMemo(() => {
    if (searchQuery.trim()) {
      // When searching, expand all matching ancestors
      const allIds = getAllNodeIds(displayTree)
      setExpandedNodes(allIds)
    }
  }, [searchQuery, displayTree])

  // Toggle node expansion
  const handleToggle = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  // Expand all nodes
  const handleExpandAll = useCallback(() => {
    setExpandedNodes(getAllNodeIds(fullTree))
  }, [fullTree])

  // Collapse all nodes
  const handleCollapseAll = useCallback(() => {
    setExpandedNodes(new Set())
  }, [])

  // Auto-expand to selected node
  useMemo(() => {
    if (selectedNodeId && siteDefinition.sitemap.edges) {
      const ancestors = getAncestorIds(selectedNodeId, siteDefinition.sitemap.edges)
      if (ancestors.length > 0) {
        setExpandedNodes(prev => {
          const next = new Set(prev)
          ancestors.forEach(id => next.add(id))
          return next
        })
      }
    }
  }, [selectedNodeId, siteDefinition.sitemap.edges])

  const pageCount = useMemo(
    () => siteDefinition.sitemap.nodes.filter(n => !n.type.startsWith('collection:')).length,
    [siteDefinition.sitemap.nodes]
  )

  return (
    <div className="flex flex-col h-full border-b">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">
            Pages
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              ({pageCount})
            </span>
          </h2>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleExpandAll}
              title="Expand all"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleCollapseAll}
              title="Collapse all"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            {onAddPage && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onAddPage(null)}
                title="Add page"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search pages..."
            className="pl-8 h-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {displayTree.length > 0 ? (
            displayTree.map(node => (
              <PageTreeNode
                key={node.id}
                treeNode={node}
                expanded={expandedNodes}
                selectedId={selectedNodeId}
                locale={locale}
                locales={locales}
                contentTypes={contentTypes}
                onToggle={handleToggle}
                onSelect={onSelectNode}
                onDoubleClick={onDoubleClickNode}
              />
            ))
          ) : searchQuery ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No pages match "{searchQuery}"
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              No pages yet.
              {onAddPage && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => onAddPage(null)}
                  className="block mx-auto mt-2"
                >
                  Add your first page
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
