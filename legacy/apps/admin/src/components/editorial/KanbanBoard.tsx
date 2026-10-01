/**
 * Kanban Board Component
 * Drag-and-drop task board for editorial planning
 */

import { useState, useEffect } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { TaskCard, TaskCardSkeleton } from './TaskCard'

type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'blocked' | 'completed' | 'cancelled'
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

interface Task {
  id: string
  title: string
  description?: string
  task_type: 'article' | 'page' | 'update' | 'fix' | 'optimize' | 'research'
  status: TaskStatus
  priority: TaskPriority
  assigned_agent_id?: string
  due_date?: string
  current_phase?: string
  phases_completed?: string[]
  tags?: string[]
  sitemap_targets?: string[]
  seo_primary_keyword?: string
}

interface KanbanBoardProps {
  websiteId: string
  tasks: Task[]
  loading?: boolean
  onTaskMove?: (taskId: string, newStatus: TaskStatus) => void
  onTaskClick?: (task: Task) => void
  onTaskDelete?: (taskId: string) => void
  onTaskEdit?: (task: Task) => void
}

const columns: Array<{ id: TaskStatus; title: string; color: string }> = [
  { id: 'backlog', title: 'Backlog', color: 'bg-gray-100 border-gray-300' },
  { id: 'ready', title: 'Ready', color: 'bg-blue-100 border-blue-300' },
  { id: 'in_progress', title: 'In Progress', color: 'bg-yellow-100 border-yellow-300' },
  { id: 'in_review', title: 'In Review', color: 'bg-purple-100 border-purple-300' },
  { id: 'blocked', title: 'Blocked', color: 'bg-red-100 border-red-300' },
  { id: 'completed', title: 'Completed', color: 'bg-green-100 border-green-300' },
]

export function KanbanBoard({
  websiteId,
  tasks,
  loading = false,
  onTaskMove,
  onTaskClick,
  onTaskDelete,
  onTaskEdit,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tasksByStatus, setTasksByStatus] = useState<Record<TaskStatus, Task[]>>({
    backlog: [],
    ready: [],
    in_progress: [],
    in_review: [],
    blocked: [],
    completed: [],
    cancelled: [],
  })

  // Group tasks by status
  useEffect(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      backlog: [],
      ready: [],
      in_progress: [],
      in_review: [],
      blocked: [],
      completed: [],
      cancelled: [],
    }

    tasks.forEach((task) => {
      grouped[task.status].push(task)
    })

    // Sort by priority (urgent > high > medium > low)
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
    Object.keys(grouped).forEach((status) => {
      grouped[status as TaskStatus].sort((a, b) => {
        return priorityOrder[a.priority] - priorityOrder[b.priority]
      })
    })

    setTasksByStatus(grouped)
  }, [tasks])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (!over) {
      setActiveId(null)
      return
    }

    const taskId = active.id as string
    const newStatus = over.id as TaskStatus

    // Find the task
    const task = tasks.find((t) => t.id === taskId)
    if (!task) {
      setActiveId(null)
      return
    }

    // If status changed, notify parent
    if (task.status !== newStatus) {
      onTaskMove?.(taskId, newStatus)
    }

    setActiveId(null)
  }

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  if (loading) {
    return (
      <div className="grid grid-cols-6 gap-4 h-full">
        {columns.map((column) => (
          <div key={column.id} className={`rounded-lg border-2 p-4 ${column.color}`}>
            <h3 className="font-semibold mb-4">{column.title}</h3>
            <TaskCardSkeleton />
            <TaskCardSkeleton />
          </div>
        ))}
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-6 gap-4 h-full overflow-x-auto">
        {columns.map((column) => (
          <SortableContext
            key={column.id}
            id={column.id}
            items={tasksByStatus[column.id].map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div
              className={`rounded-lg border-2 p-4 ${column.color} min-h-[500px] flex flex-col`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm">{column.title}</h3>
                <span className="bg-white rounded-full px-2 py-0.5 text-xs font-semibold">
                  {tasksByStatus[column.id].length}
                </span>
              </div>

              {/* Task Cards */}
              <div className="flex-1 overflow-y-auto">
                {tasksByStatus[column.id].length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-8">
                    No tasks
                  </div>
                ) : (
                  tasksByStatus[column.id].map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={() => onTaskClick?.(task)}
                      onDelete={() => onTaskDelete?.(task.id)}
                      onEdit={() => onTaskEdit?.(task)}
                    />
                  ))
                )}
              </div>
            </div>
          </SortableContext>
        ))}
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeTask ? (
          <div className="rotate-3 scale-105">
            <TaskCard task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
