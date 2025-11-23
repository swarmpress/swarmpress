/**
 * SEO Metrics Dashboard
 * Comprehensive view of SEO health and optimization status
 */

import { useState, useEffect } from 'react'
import type { SitemapAnalytics } from '@swarm-press/backend/db/repositories/sitemap-analytics-repository'

interface SEOMetricsDashboardProps {
  websiteId: string
}

export default function SEOMetricsDashboard({ websiteId }: SEOMetricsDashboardProps) {
  const [analytics, setAnalytics] = useState<SitemapAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

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
    } finally {
      setLoading(false)
    }
  }

  async function refreshAnalytics() {
    setRefreshing(true)
    try {
      const response = await fetch('/api/trpc/analytics.recomputeAnalytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId }),
      })
      const data = await response.json()
      setAnalytics(data.result.data.analytics)
    } catch (error) {
      console.error('Failed to refresh analytics:', error)
    } finally {
      setRefreshing(false)
    }
  }

  if (loading || !analytics) {
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="animate-spin text-4xl mb-2">⏳</div>
        <div>Computing analytics...</div>
      </div>
    )
  }

  const freshnessColor =
    analytics.avg_freshness_score >= 80
      ? 'text-green-600'
      : analytics.avg_freshness_score >= 60
      ? 'text-yellow-600'
      : 'text-red-600'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-900">📊 Analytics Dashboard</h3>
        <button
          onClick={refreshAnalytics}
          disabled={refreshing}
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {refreshing ? '↻ Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
          <div className="text-2xl font-bold text-blue-900">{analytics.total_pages}</div>
          <div className="text-sm text-blue-700">Total Pages</div>
        </div>
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
          <div className={`text-2xl font-bold ${freshnessColor}`}>
            {analytics.avg_freshness_score}%
          </div>
          <div className="text-sm text-purple-700">Avg Freshness</div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="bg-white rounded-lg border p-4">
        <h4 className="font-medium text-gray-900 mb-3">Page Status</h4>
        <div className="space-y-2">
          {Object.entries(analytics.by_status).map(([status, count]) => {
            const colors: Record<string, string> = {
              published: 'bg-green-500',
              draft: 'bg-yellow-500',
              planned: 'bg-blue-500',
              outdated: 'bg-orange-500',
              deprecated: 'bg-red-500',
            }
            const percentage = analytics.total_pages > 0 ? (count / analytics.total_pages) * 100 : 0

            return (
              <div key={status}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700 capitalize">{status}</span>
                  <span className="text-gray-600">{count} ({percentage.toFixed(0)}%)</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${colors[status] || 'bg-gray-400'}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* SEO Metrics */}
      <div className="bg-white rounded-lg border p-4">
        <h4 className="font-medium text-gray-900 mb-3">🔍 SEO Health</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-gray-600">Keywords</div>
            <div className="font-semibold text-gray-900">
              {analytics.seo_metrics.pages_with_keywords} / {analytics.total_pages}
            </div>
          </div>
          <div>
            <div className="text-gray-600">Meta Desc</div>
            <div className="font-semibold text-gray-900">
              {analytics.seo_metrics.pages_with_meta_description} / {analytics.total_pages}
            </div>
          </div>
          <div>
            <div className="text-gray-600">Avg Keywords</div>
            <div className="font-semibold text-gray-900">
              {analytics.seo_metrics.avg_keywords_per_page.toFixed(1)} / page
            </div>
          </div>
          <div>
            <div className="text-gray-600">Search Volume</div>
            <div className="font-semibold text-gray-900">
              {analytics.seo_metrics.total_search_volume.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Link Graph Metrics */}
      <div className="bg-white rounded-lg border p-4">
        <h4 className="font-medium text-gray-900 mb-3">🔗 Link Structure</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Total Internal Links</span>
            <span className="font-semibold text-gray-900">
              {analytics.link_graph_metrics.total_links}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Avg Outgoing Links</span>
            <span className="font-semibold text-gray-900">
              {analytics.link_graph_metrics.avg_outgoing_links.toFixed(1)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Avg Incoming Links</span>
            <span className="font-semibold text-gray-900">
              {analytics.link_graph_metrics.avg_incoming_links.toFixed(1)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Pages w/o Outgoing</span>
            <span className="font-semibold text-orange-600">
              {analytics.link_graph_metrics.pages_with_no_outgoing}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Broken Links</span>
            <span className="font-semibold text-red-600">
              {analytics.link_graph_metrics.broken_links.length}
            </span>
          </div>
        </div>
      </div>

      {/* Issues Section */}
      <div className="space-y-3">
        {/* Orphan Pages */}
        {analytics.orphan_pages.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-orange-600 font-medium">⚠️ Orphan Pages</span>
              <span className="bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full text-xs">
                {analytics.orphan_pages.length}
              </span>
            </div>
            <div className="text-sm text-orange-700 space-y-1">
              {analytics.orphan_pages.slice(0, 5).map((page) => (
                <div key={page.id}>• {page.slug}</div>
              ))}
              {analytics.orphan_pages.length > 5 && (
                <div className="text-xs text-orange-600">
                  +{analytics.orphan_pages.length - 5} more
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pages Needing Update */}
        {analytics.pages_needing_update.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-yellow-600 font-medium">📅 Needs Update</span>
              <span className="bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full text-xs">
                {analytics.pages_needing_update.length}
              </span>
            </div>
            <div className="text-sm text-yellow-700 space-y-1">
              {analytics.pages_needing_update.slice(0, 5).map((page) => (
                <div key={page.id} className="flex justify-between">
                  <span>• {page.slug}</span>
                  <span className="text-xs">
                    {page.freshness_score}% ({page.days_since_update}d)
                  </span>
                </div>
              ))}
              {analytics.pages_needing_update.length > 5 && (
                <div className="text-xs text-yellow-600">
                  +{analytics.pages_needing_update.length - 5} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Computed At */}
      <div className="text-xs text-gray-400 text-center">
        Last updated: {new Date(analytics.computed_at).toLocaleString()}
      </div>
    </div>
  )
}
