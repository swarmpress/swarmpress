/**
 * TaskNode Component
 * Custom node rendering for ReactFlow graph view
 */

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { EditorialTask } from '../../hooks/useEditorialTasks'

interface TaskNodeProps {
  data: {
    task: EditorialTask
    statusColor: string
    priorityColor: string
  }
}

export const TaskNode = memo(({ data }: TaskNodeProps) => {
  const { task, statusColor, priorityColor } = data

  // Calculate phase progress
  const phases = task.phases || {}
  const totalPhases = 7 // research, outline, draft, edit, review, publish, optimize
  const completedPhases = Object.values(phases).filter((p) => p?.completed).length
  const progressPercent = (completedPhases / totalPhases) * 100

  return (
    <div
      className="bg-white rounded-lg shadow-lg border-2 p-3 min-w-[280px]"
      style={{ borderColor: priorityColor }}
    >
      {/* Handles for connections */}
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />

      {/* Header with status badge */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 pr-2">
          <h3 className="font-semibold text-sm text-gray-900 line-clamp-2">
            {task.title}
          </h3>
        </div>
        <div
          className="px-2 py-1 rounded text-xs font-medium text-white shrink-0"
          style={{ backgroundColor: statusColor }}
        >
          {task.status.replace('_', ' ')}
        </div>
      </div>

      {/* Task Type */}
      <div className="mb-2">
        <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
          {task.task_type}
        </span>
      </div>

      {/* Progress Bar */}
      {completedPhases > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
            <span>Progress</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: statusColor,
              }}
            ></div>
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-1 text-xs text-gray-600">
        {task.assigned_agent_id && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">🤖</span>
            <span className="truncate">{task.assigned_agent_id}</span>
          </div>
        )}
        {task.assigned_human && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">👤</span>
            <span className="truncate">{task.assigned_human}</span>
          </div>
        )}
        {task.due_date && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">📅</span>
            <span>{new Date(task.due_date).toLocaleDateString()}</span>
          </div>
        )}
        {task.estimated_hours && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">⏱️</span>
            <span>{task.estimated_hours}h</span>
          </div>
        )}
      </div>

      {/* Priority Indicator */}
      <div className="mt-2 pt-2 border-t border-gray-200">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Priority:</span>
          <span
            className="font-medium capitalize"
            style={{ color: priorityColor }}
          >
            {task.priority}
          </span>
        </div>
      </div>

      {/* Dependencies count */}
      {task.depends_on && task.depends_on.length > 0 && (
        <div className="mt-1 text-xs text-gray-500">
          ↑ {task.depends_on.length} {task.depends_on.length === 1 ? 'dependency' : 'dependencies'}
        </div>
      )}
    </div>
  )
})

TaskNode.displayName = 'TaskNode'
