/**
 * Analytics Overlay
 * Visual overlay on sitemap graph showing analytics insights
 */

import { useState, useEffect } from 'react'
import type { SitemapAnalytics } from '@swarm-press/backend/db/repositories/sitemap-analytics-repository'

interface AnalyticsOverlayProps {
  websiteId: string
  onPageHighlight?: (pageIds: string[], reason: string) => void
}

export default function AnalyticsOverlay({
  websiteId,
  onPageHighlight,
}: AnalyticsOverlayProps) {
  const [analytics, setAnalytics] = useState<SitemapAnalytics | null>(null)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  useEffect(() => {
    loadAnalytics()
  }, [websiteId])

  async function loadAnalytics() {
    try {
      const response = await fetch(
        `/api/trpc/analytics.getAnalytics?input=${encodeURIComponent(
          JSON.stringify({ websiteId })
        )}`
      )
      const data = await response.json()
      setAnalytics(data.result.data.analytics)
    } catch (error) {
      console.error('Failed to load analytics:', error)
    }
  }

  function handleFilterClick(filter: string, pageIds: string[]) {
    if (activeFilter === filter) {
      setActiveFilter(null)
      onPageHighlight?.([], '')
    } else {
      setActiveFilter(filter)
      onPageHighlight?.(pageIds, filter)
    }
  }

  if (!analytics) {
    return null
  }

  const filters = [
    {
      id: 'orphans',
      label: 'Orphan Pages',
      count: analytics.orphan_pages.length,
      color: 'bg-orange-500',
      icon: '⚠️',
      pageIds: analytics.orphan_pages.map((p) => p.id),
    },
    {
      id: 'needs-update',
      label: 'Needs Update',
      count: analytics.pages_needing_update.length,
      color: 'bg-yellow-500',
      icon: '📅',
      pageIds: analytics.pages_needing_update.map((p) => p.id),
    },
    {
      id: 'no-outgoing',
      label: 'No Links Out',
      count: analytics.link_graph_metrics.pages_with_no_outgoing,
      color: 'bg-blue-500',
      icon: '🔗',
      pageIds: [], // Would need to compute this
    },
    {
      id: 'broken-links',
      label: 'Broken Links',
      count: analytics.link_graph_metrics.broken_links.length,
      color: 'bg-red-500',
      icon: '❌',
      pageIds: [...new Set(analytics.link_graph_metrics.broken_links.map((l) => l.source_page_id))],
    },
    {
      id: 'hub-pages',
      label: 'Hub Pages',
      count: analytics.link_graph_metrics.hub_pages.length,
      color: 'bg-purple-500',
      icon: '⭐',
      pageIds: analytics.link_graph_metrics.hub_pages.map((p) => p.id),
    },
    {
      id: 'authority-pages',
      label: 'Authority Pages',
      count: analytics.link_graph_metrics.authority_pages.length,
      color: 'bg-indigo-500',
      icon: '👑',
      pageIds: analytics.link_graph_metrics.authority_pages.map((p) => p.id),
    },
  ]

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 max-w-xs">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-900">🔍 Analytics Filters</h3>
        {activeFilter && (
          <button
            onClick={() => {
              setActiveFilter(null)
              onPageHighlight?.([], '')
            }}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      <div className="space-y-2">
        {filters.map((filter) => (
          <button
            key={filter.id}
            onClick={() => handleFilterClick(filter.id, filter.pageIds)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all ${
              activeFilter === filter.id
                ? `${filter.color} text-white shadow-md`
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{filter.icon}</span>
              <span className="text-sm font-medium">{filter.label}</span>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                activeFilter === filter.id
                  ? 'bg-white/20'
                  : 'bg-gray-200'
              }`}
            >
              {filter.count}
            </span>
          </button>
        ))}
      </div>

      {/* Active Filter Details */}
      {activeFilter && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg border">
          <div className="text-xs font-medium text-gray-700 mb-2">
            {filters.find((f) => f.id === activeFilter)?.label}
          </div>
          <div className="text-xs text-gray-600">
            Highlighting {filters.find((f) => f.id === activeFilter)?.count} pages on the graph
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 pt-3 border-t text-xs text-gray-500 space-y-1">
        <div>💡 Click a filter to highlight pages</div>
        <div>💡 Click again to clear</div>
      </div>
    </div>
  )
}
