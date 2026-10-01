/**
 * Temporal Schedule Management
 * Provides functions to create and manage Temporal schedules for autonomous agent execution
 */

import { Connection, ScheduleClient, ScheduleHandle, ScheduleOverlapPolicy } from '@temporalio/client'
import { temporalClient } from './client'

// Schedule types that can be configured per website
export type ScheduleType =
  | 'scheduled-content'
  | 'media-check'
  | 'link-validation'
  | 'stale-content'

// Workflow mapping for each schedule type
export const SCHEDULE_WORKFLOW_MAP: Record<ScheduleType, { workflow: string; taskQueue: string }> = {
  'scheduled-content': { workflow: 'scheduledContentWorkflow', taskQueue: 'swarmpress-content-production' },
  'media-check': { workflow: 'scheduledMaintenanceWorkflow', taskQueue: 'swarmpress-default' },
  'link-validation': { workflow: 'scheduledMaintenanceWorkflow', taskQueue: 'swarmpress-default' },
  'stale-content': { workflow: 'scheduledMaintenanceWorkflow', taskQueue: 'swarmpress-default' },
}

// Default cron expressions for each schedule type
export const DEFAULT_CRON_EXPRESSIONS: Record<ScheduleType, string> = {
  'scheduled-content': '0 6 * * *',     // 6am daily
  'media-check': '0 7 * * *',           // 7am daily
  'link-validation': '0 8 * * 1',       // Monday 8am weekly
  'stale-content': '0 9 1 * *',         // 1st of month 9am
}

// Frequency descriptions
export const SCHEDULE_FREQUENCIES: Record<ScheduleType, string> = {
  'scheduled-content': 'daily',
  'media-check': 'daily',
  'link-validation': 'weekly',
  'stale-content': 'monthly',
}

// Schedule descriptions
export const SCHEDULE_DESCRIPTIONS: Record<ScheduleType, string> = {
  'scheduled-content': 'Checks content calendar and creates briefs for missing content',
  'media-check': 'Validates all image URLs are accessible and detects broken media',
  'link-validation': 'Verifies internal links resolve correctly',
  'stale-content': 'Identifies outdated content (events, weather, transport info)',
}

export interface ScheduleInfo {
  scheduleId: string
  scheduleType: ScheduleType
  websiteId: string
  workflowType: string
  cronExpression: string
  frequency: string
  description: string
  isPaused: boolean
  nextRunTime?: Date
  lastRunTime?: Date
  lastRunStatus?: 'completed' | 'failed' | 'running'
  recentActions: ScheduleAction[]
}

export interface ScheduleAction {
  scheduledTime: Date
  startedTime?: Date
  endedTime?: Date
  workflowId?: string
  runId?: string
  status: 'scheduled' | 'running' | 'completed' | 'failed'
}

export interface CreateScheduleInput {
  websiteId: string
  scheduleType: ScheduleType
  cronExpression?: string
  workflowArgs?: Record<string, unknown>
}

/**
 * Schedule Client Manager
 */
class ScheduleManager {
  private scheduleClient: ScheduleClient | null = null

  /**
   * Get or create the schedule client
   */
  async getClient(): Promise<ScheduleClient> {
    if (this.scheduleClient) {
      return this.scheduleClient
    }

    const connection = temporalClient.getConnection()
    this.scheduleClient = new ScheduleClient({
      connection,
      namespace: 'default',
    })

    return this.scheduleClient
  }

  /**
   * Generate a schedule ID for a website schedule
   */
  generateScheduleId(websiteId: string, scheduleType: ScheduleType): string {
    return `${websiteId}-${scheduleType}`
  }

