import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Switch } from '../ui/switch'
import { Label } from '../ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog'
import {
  Play,
  RefreshCw,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  Workflow,
  Sun,
  Leaf,
  Snowflake,
  Flower2,
  ExternalLink,
} from 'lucide-react'

interface SeasonInfo {
  currentDate: string
  currentSeason: 'spring' | 'summer' | 'fall' | 'winter'
  nextSeason: string
  seasonWindow: { start: string; end: string }
}

interface WorkflowStatus {
  connected: boolean
  message: string
}

interface WorkflowResult {
  success: boolean
  workflowId?: string
  runId?: string
  dryRun?: boolean
  message: string
}

interface WorkflowControlPanelProps {
  websiteId: string
  websiteName: string
}

export default function WorkflowControlPanel({ websiteId, websiteName }: WorkflowControlPanelProps) {
  const [status, setStatus] = useState<WorkflowStatus | null>(null)
  const [seasonInfo, setSeasonInfo] = useState<SeasonInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dryRun, setDryRun] = useState(true)
  const [lastResult, setLastResult] = useState<WorkflowResult | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, seasonRes] = await Promise.all([
        fetch('/api/workflows/status'),
        fetch('/api/workflows/season-info'),
      ])

      if (!statusRes.ok || !seasonRes.ok) {
        throw new Error('Failed to fetch workflow status')
      }

      const statusData = await statusRes.json()
      const seasonData = await seasonRes.json()

      setStatus(statusData)
      setSeasonInfo(seasonData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  async function startScheduledContent() {
    setStarting(true)
    setError(null)
    setLastResult(null)

    try {
      const response = await fetch('/api/workflows/start-scheduled-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          dryRun,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to start workflow')
      }

      const result = await response.json()
      setLastResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scheduled content')
    } finally {
      setStarting(false)
    }
  }

  const getSeasonIcon = (season: string) => {
    switch (season) {
      case 'spring': return <Flower2 className="h-4 w-4 text-pink-500" />
      case 'summer': return <Sun className="h-4 w-4 text-yellow-500" />
      case 'fall': return <Leaf className="h-4 w-4 text-orange-500" />
      case 'winter': return <Snowflake className="h-4 w-4 text-blue-400" />
      default: return <Calendar className="h-4 w-4" />
    }
  }

  const getSeasonColor = (season: string) => {
    switch (season) {
      case 'spring': return 'bg-pink-100 text-pink-700 dark:bg-pink-900/20 dark:text-pink-400'
      case 'summer': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400'
      case 'fall': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400'
      case 'winter': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
      default: return 'bg-muted text-muted-foreground'
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Loading workflow status...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-2 border-purple-200 dark:border-purple-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Workflow className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Workflow Control</CardTitle>
              <CardDescription>
                Manage Temporal workflows for {websiteName}
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={fetchStatus}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm p-3 rounded-lg bg-destructive/10">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Temporal Connection Status */}
        <div className="flex items-center justify-between p-3 rounded-lg border">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${status?.connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm font-medium">Temporal Engine</span>
          </div>
          <Badge variant={status?.connected ? 'default' : 'destructive'}>
            {status?.connected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>

        {/* Current Season Display */}
        {seasonInfo && (
          <div className={`p-4 rounded-lg ${getSeasonColor(seasonInfo.currentSeason)}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getSeasonIcon(seasonInfo.currentSeason)}
                <div>
                  <div className="font-semibold capitalize">{seasonInfo.currentSeason} Season</div>
                  <div className="text-sm opacity-75">
                    {seasonInfo.seasonWindow.start} to {seasonInfo.seasonWindow.end}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs opacity-75">Next season</div>
                <div className="font-medium capitalize">{seasonInfo.nextSeason}</div>
              </div>
            </div>
          </div>
        )}

        {/* Last Workflow Result */}
        {lastResult && (
          <div className={`p-4 rounded-lg border ${
            lastResult.success
              ? 'border-green-200 bg-green-50 dark:bg-green-900/10'
              : 'border-destructive/30 bg-destructive/10'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {lastResult.success ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="font-medium">
                {lastResult.success ? 'Workflow Started' : 'Workflow Failed'}
              </span>
              {lastResult.dryRun && (
                <Badge variant="outline" className="ml-2">Dry Run</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{lastResult.message}</p>
            {lastResult.workflowId && (
              <div className="mt-2 flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <Clock className="h-3 w-3" />
                ID: {lastResult.workflowId}
              </div>
            )}
          </div>
        )}

        {/* Scheduled Content Controls */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="dry-run" className="font-medium">Dry Run Mode</Label>
              <p className="text-xs text-muted-foreground">
                Preview what would be generated without creating content
              </p>
            </div>
            <Switch
              id="dry-run"
              checked={dryRun}
              onCheckedChange={setDryRun}
            />
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                className="w-full"
                size="lg"
                disabled={!status?.connected || starting}
                variant={dryRun ? 'outline' : 'default'}
              >
                {starting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    {dryRun ? 'Preview Scheduled Content' : 'Run Scheduled Content Check'}
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {dryRun ? 'Preview Scheduled Content?' : 'Run Scheduled Content Check?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {dryRun ? (
                    <>
                      This will check the content calendar and show what content would be generated
                      based on the current season and schedule. No content will be created.
                    </>
                  ) : (
                    <>
                      This will check the content calendar and generate any due content for{' '}
                      <strong>{websiteName}</strong>.
                      <ul className="list-disc list-inside mt-2 space-y-1">
                        <li>Check current season ({seasonInfo?.currentSeason})</li>
                        <li>Find topics due for generation</li>
                        <li>Create content with AI agents</li>
                      </ul>
                      <p className="mt-2 text-yellow-600 dark:text-yellow-400">
                        Note: This uses Claude API credits.
                      </p>
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={startScheduledContent}>
                  {dryRun ? 'Preview' : 'Run Check'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {!status?.connected && (
            <p className="text-sm text-muted-foreground text-center">
              Temporal is not connected. Please ensure the workflow engine is running.
            </p>
          )}
        </div>

        {/* Quick Links */}
        <div className="pt-4 border-t">
          <h4 className="text-sm font-medium mb-3">Quick Actions</h4>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/editorial/kanban" className="flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                Editorial Board
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a
                href="http://localhost:8233"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-3 w-3" />
                Temporal UI
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
