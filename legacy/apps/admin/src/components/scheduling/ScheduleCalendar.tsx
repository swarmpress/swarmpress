/**
 * ScheduleCalendar Component
 * Monthly grid calendar showing execution history and upcoming scheduled runs
 */

import React, { useState, useEffect, useMemo } from 'react'
import { useSchedules, type ScheduleType, type ScheduleExecution, type UpcomingRun, type ExecutionStatus } from '../../hooks/useSchedules'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip'
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  FileText,
  Image,
  Link2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  Sun,
  CalendarDays,
  CalendarRange,
} from 'lucide-react'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
} from 'date-fns'

interface ScheduleCalendarProps {
  websiteId: string
}

// Schedule type icons
const SCHEDULE_ICONS: Record<ScheduleType, React.ReactNode> = {
  'scheduled-content': <FileText className="h-3 w-3" />,
  'media-check': <Image className="h-3 w-3" />,
  'link-validation': <Link2 className="h-3 w-3" />,
  'stale-content': <Calendar className="h-3 w-3" />,
}

// Frequency icons
const FREQUENCY_ICONS: Record<string, React.ReactNode> = {
  daily: <Sun className="h-3 w-3" />,
  weekly: <CalendarDays className="h-3 w-3" />,
  monthly: <CalendarRange className="h-3 w-3" />,
}

// Status colors
const STATUS_COLORS: Record<ExecutionStatus, string> = {
  scheduled: 'bg-gray-200 dark:bg-gray-700 border-gray-400',
  running: 'bg-blue-200 dark:bg-blue-800 border-blue-400 animate-pulse',
  completed: 'bg-green-200 dark:bg-green-800 border-green-400',
  failed: 'bg-red-200 dark:bg-red-800 border-red-400',
}

// Status icons
const STATUS_ICONS: Record<ExecutionStatus, React.ReactNode> = {
  scheduled: <Clock className="h-2.5 w-2.5" />,
  running: <Loader2 className="h-2.5 w-2.5 animate-spin" />,
  completed: <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />,
  failed: <XCircle className="h-2.5 w-2.5 text-red-600" />,
}

// Frequency colors for badges
const FREQUENCY_BADGE_COLORS: Record<string, string> = {
  daily: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  weekly: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  monthly: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
}

interface CalendarEvent {
  id: string
  date: Date
  scheduleType: ScheduleType
  status: ExecutionStatus
  frequency: string | null
  triggerType: 'scheduled' | 'manual'
  isUpcoming: boolean
  execution?: ScheduleExecution
}

