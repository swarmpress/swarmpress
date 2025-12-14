'use client'

import { memo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ContentType, TemplatePage } from '@swarm-press/shared'
import { getLocalizedValue, hasPageStructure } from '@swarm-press/shared'
import { Badge } from '../../ui/badge'
import {
  Database,
  Sparkles,
  ChevronDown,
  ChevronRight,
  FileText,
  Link2,
  Layers,
  Users,
} from 'lucide-react'
import { cn } from '../../../lib/utils'

interface TemplateCollectionNodeData {
  id: string
  nodeType: string
  contentType?: ContentType
  filter?: Record<string, unknown>
  prompts?: unknown
  isTemplate?: boolean
  instanceOverrides?: Array<{ instanceId: string; skipPages?: string[] }>
}

export const TemplateCollectionNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as TemplateCollectionNodeData
  const contentType = nodeData.contentType
  const [isExpanded, setIsExpanded] = useState(true)

  // Get template pages
  const templatePages = contentType?.pageStructure?.pages || []
  const pageCount = templatePages.length

  // Count instances with overrides
  const overrideCount = nodeData.instanceOverrides?.length || 0

  return (
    <div
      className={cn(
        'rounded-lg border-2 shadow-sm min-w-[220px] max-w-[280px] transition-all overflow-hidden',
        'bg-gradient-to-b from-purple-50 to-orange-50 border-purple-300',
        'dark:from-purple-950 dark:to-orange-950 dark:border-purple-700',
        selected && 'ring-2 ring-primary ring-offset-2'
      )}
    >
      {/* Source Handle (for attaching to pages) */}
      <Handle
        type="source"
        position={Position.Left}
        className="!w-3 !h-3 !bg-purple-400 !border-2 !border-white"
      />

      {/* Target Handle (for receiving connections) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-purple-400 !border-2 !border-white"
      />

      {/* Header */}
      <div className="px-4 py-3 bg-purple-100/50 dark:bg-purple-900/30 border-b border-purple-200 dark:border-purple-800">
        <div className="flex items-start gap-2">
          <Layers className="h-5 w-5 text-purple-600 dark:text-purple-400 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate text-purple-900 dark:text-purple-100">
              {contentType?.name || nodeData.nodeType.replace('collection:', '')}
            </div>
            <div className="text-xs text-purple-600 dark:text-purple-400">
              Template Collection
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300">
            {pageCount} pages
          </Badge>
        </div>
      </div>

      {/* Template Pages List */}
      <div className="px-3 py-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full mb-1"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span>Template Pages</span>
        </button>

        {isExpanded && templatePages.length > 0 && (
          <div className="space-y-1 pl-2 border-l-2 border-purple-200 dark:border-purple-800 ml-1">
            {templatePages.slice(0, 5).map((page) => (
              <TemplatePageItem
                key={page.slug}
                page={page}
                locale="en"
              />
            ))}
            {templatePages.length > 5 && (
              <div className="text-xs text-muted-foreground pl-4">
                +{templatePages.length - 5} more pages
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer with stats */}
      <div className="px-3 py-2 bg-orange-100/50 dark:bg-orange-900/30 border-t border-orange-200 dark:border-orange-800 flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-orange-700 dark:text-orange-300">
          <Users className="h-3 w-3" />
          <span>Instances</span>
        </div>
        {overrideCount > 0 && (
          <Badge variant="outline" className="text-[10px] bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300">
            {overrideCount} with overrides
          </Badge>
        )}
      </div>
    </div>
  )
})

TemplateCollectionNode.displayName = 'TemplateCollectionNode'

// Template page item component
interface TemplatePageItemProps {
  page: TemplatePage
  locale: string
}

function TemplatePageItem({ page, locale }: TemplatePageItemProps) {
  const title = getLocalizedValue(page.title, locale)
  const hasBinding = !!page.collectionBinding
  const hasPrompts = !!(page.prompts || page.ai_hints)
  const isRequired = page.required !== false

  return (
    <div className="flex items-center gap-1.5 py-0.5 pl-2">
      <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
      <span className={cn(
        'text-xs truncate',
        !isRequired && 'text-muted-foreground italic'
      )}>
        {title || page.slug}
      </span>
      {hasBinding && (
        <span title="Collection binding">
          <Link2 className="h-2.5 w-2.5 text-orange-500 flex-shrink-0" />
        </span>
      )}
      {hasPrompts && (
        <span title="AI prompts">
          <Sparkles className="h-2.5 w-2.5 text-purple-500 flex-shrink-0" />
        </span>
      )}
    </div>
  )
}
