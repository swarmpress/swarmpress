'use client'

import { memo } from 'react'
import type { ContentType, LocalizedString } from '@swarm-press/shared'
import { getLocalizedValue } from '@swarm-press/shared'
import { ChevronRight, ChevronDown, FileText, Home, MapPin, Sparkles, Languages } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { TreeNode } from './tree-utils'
import { getTranslationStatus, getStatusInfo } from './tree-utils'

interface PageTreeNodeProps {
  treeNode: TreeNode
  expanded: Set<string>
  selectedId: string | null
  locale: string
  locales: string[]
  contentTypes: Record<string, ContentType>
  onToggle: (nodeId: string) => void
  onSelect: (nodeId: string) => void
  onDoubleClick: (nodeId: string) => void
}

// Map icon names to Lucide components
const iconMap: Record<string, React.ElementType> = {
  home: Home,
  'map-pin': MapPin,
  'file-text': FileText,
}

export const PageTreeNode = memo(function PageTreeNode({
  treeNode,
  expanded,
  selectedId,
  locale,
  locales,
  contentTypes,
  onToggle,
  onSelect,
  onDoubleClick,
}: PageTreeNodeProps) {
  const { node, children, depth, url } = treeNode
  const hasChildren = children.length > 0
  const isExpanded = expanded.has(node.id)
  const isSelected = selectedId === node.id

  const contentType = contentTypes[node.type]
  const IconComponent = contentType?.icon ? iconMap[contentType.icon] : FileText

  const title = getLocalizedValue(node.data?.title as LocalizedString, locale) || 'Untitled'
  const status = node.data?.status || 'draft'
  const statusInfo = getStatusInfo(status)
  const hasPrompts = node.data?.prompts || contentType?.prompts

  // Translation status
  const titleTranslation = getTranslationStatus(node.data?.title as LocalizedString, locales)
  const hasMultipleLocales = locales.length > 1
  const hasTranslationGaps = titleTranslation.missing.length > 0 && hasMultipleLocales

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(node.id)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDoubleClick(node.id)
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggle(node.id)
  }

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer group',
          'hover:bg-muted transition-colors',
          isSelected && 'bg-accent text-accent-foreground'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {/* Expand/Collapse */}
        {hasChildren ? (
          <button
            onClick={handleToggle}
            className="p-0.5 hover:bg-muted-foreground/10 rounded shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* Icon */}
        <span
          className="shrink-0"
          style={{ color: contentType?.color }}
        >
          <IconComponent className="h-4 w-4" />
        </span>

        {/* Title & URL */}
        <div className="flex-1 min-w-0 ml-1">
          <div className="text-sm font-medium truncate">{title}</div>
          <div className="text-xs text-muted-foreground truncate">{url}</div>
        </div>

        {/* Status Dot */}
        <div
          className={cn('w-2 h-2 rounded-full shrink-0', statusInfo.color.dot)}
          title={statusInfo.label}
        />

        {/* Translation Indicator */}
        {hasMultipleLocales && (
          <div
            className={cn(
              'flex items-center gap-0.5 shrink-0',
              hasTranslationGaps ? 'text-amber-500' : 'text-green-500'
            )}
            title={hasTranslationGaps ? `Missing: ${titleTranslation.missing.join(', ')}` : 'All translations complete'}
          >
            <Languages className="h-3 w-3" />
          </div>
        )}

        {/* AI Indicator */}
        {hasPrompts && (
          <Sparkles className="h-3 w-3 text-purple-500 shrink-0" />
        )}
      </div>

      {/* Children */}
      {isExpanded && children.map(child => (
        <PageTreeNode
          key={child.id}
          treeNode={child}
          expanded={expanded}
          selectedId={selectedId}
          locale={locale}
          locales={locales}
          contentTypes={contentTypes}
          onToggle={onToggle}
          onSelect={onSelect}
          onDoubleClick={onDoubleClick}
        />
      ))}
    </div>
  )
})
