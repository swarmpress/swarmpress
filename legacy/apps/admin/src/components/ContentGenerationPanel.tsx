import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Progress } from './ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
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
} from './ui/alert-dialog'
import {
  Play,
  Pause,
  RefreshCw,
  Zap,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  Bot,
  Rocket,
} from 'lucide-react'

interface GenerationStatus {
  activeJob: {
    id: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    startedAt: string
    completedAt?: string
    totalTasks: number
    completedTasks: number
    currentTask?: string
    error?: string
    logs: Array<{ timestamp: string; message: string; level: 'info' | 'warn' | 'error' }>
  } | null
  taskStats: {
    total: number
    by_status: Record<string, number>
    by_priority: Record<string, number>
  }
  contentStats: {
    briefs: number
    drafts: number
    in_review: number
    approved: number
    published: number
  }
}

interface ContentGenerationPanelProps {
  websiteId: string
  websiteName: string
}

export default function ContentGenerationPanel({ websiteId, websiteName }: ContentGenerationPanelProps) {
  const [status, setStatus] = useState<GenerationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'prepare' | 'generate'>('prepare')
  const [priority, setPriority] = useState<string>('all')
  const [showLogs, setShowLogs] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/content-generation/status?websiteId=${websiteId}`)
      if (!response.ok) throw new Error('Failed to fetch status')
      const data = await response.json()
      setStatus(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status')
    } finally {
      setLoading(false)
    }
  }, [websiteId])

  useEffect(() => {
    fetchStatus()
    // Poll for updates if job is running
    const interval = setInterval(() => {
      if (status?.activeJob?.status === 'running' || status?.activeJob?.status === 'pending') {
        fetchStatus()
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [fetchStatus, status?.activeJob?.status])

  async function startGeneration() {
    setStarting(true)
    setError(null)
    try {
      const response = await fetch('/api/content-generation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          mode,
          priority: priority === 'all' ? undefined : priority,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to start generation')
      }

      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start generation')
    } finally {
      setStarting(false)
    }
  }

  async function cancelGeneration() {
    if (!status?.activeJob) return
    try {
      const response = await fetch('/api/content-generation/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: status.activeJob.id }),
      })
      if (!response.ok) throw new Error('Failed to cancel')
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Loading generation status...</p>
        </CardContent>
      </Card>
    )
  }

  const hasActiveJob = status?.activeJob && ['pending', 'running'].includes(status.activeJob.status)
  const readyTasks = (status?.taskStats.by_status?.backlog || 0) + (status?.taskStats.by_status?.ready || 0)

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Rocket className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Content Generation</CardTitle>
              <CardDescription>
                Start autonomous content creation for {websiteName}
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

        {/* Statistics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<FileText className="h-4 w-4" />}
            label="Ready Tasks"
            value={readyTasks}
            variant="default"
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="In Progress"
            value={status?.taskStats.by_status?.in_progress || 0}
            variant="warning"
          />
          <StatCard
            icon={<Bot className="h-4 w-4" />}
            label="Drafts"
            value={parseInt(String(status?.contentStats?.drafts || 0))}
            variant="info"
          />
          <StatCard
            icon={<CheckCircle className="h-4 w-4" />}
            label="Published"
            value={parseInt(String(status?.contentStats?.published || 0))}
            variant="success"
          />
        </div>

        {/* Active Job Status */}
        {hasActiveJob && status?.activeJob && (
          <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="font-medium">
                  {status.activeJob.status === 'pending' ? 'Starting...' : 'Generating Content'}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={cancelGeneration}>
                <Pause className="h-3 w-3 mr-1" />
                Cancel
              </Button>
            </div>

            <Progress
              value={(status.activeJob.completedTasks / status.activeJob.totalTasks) * 100}
              className="h-2"
            />

            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{status.activeJob.completedTasks} / {status.activeJob.totalTasks} tasks</span>
              {status.activeJob.currentTask && (
                <span className="truncate max-w-[200px]">{status.activeJob.currentTask}</span>
              )}
            </div>

            {/* Log viewer toggle */}
            <div className="pt-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowLogs(!showLogs)}
                className="w-full justify-start"
              >
                {showLogs ? 'Hide Logs' : 'Show Logs'} ({status.activeJob.logs.length})
              </Button>

              {showLogs && (
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1 text-xs font-mono bg-black/5 p-2 rounded">
                  {status.activeJob.logs.slice(-20).map((log, i) => (
                    <div
                      key={i}
                      className={`${
                        log.level === 'error' ? 'text-destructive' :
                        log.level === 'warn' ? 'text-yellow-600' :
                        'text-muted-foreground'
                      }`}
                    >
                      {new Date(log.timestamp).toLocaleTimeString()}: {log.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Completed Job Status */}
        {status?.activeJob && status.activeJob.status === 'completed' && (
          <div className="p-4 rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/10">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              <span className="font-medium">Generation Complete</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Processed {status.activeJob.completedTasks} of {status.activeJob.totalTasks} tasks
            </p>
          </div>
        )}

        {/* Failed Job Status */}
        {status?.activeJob && status.activeJob.status === 'failed' && (
          <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/10">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">Generation Failed</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {status.activeJob.error || 'Unknown error occurred'}
            </p>
          </div>
        )}

        {/* Start Generation Controls */}
        {!hasActiveJob && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Mode</label>
                <Select value={mode} onValueChange={(v) => setMode(v as 'prepare' | 'generate')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prepare">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Prepare Content
                      </div>
                    </SelectItem>
                    <SelectItem value="generate">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        Generate with AI
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {mode === 'prepare'
                    ? 'Create content briefs from editorial tasks'
                    : 'Run full AI generation workflow'}
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Priority Filter</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priorities</SelectItem>
                    <SelectItem value="urgent">Urgent Only</SelectItem>
                    <SelectItem value="high">High Priority</SelectItem>
                    <SelectItem value="medium">Medium Priority</SelectItem>
                    <SelectItem value="low">Low Priority</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  className="w-full"
                  size="lg"
                  disabled={readyTasks === 0 || starting}
                >
                  {starting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Start {mode === 'generate' ? 'AI Generation' : 'Content Preparation'}
                      {readyTasks > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {readyTasks} tasks
                        </Badge>
                      )}
                    </>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {mode === 'generate' ? 'Start AI Content Generation?' : 'Start Content Preparation?'}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {mode === 'generate' ? (
                      <>
                        This will trigger the autonomous content generation workflow for{' '}
                        <strong>{readyTasks}</strong> editorial tasks. AI agents will:
                        <ul className="list-disc list-inside mt-2 space-y-1">
                          <li>Research topics using external tools</li>
                          <li>Write content drafts</li>
                          <li>Submit for editorial review</li>
                        </ul>
                        <p className="mt-2 text-yellow-600 dark:text-yellow-400">
                          Note: This uses Claude API credits and requires Temporal to be running.
                        </p>
                      </>
                    ) : (
                      <>
                        This will create content briefs from <strong>{readyTasks}</strong> editorial tasks.
                        Content items will be created in "brief_created" status, ready for AI generation.
                      </>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={startGeneration}>
                    {mode === 'generate' ? 'Start Generation' : 'Create Briefs'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {readyTasks === 0 && (
              <p className="text-sm text-muted-foreground text-center">
                No editorial tasks ready for content generation.
                Create tasks in the Editorial section first.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: number
  variant: 'default' | 'warning' | 'info' | 'success'
}

function StatCard({ icon, label, value, variant }: StatCardProps) {
  const colors = {
    default: 'bg-muted text-muted-foreground',
    warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    success: 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400',
  }

  return (
    <div className={`p-3 rounded-lg ${colors[variant]}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}
