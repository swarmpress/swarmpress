/**
 * Shadcn Kanban View Component
 * Uses shadcn/ui kanban component with real editorial tasks data
 */

import { useMemo } from 'react'
import {
  KanbanProvider,
  KanbanBoard,
  KanbanHeader,
  KanbanCards,
  KanbanCard,
  type DragEndEvent,
} from '../ui/kanban'
import { useToast } from '../Toast'
import { useEditorialTasks, type TaskStatus } from '../../hooks/useEditorialTasks'

interface ShadcnKanbanViewProps {
  websiteId: string
}

// Column definitions matching our task statuses
const COLUMNS = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'ready', name: 'Ready' },
  { id: 'in_progress', name: 'In Progress' },
  { id: 'in_review', name: 'In Review' },
  { id: 'blocked', name: 'Blocked' },
  { id: 'completed', name: 'Completed' },
]

// Priority colors
const PRIORITY_COLORS = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-red-100 text-red-800',
}

export function ShadcnKanbanView({ websiteId }: ShadcnKanbanViewProps) {
  const { showToast } = useToast()
  const {
    tasks,
    stats,
    isLoading,
    error,
    updateTaskStatus,
  } = useEditorialTasks(websiteId)

  // Transform tasks to kanban format
  const kanbanData = useMemo(() => {
    return tasks.map((task) => ({
      id: task.id,
      name: task.title,
      column: task.status,
      priority: task.priority,
      taskType: task.task_type,
      description: task.description,
      dueDate: task.due_date,
      assignedAgent: task.assigned_agent_id,
      tags: task.tags,
    }))
  }, [tasks])

  const handleDataChange = async (newData: typeof kanbanData) => {
    // Find which task changed status
    for (const newTask of newData) {
      const oldTask = kanbanData.find((t) => t.id === newTask.id)
      if (oldTask && oldTask.column !== newTask.column) {
        try {
          await updateTaskStatus(newTask.id, newTask.column as TaskStatus)
          showToast(`Task moved to ${newTask.column}`, 'success')
        } catch (err) {
          showToast(`Failed to update task status: ${err.message}`, 'error')
        }
      }
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    console.log('Drag ended:', event)
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading tasks...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-red-600">
          <p className="text-lg font-semibold">Error loading tasks</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full p-4">
      {/* Stats Bar */}
      {stats && (
        <div className="mb-4 flex gap-4">
          <div className="rounded-lg bg-white px-4 py-2 shadow-sm border">
            <p className="text-xs text-gray-600">Total Tasks</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </div>
          <div className="rounded-lg bg-white px-4 py-2 shadow-sm border">
            <p className="text-xs text-gray-600">In Progress</p>
            <p className="text-2xl font-bold">{stats.by_status.in_progress || 0}</p>
          </div>
          <div className="rounded-lg bg-white px-4 py-2 shadow-sm border">
            <p className="text-xs text-gray-600">Completed</p>
            <p className="text-2xl font-bold">{stats.by_status.completed || 0}</p>
          </div>
          {stats.blocked_count > 0 && (
            <div className="rounded-lg bg-red-50 px-4 py-2 shadow-sm border border-red-200">
              <p className="text-xs text-red-600">Blocked</p>
              <p className="text-2xl font-bold text-red-700">{stats.blocked_count}</p>
            </div>
          )}
        </div>
      )}

      {/* Kanban Board */}
      <div className="h-[calc(100%-6rem)]">
        <KanbanProvider
          columns={COLUMNS}
          data={kanbanData}
          onDataChange={handleDataChange}
          onDragEnd={handleDragEnd}
        >
          {(column) => (
            <KanbanBoard id={column.id} key={column.id}>
              <KanbanHeader>
                <div className="flex items-center justify-between">
                  <span>{column.name}</span>
                  <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs">
                    {kanbanData.filter((t) => t.column === column.id).length}
                  </span>
                </div>
              </KanbanHeader>
              <KanbanCards id={column.id}>
                {(task) => (
                  <KanbanCard key={task.id} {...task}>
                    <div className="space-y-2">
                      {/* Task Title */}
                      <h4 className="font-medium text-sm line-clamp-2">{task.name}</h4>

                      {/* Priority Badge */}
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                            PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS]
                          }`}
                        >
                          {task.priority}
                        </span>
                        <span className="text-xs text-gray-500 capitalize">
                          {task.taskType}
                        </span>
                      </div>

                      {/* Description */}
                      {task.description && (
                        <p className="text-xs text-gray-600 line-clamp-2">
                          {task.description}
                        </p>
                      )}

                      {/* Tags */}
                      {task.tags && task.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {task.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Due Date */}
                      {task.dueDate && (
                        <p className="text-xs text-gray-500">
                          Due: {new Date(task.dueDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </KanbanCard>
                )}
              </KanbanCards>
            </KanbanBoard>
          )}
        </KanbanProvider>
      </div>
    </div>
  )
}
