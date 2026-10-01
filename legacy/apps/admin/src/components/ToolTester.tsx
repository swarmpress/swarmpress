import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Textarea } from './ui/textarea'
import { Badge } from './ui/badge'
import { Play, AlertCircle, CheckCircle, Clock, Terminal } from 'lucide-react'

interface Website {
  id: string
  domain: string
  title: string
}

interface Tool {
  id: string
  name: string
  type: string
  config?: {
    manifest?: {
      input?: Record<string, { type: string; description?: string; required?: boolean }>
    }
  }
}

interface TestResult {
  success: boolean
  result?: unknown
  error?: string
  logs?: string[]
  duration?: number
}

interface ToolTesterProps {
  tool: Tool
  websites: Website[]
}

export default function ToolTester({ tool, websites }: ToolTesterProps) {
  const [selectedWebsite, setSelectedWebsite] = useState<string>('')
  const [testInput, setTestInput] = useState('{}')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)

  // Generate sample input from manifest
  const generateSampleInput = () => {
    const manifest = tool.config?.manifest
    if (!manifest?.input) {
      setTestInput('{}')
      return
    }

    const sample: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(manifest.input)) {
      switch (field.type) {
        case 'string':
          sample[key] = field.description || `sample_${key}`
          break
        case 'number':
          sample[key] = 0
          break
        case 'boolean':
          sample[key] = true
          break
        case 'array':
          sample[key] = []
          break
        case 'object':
          sample[key] = {}
          break
        default:
          sample[key] = null
      }
    }
    setTestInput(JSON.stringify(sample, null, 2))
  }

  const validateInput = (value: string): boolean => {
    try {
      JSON.parse(value)
      setInputError(null)
      return true
    } catch {
      setInputError('Invalid JSON')
      return false
    }
  }

  const runTest = async () => {
    if (!selectedWebsite) {
      setInputError('Please select a website for testing')
      return
    }

    if (!validateInput(testInput)) return

    setTesting(true)
    setResult(null)

    try {
      const response = await fetch(`/api/tools/${tool.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: selectedWebsite,
          test_input: JSON.parse(testInput),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setResult({
          success: false,
          error: data.message || 'Test failed',
        })
      } else {
        setResult(data)
      }
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Test failed',
      })
    } finally {
      setTesting(false)
    }
  }

  const manifest = tool.config?.manifest
  const hasInputSchema = manifest?.input && Object.keys(manifest.input).length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-5 w-5" />
          Tool Tester
        </CardTitle>
        <CardDescription>
          Test "{tool.name}" with sample input and see the output
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Website selector */}
        <div className="space-y-2">
          <Label>Test Website Context</Label>
          <Select value={selectedWebsite} onValueChange={setSelectedWebsite}>
            <SelectTrigger>
              <SelectValue placeholder="Select website (for secrets access)..." />
            </SelectTrigger>
            <SelectContent>
              {websites.map(website => (
                <SelectItem key={website.id} value={website.id}>
                  {website.title} ({website.domain})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Secrets will be loaded from the selected website's configuration
          </p>
        </div>

        {/* Input schema reference */}
        {hasInputSchema && (
          <div className="space-y-2">
            <Label>Expected Input Parameters</Label>
            <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
              {Object.entries(manifest.input!).map(([key, field]) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <code className="font-medium">{key}</code>
                  <Badge variant="outline" className="text-xs">{field.type}</Badge>
                  {field.required && <Badge variant="destructive" className="text-xs">required</Badge>}
                  {field.description && (
                    <span className="text-muted-foreground">- {field.description}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Test input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="test-input">Test Input (JSON)</Label>
            {hasInputSchema && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={generateSampleInput}
              >
                Generate Sample
              </Button>
            )}
          </div>
          <Textarea
            id="test-input"
            value={testInput}
            onChange={(e) => {
              setTestInput(e.target.value)
              if (e.target.value) validateInput(e.target.value)
            }}
            placeholder='{"param1": "value1"}'
            className="font-mono text-sm min-h-[100px]"
          />
          {inputError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {inputError}
            </div>
          )}
        </div>

        {/* Run button */}
        <Button
          onClick={runTest}
          disabled={testing || !selectedWebsite}
          className="w-full"
        >
          {testing ? (
            <>
              <Clock className="h-4 w-4 mr-2 animate-spin" />
              Running Test...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run Test
            </>
          )}
        </Button>

        {/* Results */}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {result.success ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="font-medium text-green-500">Success</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  <span className="font-medium text-destructive">Failed</span>
                </>
              )}
              {result.duration && (
                <Badge variant="outline" className="ml-auto">
                  {result.duration}ms
                </Badge>
              )}
            </div>

            {/* Error message */}
            {result.error && (
              <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/10">
                <pre className="text-sm text-destructive whitespace-pre-wrap font-mono">
                  {result.error}
                </pre>
              </div>
            )}

            {/* Result output */}
            {result.result !== undefined && (
              <div className="space-y-2">
                <Label>Output</Label>
                <div className="p-3 rounded-lg border bg-muted/30">
                  <pre className="text-sm whitespace-pre-wrap font-mono overflow-auto max-h-[300px]">
                    {typeof result.result === 'string'
                      ? result.result
                      : JSON.stringify(result.result, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Console logs */}
            {result.logs && result.logs.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  Console Output
                </Label>
                <div className="p-3 rounded-lg border bg-slate-950 text-slate-50">
                  <pre className="text-sm whitespace-pre-wrap font-mono overflow-auto max-h-[200px]">
                    {result.logs.join('\n')}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
