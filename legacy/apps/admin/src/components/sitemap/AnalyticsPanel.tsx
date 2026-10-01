/**
 * Analytics Panel
 * Comprehensive analytics view with multiple tabs
 */

import { useState } from 'react'
import SEOMetricsDashboard from './SEOMetricsDashboard'
import AnalyticsOverlay from './AnalyticsOverlay'

interface AnalyticsPanelProps {
  websiteId: string
}

export default function AnalyticsPanel({ websiteId }: AnalyticsPanelProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'filters'>('overview')

  return (
    <div className="h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="flex border-b bg-gray-50">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'bg-white border-b-2 border-indigo-600 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span>📊</span>
            <span>Overview</span>
          </div>
        </button>
        <button
          onClick={() => setActiveTab('filters')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'filters'
              ? 'bg-white border-b-2 border-indigo-600 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span>🔍</span>
            <span>Filters</span>
          </div>
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'overview' ? (
          <SEOMetricsDashboard websiteId={websiteId} />
        ) : (
          <AnalyticsOverlay
            websiteId={websiteId}
            onPageHighlight={(pageIds, reason) => {
              // Dispatch event to highlight pages on graph
              window.dispatchEvent(
                new CustomEvent('highlight-pages', {
                  detail: { pageIds, reason },
                })
              )
            }}
          />
        )}
      </div>

      {/* Info Footer */}
      <div className="border-t bg-gray-50 p-3 text-xs text-gray-500">
        <div>💡 Analytics are cached for 15 minutes</div>
        <div>💡 Use filters to highlight issues on the graph</div>
      </div>
    </div>
  )
}
