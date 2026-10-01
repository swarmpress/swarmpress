/**
 * Task Form Modal Component
 * Create or edit editorial tasks with full validation
 */

import { useState, useEffect } from 'react'

type TaskType = 'article' | 'page' | 'update' | 'fix' | 'optimize' | 'research'
type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'blocked' | 'completed' | 'cancelled'
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

interface TaskFormData {
  title: string
  description: string
  task_type: TaskType
  status: TaskStatus
  priority: TaskPriority
  assigned_agent_id: string
  assigned_human: string
  due_date: string
  estimated_hours: string
  tags: string
  seo_primary_keyword: string
  seo_secondary_keywords: string
  word_count_target: string
  content_type: string
  notes: string
}

interface TaskFormModalProps {
  mode: 'create' | 'edit'
  initialData?: Partial<TaskFormData>
  onSubmit: (data: TaskFormData) => void
  onClose: () => void
}

export function TaskFormModal({ mode, initialData, onSubmit, onClose }: TaskFormModalProps) {
  const [formData, setFormData] = useState<TaskFormData>({
    title: initialData?.title || '',
    description: initialData?.description || '',
    task_type: initialData?.task_type || 'article',
    status: initialData?.status || 'backlog',
    priority: initialData?.priority || 'medium',
    assigned_agent_id: initialData?.assigned_agent_id || '',
    assigned_human: initialData?.assigned_human || '',
    due_date: initialData?.due_date || '',
    estimated_hours: initialData?.estimated_hours || '',
    tags: initialData?.tags || '',
    seo_primary_keyword: initialData?.seo_primary_keyword || '',
    seo_secondary_keywords: initialData?.seo_secondary_keywords || '',
    word_count_target: initialData?.word_count_target || '',
    content_type: initialData?.content_type || '',
    notes: initialData?.notes || '',
  })

  const [errors, setErrors] = useState<Partial<Record<keyof TaskFormData, string>>>({})
  const [activeTab, setActiveTab] = useState<'basic' | 'seo' | 'content' | 'notes'>('basic')

  const handleChange = (field: keyof TaskFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof TaskFormData, string>> = {}

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required'
    } else if (formData.title.length < 3) {
      newErrors.title = 'Title must be at least 3 characters'
    }

    if (formData.estimated_hours && isNaN(Number(formData.estimated_hours))) {
      newErrors.estimated_hours = 'Must be a valid number'
    }

    if (formData.word_count_target && isNaN(Number(formData.word_count_target))) {
      newErrors.word_count_target = 'Must be a valid number'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (validate()) {
      onSubmit(formData)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-blue-600 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">
            {mode === 'create' ? '+ New Task' : '✏️ Edit Task'}
          </h2>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-200 text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 bg-white">
          <div className="flex">
            <TabButton
              active={activeTab === 'basic'}
              onClick={() => setActiveTab('basic')}
            >
              📋 Basic
            </TabButton>
            <TabButton
              active={activeTab === 'seo'}
              onClick={() => setActiveTab('seo')}
            >
              🎯 SEO
            </TabButton>
            <TabButton
              active={activeTab === 'content'}
              onClick={() => setActiveTab('content')}
            >
              📝 Content
            </TabButton>
            <TabButton
              active={activeTab === 'notes'}
              onClick={() => setActiveTab('notes')}
            >
              📌 Notes
            </TabButton>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          {activeTab === 'basic' && (
            <div className="space-y-6">
              {/* Title */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.title ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Write comprehensive React hooks guide"
                />
                {errors.title && (
                  <p className="text-red-500 text-sm mt-1">{errors.title}</p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Detailed description of the task..."
                />
              </div>

              {/* Task Type, Status, Priority */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Task Type
                  </label>
                  <select
                    value={formData.task_type}
                    onChange={(e) => handleChange('task_type', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="article">📄 Article</option>
                    <option value="page">📃 Page</option>
                    <option value="update">🔄 Update</option>
                    <option value="fix">🔧 Fix</option>
                    <option value="optimize">⚡ Optimize</option>
                    <option value="research">🔍 Research</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => handleChange('status', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="backlog">Backlog</option>
                    <option value="ready">Ready</option>
                    <option value="in_progress">In Progress</option>
                    <option value="in_review">In Review</option>
                    <option value="blocked">Blocked</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Priority
                  </label>
                  <select
                    value={formData.priority}
                    onChange={(e) => handleChange('priority', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              {/* Assignment */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Assigned Agent
                  </label>
                  <input
                    type="text"
                    value={formData.assigned_agent_id}
                    onChange={(e) => handleChange('assigned_agent_id', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="writer-01"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Assigned Human
                  </label>
                  <input
                    type="text"
                    value={formData.assigned_human}
                    onChange={(e) => handleChange('assigned_human', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="John Doe"
                  />
                </div>
              </div>

              {/* Timeline */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => handleChange('due_date', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Estimated Hours
                  </label>
                  <input
                    type="number"
                    value={formData.estimated_hours}
                    onChange={(e) => handleChange('estimated_hours', e.target.value)}
                    className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.estimated_hours ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="8"
                    min="0"
                    step="0.5"
                  />
                  {errors.estimated_hours && (
                    <p className="text-red-500 text-sm mt-1">{errors.estimated_hours}</p>
                  )}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => handleChange('tags', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="react, tutorial, hooks"
                />
              </div>
            </div>
          )}

          {activeTab === 'seo' && (
            <div className="space-y-6">
              {/* Primary Keyword */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Primary Keyword
                </label>
                <input
                  type="text"
                  value={formData.seo_primary_keyword}
                  onChange={(e) => handleChange('seo_primary_keyword', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="react hooks tutorial"
                />
              </div>

              {/* Secondary Keywords */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Secondary Keywords (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.seo_secondary_keywords}
                  onChange={(e) => handleChange('seo_secondary_keywords', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="useState, useEffect, custom hooks"
                />
              </div>
            </div>
          )}

          {activeTab === 'content' && (
            <div className="space-y-6">
              {/* Word Count Target */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Target Word Count
                </label>
                <input
                  type="number"
                  value={formData.word_count_target}
                  onChange={(e) => handleChange('word_count_target', e.target.value)}
                  className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.word_count_target ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="3500"
                  min="0"
                />
                {errors.word_count_target && (
                  <p className="text-red-500 text-sm mt-1">{errors.word_count_target}</p>
                )}
              </div>

              {/* Content Type */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Content Type
                </label>
                <input
                  type="text"
                  value={formData.content_type}
                  onChange={(e) => handleChange('content_type', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="tutorial, guide, reference, etc."
                />
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                rows={10}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Additional notes, blockers, special requirements..."
              />
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            {mode === 'create' ? 'Create Task' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-6 py-3 font-medium border-b-2 transition-colors ${
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}
