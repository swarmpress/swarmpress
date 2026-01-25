/**
 * ScheduleManagement Component
 * Manage autonomous agent schedules - list, pause/resume, create, delete
 */

import React, { useState } from 'react'
import { useSchedules, type ScheduleType, type WebsiteSchedule, type UpcomingRun } from '../../hooks/useSchedules'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Switch } from '../ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip'
import {
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Clock,
  Calendar,
  Zap,
  FileText,
  Image,
  Link2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
} from 'lucide-react'

interface ScheduleManagementProps {
  websiteId: string
}

// Schedule type icons
const SCHEDULE_ICONS: Record<ScheduleType, React.ReactNode> = {
  'scheduled-content': <FileText className="h-4 w-4" />,
  'media-check': <Image className="h-4 w-4" />,
  'link-validation': <Link2 className="h-4 w-4" />,
  'stale-content': <Calendar className="h-4 w-4" />,
}

// Frequency colors
const FREQUENCY_COLORS: Record<string, string> = {
  daily: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  weekly: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  monthly: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
}

// Format cron expression for display
function formatCron(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length !== 5) return cron

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour}:${minute.padStart(2, '0')}`
  }
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return `${days[parseInt(dayOfWeek)]} at ${hour}:${minute.padStart(2, '0')}`
  }
  if (dayOfMonth !== '*' && month === '*') {
    return `${dayOfMonth}${getOrdinalSuffix(parseInt(dayOfMonth))} of month at ${hour}:${minute.padStart(2, '0')}`
  }

  return cron
}

function getOrdinalSuffix(n: number): string {
  if (n > 3 && n < 21) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

// Format date for display
function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never'
  const date = new Date(dateString)
  const now = new Date()
  const diff = date.getTime() - now.getTime()
  const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(diff / (1000 * 60 * 60))
  const diffMinutes = Math.floor(diff / (1000 * 60))

  if (diff < 0) {
    // Past
    const absDiffMinutes = Math.abs(diffMinutes)
    if (absDiffMinutes < 60) return `${absDiffMinutes}m ago`
    const absDiffHours = Math.abs(diffHours)
    if (absDiffHours < 24) return `${absDiffHours}h ago`
    const absDiffDays = Math.abs(diffDays)
    if (absDiffDays < 7) return `${absDiffDays}d ago`
    return date.toLocaleDateString()
  }

  // Future
  if (diffMinutes < 60) return `in ${diffMinutes}m`
  if (diffHours < 24) return `in ${diffHours}h`
  if (diffDays < 7) return `in ${diffDays}d`
  return date.toLocaleDateString()
}

function ScheduleCard({
  schedule,
  onPause,
  onResume,
  onTrigger,
  onDelete,
  isTriggering,
}: {
  schedule: WebsiteSchedule
  onPause: () => void
  onResume: () => void
  onTrigger: () => void
  onDelete: () => void
  isTriggering: boolean
}) {
  const isPaused = schedule.isPaused ?? !schedule.enabled
  const scheduleType = schedule.schedule_type as ScheduleType

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-4">
        <div className={`p-2 rounded-lg ${isPaused ? 'bg-muted' : 'bg-primary/10'}`}>
          {SCHEDULE_ICONS[scheduleType]}
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium capitalize">
              {scheduleType.replace(/-/g, ' ')}
            </span>
            <Badge variant="outline" className={FREQUENCY_COLORS[schedule.frequency]}>
              {schedule.frequency}
            </Badge>
            {isPaused && (
              <Badge variant="secondary" className="text-yellow-600">
                Paused
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatCron(schedule.cron_expression)}
                </TooltipTrigger>
                <TooltipContent>
                  <p>Cron: {schedule.cron_expression}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {schedule.last_run_at && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                Last: {formatDate(schedule.last_run_at)}
              </span>
            )}

            {schedule.nextRunTime && !isPaused && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Next: {formatDate(schedule.nextRunTime)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onTrigger}
                disabled={isTriggering}
              >
                {isTriggering ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Run now</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!isPaused}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onResume()
                    } else {
                      onPause()
                    }
                  }}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isPaused ? 'Resume schedule' : 'Pause schedule'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the {scheduleType.replace(/-/g, ' ')} schedule?
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

function UpcomingRunsList({ runs }: { runs: UpcomingRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        No upcoming runs scheduled
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {runs.slice(0, 5).map((run, index) => {
        const scheduleType = run.scheduleType as ScheduleType
        return (
          <div
            key={`${run.scheduledTime}-${index}`}
            className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md"
          >
            <div className="flex items-center gap-2">
              {SCHEDULE_ICONS[scheduleType]}
              <span className="text-sm capitalize">
                {scheduleType.replace(/-/g, ' ')}
              </span>
            </div>
            <span className="text-sm text-muted-foreground">
              {formatDate(run.scheduledTime)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function ScheduleManagement({ websiteId }: ScheduleManagementProps) {
  const {
    schedules,
    upcomingRuns,
    statistics,
    isLoading,
    error,
    pauseSchedule,
    resumeSchedule,
    triggerSchedule,
    deleteSchedule,
    createDefaultSchedules,
    refresh,
  } = useSchedules(websiteId)

  const [triggeringSchedule, setTriggeringSchedule] = useState<ScheduleType | null>(null)
  const [isCreatingDefaults, setIsCreatingDefaults] = useState(false)

  const handleTrigger = async (scheduleType: ScheduleType) => {
    setTriggeringSchedule(scheduleType)
    try {
      await triggerSchedule(scheduleType)
    } finally {
      setTriggeringSchedule(null)
    }
  }

  const handleCreateDefaults = async () => {
    setIsCreatingDefaults(true)
    try {
      await createDefaultSchedules()
    } finally {
      setIsCreatingDefaults(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Loading schedules...</p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center gap-2 text-destructive justify-center">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
          <div className="text-center mt-4">
            <Button variant="outline" onClick={refresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Agent Schedules</h2>
          <p className="text-sm text-muted-foreground">
            Configure when autonomous agents run maintenance tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          {schedules.length === 0 && (
            <Button onClick={handleCreateDefaults} disabled={isCreatingDefaults}>
              {isCreatingDefaults ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Setup Default Schedules
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Statistics */}
      {statistics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{statistics.total}</div>
              <p className="text-xs text-muted-foreground">Total Executions</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600">
                {statistics.by_status.completed}
              </div>
              <p className="text-xs text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-600">
                {statistics.by_status.failed}
              </div>
              <p className="text-xs text-muted-foreground">Failed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">
                {(statistics.success_rate * 100).toFixed(0)}%
              </div>
              <p className="text-xs text-muted-foreground">Success Rate</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        {/* Schedules List */}
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configured Schedules</CardTitle>
              <CardDescription>
                {schedules.length} schedule{schedules.length !== 1 ? 's' : ''} configured
              </CardDescription>
            </CardHeader>
            <CardContent>
              {schedules.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No schedules configured yet</p>
                  <p className="text-sm mt-1">
                    Click "Setup Default Schedules" to get started
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {schedules.map((schedule) => (
                    <ScheduleCard
                      key={schedule.id}
                      schedule={schedule}
                      onPause={() => pauseSchedule(schedule.schedule_type as ScheduleType)}
                      onResume={() => resumeSchedule(schedule.schedule_type as ScheduleType)}
                      onTrigger={() => handleTrigger(schedule.schedule_type as ScheduleType)}
                      onDelete={() => deleteSchedule(schedule.schedule_type as ScheduleType)}
                      isTriggering={triggeringSchedule === schedule.schedule_type}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Runs */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upcoming Runs</CardTitle>
              <CardDescription>Next scheduled executions</CardDescription>
            </CardHeader>
            <CardContent>
              <UpcomingRunsList runs={upcomingRuns} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
