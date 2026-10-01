/**
 * Kanban Statistics Component
 * Display aggregate statistics for editorial tasks
 */

interface TaskStats {
  total: number
  by_status: {
    backlog: number
    ready: number
    in_progress: number
    in_review: number
    blocked: number
    completed: number
    cancelled: number
  }
  by_priority: {
    low: number
    medium: number
    high: number
    urgent: number
  }
  by_type: {
    article: number
    page: number
    update: number
    fix: number
    optimize: number
    research: number
  }
  overdue_count: number
  blocked_count: number
  avg_completion_hours?: number
}

interface KanbanStatsProps {
  stats: TaskStats
  loading?: boolean
}

export function KanbanStats({ stats, loading = false }: KanbanStatsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-4 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-lg border-2 border-gray-200 p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded mb-2 w-1/2" />
            <div className="h-8 bg-gray-200 rounded w-3/4" />
          </div>
        ))}
      </div>
    )
  }

  const activeTasksCount =
    stats.by_status.ready +
    stats.by_status.in_progress +
    stats.by_status.in_review

  const completionRate = stats.total > 0
    ? Math.round((stats.by_status.completed / stats.total) * 100)
    : 0

  const urgentTasksCount = stats.by_priority.urgent + stats.by_priority.high

  return (
    <div className="space-y-4 mb-4">
      {/* Key Metrics */}
      <div className="grid grid-cols-5 gap-4">
        {/* Total Tasks */}
        <div className="bg-white rounded-lg border-2 border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Total Tasks</div>
          <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
        </div>

        {/* Active Tasks */}
        <div className="bg-blue-50 rounded-lg border-2 border-blue-300 p-4">
          <div className="text-sm text-blue-700 mb-1">Active</div>
          <div className="text-3xl font-bold text-blue-900">{activeTasksCount}</div>
        </div>

        {/* Completed */}
        <div className="bg-green-50 rounded-lg border-2 border-green-300 p-4">
          <div className="text-sm text-green-700 mb-1">Completed</div>
          <div className="text-3xl font-bold text-green-900">{stats.by_status.completed}</div>
          <div className="text-xs text-green-600 mt-1">{completionRate}% rate</div>
        </div>

        {/* Urgent/High Priority */}
        <div className="bg-orange-50 rounded-lg border-2 border-orange-300 p-4">
          <div className="text-sm text-orange-700 mb-1">High Priority</div>
          <div className="text-3xl font-bold text-orange-900">{urgentTasksCount}</div>
        </div>

        {/* Issues */}
        <div className={`rounded-lg border-2 p-4 ${
          stats.blocked_count > 0 || stats.overdue_count > 0
            ? 'bg-red-50 border-red-300'
            : 'bg-gray-50 border-gray-200'
        }`}>
          <div className={`text-sm mb-1 ${
            stats.blocked_count > 0 || stats.overdue_count > 0
              ? 'text-red-700'
              : 'text-gray-500'
          }`}>
            Issues
          </div>
          <div className={`text-3xl font-bold ${
            stats.blocked_count > 0 || stats.overdue_count > 0
              ? 'text-red-900'
              : 'text-gray-900'
          }`}>
            {stats.blocked_count + stats.overdue_count}
          </div>
          {(stats.blocked_count > 0 || stats.overdue_count > 0) && (
            <div className="text-xs text-red-600 mt-1">
              {stats.blocked_count > 0 && `${stats.blocked_count} blocked`}
              {stats.blocked_count > 0 && stats.overdue_count > 0 && ', '}
              {stats.overdue_count > 0 && `${stats.overdue_count} overdue`}
            </div>
          )}
        </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="bg-white rounded-lg border-2 border-gray-200 p-4">
        <h3 className="font-semibold mb-4">Breakdown</h3>

        <div className="grid grid-cols-3 gap-6">
          {/* By Status */}
          <div>
            <h4 className="text-sm font-semibold text-gray-600 mb-3">By Status</h4>
            <div className="space-y-2">
              <StatusBar label="Backlog" count={stats.by_status.backlog} total={stats.total} color="bg-gray-400" />
              <StatusBar label="Ready" count={stats.by_status.ready} total={stats.total} color="bg-blue-500" />
              <StatusBar label="In Progress" count={stats.by_status.in_progress} total={stats.total} color="bg-yellow-500" />
              <StatusBar label="In Review" count={stats.by_status.in_review} total={stats.total} color="bg-purple-500" />
              <StatusBar label="Blocked" count={stats.by_status.blocked} total={stats.total} color="bg-red-500" />
              <StatusBar label="Completed" count={stats.by_status.completed} total={stats.total} color="bg-green-500" />
            </div>
          </div>

          {/* By Priority */}
          <div>
            <h4 className="text-sm font-semibold text-gray-600 mb-3">By Priority</h4>
            <div className="space-y-2">
              <StatusBar label="Urgent" count={stats.by_priority.urgent} total={stats.total} color="bg-red-600" />
              <StatusBar label="High" count={stats.by_priority.high} total={stats.total} color="bg-orange-500" />
              <StatusBar label="Medium" count={stats.by_priority.medium} total={stats.total} color="bg-blue-500" />
              <StatusBar label="Low" count={stats.by_priority.low} total={stats.total} color="bg-gray-400" />
            </div>
          </div>

          {/* By Type */}
          <div>
            <h4 className="text-sm font-semibold text-gray-600 mb-3">By Type</h4>
            <div className="space-y-2">
              <StatusBar label="📄 Article" count={stats.by_type.article} total={stats.total} color="bg-indigo-500" />
              <StatusBar label="📃 Page" count={stats.by_type.page} total={stats.total} color="bg-blue-500" />
              <StatusBar label="🔄 Update" count={stats.by_type.update} total={stats.total} color="bg-green-500" />
              <StatusBar label="🔧 Fix" count={stats.by_type.fix} total={stats.total} color="bg-red-500" />
              <StatusBar label="⚡ Optimize" count={stats.by_type.optimize} total={stats.total} color="bg-yellow-500" />
              <StatusBar label="🔍 Research" count={stats.by_type.research} total={stats.total} color="bg-purple-500" />
            </div>
          </div>
        </div>

        {/* Average Completion Time */}
        {stats.avg_completion_hours !== undefined && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="text-sm text-gray-600">
              Average Completion Time: <span className="font-semibold text-gray-900">{stats.avg_completion_hours.toFixed(1)} hours</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBar({
  label,
  count,
  total,
  color,
}: {
  label: string
  count: number
  total: number
  color: string
}) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0

  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span className="font-semibold">{count} ({percentage}%)</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`${color} h-2 rounded-full transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
