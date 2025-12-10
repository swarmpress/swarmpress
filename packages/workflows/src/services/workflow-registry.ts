/**
 * Workflow Registry
 * Tracks running workflow IDs for signal routing
 *
 * This allows GitHub webhooks to find and signal the correct
 * Temporal workflow when CEO takes action.
 */

interface WorkflowEntry {
  workflowId: string
  runId: string
  contentId: string
  workflowType: 'content-production' | 'editorial-review' | 'publishing'
  status: 'running' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
}

// In-memory registry (should be in DB for production)
const workflowRegistry = new Map<string, WorkflowEntry>()

/**
 * Register a workflow for signal routing
 */
export function registerWorkflow(entry: Omit<WorkflowEntry, 'createdAt' | 'updatedAt'>): void {
  const now = new Date().toISOString()
  workflowRegistry.set(entry.contentId, {
    ...entry,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`[WorkflowRegistry] Registered ${entry.workflowType} workflow for content ${entry.contentId}`)
}

/**
 * Get workflow entry by content ID
 */
export function getWorkflowByContentId(contentId: string): WorkflowEntry | undefined {
  return workflowRegistry.get(contentId)
}

/**
 * Update workflow status
 */
export function updateWorkflowStatus(
  contentId: string,
  status: WorkflowEntry['status']
): void {
  const entry = workflowRegistry.get(contentId)
  if (entry) {
    entry.status = status
    entry.updatedAt = new Date().toISOString()
    console.log(`[WorkflowRegistry] Updated ${contentId} status to ${status}`)
  }
}

/**
 * Remove workflow from registry
 */
export function unregisterWorkflow(contentId: string): void {
  workflowRegistry.delete(contentId)
  console.log(`[WorkflowRegistry] Unregistered workflow for content ${contentId}`)
}

/**
 * Get all running workflows
 */
export function getRunningWorkflows(): WorkflowEntry[] {
  return Array.from(workflowRegistry.values()).filter(
    (entry) => entry.status === 'running'
  )
}

/**
 * Find workflow by PR branch name
 * Branch format: content/{contentId}
 */
export function findWorkflowByBranch(branchName: string): WorkflowEntry | undefined {
  const match = branchName.match(/content\/(.+)/)
  if (!match || !match[1]) {
    return undefined
  }
  const contentId = match[1]
  return workflowRegistry.get(contentId)
}

export { WorkflowEntry }
