/**
 * ClusterNode Component
 * Custom React Flow node for displaying topical clusters
 */

import React, { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ClusterNodeData } from './graphUtils'

const ClusterNode = memo(({ data, selected }: NodeProps<ClusterNodeData>) => {
  return (
    <div
      className={`
        relative px-5 py-4 rounded-xl border-2 shadow-lg bg-gradient-to-br from-purple-50 to-blue-50
        min-w-[250px] max-w-[350px]
        transition-all duration-200
        ${selected ? 'border-purple-500 shadow-xl ring-2 ring-purple-300' : 'border-purple-300 hover:border-purple-400'}
      `}
    >
      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-4 h-4 !bg-purple-500 border-2 border-white"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-4 h-4 !bg-purple-500 border-2 border-white"
      />

      {/* Cluster icon */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-purple-500 flex items-center justify-center text-white text-lg">
          🗂️
        </div>
        <div className="flex-1">
          <div className="text-xs font-medium text-purple-600 uppercase tracking-wide">
            Topical Cluster
          </div>
          <div className="font-bold text-gray-900 text-lg">
            {data.name}
          </div>
        </div>
      </div>

      {/* Topics */}
      {data.topics && data.topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {data.topics.slice(0, 3).map((topic, idx) => (
            <span
              key={idx}
              className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full"
            >
              {topic}
            </span>
          ))}
          {data.topics.length > 3 && (
            <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full">
              +{data.topics.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-gray-600">
        <div>
          <span className="font-medium text-gray-900">{data.page_count || 0}</span> pages
        </div>
        {data.primary_keyword && (
          <div className="text-xs">
            🎯 {data.primary_keyword}
          </div>
        )}
      </div>
    </div>
  )
})

ClusterNode.displayName = 'ClusterNode'

export default ClusterNode