  /**
   * Create a new schedule for a website
   */
  async createSchedule(input: CreateScheduleInput): Promise<ScheduleHandle> {
    const client = await this.getClient()
    const scheduleId = this.generateScheduleId(input.websiteId, input.scheduleType)
    const workflowConfig = SCHEDULE_WORKFLOW_MAP[input.scheduleType]
    const cronExpression = input.cronExpression || DEFAULT_CRON_EXPRESSIONS[input.scheduleType]

    // Build workflow args based on schedule type
    const workflowArgs = this.buildWorkflowArgs(input.scheduleType, input.websiteId, input.workflowArgs)

    console.log(`[ScheduleManager] Creating schedule: ${scheduleId}`)
    console.log(`[ScheduleManager] Cron: ${cronExpression}, Workflow: ${workflowConfig.workflow}`)

    const handle = await client.create({
      scheduleId,
      spec: {
        cronExpressions: [cronExpression],
      },
      action: {
        type: 'startWorkflow',
        workflowType: workflowConfig.workflow,
        taskQueue: workflowConfig.taskQueue,
        args: [workflowArgs],
        workflowId: `${scheduleId}-${Date.now()}`,
      },
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '1 hour',
      },
      state: {
        paused: false,
        note: `Automated ${input.scheduleType} schedule for website ${input.websiteId}`,
      },
    })

