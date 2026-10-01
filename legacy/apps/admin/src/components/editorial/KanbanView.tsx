/**
 * Kanban View Component
 * Main container that integrates all Kanban components with tRPC
 */

import { useState, useMemo, useEffect } from 'react'
import { KanbanBoard } from './KanbanBoard'
import { KanbanFilters } from './KanbanFilters'
import { KanbanStats } from './KanbanStats'
import { TaskDetailModal } from './TaskDetailModal'
import { TaskFormModal } from './TaskFormModal'
import { useToast } from '../Toast'
import { useEditorialTasks } from '../../hooks/useEditorialTasks'
import type { TaskType, TaskStatus, TaskPriority } from '../../hooks/useEditorialTasks'

interface KanbanViewProps {
  websiteId: string
}

export function KanbanView({ websiteId }: KanbanViewProps) {
  const { showToast } = useToast()
  const {
    tasks,
    stats,
    isLoading,
    error,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask,
    refresh,
    createGitHubIssue,
    createGitHubPR,
    syncFromGitHubPR,
  } = useEditorialTasks(websiteId)

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [showOverdueOnly, setShowOverdueOnly] = useState(false)

  // Modal state
  const [selectedTask, setSelectedTask] = useState<any | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showFormModal, setShowFormModal] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editingTask, setEditingTask] = useState<any | null>(null)

  // Listen for new task event from page
  useEffect(() => {
    const handleNewTask = () => {
      handleCreateTask()
    }
    window.addEventListener('kanban:new-task', handleNewTask)
    return () => window.removeEventListener('kanban:new-task', handleNewTask)
  }, [])

  // Apply filters
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesSearch =
          task.title.toLowerCase().includes(query) ||
          task.description?.toLowerCase().includes(query) ||
          task.tags?.some(tag => tag.toLowerCase().includes(query))
        if (!matchesSearch) return false
      }

      // Priority filter
      if (selectedPriorities.length > 0 && !selectedPriorities.includes(task.priority)) {
        return false
      }

      // Type filter
      if (selectedTypes.length > 0 && !selectedTypes.includes(task.task_type)) {
        return false
      }

      // Tags filter
      if (selectedTags.length > 0) {
        const hasTag = selectedTags.some(tag => task.tags?.includes(tag))
        if (!hasTag) return false
      }

      // Agent filter
      if (selectedAgent && task.assigned_agent_id !== selectedAgent) {
        return false
      }

      // Overdue filter
      if (showOverdueOnly) {
        const isOverdue = task.due_date && new Date(task.due_date) < new Date()
        if (!isOverdue) return false
      }

      return true
    })
  }, [tasks, searchQuery, selectedPriorities, selectedTypes, selectedTags, selectedAgent, showOverdueOnly])

  // Get unique tags and agents for filters
  const availableTags = useMemo(() => {
    const allTags = tasks.flatMap(task => task.tags || [])
    return Array.from(new Set(allTags)).sort()
  }, [tasks])

  const availableAgents = useMemo(() => {
    const agentIds = tasks
      .map(task => task.assigned_agent_id)
      .filter((id): id is string => !!id)
    const uniqueIds = Array.from(new Set(agentIds))
    return uniqueIds.map(id => ({ id, name: id }))
  }, [tasks])

  // Handlers
  const handleTaskMove = async (taskId: string, newStatus: any) => {
    try {
      await updateTaskStatus(taskId, newStatus as TaskStatus)
      showToast(`Task moved to ${newStatus}`, 'success', 2000)
    } catch (err) {
      showToast('Failed to update task status', 'error', 3000)
    }
  }

  const handleTaskClick = (task: any) => {
    setSelectedTask(task)
    setShowDetailModal(true)
  }

  const handleTaskDelete = async (taskId: string) => {
    if (confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteTask(taskId)
        showToast('Task deleted', 'success', 2000)
        setShowDetailModal(false)
      } catch (err) {
        showToast('Failed to delete task', 'error', 3000)
      }
    }
  }

  const handleTaskEdit = (task: any) => {
    setEditingTask(task)
    setFormMode('edit')
    setShowFormModal(true)
    setShowDetailModal(false)
  }

  const handleCreateTask = () => {
    setEditingTask(null)
    setFormMode('create')
    setShowFormModal(true)
  }

  const handleFormSubmit = async (formData: any) => {
    try {
      if (formMode === 'create') {
        await createTask({
          title: formData.title,
          description: formData.description,
          taskType: formData.task_type as TaskType,
          status: formData.status as TaskStatus,
          priority: formData.priority as TaskPriority,
          assignedAgentId: formData.assigned_agent_id,
          assignedHuman: formData.assigned_human,
          dueDate: formData.due_date,
          estimatedHours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : undefined,
          tags: formData.tags ? formData.tags.split(',').map((t: string) => t.trim()) : undefined,
          seoPrimaryKeyword: formData.seo_primary_keyword,
          seoSecondaryKeywords: formData.seo_secondary_keywords
            ? formData.seo_secondary_keywords.split(',').map((k: string) => k.trim())
            : undefined,
          wordCountTarget: formData.word_count_target ? parseInt(formData.word_count_target, 10) : undefined,
          contentType: formData.content_type,
          notes: formData.notes,
        })
        showToast('Task created successfully', 'success', 3000)
      } else if (editingTask) {
        await updateTask(editingTask.id, {
          title: formData.title,
          description: formData.description,
          status: formData.status as TaskStatus,
          priority: formData.priority as TaskPriority,
          assignedAgentId: formData.assigned_agent_id,
          assignedHuman: formData.assigned_human,
          dueDate: formData.due_date,
          estimatedHours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : undefined,
          tags: formData.tags ? formData.tags.split(',').map((t: string) => t.trim()) : undefined,
          notes: formData.notes,
          seoPrimaryKeyword: formData.seo_primary_keyword,
          seoSecondaryKeywords: formData.seo_secondary_keywords
            ? formData.seo_secondary_keywords.split(',').map((k: string) => k.trim())
            : undefined,
          wordCountTarget: formData.word_count_target ? parseInt(formData.word_count_target, 10) : undefined,
          contentType: formData.content_type,
        })
        showToast('Task updated successfully', 'success', 3000)
      }
      setShowFormModal(false)
      setEditingTask(null)
    } catch (err) {
      showToast(`Failed to ${formMode === 'create' ? 'create' : 'update'} task`, 'error', 3000)
    }
  }

  const handleCloseDetailModal = () => {
    setShowDetailModal(false)
    setSelectedTask(null)
  }

  const handleCloseFormModal = () => {
    setShowFormModal(false)
    setEditingTask(null)
  }

  return (
    <div className="h-full flex flex-col p-6 bg-gray-50 overflow-auto">
      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <div className="flex items-center justify-between">
            <span>⚠️ {error}</span>
            <button
              onClick={refresh}
              className="px-3 py-1 bg-red-100 hover:bg-red-200 rounded text-sm"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Statistics */}
      <KanbanStats stats={stats} loading={isLoading} />

      {/* Filters */}
      <KanbanFilters
        onSearchChange={setSearchQuery}
        onPriorityChange={setSelectedPriorities}
        onTypeChange={setSelectedTypes}
        onTagsChange={setSelectedTags}
        onAgentChange={setSelectedAgent}
        onOverdueChange={setShowOverdueOnly}
        availableTags={availableTags}
        availableAgents={availableAgents}
      />

      {/* Kanban Board */}
      <div className="flex-1 min-h-0">
        <KanbanBoard
          websiteId={websiteId}
          tasks={filteredTasks}
          loading={isLoading}
          onTaskMove={handleTaskMove}
          onTaskClick={handleTaskClick}
          onTaskDelete={handleTaskDelete}
          onTaskEdit={handleTaskEdit}
        />
      </div>

      {/* Results Count */}
      <div className="mt-4 text-sm text-gray-600 text-center">
        Showing {filteredTasks.length} of {tasks.length} tasks
      </div>

      {/* Task Detail Modal */}
      {showDetailModal && selectedTask && (
        <TaskDetailModal
          task={{
            ...selectedTask,
            created_at: selectedTask.created_at || new Date().toISOString(),
            updated_at: selectedTask.updated_at || new Date().toISOString(),
          }}
          websiteId={websiteId}
          onClose={handleCloseDetailModal}
          onEdit={() => handleTaskEdit(selectedTask)}
          onDelete={() => handleTaskDelete(selectedTask.id)}
          onCreateGitHubIssue={createGitHubIssue}
          onCreateGitHubPR={createGitHubPR}
          onSyncGitHubPR={syncFromGitHubPR}
        />
      )}

      {/* Task Form Modal */}
      {showFormModal && (
        <TaskFormModal
          mode={formMode}
          initialData={editingTask ? {
            title: editingTask.title,
            description: editingTask.description || '',
            task_type: editingTask.task_type,
            status: editingTask.status,
            priority: editingTask.priority,
            assigned_agent_id: editingTask.assigned_agent_id || '',
            assigned_human: editingTask.assigned_human || '',
            due_date: editingTask.due_date || '',
            estimated_hours: editingTask.estimated_hours?.toString() || '',
            tags: editingTask.tags?.join(', ') || '',
            seo_primary_keyword: editingTask.seo_primary_keyword || '',
            seo_secondary_keywords: editingTask.seo_secondary_keywords?.join(', ') || '',
            word_count_target: editingTask.word_count_target?.toString() || '',
            content_type: editingTask.content_type || '',
            notes: editingTask.notes || '',
          } : undefined}
          onSubmit={handleFormSubmit}
          onClose={handleCloseFormModal}
        />
      )}
    </div>
  )
}

// Export the handleCreateTask function for use in the page
export { KanbanView as default }
export type { KanbanViewProps }
