/**
 * useSchedules Hook
 * React hook for managing autonomous agent schedules with tRPC
 */

import { useState, useEffect, useCallback } from 'react'
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@swarm-press/backend'
import superjson from 'superjson'

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'

// Create tRPC client for React components
const trpcClient = createTRPCProxyClient<AppRouter>({
  transformer: superjson,
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      headers() {
        return {
          authorization: 'Bearer ceo:admin@swarm.press',
        }
      },
    }),
  ],
})

export type ScheduleType = 'scheduled-content' | 'media-check' | 'link-validation' | 'stale-content'
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly'
export type ExecutionStatus = 'scheduled' | 'running' | 'completed' | 'failed'
export type TriggerType = 'scheduled' | 'manual'

export interface WebsiteSchedule {
  id: string
  website_id: string
  schedule_type: ScheduleType
  frequency: ScheduleFrequency
  temporal_schedule_id: string | null
  cron_expression: string
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
  isPaused?: boolean
  nextRunTime?: string
}

export interface ScheduleExecution {
  id: string
  website_id: string
  schedule_id: string | null
  schedule_type: ScheduleType
  workflow_type: string
  workflow_id: string | null
  trigger_type: TriggerType
  frequency: ScheduleFrequency | null
  status: ExecutionStatus
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  triggered_by: string | null
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
}

export interface ScheduleTypeInfo {
  type: ScheduleType
  name: string
  description: string
  frequency: ScheduleFrequency
  defaultCron: string
  icon: string
}

export interface UpcomingRun {
  scheduleType: ScheduleType
  scheduledTime: string
  frequency?: string
}

export interface ExecutionStatistics {
  total: number
  by_status: Record<ExecutionStatus, number>
  by_trigger_type: Record<TriggerType, number>
  by_schedule_type: Record<ScheduleType, number>
  success_rate: number
}

