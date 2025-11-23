/**
 * Suggestions Overlay
 * Displays AI agent suggestions on the sitemap graph
 */

import { useState, useEffect } from 'react'
import type { SuggestionWithMetadata } from '@swarm-press/backend/db/repositories/suggestion-repository'

interface SuggestionsOverlayProps {
  websiteId: string
  onSuggestionClick?: (suggestion: SuggestionWithMetadata) => void
}

export default function SuggestionsOverlay({
  websiteId,
  onSuggestionClick,
}: SuggestionsOverlayProps) {
  const [suggestions, setSuggestions] = useState<SuggestionWithMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  useEffect(() => {
    loadSuggestions()
    // Poll for new suggestions every 30 seconds
    const interval = setInterval(loadSuggestions, 30000)
    return () => clearInterval(interval)
  }, [websiteId])

  async function loadSuggestions() {
    try {
      const response = await fetch(
        `/api/trpc/suggestion.getPendingByWebsite?input=${encodeURIComponent(
          JSON.stringify({ websiteId })
        )}`
      )
      const data = await response.json()
      setSuggestions(data.result.data.suggestions || [])
    } catch (error) {
      console.error('Failed to load suggestions:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleStatusUpdate(
    id: string,
    status: 'accepted' | 'rejected' | 'implemented'
  ) {
    try {
      await fetch('/api/trpc/suggestion.updateStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      await loadSuggestions()
    } catch (error) {
      console.error('Failed to update suggestion:', error)
    }
  }

  const filteredSuggestions = suggestions.filter((s) => {
    if (filter !== 'all' && s.estimated_value !== filter) return false
    if (typeFilter !== 'all' && s.suggestion_type !== typeFilter) return false
    return true
  })

  const suggestionTypeColors: Record<string, string> = {
    new_page: 'bg-blue-100 text-blue-800 border-blue-300',
    improve_content: 'bg-purple-100 text-purple-800 border-purple-300',
    add_links: 'bg-green-100 text-green-800 border-green-300',
    update_blueprint: 'bg-orange-100 text-orange-800 border-orange-300',
  }

  const valueIcons: Record<string, string> = {
    high: '🔥',
    medium: '⚡',
    low: '💡',
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading suggestions...
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-3">
        <h3 className="font-bold text-lg flex items-center gap-2">
          <span>🤖</span>
          <span>AI Suggestions</span>
          <span className="ml-auto bg-white/20 px-2 py-1 rounded-full text-sm">
            {filteredSuggestions.length}
          </span>
        </h3>
      </div>

      {/* Filters */}
      <div className="p-3 border-b bg-gray-50 space-y-2">
        <div className="flex gap-2">
          <label className="text-sm font-medium text-gray-700">Value:</label>
          <div className="flex gap-1">
            {['all', 'high', 'medium', 'low'].map((val) => (
              <button
                key={val}
                onClick={() => setFilter(val as any)}
                className={`px-2 py-1 text-xs rounded ${
                  filter === val
                    ? 'bg-purple-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {val === 'all' ? 'All' : valueIcons[val]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <label className="text-sm font-medium text-gray-700">Type:</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1"
          >
            <option value="all">All Types</option>
            <option value="new_page">New Page</option>
            <option value="improve_content">Improve Content</option>
            <option value="add_links">Add Links</option>
            <option value="update_blueprint">Update Blueprint</option>
          </select>
        </div>
      </div>

      {/* Suggestions List */}
      <div className="max-h-96 overflow-y-auto">
        {filteredSuggestions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-4xl mb-2">✨</div>
            <div>No pending suggestions</div>
            <div className="text-sm mt-1">All caught up!</div>
          </div>
        ) : (
          <div className="divide-y">
            {filteredSuggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="p-3 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => onSuggestionClick?.(suggestion)}
              >
                {/* Header */}
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-2xl">{valueIcons[suggestion.estimated_value]}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          suggestionTypeColors[suggestion.suggestion_type]
                        }`}
                      >
                        {suggestion.suggestion_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-gray-500">
                        {suggestion.agent_id.slice(0, 8)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-800 font-medium">
                      {suggestion.reason}
                    </p>
                  </div>
                </div>

                {/* Details */}
                {suggestion.proposed_slug && (
                  <div className="text-xs text-gray-600 ml-9 mb-1">
                    📄 Proposed: <code className="bg-gray-100 px-1 rounded">{suggestion.proposed_slug}</code>
                  </div>
                )}

                {suggestion.keywords && suggestion.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 ml-9 mb-2">
                    {suggestion.keywords.map((keyword, i) => (
                      <span
                        key={i}
                        className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 ml-9 mt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStatusUpdate(suggestion.id, 'accepted')
                    }}
                    className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                  >
                    ✓ Accept
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStatusUpdate(suggestion.id, 'implemented')
                    }}
                    className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    ✓ Implemented
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStatusUpdate(suggestion.id, 'rejected')
                    }}
                    className="text-xs px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                  >
                    ✗ Dismiss
                  </button>
                </div>

                {/* Timestamp */}
                <div className="text-xs text-gray-400 ml-9 mt-1">
                  {new Date(suggestion.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
