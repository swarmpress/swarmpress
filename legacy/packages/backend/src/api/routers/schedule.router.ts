/**
 * Schedule API Router
 * Endpoints for managing autonomous agent schedules and viewing execution history
 */

import { z } from 'zod'
import { router, publicProcedure, protectedProcedure, ceoProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { scheduleRepository } from '../../db/repositories/index.js'

// Lazy import Temporal schedule manager to avoid connection issues at startup
async function getScheduleManager() {
  const { scheduleManager, SCHEDULE_FREQUENCIES, DEFAULT_CRON_EXPRESSIONS, SCHEDULE_DESCRIPTIONS } =
    await import('@swarm-press/workflows')
  return { scheduleManager, SCHEDULE_FREQUENCIES, DEFAULT_CRON_EXPRESSIONS, SCHEDULE_DESCRIPTIONS }
}

// Zod schemas
const scheduleTypeSchema = z.enum([
  'scheduled-content',
  'media-check',
  'link-validation',
  'stale-content',
])

const frequencySchema = z.enum(['daily', 'weekly', 'monthly'])

const executionStatusSchema = z.enum(['scheduled', 'running', 'completed', 'failed'])

const triggerTypeSchema = z.enum(['scheduled', 'manual'])

export const scheduleRouter = router({
  // ============================================================================
  // Schedule Management
  // ============================================================================

  /**
   * List all schedules for a website
   */
  listSchedules: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Get schedules from database
        const dbSchedules = await scheduleRepository.findSchedulesByWebsite(input.websiteId)

        // Try to get live status from Temporal (may fail if not connected)
        let temporalSchedules: Record<string, { isPaused: boolean; nextRunTime?: Date }> = {}
        try {
          const { scheduleManager } = await getScheduleManager()
          const liveSchedules = await scheduleManager.listSchedulesForWebsite(input.websiteId)
          temporalSchedules = Object.fromEntries(
            liveSchedules.map((s) => [
              s.scheduleType,
              { isPaused: s.isPaused, nextRunTime: s.nextRunTime },
            ])
          )
        } catch (error) {
          console.log('[ScheduleRouter] Temporal not available, using database only')
        }

        // Merge database and Temporal info
        return {
          schedules: dbSchedules.map((schedule) => ({
            ...schedule,
            isPaused: temporalSchedules[schedule.schedule_type]?.isPaused ?? !schedule.enabled,
            nextRunTime:
              temporalSchedules[schedule.schedule_type]?.nextRunTime?.toISOString() ||
              schedule.next_run_at,
          })),
        }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to list schedules:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to list schedules',
        })
      }
    }),

  /**
   * Get schedule details
   */
  getSchedule: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        scheduleType: scheduleTypeSchema,
      })
    )
    .query(async ({ input }) => {
      try {
        const schedule = await scheduleRepository.findScheduleByType(
          input.websiteId,
          input.scheduleType
        )

        if (!schedule) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Schedule ${input.scheduleType} not found for website`,
          })
        }

        // Try to get live info from Temporal
        let temporalInfo = null
        try {
          const { scheduleManager } = await getScheduleManager()
          temporalInfo = await scheduleManager.getScheduleInfo(input.websiteId, input.scheduleType)
        } catch (error) {
          console.log('[ScheduleRouter] Temporal not available')
        }

        return {
          schedule: {
            ...schedule,
            isPaused: temporalInfo?.isPaused ?? !schedule.enabled,
            nextRunTime: temporalInfo?.nextRunTime?.toISOString() || schedule.next_run_at,
            recentActions: temporalInfo?.recentActions || [],
          },
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error
        console.error('[ScheduleRouter] Failed to get schedule:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get schedule',
        })
      }
    }),

  /**
   * Create a schedule (or enable it if it exists)
   */
  createSchedule: protectedProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        scheduleType: scheduleTypeSchema,
        cronExpression: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { scheduleManager, SCHEDULE_FREQUENCIES, DEFAULT_CRON_EXPRESSIONS } =
          await getScheduleManager()

        const cronExpression = input.cronExpression || DEFAULT_CRON_EXPRESSIONS[input.scheduleType]
        const frequency = SCHEDULE_FREQUENCIES[input.scheduleType]

        // Create in Temporal
        await scheduleManager.createSchedule({
          websiteId: input.websiteId,
          scheduleType: input.scheduleType,
          cronExpression,
        })

        // Upsert in database
        const schedule = await scheduleRepository.upsertSchedule({
          website_id: input.websiteId,
          schedule_type: input.scheduleType,
          frequency: frequency as 'daily' | 'weekly' | 'monthly',
          temporal_schedule_id: `${input.websiteId}-${input.scheduleType}`,
          cron_expression: cronExpression,
          enabled: true,
        })

        console.log(`[ScheduleRouter] Schedule created: ${input.scheduleType} for ${input.websiteId}`)

        return {
          success: true,
          schedule,
          message: `Schedule ${input.scheduleType} created successfully`,
        }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to create schedule:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create schedule',
        })
      }
    }),

  /**
   * Create default schedules for a website
   */
  createDefaultSchedules: protectedProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { scheduleManager, SCHEDULE_FREQUENCIES, DEFAULT_CRON_EXPRESSIONS } =
          await getScheduleManager()

        const scheduleTypes = [
          'scheduled-content',
          'media-check',
          'link-validation',
          'stale-content',
        ] as const

        const created: string[] = []
        const skipped: string[] = []

        for (const scheduleType of scheduleTypes) {
          try {
            // Check if already exists in DB
            const existing = await scheduleRepository.findScheduleByType(
              input.websiteId,
              scheduleType
            )
            if (existing) {
              skipped.push(scheduleType)
              continue
            }

            // Create in Temporal
            await scheduleManager.createSchedule({
              websiteId: input.websiteId,
              scheduleType,
            })

            // Create in database
            await scheduleRepository.createSchedule({
              website_id: input.websiteId,
              schedule_type: scheduleType,
              frequency: SCHEDULE_FREQUENCIES[scheduleType] as 'daily' | 'weekly' | 'monthly',
              temporal_schedule_id: `${input.websiteId}-${scheduleType}`,
              cron_expression: DEFAULT_CRON_EXPRESSIONS[scheduleType],
              enabled: true,
            })

            created.push(scheduleType)
          } catch (err) {
            console.error(`[ScheduleRouter] Failed to create ${scheduleType}:`, err)
            skipped.push(scheduleType)
          }
        }

        console.log(`[ScheduleRouter] Default schedules: created=${created.join(',')}, skipped=${skipped.join(',')}`)

        return {
          success: true,
          created,
          skipped,
          message: `Created ${created.length} schedules, skipped ${skipped.length}`,
        }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to create default schedules:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create default schedules',
        })
      }
    }),

  /**
   * Update schedule cron expression
   */
  updateSchedule: protectedProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        scheduleType: scheduleTypeSchema,
        cronExpression: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Update in Temporal
        try {
          const { scheduleManager } = await getScheduleManager()
          await scheduleManager.updateSchedule(
            input.websiteId,
            input.scheduleType,
            input.cronExpression
          )
        } catch (error) {
          console.log('[ScheduleRouter] Temporal update failed, updating database only')
        }

        // Update in database
        const schedule = await scheduleRepository.findScheduleByType(
          input.websiteId,
          input.scheduleType
        )
        if (schedule) {
          await scheduleRepository.updateSchedule(schedule.id, {
            cron_expression: input.cronExpression,
          })
        }

        console.log(`[ScheduleRouter] Schedule updated: ${input.scheduleType} cron=${input.cronExpression}`)

        return {
          success: true,
          message: `Schedule ${input.scheduleType} updated successfully`,
        }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to update schedule:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update schedule',
        })
      }
    }),

  /**
   * Pause a schedule
   */
  pauseSchedule: protectedProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        scheduleType: scheduleTypeSchema,
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Pause in Temporal
        try {
          const { scheduleManager } = await getScheduleManager()
          await scheduleManager.pauseSchedule(input.websiteId, input.scheduleType)
        } catch (error) {
          console.log('[ScheduleRouter] Temporal pause failed, updating database only')
        }

        // Update database
        const schedule = await scheduleRepository.findScheduleByType(
          input.websiteId,
          input.scheduleType
        )
        if (schedule) {
          await scheduleRepository.updateSchedule(schedule.id, { enabled: false })
        }

        console.log(`[ScheduleRouter] Schedule paused: ${input.scheduleType}`)

        return {
          success: true,
          message: `Schedule ${input.scheduleType} paused`,
        }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to pause schedule:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to pause schedule',
        })
      }
    }),

  /**
   * Resume a schedule
   */
  resumeSchedule: protectedProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        scheduleType: scheduleTypeSchema,
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Resume in Temporal
        try {
          const { scheduleManager } = await getScheduleManager()
          await scheduleManager.resumeSchedule(input.websiteId, input.scheduleType)
        } catch (error) {
          console.log('[ScheduleRouter] Temporal resume failed, updating database only')
        }

        // Update database
        const schedule = await scheduleRepository.findScheduleByType(
          input.websiteId,
          input.scheduleType
        )
        if (schedule) {
          await scheduleRepository.updateSchedule(schedule.id, { enabled: true })
        }

        console.log(`[ScheduleRouter] Schedule resumed: ${input.scheduleType}`)

        return {
          success: true,
          message: `Schedule ${input.scheduleType} resumed`,
        }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to resume schedule:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to resume schedule',
        })
      }
    }),

  /**
   * Delete a schedule
   */
  deleteSchedule: ceoProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        scheduleType: scheduleTypeSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Delete from Temporal
        try {
          const { scheduleManager } = await getScheduleManager()
          await scheduleManager.deleteSchedule(input.websiteId, input.scheduleType)
        } catch (error) {
          console.log('[ScheduleRouter] Temporal delete failed, deleting from database only')
        }

        // Delete from database
        const schedule = await scheduleRepository.findScheduleByType(
          input.websiteId,
          input.scheduleType
        )
        if (schedule) {
          await scheduleRepository.deleteSchedule(schedule.id)
        }

        console.log(`[ScheduleRouter] Schedule deleted: ${input.scheduleType} by ${ctx.user.email}`)

        return {
          success: true,
          message: `Schedule ${input.scheduleType} deleted`,
        }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to delete schedule:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to delete schedule',
        })
      }
    }),

  /**
   * Trigger a schedule manually (run now)
   */
  triggerSchedule: protectedProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        scheduleType: scheduleTypeSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { scheduleManager, SCHEDULE_FREQUENCIES } = await getScheduleManager()

        // Get schedule info
        const schedule = await scheduleRepository.findScheduleByType(
          input.websiteId,
          input.scheduleType
        )

        // Trigger in Temporal
        const result = await scheduleManager.triggerSchedule(input.websiteId, input.scheduleType)

        // Create execution record
        const execution = await scheduleRepository.createExecution({
          website_id: input.websiteId,
          schedule_id: schedule?.id,
          schedule_type: input.scheduleType,
          workflow_type: `${input.scheduleType}Workflow`,
          workflow_id: result.workflowId,
          trigger_type: 'manual',
          frequency: SCHEDULE_FREQUENCIES[input.scheduleType] as 'daily' | 'weekly' | 'monthly',
          status: 'running',
          scheduled_at: new Date().toISOString(),
          triggered_by: ctx.user?.email || 'unknown',
        })

        console.log(`[ScheduleRouter] Schedule triggered: ${input.scheduleType} execution=${execution.id}`)

        return {
          success: true,
          executionId: execution.id,
          workflowId: result.workflowId,
          message: `Schedule ${input.scheduleType} triggered manually`,
        }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to trigger schedule:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to trigger schedule',
        })
      }
    }),

  // ============================================================================
  // Execution History
  // ============================================================================

  /**
   * Get execution history for a website
   */
  getExecutionHistory: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        scheduleType: scheduleTypeSchema.optional(),
        triggerType: triggerTypeSchema.optional(),
        status: executionStatusSchema.optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const executions = await scheduleRepository.findExecutionsByWebsite(input.websiteId, {
          scheduleType: input.scheduleType,
          triggerType: input.triggerType,
          status: input.status,
          limit: input.limit,
          offset: input.offset,
        })

        return { executions }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to get execution history:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get execution history',
        })
      }
    }),

  /**
   * Get executions for calendar view (date range)
   */
  getCalendarExecutions: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        startDate: z.string(), // ISO date string
        endDate: z.string(),
      })
    )
    .query(async ({ input }) => {
      try {
        const executions = await scheduleRepository.findExecutionsForCalendar(
          input.websiteId,
          input.startDate,
          input.endDate
        )

        // Also get upcoming scheduled runs from Temporal
        let upcomingRuns: Array<{
          scheduleType: string
          scheduledTime: string
        }> = []

        try {
          const { scheduleManager } = await getScheduleManager()
          const schedules = await scheduleManager.listSchedulesForWebsite(input.websiteId)

          for (const schedule of schedules) {
            const runs = await scheduleManager.getUpcomingRuns(
              input.websiteId,
              schedule.scheduleType,
              10
            )
            for (const runTime of runs) {
              const runTimeStr = runTime.toISOString()
              // Only include runs within the date range
              if (runTimeStr >= input.startDate && runTimeStr <= input.endDate) {
                upcomingRuns.push({
                  scheduleType: schedule.scheduleType,
                  scheduledTime: runTimeStr,
                })
              }
            }
          }
        } catch (error) {
          console.log('[ScheduleRouter] Temporal not available for upcoming runs')
        }

        return {
          executions,
          upcomingRuns,
        }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to get calendar executions:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get calendar executions',
        })
      }
    }),

  /**
   * Get upcoming scheduled runs
   */
  getUpcomingRuns: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        scheduleType: scheduleTypeSchema.optional(),
        limit: z.number().min(1).max(20).default(10),
      })
    )
    .query(async ({ input }) => {
      try {
        const { scheduleManager } = await getScheduleManager()

        const upcomingRuns: Array<{
          scheduleType: string
          scheduledTime: string
          frequency: string
        }> = []

        if (input.scheduleType) {
          const runs = await scheduleManager.getUpcomingRuns(
            input.websiteId,
            input.scheduleType,
            input.limit
          )
          for (const runTime of runs) {
            upcomingRuns.push({
              scheduleType: input.scheduleType,
              scheduledTime: runTime.toISOString(),
              frequency: 'daily', // Would need to look this up
            })
          }
        } else {
          const schedules = await scheduleManager.listSchedulesForWebsite(input.websiteId)
          for (const schedule of schedules) {
            const runs = await scheduleManager.getUpcomingRuns(
              input.websiteId,
              schedule.scheduleType,
              Math.ceil(input.limit / 4)
            )
            for (const runTime of runs) {
              upcomingRuns.push({
                scheduleType: schedule.scheduleType,
                scheduledTime: runTime.toISOString(),
                frequency: schedule.frequency,
              })
            }
          }
        }

        // Sort by time
        upcomingRuns.sort(
          (a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
        )

        return { upcomingRuns: upcomingRuns.slice(0, input.limit) }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to get upcoming runs:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get upcoming runs',
        })
      }
    }),

  /**
   * Get execution statistics
   */
  getStatistics: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const stats = await scheduleRepository.getExecutionStatistics(
          input.websiteId,
          input.startDate,
          input.endDate
        )
        return { statistics: stats }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to get statistics:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get statistics',
        })
      }
    }),

  /**
   * Update execution status (used by workflows)
   */
  updateExecution: publicProcedure
    .input(
      z.object({
        executionId: z.string().uuid(),
        status: executionStatusSchema.optional(),
        workflowId: z.string().optional(),
        startedAt: z.string().optional(),
        completedAt: z.string().optional(),
        result: z.record(z.unknown()).optional(),
        error: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const execution = await scheduleRepository.updateExecution(input.executionId, {
          status: input.status,
          workflow_id: input.workflowId,
          started_at: input.startedAt,
          completed_at: input.completedAt,
          result: input.result,
          error: input.error,
        })

        // If completed/failed, update the schedule's last_run_at
        if (input.status === 'completed' || input.status === 'failed') {
          if (execution.schedule_id) {
            await scheduleRepository.updateSchedule(execution.schedule_id, {
              last_run_at: input.completedAt || new Date().toISOString(),
            })
          }
        }

        return { execution }
      } catch (error) {
        console.error('[ScheduleRouter] Failed to update execution:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update execution',
        })
      }
    }),

  /**
   * Get schedule type descriptions
   */
  getScheduleTypes: publicProcedure.query(async () => {
    try {
      const { SCHEDULE_FREQUENCIES, DEFAULT_CRON_EXPRESSIONS, SCHEDULE_DESCRIPTIONS } =
        await getScheduleManager()

      return {
        types: [
          {
            type: 'scheduled-content',
            name: 'Scheduled Content',
            description: SCHEDULE_DESCRIPTIONS['scheduled-content'],
            frequency: SCHEDULE_FREQUENCIES['scheduled-content'],
            defaultCron: DEFAULT_CRON_EXPRESSIONS['scheduled-content'],
            icon: '📝',
          },
          {
            type: 'media-check',
            name: 'Media Check',
            description: SCHEDULE_DESCRIPTIONS['media-check'],
            frequency: SCHEDULE_FREQUENCIES['media-check'],
            defaultCron: DEFAULT_CRON_EXPRESSIONS['media-check'],
            icon: '🖼️',
          },
          {
            type: 'link-validation',
            name: 'Link Validation',
            description: SCHEDULE_DESCRIPTIONS['link-validation'],
            frequency: SCHEDULE_FREQUENCIES['link-validation'],
            defaultCron: DEFAULT_CRON_EXPRESSIONS['link-validation'],
            icon: '🔗',
          },
          {
            type: 'stale-content',
            name: 'Stale Content Check',
            description: SCHEDULE_DESCRIPTIONS['stale-content'],
            frequency: SCHEDULE_FREQUENCIES['stale-content'],
            defaultCron: DEFAULT_CRON_EXPRESSIONS['stale-content'],
            icon: '📅',
          },
        ],
      }
    } catch (error) {
      console.error('[ScheduleRouter] Failed to get schedule types:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get schedule types',
      })
    }
  }),
})