    console.log(`[ScheduleManager] Schedule created: ${scheduleId}`)
    return handle
  }

  /**
   * Build workflow arguments based on schedule type
   */
  private buildWorkflowArgs(
    scheduleType: ScheduleType,
    websiteId: string,
    customArgs?: Record<string, unknown>
  ): Record<string, unknown> {
    const baseArgs = {
      websiteId,
      triggeredBy: 'schedule',
      scheduleType,
      ...customArgs,
    }

    switch (scheduleType) {
      case 'scheduled-content':
        return {
          ...baseArgs,
          dryRun: false,
          maxTopics: 3,
        }
      case 'media-check':
        return {
          ...baseArgs,
          checkType: 'media',
        }
      case 'link-validation':
        return {
          ...baseArgs,
          checkType: 'links',
          autoFix: false,
        }
      case 'stale-content':
        return {
          ...baseArgs,
          checkType: 'stale',
          stalenessThreshold: 90, // days
        }
      default:
        return baseArgs
    }
  }

  /**
   * Get a schedule handle by ID
   */
  async getSchedule(scheduleId: string): Promise<ScheduleHandle> {
    const client = await this.getClient()
    return client.getHandle(scheduleId)
  }

  /**
   * Get schedule info with recent actions
   */
  async getScheduleInfo(
    websiteId: string,
    scheduleType: ScheduleType
  ): Promise<ScheduleInfo | null> {
    try {
      const scheduleId = this.generateScheduleId(websiteId, scheduleType)
      const handle = await this.getSchedule(scheduleId)
      const description = await handle.describe()

      // Get recent actions
      const recentActions: ScheduleAction[] = description.info.recentActions.map((action) => ({
        scheduledTime: action.scheduleTime,
        startedTime: action.startedTime,
        status: action.startedTime ? 'completed' : 'scheduled',
      }))

      // Get next scheduled runs
      const nextRunTime = description.info.nextActions[0]?.scheduleTime

      // Determine last run status
      const lastAction = description.info.recentActions[0]
      const lastRunStatus = lastAction ? 'completed' : undefined

      return {
        scheduleId,
        scheduleType,
        websiteId,
        workflowType: SCHEDULE_WORKFLOW_MAP[scheduleType].workflow,
        cronExpression: description.schedule.spec.cronExpressions?.[0] || DEFAULT_CRON_EXPRESSIONS[scheduleType],
        frequency: SCHEDULE_FREQUENCIES[scheduleType],
        description: SCHEDULE_DESCRIPTIONS[scheduleType],
        isPaused: description.schedule.state.paused,
        nextRunTime,
        lastRunTime: lastAction?.scheduleTime,
        lastRunStatus,
        recentActions,
      }
    } catch (error) {
      // Schedule doesn't exist
      return null
    }
  }

  /**
   * List all schedules for a website
   */
  async listSchedulesForWebsite(websiteId: string): Promise<ScheduleInfo[]> {
    const scheduleTypes: ScheduleType[] = [
      'scheduled-content',
      'media-check',
      'link-validation',
      'stale-content',
    ]

    const schedules = await Promise.all(
      scheduleTypes.map((type) => this.getScheduleInfo(websiteId, type))
    )

    return schedules.filter((s): s is ScheduleInfo => s !== null)
  }

  /**
   * List all schedules (across all websites)
   */
  async listAllSchedules(): Promise<ScheduleInfo[]> {
    const client = await this.getClient()
    const schedules: ScheduleInfo[] = []

    for await (const schedule of client.list()) {
      const scheduleId = schedule.scheduleId
      // Parse websiteId and scheduleType from scheduleId
      const lastDashIndex = scheduleId.lastIndexOf('-')
      if (lastDashIndex === -1) continue

      // Find the schedule type
      let websiteId: string | null = null
      let scheduleType: ScheduleType | null = null

      for (const type of ['scheduled-content', 'media-check', 'link-validation', 'stale-content'] as ScheduleType[]) {
        if (scheduleId.endsWith(`-${type}`)) {
          websiteId = scheduleId.slice(0, scheduleId.length - type.length - 1)
          scheduleType = type
          break
        }
      }

      if (!websiteId || !scheduleType) continue

      const info = await this.getScheduleInfo(websiteId, scheduleType)
      if (info) {
        schedules.push(info)
      }
    }

    return schedules
  }

  /**
   * Pause a schedule
   */
  async pauseSchedule(websiteId: string, scheduleType: ScheduleType): Promise<void> {
    const scheduleId = this.generateScheduleId(websiteId, scheduleType)
    const handle = await this.getSchedule(scheduleId)
    await handle.pause('Paused by user')
    console.log(`[ScheduleManager] Schedule paused: ${scheduleId}`)
  }

  /**
   * Resume a schedule
   */
  async resumeSchedule(websiteId: string, scheduleType: ScheduleType): Promise<void> {
    const scheduleId = this.generateScheduleId(websiteId, scheduleType)
    const handle = await this.getSchedule(scheduleId)
    await handle.unpause('Resumed by user')
    console.log(`[ScheduleManager] Schedule resumed: ${scheduleId}`)
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(websiteId: string, scheduleType: ScheduleType): Promise<void> {
    const scheduleId = this.generateScheduleId(websiteId, scheduleType)
    const handle = await this.getSchedule(scheduleId)
    await handle.delete()
    console.log(`[ScheduleManager] Schedule deleted: ${scheduleId}`)
  }

  /**
   * Update a schedule's cron expression
   */
  async updateSchedule(
    websiteId: string,
    scheduleType: ScheduleType,
    cronExpression: string
  ): Promise<void> {
    const scheduleId = this.generateScheduleId(websiteId, scheduleType)
    const handle = await this.getSchedule(scheduleId)

    await handle.update((schedule) => {
      schedule.spec.cronExpressions = [cronExpression]
      return schedule
    })

    console.log(`[ScheduleManager] Schedule updated: ${scheduleId} with cron: ${cronExpression}`)
  }

  /**
   * Trigger a schedule manually (run now)
   */
  async triggerSchedule(
    websiteId: string,
    scheduleType: ScheduleType
  ): Promise<{ workflowId: string }> {
    const scheduleId = this.generateScheduleId(websiteId, scheduleType)
    const handle = await this.getSchedule(scheduleId)
    await handle.trigger()
    console.log(`[ScheduleManager] Schedule triggered manually: ${scheduleId}`)

    // Return a placeholder workflow ID (the actual one is generated by the schedule)
    return { workflowId: `${scheduleId}-manual-${Date.now()}` }
  }

  /**
   * Get upcoming scheduled runs for a schedule
   */
  async getUpcomingRuns(
    websiteId: string,
    scheduleType: ScheduleType,
    limit: number = 10
  ): Promise<Date[]> {
    const scheduleId = this.generateScheduleId(websiteId, scheduleType)
    const handle = await this.getSchedule(scheduleId)
    const description = await handle.describe()

    return description.info.nextActions
      .slice(0, limit)
      .map((action) => action.scheduleTime)
  }

  /**
   * Get recent execution history for a schedule
   */
  async getRecentExecutions(
    websiteId: string,
    scheduleType: ScheduleType,
    limit: number = 10
  ): Promise<ScheduleAction[]> {
    const scheduleId = this.generateScheduleId(websiteId, scheduleType)
    const handle = await this.getSchedule(scheduleId)
    const description = await handle.describe()

    return description.info.recentActions.slice(0, limit).map((action) => ({
      scheduledTime: action.scheduleTime,
      startedTime: action.startedTime,
      status: action.startedTime ? 'completed' : 'scheduled',
    }))
  }

  /**
   * Create default schedules for a website
   */
  async createDefaultSchedules(websiteId: string): Promise<void> {
    const scheduleTypes: ScheduleType[] = [
      'scheduled-content',
      'media-check',
      'link-validation',
      'stale-content',
    ]

    for (const scheduleType of scheduleTypes) {
      try {
        // Check if schedule already exists
        const existing = await this.getScheduleInfo(websiteId, scheduleType)
        if (existing) {
          console.log(`[ScheduleManager] Schedule ${scheduleType} already exists for website ${websiteId}`)
          continue
        }

        await this.createSchedule({ websiteId, scheduleType })
      } catch (error) {
        console.error(`[ScheduleManager] Failed to create ${scheduleType} schedule:`, error)
      }
    }
  }

  /**
   * Delete all schedules for a website
   */
  async deleteAllSchedules(websiteId: string): Promise<void> {
    const scheduleTypes: ScheduleType[] = [
      'scheduled-content',
      'media-check',
      'link-validation',
      'stale-content',
    ]

    for (const scheduleType of scheduleTypes) {
      try {
        await this.deleteSchedule(websiteId, scheduleType)
      } catch (error) {
        // Schedule might not exist, that's ok
        console.log(`[ScheduleManager] Schedule ${scheduleType} not found for website ${websiteId}`)
      }
    }
  }
}

