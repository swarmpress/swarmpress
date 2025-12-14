'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ContentType } from '@swarm-press/shared'
import { Badge } from '../../ui/badge'
import { Database, Filter, Sparkles, Utensils, Bed, Mountain, Calendar, Star } from 'lucide-react'
import { cn } from '../../../lib/utils'

interface CollectionNodeData {
  id: string
  nodeType: string
  contentType?: ContentType
  filter?: Record<string, any>
  prompts?: any
}

// Map icon names to Lucide components
const iconMap: Record<string, any> = {
  utensils: Utensils,
  bed: Bed,
  mountain: Mountain,
  calendar: Calendar,
  star: Star,
  database: Database,
}

export const CollectionNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as CollectionNodeData
  const contentType = nodeData.contentType
  const hasPrompts = nodeData.prompts || contentType?.prompts
  const hasFilter = nodeData.filter && Object.keys(nodeData.filter).length > 0

  // Get icon component
  const IconComponent = contentType?.icon ? iconMap[contentType.icon] : Database

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 shadow-sm min-w-[180px] max-w-[250px] transition-all',
        'bg-orange-50 border-orange-300 text-orange-900',
        'dark:bg-orange-950 dark:border-orange-800 dark:text-orange-100',
        selected && 'ring-2 ring-primary ring-offset-2'
      )}
      style={{
        borderColor: contentType?.color ?? undefined,
        borderLeftWidth: contentType?.color ? '4px' : undefined,
      }}
    >
      {/* Source Handle (for attaching to pages) */}
      <Handle
        type="source"
        position={Position.Left}
        className="!w-3 !h-3 !bg-orange-400 !border-2 !border-white"
      />

      {/* Target Handle (for receiving connections) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-orange-400 !border-2 !border-white"
      />

      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-lg">
          {IconComponent ? <IconComponent className="h-5 w-5" /> : <Database className="h-5 w-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">
            {contentType?.name || nodeData.nodeType}
          </div>
          <div className="text-xs text-muted-foreground">
            Collection
          </div>
        </div>
      </div>

      {/* Type Badge */}
      <Badge variant="outline" className="text-xs bg-orange-100 mb-2">
        {nodeData.nodeType.replace('collection:', '')}
      </Badge>

      {/* Filter Indicator */}
      {hasFilter && (
        <div className="flex items-center gap-1 text-xs text-orange-700 dark:text-orange-300 mb-1">
          <Filter className="h-3 w-3" />
          <span>Filtered</span>
        </div>
      )}

      {/* Prompts/AI Indicator */}
      {hasPrompts && (
        <div className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
          <Sparkles className="h-3 w-3" />
          <span>AI-assisted</span>
        </div>
      )}
    </div>
  )
})

CollectionNode.displayName = 'CollectionNode'
