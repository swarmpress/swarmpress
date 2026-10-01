/**
 * Kanban Filters Component
 * Search and filter controls for Kanban board
 */

import { useState } from 'react'

type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
type TaskType = 'article' | 'page' | 'update' | 'fix' | 'optimize' | 'research'

interface KanbanFiltersProps {
  onSearchChange?: (search: string) => void
  onPriorityChange?: (priorities: TaskPriority[]) => void
  onTypeChange?: (types: TaskType[]) => void
  onTagsChange?: (tags: string[]) => void
  onAgentChange?: (agentId: string | null) => void
  onOverdueChange?: (showOverdue: boolean) => void
  availableTags?: string[]
  availableAgents?: Array<{ id: string; name: string }>
}

export function KanbanFilters({
  onSearchChange,
  onPriorityChange,
  onTypeChange,
  onTagsChange,
  onAgentChange,
  onOverdueChange,
  availableTags = [],
  availableAgents = [],
}: KanbanFiltersProps) {
  const [search, setSearch] = useState('')
  const [selectedPriorities, setSelectedPriorities] = useState<TaskPriority[]>([])
  const [selectedTypes, setSelectedTypes] = useState<TaskType[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [showOverdue, setShowOverdue] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const handleSearchChange = (value: string) => {
    setSearch(value)
    onSearchChange?.(value)
  }

  const togglePriority = (priority: TaskPriority) => {
    const updated = selectedPriorities.includes(priority)
      ? selectedPriorities.filter((p) => p !== priority)
      : [...selectedPriorities, priority]
    setSelectedPriorities(updated)
    onPriorityChange?.(updated)
  }

  const toggleType = (type: TaskType) => {
    const updated = selectedTypes.includes(type)
      ? selectedTypes.filter((t) => t !== type)
      : [...selectedTypes, type]
    setSelectedTypes(updated)
    onTypeChange?.(updated)
  }

  const toggleTag = (tag: string) => {
    const updated = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag]
    setSelectedTags(updated)
    onTagsChange?.(updated)
  }

  const handleAgentChange = (agentId: string) => {
    const updated = agentId === '' ? null : agentId
    setSelectedAgent(updated)
    onAgentChange?.(updated)
  }

  const handleOverdueToggle = () => {
    const updated = !showOverdue
    setShowOverdue(updated)
    onOverdueChange?.(updated)
  }

  const clearFilters = () => {
    setSearch('')
    setSelectedPriorities([])
    setSelectedTypes([])
    setSelectedTags([])
    setSelectedAgent(null)
    setShowOverdue(false)
    onSearchChange?.('')
    onPriorityChange?.([])
    onTypeChange?.([])
    onTagsChange?.([])
    onAgentChange?.(null)
    onOverdueChange?.(false)
  }

  const activeFilterCount =
    (search ? 1 : 0) +
    selectedPriorities.length +
    selectedTypes.length +
    selectedTags.length +
    (selectedAgent ? 1 : 0) +
    (showOverdue ? 1 : 0)

  return (
    <div className="bg-white rounded-lg border-2 border-gray-200 p-4 mb-4">
      {/* Header with Search */}
      <div className="flex items-center gap-4 mb-4">
        {/* Search */}
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          )}
        </div>

        {/* Expand/Collapse */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
        >
          {isExpanded ? '▲ Hide Filters' : '▼ Show Filters'}
          {activeFilterCount > 0 && (
            <span className="ml-2 bg-blue-600 text-white rounded-full px-2 py-0.5 text-xs">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Clear Filters */}
        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Expanded Filters */}
      {isExpanded && (
        <div className="space-y-4 border-t border-gray-200 pt-4">
          {/* Priority Filters */}
          <div>
            <label className="block text-sm font-semibold mb-2">Priority</label>
            <div className="flex flex-wrap gap-2">
              {(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map((priority) => (
                <button
                  key={priority}
                  onClick={() => togglePriority(priority)}
                  className={`px-3 py-1 rounded-lg border-2 text-sm font-medium transition-colors ${
                    selectedPriorities.includes(priority)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Type Filters */}
          <div>
            <label className="block text-sm font-semibold mb-2">Task Type</label>
            <div className="flex flex-wrap gap-2">
              {(['article', 'page', 'update', 'fix', 'optimize', 'research'] as TaskType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`px-3 py-1 rounded-lg border-2 text-sm font-medium transition-colors ${
                    selectedTypes.includes(type)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Tags Filter */}
          {availableTags.length > 0 && (
            <div>
              <label className="block text-sm font-semibold mb-2">Tags</label>
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1 rounded-lg border-2 text-sm font-medium transition-colors ${
                      selectedTags.includes(tag)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Agent Filter */}
          {availableAgents.length > 0 && (
            <div>
              <label className="block text-sm font-semibold mb-2">Assigned Agent</label>
              <select
                value={selectedAgent || ''}
                onChange={(e) => handleAgentChange(e.target.value)}
                className="px-3 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Agents</option>
                {availableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Overdue Toggle */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOverdue}
                onChange={handleOverdueToggle}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-semibold">Show Overdue Only</span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
