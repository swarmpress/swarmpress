'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ContentType } from '@swarm-press/shared'
import { Badge } from '../../ui/badge'
import { FileText, Globe, Lock, Eye, EyeOff, Sparkles, Home, MapPin } from 'lucide-react'
import { cn } from '../../../lib/utils'

interface PageNodeData {
  id: string
  nodeType: string
  slug: string
  title: string
  status: 'draft' | 'in_progress' | 'in_review' | 'approved' | 'published' | 'archived'
  contentType?: ContentType
  locale?: string
  prompts?: any
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 border-slate-300 text-slate-700',
  in_progress: 'bg-blue-100 border-blue-300 text-blue-700',
  in_review: 'bg-amber-100 border-amber-300 text-amber-700',
  approved: 'bg-green-100 border-green-300 text-green-700',
  published: 'bg-emerald-100 border-emerald-300 text-emerald-700',
  archived: 'bg-gray-100 border-gray-300 text-gray-700',
}

const statusIcons: Record<string, any> = {
  draft: FileText,
  in_progress: Sparkles,
  in_review: Eye,
  approved: Lock,
  published: Globe,
  archived: EyeOff,
}

// Map icon names to Lucide components
const iconMap: Record<string, any> = {
  home: Home,
  'map-pin': MapPin,
  'file-text': FileText,
}

export const PageNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as PageNodeData
  const status = nodeData.status || 'draft'
  const StatusIcon = statusIcons[status] || FileText
  const contentType = nodeData.contentType
  const hasPrompts = nodeData.prompts || contentType?.prompts

  // Get icon component
  const IconComponent = contentType?.icon ? iconMap[contentType.icon] : null

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 shadow-sm min-w-[200px] max-w-[280px] transition-all',
        statusColors[status],
        selected && 'ring-2 ring-primary ring-offset-2'
      )}
      style={{
        borderColor: contentType?.color ?? undefined,
        borderLeftWidth: contentType?.color ? '4px' : undefined,
      }}
    >
      {/* Input Handle (for parent connections) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white"
      />

      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-lg" title={contentType?.name}>
          {IconComponent ? <IconComponent className="h-5 w-5" /> : '📄'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">
            {nodeData.title || 'Untitled'}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {nodeData.slug || '/...'}
          </div>
        </div>
        <StatusIcon className="h-4 w-4 shrink-0" />
      </div>

      {/* Type Badge */}
      {contentType && (
        <Badge variant="outline" className="text-xs mb-2">
          {contentType.name}
        </Badge>
      )}

      {/* Prompts/AI Indicator */}
      {hasPrompts && (
        <div className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
          <Sparkles className="h-3 w-3" />
          <span>AI-assisted</span>
        </div>
      )}

      {/* Output Handle (for child connections) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white"
      />
    </div>
  )
})

PageNode.displayName = 'PageNode'
