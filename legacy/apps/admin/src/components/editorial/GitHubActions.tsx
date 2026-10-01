/**
 * GitHub Actions Component
 * Provides GitHub integration actions for editorial tasks
 */

import { useState } from 'react'

export interface GitHubActionsProps {
  taskId: string
  websiteId: string
  githubIssueUrl?: string
  githubPrUrl?: string
  githubBranch?: string
  onCreateIssue: (taskId: string, websiteId: string) => Promise<any>
  onCreatePR: (taskId: string, websiteId: string) => Promise<any>
  onSyncPR: (taskId: string, websiteId: string) => Promise<any>
}

export function GitHubActions({
  taskId,
  websiteId,
  githubIssueUrl,
  githubPrUrl,
  githubBranch,
  onCreateIssue,
  onCreatePR,
  onSyncPR,
}: GitHubActionsProps) {
  const [isCreatingIssue, setIsCreatingIssue] = useState(false)
  const [isCreatingPR, setIsCreatingPR] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleCreateIssue = async () => {
    setIsCreatingIssue(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await onCreateIssue(taskId, websiteId)
      setSuccess(`GitHub Issue #${result.issueNumber} created`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create GitHub Issue')
    } finally {
      setIsCreatingIssue(false)
    }
  }

  const handleCreatePR = async () => {
    setIsCreatingPR(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await onCreatePR(taskId, websiteId)
      setSuccess(`GitHub PR #${result.prNumber} created`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create GitHub PR')
    } finally {
      setIsCreatingPR(false)
    }
  }

  const handleSyncPR = async () => {
    setIsSyncing(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await onSyncPR(taskId, websiteId)
      if (result.updated) {
        setSuccess(`Task status synced: ${result.prState} → ${result.taskStatus}`)
      } else {
        setSuccess(`Task status already up to date`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync from GitHub PR')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900">GitHub Integration</h3>

      {/* Success/Error Messages */}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
          ✓ {success}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* GitHub Issue Section */}
      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📋</span>
            <span className="font-medium text-gray-900">GitHub Issue</span>
          </div>
          {githubIssueUrl && (
            <a
              href={githubIssueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-sm"
            >
              View Issue →
            </a>
          )}
        </div>

        {githubIssueUrl ? (
          <div className="text-sm text-gray-600">
            <p className="break-all">{githubIssueUrl}</p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Create a GitHub Issue to track this task in your repository.
            </p>
            <button
              onClick={handleCreateIssue}
              disabled={isCreatingIssue}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isCreatingIssue ? 'Creating...' : '+ Create Issue'}
            </button>
          </div>
        )}
      </div>

      {/* GitHub Pull Request Section */}
      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔀</span>
            <span className="font-medium text-gray-900">Pull Request</span>
          </div>
          {githubPrUrl && (
            <a
              href={githubPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-sm"
            >
              View PR →
            </a>
          )}
        </div>

        {githubPrUrl ? (
          <div className="space-y-2">
            <div className="text-sm text-gray-600">
              <p className="break-all">{githubPrUrl}</p>
              {githubBranch && (
                <p className="mt-1">
                  <span className="font-medium">Branch:</span> <code className="bg-white px-1.5 py-0.5 rounded text-xs">{githubBranch}</code>
                </p>
              )}
            </div>
            <button
              onClick={handleSyncPR}
              disabled={isSyncing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isSyncing ? 'Syncing...' : '🔄 Sync Status from PR'}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Create a Pull Request with a dedicated branch for this task.
            </p>
            <button
              onClick={handleCreatePR}
              disabled={isCreatingPR}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isCreatingPR ? 'Creating...' : '+ Create PR'}
            </button>
          </div>
        )}
      </div>

      {/* Help Text */}
      <div className="text-xs text-gray-500 italic">
        <p>
          GitHub integration requires a repository to be configured for this website.
          Issues and PRs will be created in that repository.
        </p>
      </div>
    </div>
  )
}