// Export singleton instance
export const scheduleManager = new ScheduleManager()

// Export helper functions
export const createSchedule = (input: CreateScheduleInput) => scheduleManager.createSchedule(input)
export const getScheduleInfo = (websiteId: string, scheduleType: ScheduleType) =>
  scheduleManager.getScheduleInfo(websiteId, scheduleType)
export const listSchedulesForWebsite = (websiteId: string) =>
  scheduleManager.listSchedulesForWebsite(websiteId)
export const listAllSchedules = () => scheduleManager.listAllSchedules()
export const pauseSchedule = (websiteId: string, scheduleType: ScheduleType) =>
  scheduleManager.pauseSchedule(websiteId, scheduleType)
export const resumeSchedule = (websiteId: string, scheduleType: ScheduleType) =>
  scheduleManager.resumeSchedule(websiteId, scheduleType)
export const deleteSchedule = (websiteId: string, scheduleType: ScheduleType) =>
  scheduleManager.deleteSchedule(websiteId, scheduleType)
export const updateSchedule = (websiteId: string, scheduleType: ScheduleType, cron: string) =>
  scheduleManager.updateSchedule(websiteId, scheduleType, cron)
export const triggerSchedule = (websiteId: string, scheduleType: ScheduleType) =>
  scheduleManager.triggerSchedule(websiteId, scheduleType)
export const getUpcomingRuns = (websiteId: string, scheduleType: ScheduleType, limit?: number) =>
  scheduleManager.getUpcomingRuns(websiteId, scheduleType, limit)
export const getRecentExecutions = (websiteId: string, scheduleType: ScheduleType, limit?: number) =>
  scheduleManager.getRecentExecutions(websiteId, scheduleType, limit)
export const createDefaultSchedules = (websiteId: string) =>
  scheduleManager.createDefaultSchedules(websiteId)
export const deleteAllSchedules = (websiteId: string) =>
  scheduleManager.deleteAllSchedules(websiteId)