function EventDot({ event }: { event: CalendarEvent }) {
  const isManual = event.triggerType === 'manual'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`
              flex items-center justify-center
              w-5 h-5 rounded-full
              ${event.isUpcoming ? 'opacity-50 border-2 border-dashed' : 'border'}
              ${STATUS_COLORS[event.status]}
              ${isManual ? 'border-dashed' : ''}
            `}
          >
            {SCHEDULE_ICONS[event.scheduleType]}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium capitalize">
              {event.scheduleType.replace(/-/g, ' ')}
            </p>
            <p className="text-xs text-muted-foreground">
              {format(event.date, 'PPp')}
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {event.isUpcoming ? 'Scheduled' : event.status}
              </Badge>
              {event.triggerType === 'manual' && (
                <Badge variant="secondary" className="text-xs">
                  Manual
                </Badge>
              )}
              {event.frequency && (
                <Badge
                  variant="outline"
                  className={`text-xs ${FREQUENCY_BADGE_COLORS[event.frequency] || ''}`}
                >
                  {event.frequency}
                </Badge>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function CalendarDay({
  date,
  currentMonth,
  events,
  onEventClick,
}: {
  date: Date
  currentMonth: Date
  events: CalendarEvent[]
  onEventClick: (event: CalendarEvent) => void
}) {
  const isCurrentMonth = isSameMonth(date, currentMonth)
  const isCurrentDay = isToday(date)

  // Group events by type and take the most recent/relevant one per type
  const groupedEvents = useMemo(() => {
    const groups: Record<ScheduleType, CalendarEvent[]> = {
      'scheduled-content': [],
      'media-check': [],
      'link-validation': [],
      'stale-content': [],
    }

    events.forEach((event) => {
      groups[event.scheduleType].push(event)
    })

    // Take most significant event per type (prefer non-upcoming, then by status)
    const priorityOrder: ExecutionStatus[] = ['running', 'failed', 'completed', 'scheduled']

    return Object.entries(groups)
      .filter(([_, evts]) => evts.length > 0)
      .map(([type, evts]) => {
        // Sort by: not upcoming first, then by status priority
        const sorted = [...evts].sort((a, b) => {
          if (a.isUpcoming !== b.isUpcoming) {
            return a.isUpcoming ? 1 : -1
          }
          return priorityOrder.indexOf(a.status) - priorityOrder.indexOf(b.status)
        })
        return sorted[0]
      })
      .filter(Boolean)
  }, [events])

  return (
    <div
      className={`
        min-h-[80px] p-1 border-r border-b
        ${!isCurrentMonth ? 'bg-muted/30' : 'bg-background'}
        ${isCurrentDay ? 'ring-2 ring-primary ring-inset' : ''}
      `}
    >
      <div
        className={`
          text-sm font-medium mb-1
          ${!isCurrentMonth ? 'text-muted-foreground' : ''}
          ${isCurrentDay ? 'text-primary' : ''}
        `}
      >
        {format(date, 'd')}
      </div>

      <div className="flex flex-wrap gap-1">
        {groupedEvents.map((event) => (
          <button
            key={event.id}
            onClick={() => onEventClick(event)}
            className="focus:outline-none focus:ring-2 focus:ring-primary rounded-full"
          >
            <EventDot event={event} />
          </button>
        ))}
      </div>

      {events.length > 4 && (
        <div className="text-xs text-muted-foreground mt-1">
          +{events.length - groupedEvents.length} more
        </div>
      )}
    </div>
  )
}

function EventDetailDialog({
  event,
  open,
  onOpenChange,
}: {
  event: CalendarEvent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!event) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 capitalize">
            {SCHEDULE_ICONS[event.scheduleType]}
            {event.scheduleType.replace(/-/g, ' ')} Execution
          </DialogTitle>
          <DialogDescription>
            {format(event.date, 'PPpp')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="flex items-center gap-2 mt-1">
                {STATUS_ICONS[event.status]}
                <span className="capitalize">{event.status}</span>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Trigger Type</p>
              <div className="flex items-center gap-2 mt-1">
                {event.triggerType === 'manual' ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Clock className="h-4 w-4" />
                )}
                <span className="capitalize">{event.triggerType}</span>
              </div>
            </div>
          </div>

          {event.frequency && (
            <div>
              <p className="text-sm text-muted-foreground">Frequency</p>
              <div className="flex items-center gap-2 mt-1">
                {FREQUENCY_ICONS[event.frequency]}
                <span className="capitalize">{event.frequency}</span>
              </div>
            </div>
          )}

          {event.execution && (
            <>
              {event.execution.workflow_id && (
                <div>
                  <p className="text-sm text-muted-foreground">Workflow ID</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block overflow-auto">
                    {event.execution.workflow_id}
                  </code>
                </div>
              )}

              {event.execution.started_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Started At</p>
                  <p className="text-sm mt-1">
                    {format(parseISO(event.execution.started_at), 'PPpp')}
                  </p>
                </div>
              )}

              {event.execution.completed_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Completed At</p>
                  <p className="text-sm mt-1">
                    {format(parseISO(event.execution.completed_at), 'PPpp')}
                  </p>
                </div>
              )}

              {event.execution.error && (
                <div>
                  <p className="text-sm text-muted-foreground">Error</p>
                  <div className="bg-destructive/10 text-destructive p-2 rounded mt-1 text-sm">
                    {event.execution.error}
                  </div>
                </div>
              )}

              {event.execution.triggered_by && (
                <div>
                  <p className="text-sm text-muted-foreground">Triggered By</p>
                  <p className="text-sm mt-1">{event.execution.triggered_by}</p>
                </div>
              )}
            </>
          )}

          {event.isUpcoming && (
            <div className="bg-muted/50 p-3 rounded-lg text-sm text-muted-foreground">
              This execution is scheduled for the future and has not run yet.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <div className="flex items-center gap-4">
        <span className="text-muted-foreground">Status:</span>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-full border ${color}`} />
            <span className="capitalize text-xs">{status}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-muted-foreground">Type:</span>
        {Object.entries(SCHEDULE_ICONS).map(([type, icon]) => (
          <div key={type} className="flex items-center gap-1">
            {icon}
            <span className="capitalize text-xs">{type.replace(/-/g, ' ')}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full border-2 border-dashed border-gray-400 opacity-50" />
        <span className="text-xs">Upcoming</span>
      </div>
    </div>
  )
}

export default function ScheduleCalendar({ websiteId }: ScheduleCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [calendarData, setCalendarData] = useState<{
    executions: ScheduleExecution[]
    upcomingRuns: UpcomingRun[]
  }>({ executions: [], upcomingRuns: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [filterType, setFilterType] = useState<ScheduleType | 'all'>('all')
  const [filterFrequency, setFilterFrequency] = useState<string>('all')

  const { getCalendarExecutions } = useSchedules(websiteId)

  // Fetch calendar data when month changes
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const start = startOfMonth(currentMonth)
        const end = endOfMonth(currentMonth)
        // Extend range to include visible days from adjacent months
        const calendarStart = startOfWeek(start)
        const calendarEnd = endOfWeek(end)

        const data = await getCalendarExecutions(
          calendarStart.toISOString(),
          calendarEnd.toISOString()
        )
        setCalendarData(data as { executions: ScheduleExecution[]; upcomingRuns: UpcomingRun[] })
      } catch (error) {
        console.error('Failed to fetch calendar data:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [currentMonth, getCalendarExecutions])

  // Build calendar events
  const events = useMemo(() => {
    const allEvents: CalendarEvent[] = []

    // Add executions
    calendarData.executions.forEach((execution) => {
      const event: CalendarEvent = {
        id: execution.id,
        date: parseISO(execution.scheduled_at),
        scheduleType: execution.schedule_type,
        status: execution.status,
        frequency: execution.frequency,
        triggerType: execution.trigger_type,
        isUpcoming: false,
        execution,
      }
      allEvents.push(event)
    })

    // Add upcoming runs
    calendarData.upcomingRuns.forEach((run, index) => {
      const event: CalendarEvent = {
        id: `upcoming-${index}`,
        date: parseISO(run.scheduledTime),
        scheduleType: run.scheduleType as ScheduleType,
        status: 'scheduled',
        frequency: run.frequency || null,
        triggerType: 'scheduled',
        isUpcoming: true,
      }
      allEvents.push(event)
    })

    return allEvents
  }, [calendarData])

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (filterType !== 'all' && event.scheduleType !== filterType) {
        return false
      }
      if (filterFrequency !== 'all' && event.frequency !== filterFrequency) {
        return false
      }
      return true
    })
  }, [events, filterType, filterFrequency])

  // Build calendar days
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const calendarStart = startOfWeek(monthStart)
    const calendarEnd = endOfWeek(monthEnd)

    const days: Date[] = []
    let day = calendarStart

    while (day <= calendarEnd) {
      days.push(day)
      day = addDays(day, 1)
    }

    return days
  }, [currentMonth])

  // Group events by day
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    filteredEvents.forEach((event) => {
      const key = format(event.date, 'yyyy-MM-dd')
      const existing = map.get(key) || []
      map.set(key, [...existing, event])
    })
    return map
  }, [filteredEvents])

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event)
    setDialogOpen(true)
  }

  const goToPreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1))
  const goToNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1))
  const goToToday = () => setCurrentMonth(new Date())

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Schedule Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filterType} onValueChange={(v) => setFilterType(v as ScheduleType | 'all')}>
              <SelectTrigger className="w-[160px] h-8">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="scheduled-content">Scheduled Content</SelectItem>
                <SelectItem value="media-check">Media Check</SelectItem>
                <SelectItem value="link-validation">Link Validation</SelectItem>
                <SelectItem value="stale-content">Stale Content</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterFrequency} onValueChange={setFilterFrequency}>
              <SelectTrigger className="w-[120px] h-8">
                <SelectValue placeholder="Frequency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Calendar navigation */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={goToPreviousMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={goToNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
          </div>
          <h3 className="text-lg font-semibold">
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <div className="w-[120px]" /> {/* Spacer for centering */}
        </div>

        {/* Calendar grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border-t border-l rounded-lg overflow-hidden">
            {/* Week day headers */}
            <div className="grid grid-cols-7">
              {weekDays.map((day) => (
                <div
                  key={day}
                  className="p-2 text-center text-sm font-medium bg-muted border-r border-b"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7">
              {calendarDays.map((day) => (
                <CalendarDay
                  key={day.toISOString()}
                  date={day}
                  currentMonth={currentMonth}
                  events={eventsByDay.get(format(day, 'yyyy-MM-dd')) || []}
                  onEventClick={handleEventClick}
                />
              ))}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 pt-4 border-t">
          <Legend />
        </div>

        {/* Event detail dialog */}
        <EventDetailDialog
          event={selectedEvent}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </CardContent>
    </Card>
  )
}
