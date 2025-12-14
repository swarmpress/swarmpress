'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ContentType } from '@swarm-press/shared'
import { Badge } from '../../ui/badge'
import { FileType, Database, Sparkles } from 'lucide-react'
import { cn } from '../../../lib/utils'

export const TypeNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as ContentType
  const hasPrompts = nodeData.prompts || nodeData.ai_hints
  const isEntity = nodeData.kind === 'entity'

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border-2 shadow-sm min-w-[160px] max-w-[220px] transition-all',
        isEntity
          ? 'bg-violet-50 border-violet-300 text-violet-900 dark:bg-violet-950 dark:border-violet-800 dark:text-violet-100'
          : 'bg-sky-50 border-sky-300 text-sky-900 dark:bg-sky-950 dark:border-sky-800 dark:text-sky-100',
        selected && 'ring-2 ring-primary ring-offset-2'
      )}
      style={{
        borderColor: nodeData.color ?? undefined,
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-lg">
          {nodeData.icon || (isEntity ? <Database className="h-5 w-5" /> : <FileType className="h-5 w-5" />)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">
            {nodeData.name}
          </div>
          <div className="text-xs text-muted-foreground">
            {isEntity ? 'Entity Type' : 'Page Type'}
          </div>
        </div>
      </div>

      {/* Kind Badge */}
      <Badge
        variant="outline"
        className={cn(
          'text-xs mb-2',
          isEntity ? 'bg-violet-100' : 'bg-sky-100'
        )}
      >
        {nodeData.kind}
      </Badge>

      {/* Schema Info */}
      {nodeData.schema && (
        <div className="text-xs text-muted-foreground mb-1">
          {nodeData.schema.sections?.length
            ? `${nodeData.schema.sections.length} sections`
            : nodeData.schema.fields?.length
            ? `${nodeData.schema.fields.length} fields`
            : null}
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

TypeNode.displayName = 'TypeNode'
