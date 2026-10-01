/**
 * Deployment Panel Component
 * Shows deployment status and controls for GitHub Pages
 */

import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface DeploymentStatus {
  configured: boolean
  pagesEnabled: boolean
  pagesUrl?: string
  customDomain?: string
  status: 'never_deployed' | 'deploying' | 'deployed' | 'failed'
  lastDeployedAt?: string
  error?: string
  latestBuild?: {
    status: string
    createdAt: string
    duration: number
    error?: string
  }
}

interface SetupResults {
  labelsCreated: number
  labelsSkipped: number
  templatesCreated: number
  templatesSkipped: number
  pagesEnabled: boolean
  pagesUrl?: string
  cnameCreated: boolean
}

interface DeploymentPanelProps {
  websiteId: string
  isConnectedToGitHub: boolean
  disabled?: boolean
}

export function DeploymentPanel({ websiteId, isConnectedToGitHub, disabled }: DeploymentPanelProps) {
  const [status, setStatus] = useState<DeploymentStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEnabling, setIsEnabling] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)
  const [isSettingUp, setIsSettingUp] = useState(false)
  const [setupResults, setSetupResults] = useState<SetupResults | null>(null)
  const [customDomain, setCustomDomain] = useState('')
  const [isSettingDomain, setIsSettingDomain] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch deployment status
  useEffect(() => {
    if (!websiteId) return

    async function fetchStatus() {
      try {
        const response = await fetch(
          `http://localhost:3000/api/trpc/github.getDeploymentStatus?input=${encodeURIComponent(
            JSON.stringify({ json: { websiteId } })
          )}`
        )
        const data = await response.json()

        // Handle tRPC errors
        if (data.error) {
          console.error('API error:', data.error)
          setStatus({
            configured: false,
            pagesEnabled: false,
            status: 'never_deployed',
          })
          return
        }

        const result = data.result?.data?.json || data.result?.data
        if (result) {
          setStatus(result)
          setCustomDomain(result?.customDomain || '')
        } else {
          // Default status if no result
          setStatus({
            configured: false,
            pagesEnabled: false,
            status: 'never_deployed',
          })
        }
      } catch (err) {
        console.error('Failed to fetch deployment status:', err)
        setStatus({
          configured: false,
          pagesEnabled: false,
          status: 'never_deployed',
        })
      } finally {
        setIsLoading(false)
      }
    }

    fetchStatus()
  }, [websiteId])

  // Enable GitHub Pages
  const handleEnablePages = async () => {
    setIsEnabling(true)
    setError(null)

    try {
      const response = await fetch('http://localhost:3000/api/trpc/github.enablePages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            websiteId,
            branch: 'gh-pages',
            path: '/',
          },
        }),
      })

      const data = await response.json()

      if (!response.ok || data.error) {
        throw new Error(data.error?.json?.message || data.error?.message || 'Failed to enable Pages')
      }

      const result = data.result?.data?.json || data.result?.data

      setStatus((prev) => ({
        ...prev!,
        pagesEnabled: true,
        pagesUrl: result?.pagesUrl,
        status: 'never_deployed',
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable Pages')
    } finally {
      setIsEnabling(false)
    }
  }

  // Deploy to GitHub Pages
  const handleDeploy = async () => {
    setIsDeploying(true)
    setError(null)

    try {
      // For now, deploy with a simple test file
      // In production, this would trigger the full build + deploy pipeline
      const response = await fetch('http://localhost:3000/api/trpc/github.deployToPages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            websiteId,
            files: [
              {
                path: 'index.html',
                content: `<!DOCTYPE html>
<html>
<head>
  <title>Site Deployed</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 2rem; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>Site Deployed Successfully!</h1>
  <p>Deployed at: ${new Date().toISOString()}</p>
  <p>This is a placeholder. Full site builder integration coming soon.</p>
</body>
</html>`,
              },
            ],
            commitMessage: `Deploy: ${new Date().toISOString()}`,
          },
        }),
      })

      const data = await response.json()

      if (!response.ok || data.error) {
        throw new Error(data.error?.json?.message || data.error?.message || 'Deployment failed')
      }

      const result = data.result?.data?.json || data.result?.data

      setStatus((prev) => ({
        ...prev!,
        status: 'deployed',
        lastDeployedAt: new Date().toISOString(),
        error: undefined,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed')
      setStatus((prev) => ({
        ...prev!,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Deployment failed',
      }))
    } finally {
      setIsDeploying(false)
    }
  }

  // Setup repository for swarm.press
  const handleSetupRepository = async () => {
    setIsSettingUp(true)
    setError(null)
    setSetupResults(null)

    try {
      const response = await fetch('http://localhost:3000/api/trpc/github.setupRepository', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            websiteId,
            enablePages: true,
            createLabels: true,
            createTemplates: true,
          },
        }),
      })

      const data = await response.json()

      if (!response.ok || data.error) {
        throw new Error(data.error?.json?.message || data.error?.message || 'Setup failed')
      }

      const result = data.result?.data?.json || data.result?.data

      setSetupResults(result?.summary)

      // If Pages was enabled, update status
      if (result?.summary?.pagesEnabled) {
        setStatus((prev) => ({
          ...prev!,
          pagesEnabled: true,
          pagesUrl: result.summary.pagesUrl,
          status: 'never_deployed',
        }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setIsSettingUp(false)
    }
  }

  // Set custom domain
  const handleSetCustomDomain = async () => {
    if (!customDomain.trim()) return

    setIsSettingDomain(true)
    setError(null)

    try {
      const response = await fetch('http://localhost:3000/api/trpc/github.setCustomDomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            websiteId,
            domain: customDomain.trim(),
          },
        }),
      })

      const data = await response.json()

      if (!response.ok || data.error) {
        throw new Error(data.error?.json?.message || data.error?.message || 'Failed to set domain')
      }

      setStatus((prev) => ({
        ...prev!,
        customDomain: customDomain.trim(),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set domain')
    } finally {
      setIsSettingDomain(false)
    }
  }

  if (!isConnectedToGitHub) {
    return (
      <Card className="p-4 bg-gray-50 border-gray-200">
        <div className="text-center text-gray-500">
          <p className="text-sm">Connect a GitHub repository to enable deployment</p>
        </div>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="text-center text-gray-500">
          <p className="text-sm">Loading deployment status...</p>
        </div>
      </Card>
    )
  }

  // Pages not enabled yet - show setup option
  if (!status?.pagesEnabled) {
    return (
      <Card className="p-6">
        <div className="space-y-6">
          {/* Repository Setup Section */}
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Setup Repository for swarm.press</h3>
              <p className="text-sm text-gray-600">
                Configure your GitHub repository with workflow labels, issue templates, PR templates,
                and enable GitHub Pages deployment.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {error}
              </div>
            )}

            {setupResults && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-2">
                <p className="font-medium text-green-800">Setup Complete!</p>
                <ul className="text-sm text-green-700 space-y-1">
                  <li>Labels: {setupResults.labelsCreated} created, {setupResults.labelsSkipped} already existed</li>
                  <li>Templates: {setupResults.templatesCreated} created, {setupResults.templatesSkipped} already existed</li>
                  <li>GitHub Pages: {setupResults.pagesEnabled ? 'Enabled' : 'Not enabled'}</li>
                  {setupResults.cnameCreated && <li>CNAME file created for custom domain</li>}
                  {setupResults.pagesUrl && (
                    <li>
                      Site URL:{' '}
                      <a href={setupResults.pagesUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        {setupResults.pagesUrl}
                      </a>
                    </li>
                  )}
                </ul>
              </div>
            )}

            <Button
              type="button"
              onClick={handleSetupRepository}
              disabled={disabled || isSettingUp}
              className="w-full"
            >
              {isSettingUp ? 'Setting up repository...' : 'Setup Repository'}
            </Button>

            <div className="text-xs text-gray-500 space-y-1">
              <p>This will create:</p>
              <ul className="list-disc list-inside pl-2">
                <li>21 workflow labels (content states, tasks, agents)</li>
                <li>Issue templates (Question Ticket, Task, Content Idea)</li>
                <li>PR template for content review</li>
                <li>GitHub Pages on gh-pages branch</li>
                <li>CNAME file for custom domain (if configured)</li>
              </ul>
            </div>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-500">or</span>
            </div>
          </div>

          {/* Simple Enable Pages Option */}
          <div className="space-y-3">
            <div>
              <h4 className="font-medium text-gray-900 mb-1">Just Enable GitHub Pages</h4>
              <p className="text-sm text-gray-600">
                Enable Pages without the full swarm.press setup.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleEnablePages}
              disabled={disabled || isEnabling}
              className="w-full"
            >
              {isEnabling ? 'Enabling...' : 'Enable GitHub Pages Only'}
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  // Pages enabled - show deployment controls
  const getStatusBadge = () => {
    switch (status?.status) {
      case 'deployed':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            Deployed
          </span>
        )
      case 'deploying':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Deploying...
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
            Failed
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            Never Deployed
          </span>
        )
    }
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">GitHub Pages Deployment</h3>
          {getStatusBadge()}
        </div>

        {/* Site URL */}
        {status?.pagesUrl && (
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">Site URL</p>
            <a
              href={status.pagesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              {status.pagesUrl}
            </a>
          </div>
        )}

        {/* Last deployed */}
        {status?.lastDeployedAt && (
          <p className="text-xs text-gray-500">
            Last deployed: {new Date(status.lastDeployedAt).toLocaleString()}
          </p>
        )}

        {/* Error message */}
        {(error || status?.error) && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error || status?.error}
          </div>
        )}

        {/* Deploy button */}
        <Button
          type="button"
          onClick={handleDeploy}
          disabled={disabled || isDeploying}
          className="w-full"
        >
          {isDeploying ? 'Deploying...' : 'Deploy Now'}
        </Button>

        {/* Custom domain section */}
        <div className="pt-4 border-t">
          <Label htmlFor="customDomain" className="text-sm font-medium">
            Custom Domain (Optional)
          </Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="customDomain"
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="www.example.com"
              disabled={disabled || isSettingDomain}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleSetCustomDomain}
              disabled={disabled || isSettingDomain || !customDomain.trim()}
            >
              {isSettingDomain ? 'Setting...' : 'Set'}
            </Button>
          </div>
          {status?.customDomain && (
            <p className="mt-2 text-xs text-gray-500">
              Custom domain: {status.customDomain}
              <br />
              Add a CNAME record pointing to your GitHub Pages URL.
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}
