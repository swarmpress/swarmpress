/**
 * GitHubSyncPanel Component
 * GitHub synchronization controls for sitemap editor
 */

import React, { useState, useEffect } from 'react'

interface GitHubSyncPanelProps {
  websiteId: string
}

interface SyncStatus {
  configured: boolean
  inSync: boolean
  localPages: number
  remotePages: number
  conflicts: string[]
}

export default function GitHubSyncPanel({ websiteId }: GitHubSyncPanelProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showPROptions, setShowPROptions] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [syncResult, setSyncResult] = useState<any>(null)

  // Load sync status
  useEffect(() => {
    if (websiteId) {
      loadSyncStatus()
    }
  }, [websiteId])

  async function loadSyncStatus() {
    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/trpc/github.getSyncStatus?input=${encodeURIComponent(JSON.stringify({ websiteId }))}`
      )
      const data = await response.json()
      setSyncStatus(data.result?.data || null)
    } catch (error) {
      console.error('Failed to load sync status:', error)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSync(createPR: boolean) {
    setIsSyncing(true)
    setSyncResult(null)

    try {
      const response = await fetch('/api/trpc/github.syncSitemap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          createPR,
          prTitle: createPR ? prTitle : undefined,
          prBody: createPR ? prBody : undefined,
        }),
      })

      const data = await response.json()
      const result = data.result?.data

      if (result) {
        setSyncResult(result)
        await loadSyncStatus()

        if (createPR) {
          setShowPROptions(false)
          setPrTitle('')
          setPrBody('')
        }
      } else {
        alert('Sync failed: ' + (data.error?.message || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to sync:', error)
      alert('Failed to sync to GitHub')
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleImport() {
    setIsSyncing(true)

    try {
      const response = await fetch('/api/trpc/github.importSitemap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId }),
      })

      const data = await response.json()
      const result = data.result?.data

      if (result) {
        alert(
          `Import complete!\n\nPages imported: ${result.pagesImported}\n${
            result.errors.length > 0 ? `Errors: ${result.errors.length}` : ''
          }`
        )
        await loadSyncStatus()
      } else {
        alert('Import failed')
      }
    } catch (error) {
      console.error('Failed to import:', error)
      alert('Failed to import from GitHub')
    } finally {
      setIsSyncing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-sm text-gray-600 mt-2">Checking sync status...</p>
        </div>
      </div>
    )
  }

  if (!syncStatus?.configured) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-yellow-600 text-xl">⚠️</span>
          <div className="flex-1">
            <h4 className="font-medium text-yellow-900 mb-1">GitHub Not Configured</h4>
            <p className="text-sm text-yellow-700 mb-3">
              This website does not have a GitHub repository configured.
            </p>
            <a
              href={`/websites/${websiteId}`}
              className="inline-block px-3 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 text-sm"
            >
              Configure Repository
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">🐙 GitHub Sync</h3>
        <button
          onClick={loadSyncStatus}
          disabled={isLoading}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Sync Status */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Status:</span>
          <span
            className={`font-medium ${
              syncStatus.inSync ? 'text-green-600' : 'text-orange-600'
            }`}
          >
            {syncStatus.inSync ? '✓ In Sync' : '⚠ Out of Sync'}
          </span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Local Pages:</span>
          <span className="font-medium text-gray-900">{syncStatus.localPages}</span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Remote Pages:</span>
          <span className="font-medium text-gray-900">{syncStatus.remotePages}</span>
        </div>

        {syncStatus.conflicts.length > 0 && (
          <div className="mt-3 p-2 bg-orange-50 rounded border border-orange-200">
            <p className="text-xs font-medium text-orange-900 mb-1">Conflicts:</p>
            <ul className="text-xs text-orange-700 space-y-1">
              {syncStatus.conflicts.slice(0, 3).map((conflict, i) => (
                <li key={i}>• {conflict}</li>
              ))}
              {syncStatus.conflicts.length > 3 && (
                <li>• ... and {syncStatus.conflicts.length - 3} more</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Sync Result */}
      {syncResult && (
        <div className="p-3 bg-green-50 border border-green-200 rounded">
          <p className="text-sm font-medium text-green-900 mb-1">✓ Sync Complete!</p>
          <div className="text-xs text-green-700 space-y-1">
            <div>Files created: {syncResult.filesCreated}</div>
            <div>Files updated: {syncResult.filesUpdated}</div>
            {syncResult.pullRequestUrl && (
              <div>
                <a
                  href={syncResult.pullRequestUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  View Pull Request →
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2">
        {!showPROptions ? (
          <>
            <button
              onClick={() => handleSync(false)}
              disabled={isSyncing}
              className="w-full px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm disabled:bg-blue-400"
            >
              {isSyncing ? 'Syncing...' : '↑ Push to GitHub'}
            </button>

            <button
              onClick={() => setShowPROptions(true)}
              disabled={isSyncing}
              className="w-full px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm"
            >
              📝 Create Pull Request
            </button>

            <button
              onClick={handleImport}
              disabled={isSyncing}
              className="w-full px-3 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors text-sm"
            >
              ↓ Import from GitHub
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">PR Title</label>
              <input
                type="text"
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
                placeholder="Update sitemap"
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">PR Description</label>
              <textarea
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
                placeholder="Describe the changes..."
                rows={3}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleSync(true)}
                disabled={isSyncing || !prTitle}
                className="flex-1 px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm disabled:bg-purple-400"
              >
                {isSyncing ? 'Creating...' : 'Create PR'}
              </button>
              <button
                onClick={() => setShowPROptions(false)}
                className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Help Text */}
      <div className="pt-3 border-t text-xs text-gray-500">
        <p className="mb-1">
          <strong>Push:</strong> Directly commit changes to the repository
        </p>
        <p className="mb-1">
          <strong>PR:</strong> Create a pull request for review
        </p>
        <p>
          <strong>Import:</strong> Pull latest changes from GitHub
        </p>
      </div>
    </div>
  )
}
