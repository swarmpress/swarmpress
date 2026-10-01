/**
 * Agent Activity Indicators
 * Real-time visual indicators of agent activities on pages
 */

import { useState, useEffect } from 'react'
import type { AgentActivity } from '@swarm-press/backend/db/repositories/agent-activity-repository'

interface AgentActivityIndicatorsProps {
  websiteId: string
  pageId?: string // If provided, show only this page's activities
}

export default function AgentActivityIndicators({
  websiteId,
  pageId,
}: AgentActivityIndicatorsProps) {
  const [activities, setActivities] = useState<AgentActivity[]>([])

  useEffect(() => {
    loadActivities()
    // Poll for updates every 5 seconds for real-time feel
    const interval = setInterval(loadActivities, 5000)
    return () => clearInterval(interval)
  }, [websiteId, pageId])

  async function loadActivities() {
    try {
      const endpoint = pageId
        ? `/api/trpc/agentActivity.getActiveByPage?input=${encodeURIComponent(
            JSON.stringify({ pageId })
          )}`
        : `/api/trpc/agentActivity.getActiveByWebsite?input=${encodeURIComponent(
            JSON.stringify({ websiteId })
          )}`

      const response = await fetch(endpoint)
      const data = await response.json()
      setActivities(data.result.data.activities || [])
    } catch (error) {
      console.error('Failed to load activities:', error)
    }
  }

  const activityIcons: Record<string, string> = {
    viewing: '👁️',
    editing: '✏️',
    suggesting: '💡',
    reviewing: '🔍',
    analyzing: '📊',
  }

  const activityColors: Record<string, string> = {
    viewing: 'bg-blue-100 text-blue-800 border-blue-300',
    editing: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    suggesting: 'bg-purple-100 text-purple-800 border-purple-300',
    reviewing: 'bg-green-100 text-green-800 border-green-300',
    analyzing: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  }

  if (activities.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      {activities.map((activity) => {
        const timeRemaining = Math.max(
          0,
          Math.floor(
            (new Date(activity.expires_at).getTime() - Date.now()) / 1000
          )
        )

        return (
          <div
            key={activity.id}
            className={`px-3 py-2 rounded-lg border flex items-center gap-2 ${
              activityColors[activity.activity_type]
            } animate-pulse-subtle`}
          >
            <span className="text-lg">{activityIcons[activity.activity_type]}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {activity.agent_name || activity.agent_id.slice(0, 8)}
              </div>
              <div className="text-xs opacity-80 truncate">
                {activity.description}
              </div>
            </div>
            <div className="text-xs opacity-60">{timeRemaining}s</div>
          </div>
        )
      })}
    </div>
  )
}
