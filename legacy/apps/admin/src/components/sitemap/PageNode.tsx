/**
 * PageNode Component
 * Custom React Flow node for displaying sitemap pages
 */

import React, { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { PageNodeData } from './graphUtils'

const PageNode = memo(({ data, selected }: NodeProps<PageNodeData>) => {
  // Status colors
  const statusColors = {
    published: 'bg-green-100 border-green-300 text-green-800',
    draft: 'bg-yellow-100 border-yellow-300 text-yellow-800',
    planned: 'bg-blue-100 border-blue-300 text-blue-800',
    outdated: 'bg-orange-100 border-orange-300 text-orange-800',
    deprecated: 'bg-red-100 border-red-300 text-red-800',
  }

  // Priority indicators
  const priorityColors = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-gray-400',
  }

  const statusClass = statusColors[data.status as keyof typeof statusColors] || statusColors.draft
  const priorityClass = priorityColors[data.priority as keyof typeof priorityColors] || priorityColors.low

  return (
    <div
      className={`
        relative px-4 py-3 rounded-lg border-2 shadow-md bg-white min-w-[200px] max-w-[300px]
        transition-all duration-200
        ${selected ? 'border-blue-500 shadow-lg ring-2 ring-blue-300' : 'border-gray-300 hover:border-blue-400'}
      `}
    >
      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-blue-500 border-2 border-white"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-blue-500 border-2 border-white"
      />

      {/* Priority indicator */}
      <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${priorityClass}`} />

      {/* Page type badge */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {data.page_type}
        </span>
      </div>

      {/* Title */}
      <div className="font-semibold text-gray-900 mb-1 line-clamp-2">
        {data.title}
      </div>

      {/* Slug */}
      <div className="text-xs text-gray-600 font-mono mb-2 truncate">
        {data.slug}
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span className={`px-2 py-1 text-xs font-medium rounded ${statusClass}`}>
          {data.status}
        </span>

        {/* Metrics */}
        {data.freshness_score !== undefined && (
          <span className="text-xs text-gray-500">
            Fresh: {data.freshness_score}%
          </span>
        )}
      </div>

      {/* Alerts/Warnings */}
      {data.alerts && data.alerts.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-xs text-orange-600">
          <span>⚠</span>
          <span>{data.alerts.length} alert{data.alerts.length > 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Tasks indicator */}
      {data.tasks && data.tasks.length > 0 && (
        <div className="mt-1 flex items-center gap-1 text-xs text-blue-600">
          <span>✓</span>
          <span>{data.tasks.length} task{data.tasks.length > 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  )
})

PageNode.displayName = 'PageNode'

export default PageNode
