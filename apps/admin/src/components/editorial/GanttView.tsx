/**
 * Gantt View Component
 * Timeline view for editorial tasks with phase breakdown
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, differenceInDays, parseISO } from 'date-fns'
import { useEditorialTasks } from '../../hooks/useEditorialTasks'
import { TaskDetailModal } from './TaskDetailModal'
import type { EditorialTask, TaskPhase } from '../../hooks/useEditorialTasks'

interface GanttViewProps {
  websiteId: string
}

interface TimelineConfig {
  startDate: Date
  endDate: Date
  days: Date[]
  pixelsPerDay: number
}

const PHASE_COLORS: Record<TaskPhase, string> = {
  research: 'bg-purple-500',
  outline: 'bg-blue-500',
  draft: 'bg-green-500',
  edit: 'bg-yellow-500',
  review: 'bg-orange-500',
  publish: 'bg-red-500',
  optimize: 'bg-pink-500',
}

const PHASE_ORDER: TaskPhase[] = ['research', 'outline', 'draft', 'edit', 'review', 'publish', 'optimize']

export function GanttView({ websiteId }: GanttViewProps) {
  const {
    tasks,
    isLoading,
    error,
    updateTask,
    deleteTask,
    refresh,
    createGitHubIssue,
    createGitHubPR,
    syncFromGitHubPR,
  } = useEditorialTasks(websiteId)

  const [selectedTask, setSelectedTask] = useState<EditorialTask | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [viewMode, setViewMode] = useState<'week' | 'month' | 'quarter'>('month')
  const [currentDate, setCurrentDate] = useState(new Date())
  const ganttRef = useRef<HTMLDivElement>(null)

  // Calculate timeline configuration
  const timeline = useMemo((): TimelineConfig => {
    let startDate: Date
    let endDate: Date

    if (viewMode === 'week') {
      startDate = startOfWeek(currentDate)
      endDate = endOfWeek(currentDate)
    } else if (viewMode === 'month') {
      startDate = startOfWeek(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1))
      endDate = endOfWeek(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0))
    } else {
      // Quarter view
      const quarter = Math.floor(currentDate.getMonth() / 3)
      startDate = startOfWeek(new Date(currentDate.getFullYear(), quarter * 3, 1))
      endDate = endOfWeek(new Date(currentDate.getFullYear(), (quarter + 1) * 3, 0))
    }

    const days = eachDayOfInterval({ start: startDate, end: endDate })
    const pixelsPerDay = viewMode === 'week' ? 120 : viewMode === 'month' ? 40 : 15

    return { startDate, endDate, days, pixelsPerDay }
  }, [currentDate, viewMode])

  // Filter tasks that have dates
  const scheduledTasks = useMemo(() => {
    return tasks.filter(task => task.started_at || task.due_date)
  }, [tasks])

  // Calculate task bar position and width
  const getTaskBarStyles = (task: EditorialTask) => {
    const startDate = task.started_at ? parseISO(task.started_at) : timeline.startDate
    const endDate = task.due_date ? parseISO(task.due_date) : addDays(startDate, task.estimated_hours ? Math.ceil(task.estimated_hours / 8) : 7)

    const daysFromStart = differenceInDays(startDate, timeline.startDate)
    const duration = differenceInDays(endDate, startDate) + 1

    const left = daysFromStart * timeline.pixelsPerDay
    const width = duration * timeline.pixelsPerDay

    return { left: `${left}px`, width: `${width}px` }
  }

  // Get phase progress for task
  const getPhaseBreakdown = (task: EditorialTask) => {
    const phases = task.phases || {}
    const completedPhases = PHASE_ORDER.filter(phase => phases[phase]?.completed)
    const currentPhase = PHASE_ORDER.find(phase => phases[phase]?.in_progress)

    return { completedPhases, currentPhase, allPhases: phases }
  }

  const handleTaskClick = (task: EditorialTask) => {
    setSelectedTask(task)
    setShowDetailModal(true)
  }

  const handleCloseDetailModal = () => {
    setShowDetailModal(false)
    setSelectedTask(null)
  }

  const handleTaskDelete = async (taskId: string) => {
    if (confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteTask(taskId)
        setShowDetailModal(false)
      } catch (err) {
        console.error('Failed to delete task:', err)
      }
    }
  }

  const handleTaskEdit = (task: EditorialTask) => {
    // Navigate to Kanban view with edit modal
    window.location.href = `/editorial/kanban?edit=${task.id}`
  }

  const navigateDate = (direction: 'prev' | 'next') => {
    if (viewMode === 'week') {
      setCurrentDate(prev => addDays(prev, direction === 'next' ? 7 : -7))
    } else if (viewMode === 'month') {
      setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + (direction === 'next' ? 1 : -1), 1))
    } else {
      setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + (direction === 'next' ? 3 : -3), 1))
    }
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
          <p className="text-gray-600">Loading timeline...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">⚠️ {error}</p>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-red-100 hover:bg-red-200 rounded"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const today = new Date()

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header Controls */}
      <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-gray-900">Timeline View</h2>

          {/* View Mode Selector */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 rounded ${viewMode === 'week' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'}`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1 rounded ${viewMode === 'month' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'}`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('quarter')}
              className={`px-3 py-1 rounded ${viewMode === 'quarter' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'}`}
            >
              Quarter
            </button>
          </div>

          {/* Date Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateDate('prev')}
              className="p-2 hover:bg-gray-100 rounded"
            >
              ←
            </button>
            <div className="min-w-[200px] text-center font-medium">
              {viewMode === 'week' && format(timeline.startDate, 'MMM d')} - {format(timeline.endDate, 'MMM d, yyyy')}
              {viewMode === 'month' && format(currentDate, 'MMMM yyyy')}
              {viewMode === 'quarter' && `Q${Math.floor(currentDate.getMonth() / 3) + 1} ${currentDate.getFullYear()}`}
            </div>
            <button
              onClick={() => navigateDate('next')}
              className="p-2 hover:bg-gray-100 rounded"
            >
              →
            </button>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="ml-2 px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 rounded"
            >
              Today
            </button>
          </div>
        </div>

        <div className="text-sm text-gray-600">
          {scheduledTasks.length} of {tasks.length} tasks scheduled
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center gap-4 text-xs">
          <span className="font-medium text-gray-700">Phases:</span>
          {PHASE_ORDER.map(phase => (
            <div key={phase} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded ${PHASE_COLORS[phase]}`}></div>
              <span className="text-gray-600 capitalize">{phase}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Gantt Chart */}
      <div ref={ganttRef} className="flex-1 overflow-auto">
        <div className="min-w-max">
          {/* Timeline Header */}
          <div className="sticky top-0 z-10 bg-gray-100 border-b border-gray-300">
            <div className="flex">
              <div className="w-64 flex-shrink-0 border-r border-gray-300 bg-gray-200 px-4 py-2 font-medium">
                Task
              </div>
              <div className="flex">
                {timeline.days.map((day, index) => (
                  <div
                    key={index}
                    className={`flex-shrink-0 border-r border-gray-200 px-2 py-2 text-center ${
                      isSameDay(day, today) ? 'bg-blue-50' : ''
                    }`}
                    style={{ width: `${timeline.pixelsPerDay}px` }}
                  >
                    <div className="text-xs font-medium">{format(day, 'EEE')}</div>
                    <div className={`text-xs ${isSameDay(day, today) ? 'text-blue-600 font-bold' : 'text-gray-600'}`}>
                      {format(day, 'd')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Task Rows */}
          <div className="relative">
            {/* SVG Layer for Dependency Lines */}
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ zIndex: 1 }}
            >
              {scheduledTasks.map((task, taskIndex) => {
                if (!task.depends_on || task.depends_on.length === 0) return null

                return task.depends_on.map((depId, depIndex) => {
                  const dependencyTask = scheduledTasks.find(t => t.id === depId)
                  if (!dependencyTask) return null

                  const depTaskIndex = scheduledTasks.indexOf(dependencyTask)
                  const taskStyles = getTaskBarStyles(task)
                  const depStyles = getTaskBarStyles(dependencyTask)

                  // Calculate line coordinates
                  const x1 = parseFloat(depStyles.left) + parseFloat(depStyles.width)
                  const y1 = (depTaskIndex * 64) + 32 + 50 // 64px per row, 32px center, 50px header
                  const x2 = parseFloat(taskStyles.left)
                  const y2 = (taskIndex * 64) + 32 + 50

                  return (
                    <g key={`${task.id}-${depId}-${depIndex}`}>
                      <defs>
                        <marker
                          id={`arrowhead-${task.id}-${depIndex}`}
                          markerWidth="10"
                          markerHeight="10"
                          refX="8"
                          refY="3"
                          orient="auto"
                        >
                          <polygon points="0 0, 10 3, 0 6" fill="#6b7280" />
                        </marker>
                      </defs>
                      <path
                        d={`M ${x1 + 264} ${y1} L ${x2 + 264} ${y2}`}
                        stroke="#6b7280"
                        strokeWidth="2"
                        fill="none"
                        markerEnd={`url(#arrowhead-${task.id}-${depIndex})`}
                        opacity="0.5"
                      />
                    </g>
                  )
                })
              })}
            </svg>

            {scheduledTasks.map((task, index) => {
              const styles = getTaskBarStyles(task)
              const { completedPhases, currentPhase } = getPhaseBreakdown(task)

              return (
                <div
                  key={task.id}
                  className={`flex border-b border-gray-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  style={{ position: 'relative', zIndex: 2 }}
                >
                  {/* Task Label */}
                  <div className="w-64 flex-shrink-0 border-r border-gray-200 px-4 py-3">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {task.title}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {task.assigned_agent_id || 'Unassigned'}
                    </div>
                  </div>

                  {/* Timeline Grid */}
                  <div className="flex-1 relative h-16">
                    {/* Today Marker */}
                    {timeline.days.map((day, dayIndex) =>
                      isSameDay(day, today) ? (
                        <div
                          key={dayIndex}
                          className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-5"
                          style={{ left: `${dayIndex * timeline.pixelsPerDay}px` }}
                        />
                      ) : null
                    )}

                    {/* Task Bar */}
                    <div
                      className="absolute top-2 bottom-2 rounded cursor-pointer hover:opacity-80 transition-opacity group"
                      style={styles}
                      onClick={() => handleTaskClick(task)}
                    >
                      {/* Phase Breakdown */}
                      <div className="flex h-full">
                        {PHASE_ORDER.map((phase, phaseIndex) => {
                          const isCompleted = completedPhases.includes(phase)
                          const isCurrent = currentPhase === phase
                          const isUpcoming = !isCompleted && !isCurrent

                          return (
                            <div
                              key={phase}
                              className={`flex-1 ${PHASE_COLORS[phase]} ${
                                isCompleted ? 'opacity-100' : isCurrent ? 'opacity-75' : 'opacity-30'
                              } ${phaseIndex > 0 ? 'border-l border-white' : ''} ${
                                phaseIndex === 0 ? 'rounded-l' : ''
                              } ${phaseIndex === PHASE_ORDER.length - 1 ? 'rounded-r' : ''}`}
                              title={`${phase}${isCompleted ? ' (completed)' : isCurrent ? ' (in progress)' : ''}`}
                            />
                          )
                        })}
                      </div>

                      {/* Task Title Overlay */}
                      <div className="absolute inset-0 flex items-center px-2">
                        <span className="text-xs font-medium text-white drop-shadow truncate">
                          {task.title}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Empty State */}
            {scheduledTasks.length === 0 && (
              <div className="flex items-center justify-center h-64 text-gray-500">
                <div className="text-center">
                  <p className="mb-2">No scheduled tasks</p>
                  <p className="text-sm">Tasks need a start date or due date to appear on the timeline</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Task Detail Modal */}
      {showDetailModal && selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          websiteId={websiteId}
          onClose={handleCloseDetailModal}
          onEdit={() => handleTaskEdit(selectedTask)}
          onDelete={() => handleTaskDelete(selectedTask.id)}
          onCreateGitHubIssue={createGitHubIssue}
          onCreateGitHubPR={createGitHubPR}
          onSyncGitHubPR={syncFromGitHubPR}
        />
      )}
    </div>
  )
}
