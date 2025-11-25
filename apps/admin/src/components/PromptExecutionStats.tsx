import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { BarChart3, Clock, Zap, ThumbsUp, AlertCircle } from 'lucide-react'

interface PromptExecutionStatsProps {
  companyPromptId?: string
  websitePromptId?: string
  agentId?: string
  capability?: string
}

interface Metrics {
  total_executions: number
  successful_executions: number
  failed_executions: number
  avg_quality_score: number | null
  quality_stddev: number | null
  high_quality_count: number
  low_quality_count: number
  avg_tokens: number | null
  avg_latency_ms: number | null
  avg_revisions: number | null
  first_execution: string | null
  last_execution: string | null
}

export default function PromptExecutionStats({
  companyPromptId,
  websitePromptId,
  agentId,
  capability
}: PromptExecutionStatsProps) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMetrics()
  }, [companyPromptId, websitePromptId, agentId, capability])

  async function fetchMetrics() {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (companyPromptId) params.set('company_prompt_id', companyPromptId)
      if (websitePromptId) params.set('website_prompt_id', websitePromptId)
      if (agentId) params.set('agent_id', agentId)
      if (capability) params.set('capability', capability)

      const response = await fetch(`/api/prompts/metrics?${params}`)
      if (!response.ok) throw new Error('Failed to fetch metrics')
      const data = await response.json()
      setMetrics(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Execution Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">Loading metrics...</div>
        </CardContent>
      </Card>
    )
  }

  if (error || !metrics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Execution Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">
            {error || 'No execution data available yet.'}
          </div>
        </CardContent>
      </Card>
    )
  }

  const successRate = metrics.total_executions > 0
    ? ((metrics.successful_executions / metrics.total_executions) * 100).toFixed(1)
    : '0'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Execution Statistics
        </CardTitle>
        <CardDescription>
          Performance metrics from the last 30 days
        </CardDescription>
      </CardHeader>
      <CardContent>
        {metrics.total_executions === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No executions recorded yet</p>
            <p className="text-sm">Statistics will appear once this prompt is used</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-4">
            {/* Total Executions */}
            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Zap className="h-4 w-4" />
                <span className="text-sm">Total Executions</span>
              </div>
              <div className="text-2xl font-bold">{metrics.total_executions}</div>
              <div className="text-xs text-muted-foreground">
                {metrics.successful_executions} successful · {metrics.failed_executions} failed
              </div>
            </div>

            {/* Success Rate */}
            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <ThumbsUp className="h-4 w-4" />
                <span className="text-sm">Success Rate</span>
              </div>
              <div className="text-2xl font-bold">{successRate}%</div>
              <div className="flex gap-1 mt-1">
                <Badge variant={parseFloat(successRate) >= 95 ? 'default' : parseFloat(successRate) >= 80 ? 'secondary' : 'destructive'}>
                  {parseFloat(successRate) >= 95 ? 'Excellent' : parseFloat(successRate) >= 80 ? 'Good' : 'Needs Attention'}
                </Badge>
              </div>
            </div>

            {/* Quality Score */}
            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <ThumbsUp className="h-4 w-4" />
                <span className="text-sm">Avg Quality</span>
              </div>
              <div className="text-2xl font-bold">
                {metrics.avg_quality_score ? metrics.avg_quality_score.toFixed(1) : 'N/A'}
                <span className="text-sm font-normal text-muted-foreground">/5</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {metrics.high_quality_count} high · {metrics.low_quality_count} low
              </div>
            </div>

            {/* Latency */}
            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Clock className="h-4 w-4" />
                <span className="text-sm">Avg Latency</span>
              </div>
              <div className="text-2xl font-bold">
                {metrics.avg_latency_ms ? `${Math.round(metrics.avg_latency_ms)}ms` : 'N/A'}
              </div>
              <div className="text-xs text-muted-foreground">
                ~{metrics.avg_tokens ? Math.round(metrics.avg_tokens) : 0} tokens avg
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