export function useSchedules(websiteId: string) {
  const [schedules, setSchedules] = useState<WebsiteSchedule[]>([])
  const [executions, setExecutions] = useState<ScheduleExecution[]>([])
  const [upcomingRuns, setUpcomingRuns] = useState<UpcomingRun[]>([])
  const [statistics, setStatistics] = useState<ExecutionStatistics | null>(null)
  const [scheduleTypes, setScheduleTypes] = useState<ScheduleTypeInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch schedules
  const fetchSchedules = useCallback(async () => {
    try {
      setError(null)
      const result = await trpcClient.schedule.listSchedules.query({ websiteId })
      setSchedules(result.schedules as WebsiteSchedule[])
    } catch (err) {
      console.error('Failed to fetch schedules:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch schedules')
    }
  }, [websiteId])

  // Fetch execution history
  const fetchExecutions = useCallback(async (limit: number = 50) => {
    try {
      const result = await trpcClient.schedule.getExecutionHistory.query({
        websiteId,
        limit,
      })
      setExecutions(result.executions as ScheduleExecution[])
    } catch (err) {
      console.error('Failed to fetch executions:', err)
    }
  }, [websiteId])

  // Fetch upcoming runs
  const fetchUpcomingRuns = useCallback(async () => {
    try {
      const result = await trpcClient.schedule.getUpcomingRuns.query({
        websiteId,
        limit: 10,
      })
      setUpcomingRuns(result.upcomingRuns as UpcomingRun[])
    } catch (err) {
      console.error('Failed to fetch upcoming runs:', err)
    }
  }, [websiteId])

  // Fetch statistics
  const fetchStatistics = useCallback(async () => {
    try {
      const result = await trpcClient.schedule.getStatistics.query({ websiteId })
      setStatistics(result.statistics as ExecutionStatistics)
    } catch (err) {
      console.error('Failed to fetch statistics:', err)
    }
  }, [websiteId])

  // Fetch schedule types
  const fetchScheduleTypes = useCallback(async () => {
    try {
      const result = await trpcClient.schedule.getScheduleTypes.query()
      setScheduleTypes(result.types as ScheduleTypeInfo[])
    } catch (err) {
      console.error('Failed to fetch schedule types:', err)
    }
  }, [])

  // Load all data on mount
  useEffect(() => {
    const loadAll = async () => {
      setIsLoading(true)
      await Promise.all([
        fetchSchedules(),
        fetchExecutions(),
        fetchUpcomingRuns(),
        fetchStatistics(),
        fetchScheduleTypes(),
      ])
      setIsLoading(false)
    }
    loadAll()
  }, [fetchSchedules, fetchExecutions, fetchUpcomingRuns, fetchStatistics, fetchScheduleTypes])

  // Create schedule
  const createSchedule = async (scheduleType: ScheduleType, cronExpression?: string) => {
    try {
      const result = await trpcClient.schedule.createSchedule.mutate({
        websiteId,
        scheduleType,
        cronExpression,
      })
      await fetchSchedules()
      return result
    } catch (err) {
      console.error('Failed to create schedule:', err)
      throw err
    }
  }

  // Create default schedules
  const createDefaultSchedules = async () => {
    try {
      const result = await trpcClient.schedule.createDefaultSchedules.mutate({ websiteId })
      await fetchSchedules()
      return result
    } catch (err) {
      console.error('Failed to create default schedules:', err)
      throw err
    }
  }

  // Update schedule
  const updateSchedule = async (scheduleType: ScheduleType, cronExpression: string) => {
    try {
      const result = await trpcClient.schedule.updateSchedule.mutate({
        websiteId,
        scheduleType,
        cronExpression,
      })
      await fetchSchedules()
      return result
    } catch (err) {
      console.error('Failed to update schedule:', err)
      throw err
    }
  }

  // Pause schedule
  const pauseSchedule = async (scheduleType: ScheduleType) => {
    try {
      // Optimistic update
      setSchedules((prev) =>
        prev.map((s) =>
          s.schedule_type === scheduleType ? { ...s, enabled: false, isPaused: true } : s
        )
      )

      const result = await trpcClient.schedule.pauseSchedule.mutate({
        websiteId,
        scheduleType,
      })
      await fetchSchedules()
      return result
    } catch (err) {
      console.error('Failed to pause schedule:', err)
      await fetchSchedules() // Revert
      throw err
    }
  }

  // Resume schedule
  const resumeSchedule = async (scheduleType: ScheduleType) => {
    try {
      // Optimistic update
      setSchedules((prev) =>
        prev.map((s) =>
          s.schedule_type === scheduleType ? { ...s, enabled: true, isPaused: false } : s
        )
      )

      const result = await trpcClient.schedule.resumeSchedule.mutate({
        websiteId,
        scheduleType,
      })
      await fetchSchedules()
      return result
    } catch (err) {
      console.error('Failed to resume schedule:', err)
      await fetchSchedules() // Revert
      throw err
    }
  }

  // Delete schedule
  const deleteSchedule = async (scheduleType: ScheduleType) => {
    try {
      // Optimistic update
      setSchedules((prev) => prev.filter((s) => s.schedule_type !== scheduleType))

      const result = await trpcClient.schedule.deleteSchedule.mutate({
        websiteId,
        scheduleType,
      })
      await fetchSchedules()
      return result
    } catch (err) {
      console.error('Failed to delete schedule:', err)
      await fetchSchedules() // Revert
      throw err
    }
  }

  // Trigger schedule manually
  const triggerSchedule = async (scheduleType: ScheduleType) => {
    try {
      const result = await trpcClient.schedule.triggerSchedule.mutate({
        websiteId,
        scheduleType,
      })
      await Promise.all([fetchExecutions(), fetchStatistics()])
      return result
    } catch (err) {
      console.error('Failed to trigger schedule:', err)
      throw err
    }
  }

  // Get executions for calendar (date range)
  const getCalendarExecutions = async (startDate: string, endDate: string) => {
    try {
      const result = await trpcClient.schedule.getCalendarExecutions.query({
        websiteId,
        startDate,
        endDate,
      })
      return result
    } catch (err) {
      console.error('Failed to get calendar executions:', err)
      throw err
    }
  }

  // Refresh all data
  const refresh = async () => {
    setIsLoading(true)
    await Promise.all([
      fetchSchedules(),
      fetchExecutions(),
      fetchUpcomingRuns(),
      fetchStatistics(),
    ])
    setIsLoading(false)
  }

  return {
    schedules,
    executions,
    upcomingRuns,
    statistics,
    scheduleTypes,
    isLoading,
    error,
    createSchedule,
    createDefaultSchedules,
    updateSchedule,
    pauseSchedule,
    resumeSchedule,
    deleteSchedule,
    triggerSchedule,
    getCalendarExecutions,
    refresh,
  }
}
