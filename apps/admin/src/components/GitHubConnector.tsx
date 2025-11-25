/**
 * GitHub Connector Component
 * Provides UI for connecting a website to a GitHub repository via OAuth
 */

import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Card } from './ui/card'

export interface GitHubConnection {
  github_repo_url?: string
  github_owner?: string
  github_repo?: string
  github_installation_id?: string
  github_connected_at?: string
}

interface GitHubConnectorProps {
  websiteId: string
  connection: GitHubConnection
  onConnect: (connection: GitHubConnection) => void
  onDisconnect: () => void
  disabled?: boolean
}

export function GitHubConnector({
  websiteId,
  connection,
  onConnect,
  onDisconnect,
  disabled,
}: GitHubConnectorProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isConnected = Boolean(connection.github_repo_url)

  // Listen for messages from the OAuth popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'github-repo-connected') {
        const { repoFullName, repository } = event.data
        const [owner, repo] = repoFullName.split('/')

        onConnect({
          github_repo_url: repository?.htmlUrl || `https://github.com/${repoFullName}`,
          github_owner: owner,
          github_repo: repo,
          github_connected_at: new Date().toISOString(),
        })

        setIsConnecting(false)
        setError(null)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onConnect])

  /**
   * Start GitHub OAuth flow via popup
   */
  const handleConnect = async () => {
    setIsConnecting(true)
    setError(null)

    try {
      // Get OAuth URL from backend (tRPC query format)
      const response = await fetch(
        `http://localhost:3000/api/trpc/github.getRepoAuthUrl?input=${encodeURIComponent(
          JSON.stringify({ json: { websiteId } })
        )}`
      )

      const data = await response.json()

      if (!response.ok || data.error) {
        throw new Error(data.error?.message || 'Failed to get authorization URL')
      }

      // tRPC with superjson wraps response in json
      const authUrl = data.result?.data?.json?.url || data.result?.data?.url
      if (!authUrl) {
        throw new Error('No authorization URL received')
      }

      // Open OAuth popup
      const width = 600
      const height = 700
      const left = window.screenX + (window.outerWidth - width) / 2
      const top = window.screenY + (window.outerHeight - height) / 2

      const popup = window.open(
        authUrl,
        'github-oauth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      )

      if (!popup) {
        throw new Error('Please allow popups to connect to GitHub')
      }

      // Check if popup was closed without completing
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed)
          setIsConnecting(false)
        }
      }, 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setIsConnecting(false)
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
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
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

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        <Button
          type="button"
          onClick={handleConnect}
          disabled={disabled || isConnecting}
          className="w-full"
        >
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          {isConnecting ? 'Connecting...' : 'Connect GitHub Repository'}
        </Button>

        <div className="pt-4 border-t">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Features</h4>
          <ul className="space-y-1 text-sm text-gray-600">
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Version control for all content changes
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Pull requests for content review workflows
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Issues for editorial task tracking
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Bi-directional sync with swarm.press
            </li>
          </ul>
        </div>
      </div>
    </Card>
  )
}
