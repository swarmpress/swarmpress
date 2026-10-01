/**
 * Agent Activity Feed
 * Chronological feed of all agent activities
 */

import { useState, useEffect } from 'react'
import type { AgentActivity } from '@swarm-press/backend/db/repositories/agent-activity-repository'

interface AgentActivityFeedProps {
  websiteId: string
  limit?: number
}

export default function AgentActivityFeed({
  websiteId,
  limit = 50,
}: AgentActivityFeedProps) {
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    loadActivities()
    if (autoRefresh) {
      const interval = setInterval(loadActivities, 10000) // Refresh every 10 seconds
      return () => clearInterval(interval)
    }
  }, [websiteId, limit, autoRefresh])

  async function loadActivities() {
    try {
      const response = await fetch(
        `/api/trpc/agentActivity.getActivityFeed?input=${encodeURIComponent(
          JSON.stringify({ websiteId, limit })
        )}`
      )
      const data = await response.json()
      setActivities(data.result.data.activities || [])
    } catch (error) {
      console.error('Failed to load activity feed:', error)
    } finally {
      setLoading(false)
    }
  }

  const activityIcons: Record<string, string> = {
    viewing: '👁️',
    editing: '✏️',
    suggesting: '💡',
    reviewing: '🔍',
    analyzing: '📊',
  }

  function getTimeAgo(date: string): string {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)

    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  function isActive(activity: AgentActivity): boolean {
    return new Date(activity.expires_at).getTime() > Date.now()
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading activity feed...
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <span>📊</span>
            <span>Activity Feed</span>
          </h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              <span>Auto-refresh</span>
            </label>
            <button
              onClick={loadActivities}
              className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-sm transition-colors"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Activity List */}
      <div className="max-h-96 overflow-y-auto divide-y">
        {activities.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-4xl mb-2">📭</div>
            <div>No recent activity</div>
          </div>
        ) : (
          activities.map((activity) => {
            const active = isActive(activity)

            return (
              <div
                key={activity.id}
                className={`p-3 hover:bg-gray-50 transition-colors ${
                  active ? 'bg-blue-50/50' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="text-2xl mt-0.5">
                    {activityIcons[activity.activity_type]}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Agent & Activity Type */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-900">
                        {activity.agent_name || activity.agent_id.slice(0, 8)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {activity.activity_type}
                      </span>
                      {active && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          Active
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-sm text-gray-700 mb-1">
                      {activity.description}
                    </p>

                    {/* Page Link */}
                    {activity.page_slug && (
                      <div className="text-xs text-blue-600">
                        📄 <code>{activity.page_slug}</code>
                      </div>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="text-xs text-gray-400 whitespace-nowrap">
                    {getTimeAgo(activity.created_at)}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
