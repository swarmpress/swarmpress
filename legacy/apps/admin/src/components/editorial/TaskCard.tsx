/**
 * Task Card Component
 * Visual card for Kanban board with priority badges and phase indicators
 */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type TaskType = 'article' | 'page' | 'update' | 'fix' | 'optimize' | 'research'
type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'blocked' | 'completed' | 'cancelled'
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
type TaskPhase = 'research' | 'outline' | 'draft' | 'edit' | 'review' | 'publish' | 'optimize'

interface TaskCardProps {
  task: {
    id: string
    title: string
    description?: string
    task_type: TaskType
    status: TaskStatus
    priority: TaskPriority
    assigned_agent_id?: string
    due_date?: string
    current_phase?: TaskPhase
    phases_completed?: string[]
    tags?: string[]
    sitemap_targets?: string[]
    seo_primary_keyword?: string
  }
  onClick?: () => void
  onDelete?: () => void
  onEdit?: () => void
}

const priorityColors: Record<TaskPriority, string> = {
  low: 'bg-gray-100 text-gray-700 border-gray-300',
  medium: 'bg-blue-100 text-blue-700 border-blue-300',
  high: 'bg-orange-100 text-orange-700 border-orange-300',
  urgent: 'bg-red-100 text-red-700 border-red-300',
}

const taskTypeIcons: Record<TaskType, string> = {
  article: '📄',
  page: '📃',
  update: '🔄',
  fix: '🔧',
  optimize: '⚡',
  research: '🔍',
}

const phaseOrder: TaskPhase[] = ['research', 'outline', 'draft', 'edit', 'review', 'publish', 'optimize']

export function TaskCard({ task, onClick, onDelete, onEdit }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Calculate phase progress
  const completedPhaseCount = task.phases_completed?.length || 0
  const currentPhaseIndex = task.current_phase
    ? phaseOrder.indexOf(task.current_phase)
    : 0
  const totalPhases = phaseOrder.length
  const progressPercentage = Math.round(((completedPhaseCount + currentPhaseIndex) / totalPhases) * 100)

  // Check if overdue
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()
  const daysUntilDue = task.due_date
    ? Math.ceil((new Date(task.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-lg border-2 p-3 mb-2 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
        isDragging ? 'shadow-lg border-blue-400' : 'border-gray-200'
      }`}
      onClick={onClick}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="flex items-center justify-between mb-2 cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{taskTypeIcons[task.task_type]}</span>
          <span
            className={`px-2 py-0.5 rounded text-xs font-semibold border ${priorityColors[task.priority]}`}
          >
            {task.priority}
          </span>
        </div>
        <div className="flex gap-1">
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              className="text-gray-400 hover:text-blue-600 transition-colors"
              title="Edit task"
            >
              ✏️
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="text-gray-400 hover:text-red-600 transition-colors"
              title="Delete task"
            >
              🗑️
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="font-semibold text-sm mb-2 line-clamp-2">{task.title}</h3>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-gray-600 mb-2 line-clamp-2">{task.description}</p>
      )}

      {/* Phase Progress */}
      {task.current_phase && (
        <div className="mb-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-gray-500 capitalize">{task.current_phase}</span>
            <span className="text-xs text-gray-500">{progressPercentage}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* SEO Keyword */}
      {task.seo_primary_keyword && (
        <div className="mb-2">
          <span className="text-xs text-gray-500">🎯 {task.seo_primary_keyword}</span>
        </div>
      )}

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
            >
              {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
              +{task.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-between items-center text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
        {/* Due Date */}
        <div>
          {task.due_date && (
            <span
              className={`${
                isOverdue
                  ? 'text-red-600 font-semibold'
                  : daysUntilDue !== null && daysUntilDue <= 3
                  ? 'text-orange-600 font-semibold'
                  : 'text-gray-500'
              }`}
            >
              📅 {isOverdue ? 'Overdue' : daysUntilDue !== null ? `${daysUntilDue}d` : 'Due'}
            </span>
          )}
        </div>

        {/* Sitemap Targets */}
        {task.sitemap_targets && task.sitemap_targets.length > 0 && (
          <span className="text-gray-400" title={`${task.sitemap_targets.length} page(s)`}>
            🗺️ {task.sitemap_targets.length}
          </span>
        )}

        {/* Agent Badge */}
        {task.assigned_agent_id && (
          <div
            className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold"
            title={task.assigned_agent_id}
          >
            {task.assigned_agent_id.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    </div>
  )
}

export function TaskCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border-2 border-gray-200 p-3 mb-2 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-gray-200 rounded" />
          <div className="w-16 h-5 bg-gray-200 rounded" />
        </div>
      </div>
      <div className="w-3/4 h-4 bg-gray-200 rounded mb-2" />
      <div className="w-full h-3 bg-gray-200 rounded mb-2" />
      <div className="w-1/2 h-3 bg-gray-200 rounded" />
    </div>
  )
}
