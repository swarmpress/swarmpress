/**
 * GitHub Connector Component
 * Provides UI for connecting a website to a GitHub repository via GitHub App
 */

import { useState } from 'react'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'

export interface GitHubConnection {
  github_repo_url?: string
  github_owner?: string
  github_repo?: string
  github_installation_id?: string
  github_connected_at?: string
}

interface GitHubConnectorProps {
  connection: GitHubConnection
  onConnect: (connection: GitHubConnection) => void
  onDisconnect: () => void
  disabled?: boolean
}

export function GitHubConnector({
  connection,
  onConnect,
  onDisconnect,
  disabled,
}: GitHubConnectorProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)
  const [manualRepoUrl, setManualRepoUrl] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const isConnected = Boolean(connection.github_repo_url)

  /**
   * Start GitHub App OAuth flow (future implementation)
   */
  const handleConnectViaApp = () => {
    setIsConnecting(true)
    setError(null)

    // TODO: Implement GitHub App OAuth flow
    // 1. Open popup to GitHub App installation page
    // 2. Handle OAuth callback
    // 3. Save installation_id and selected repository

    // For now, show manual input option
    alert(
      'GitHub App OAuth flow coming soon!\n\nFor MVP, use the "Manual Setup" option below with a Personal Access Token.'
    )
    setIsConnecting(false)
    setShowManualInput(true)
  }

  /**
   * Manual connection via PAT
   */
  const handleManualConnect = async () => {
    if (!manualRepoUrl.trim()) {
      setError('Please enter a repository URL')
      return
    }

    setVerifying(true)
    setError(null)

    try {
      // Verify repository access
      const response = await fetch('/api/github/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: manualRepoUrl,
          token: manualToken,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to verify repository access')
      }

      if (!data.hasAccess) {
        throw new Error('No access to repository. Check token permissions.')
      }

      // Parse repository URL
      const match = manualRepoUrl.match(/github\.com[:/]([^/]+)\/([^/\.]+)/)
      if (!match) {
        throw new Error('Invalid GitHub repository URL')
      }

      const [, owner, repo] = match

      // Save connection
      onConnect({
        github_repo_url: `https://github.com/${owner}/${repo}`,
        github_owner: owner,
        github_repo: repo,
        github_connected_at: new Date().toISOString(),
      })

      setShowManualInput(false)
      setManualRepoUrl('')
      setManualToken('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setVerifying(false)
    }
  }

  /**
   * Disconnect from GitHub
   */
  const handleDisconnect = () => {
    if (!confirm('Disconnect from GitHub? This will not delete any data from the repository.')) {
      return
    }
    onDisconnect()
  }

  if (isConnected) {
    return (
      <Card className="p-4 bg-green-50 border-green-200">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">✓</span>
              <h3 className="font-semibold text-green-900">GitHub Connected</h3>
            </div>
            <div className="space-y-1 text-sm text-green-800">
              <p>
                <span className="font-medium">Repository:</span>{' '}
                <a
                  href={connection.github_repo_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-green-600"
                >
                  {connection.github_owner}/{connection.github_repo}
                </a>
              </p>
              {connection.github_connected_at && (
                <p className="text-xs text-green-600">
                  Connected {new Date(connection.github_connected_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disabled}
            className="ml-4"
          >
            Disconnect
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-gray-900 mb-1">GitHub Integration</h3>
          <p className="text-sm text-gray-600">
            Connect this website to a GitHub repository for version control, collaboration, and
            content review workflows.
          </p>
        </div>

        {!showManualInput ? (
          <div className="space-y-3">
            <Button
              type="button"
              onClick={handleConnectViaApp}
              disabled={disabled || isConnecting}
              className="w-full"
            >
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              {isConnecting ? 'Connecting...' : 'Connect with GitHub App'}
            </Button>

            <button
              type="button"
              onClick={() => setShowManualInput(true)}
              disabled={disabled}
              className="w-full text-sm text-gray-600 hover:text-gray-900 underline"
            >
              Or use manual setup with Personal Access Token
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="manual_repo_url">Repository URL *</Label>
              <Input
                id="manual_repo_url"
                type="url"
                value={manualRepoUrl}
                onChange={(e) => setManualRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                disabled={disabled || verifying}
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Format: https://github.com/owner/repo
              </p>
            </div>

            <div>
              <Label htmlFor="manual_token">Personal Access Token *</Label>
              <Input
                id="manual_token"
                type="password"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                disabled={disabled || verifying}
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Token will be stored securely in environment variables.{' '}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Create token
                </a>
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleManualConnect}
                disabled={disabled || verifying}
              >
                {verifying ? 'Verifying...' : 'Connect Repository'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowManualInput(false)
                  setError(null)
                  setManualRepoUrl('')
                  setManualToken('')
                }}
                disabled={disabled || verifying}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="pt-4 border-t">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Features</h4>
          <ul className="space-y-1 text-sm text-gray-600">
            <li>✓ Version control for all content changes</li>
            <li>✓ Pull requests for content review workflows</li>
            <li>✓ Issues for editorial task tracking</li>
            <li>✓ Bi-directional sync with swarm.press</li>
          </ul>
        </div>
      </div>
    </Card>
  )
}
