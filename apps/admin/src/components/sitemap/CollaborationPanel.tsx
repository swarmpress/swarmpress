/**
 * Collaboration Panel
 * Unified panel showing agent suggestions, activities, and collaboration features
 */

import { useState } from 'react'
import SuggestionsOverlay from './SuggestionsOverlay'
import AgentActivityFeed from './AgentActivityFeed'
import AgentActivityIndicators from './AgentActivityIndicators'
import type { SuggestionWithMetadata } from '@swarm-press/backend/db/repositories/suggestion-repository'

interface CollaborationPanelProps {
  websiteId: string
  selectedPageId?: string
  onSuggestionClick?: (suggestion: SuggestionWithMetadata) => void
}

export default function CollaborationPanel({
  websiteId,
  selectedPageId,
  onSuggestionClick,
}: CollaborationPanelProps) {
  const [activeTab, setActiveTab] = useState<'suggestions' | 'activity'>('suggestions')

  return (
    <div className="h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="flex border-b bg-gray-50">
        <button
          onClick={() => setActiveTab('suggestions')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'suggestions'
              ? 'bg-white border-b-2 border-purple-600 text-purple-600'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span>🤖</span>
            <span>Suggestions</span>
          </div>
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'activity'
              ? 'bg-white border-b-2 border-indigo-600 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span>📊</span>
            <span>Activity</span>
          </div>
        </button>
      </div>

      {/* Active Indicators (always visible at top) */}
      {selectedPageId && (
        <div className="p-3 border-b bg-blue-50">
          <div className="text-xs font-medium text-gray-700 mb-2">
            Active on this page:
          </div>
          <AgentActivityIndicators websiteId={websiteId} pageId={selectedPageId} />
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'suggestions' ? (
          <div className="h-full overflow-auto p-4">
            <SuggestionsOverlay
              websiteId={websiteId}
              onSuggestionClick={onSuggestionClick}
            />
          </div>
        ) : (
          <div className="h-full overflow-auto p-4">
            <AgentActivityFeed websiteId={websiteId} limit={100} />
          </div>
        )}
      </div>

      {/* Task Creation Footer */}
      <div className="border-t bg-gray-50 p-3">
        <button className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all font-medium text-sm shadow-md hover:shadow-lg">
          + Create Agent Task
        </button>
      </div>
    </div>
  )
}
