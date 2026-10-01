import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'

interface ManifestField {
  type: string
  required?: boolean
  description?: string
}

interface ToolFormProps {
  tool?: {
    id: string
    name: string
    display_name?: string | null
    description?: string | null
    type: 'javascript' | 'rest' | 'graphql' | 'mcp' | 'builtin'
    endpoint_url?: string | null
    config: Record<string, unknown>
    input_schema?: Record<string, unknown> | null
  }
  websites?: Array<{ id: string; domain: string; title: string }>
  mode: 'create' | 'edit'
  defaultType?: 'javascript' | 'rest' | 'graphql' | 'mcp'
}

const DEFAULT_CODE = `// Access input parameters via 'input' object
const { query } = input;

// Use api.rest() for HTTP requests
const data = await api.rest({
  url: \`https://api.example.com/search?q=\${query}\`,
  method: 'GET',
  headers: {
    'Authorization': \`Bearer \${api.secret('API_KEY')}\`
  }
});

// Log messages (captured and returned with results)
api.log('Fetched data:', data);

// Return the result
return {
  results: data.items,
  count: data.total
};`

const DEFAULT_MANIFEST = {
  input: {
    query: { type: 'string', required: true, description: 'Search query' },
  },
  output: {
    results: { type: 'array', description: 'Search results' },
    count: { type: 'number', description: 'Total count' },
  },
}

export default function ToolForm({ tool, websites, mode, defaultType = 'javascript' }: ToolFormProps) {
  const [toolType, setToolType] = useState<'javascript' | 'rest' | 'graphql' | 'mcp'>(
    (tool?.type as any) || defaultType
  )
  const [name, setName] = useState(tool?.name || '')
  const [displayName, setDisplayName] = useState(tool?.display_name || '')
  const [description, setDescription] = useState(tool?.description || '')
  const [websiteId, setWebsiteId] = useState<string | null>(null)

  // JavaScript tool fields
  const [code, setCode] = useState(
    (tool?.config as any)?.code || DEFAULT_CODE
  )
  const [manifestJson, setManifestJson] = useState(
    JSON.stringify((tool?.config as any)?.manifest || DEFAULT_MANIFEST, null, 2)
  )
  const [timeout, setTimeout] = useState(
    (tool?.config as any)?.timeout || 5000
  )

  // REST/GraphQL tool fields
  const [endpointUrl, setEndpointUrl] = useState(tool?.endpoint_url || '')
  const [authType, setAuthType] = useState(
    (tool?.config as any)?.auth_type || 'none'
  )
  const [authHeader, setAuthHeader] = useState(
    (tool?.config as any)?.auth_header || ''
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manifestError, setManifestError] = useState<string | null>(null)

  // Validate manifest JSON on change
  useEffect(() => {
    if (toolType === 'javascript') {
      try {
        JSON.parse(manifestJson)
        setManifestError(null)
      } catch (e) {
        setManifestError('Invalid JSON format')
      }
    }
  }, [manifestJson, toolType])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    // Validate manifest for JavaScript tools
    if (toolType === 'javascript') {
      try {
        JSON.parse(manifestJson)
      } catch (e) {
        setError('Invalid manifest JSON')
        setIsSubmitting(false)
        return
      }
    }

    try {
      if (toolType === 'javascript') {
        // Use the JavaScript-specific endpoint
        const url = mode === 'create' ? '/api/tools/javascript' : `/api/tools/javascript/${tool?.id}`
        const manifest = JSON.parse(manifestJson)

        const response = await fetch(url, {
          method: mode === 'create' ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            display_name: displayName || undefined,
            description: description || undefined,
            code,
            manifest,
            timeout,
            website_id: websiteId,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.message || 'Failed to save tool')
        }
      } else {
        // Use the generic tool endpoint for REST/GraphQL/MCP
        const url = mode === 'create' ? '/api/tools' : `/api/tools/${tool?.id}`

        const config: Record<string, unknown> = {}
        if (authType !== 'none') {
          config.auth_type = authType
          config.auth_header = authHeader
        }

        const response = await fetch(url, {
          method: mode === 'create' ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            display_name: displayName || undefined,
            description: description || undefined,
            type: toolType,
            endpoint_url: endpointUrl || undefined,
            config,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.message || 'Failed to save tool')
        }
      }

      // Redirect to tools list on success
      window.location.href = '/tools'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Tool Type Selector (only for create mode) */}
      {mode === 'create' && (
        <Card>
          <CardHeader>
            <CardTitle>Tool Type</CardTitle>
            <CardDescription>Select the type of tool you want to create</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 flex-wrap">
              <Button
                type="button"
                variant={toolType === 'javascript' ? 'default' : 'outline'}
                onClick={() => setToolType('javascript')}
              >
                JavaScript
              </Button>
              <Button
                type="button"
                variant={toolType === 'rest' ? 'default' : 'outline'}
                onClick={() => setToolType('rest')}
              >
                REST API
              </Button>
              <Button
                type="button"
                variant={toolType === 'graphql' ? 'default' : 'outline'}
                onClick={() => setToolType('graphql')}
              >
                GraphQL
              </Button>
              <Button
                type="button"
                variant={toolType === 'mcp' ? 'default' : 'outline'}
                onClick={() => setToolType('mcp')}
              >
                MCP Server
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {mode === 'create' ? 'Create New Tool' : 'Edit Tool'}
            {mode === 'edit' && tool && (
              <Badge variant="secondary" className="ml-2">
                {tool.type}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {toolType === 'javascript'
              ? 'Create a custom JavaScript tool that runs in a secure sandbox.'
              : toolType === 'rest'
                ? 'Configure a REST API endpoint for agents to call.'
                : toolType === 'graphql'
                  ? 'Configure a GraphQL endpoint for agents to query.'
                  : 'Configure an MCP server connection.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="name">Tool Name *</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))}
                  placeholder="e.g., fetch_weather"
                  required
                  disabled={isSubmitting || mode === 'edit'}
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase with underscores. Used as the tool identifier.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g., Fetch Weather Data"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this tool does..."
                rows={2}
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                This description is shown to agents when selecting tools.
              </p>
            </div>

            {/* Website Assignment */}
            {mode === 'create' && websites && websites.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="website">Assign to Website</Label>
                <select
                  id="website"
                  value={websiteId || ''}
                  onChange={(e) => setWebsiteId(e.target.value || null)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={isSubmitting}
                >
                  <option value="">Global (all websites)</option>
                  {websites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.title} ({site.domain})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Global tools are available to all websites. Website-specific tools are only available to that website.
                </p>
              </div>
            )}

            {/* JavaScript Tool Fields */}
            {toolType === 'javascript' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="code">JavaScript Code *</Label>
                  <Textarea
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="// Your JavaScript code here..."
                    rows={15}
                    required
                    disabled={isSubmitting}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Available APIs: <code>api.rest()</code>, <code>api.graphql()</code>, <code>api.log()</code>, <code>api.date()</code>, <code>api.secret(key)</code>, <code>api.sleep(ms)</code>
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="manifest">
                    Input/Output Manifest (JSON) *
                    {manifestError && (
                      <span className="text-destructive ml-2 text-xs">{manifestError}</span>
                    )}
                  </Label>
                  <Textarea
                    id="manifest"
                    value={manifestJson}
                    onChange={(e) => setManifestJson(e.target.value)}
                    placeholder='{"input": {...}, "output": {...}}'
                    rows={10}
                    required
                    disabled={isSubmitting}
                    className={`font-mono text-sm ${manifestError ? 'border-destructive' : ''}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Define input parameters and output schema for validation.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timeout">Timeout (ms)</Label>
                  <Input
                    id="timeout"
                    type="number"
                    value={timeout}
                    onChange={(e) => setTimeout(parseInt(e.target.value) || 5000)}
                    min={100}
                    max={30000}
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum execution time (100-30000ms). Default: 5000ms.
                  </p>
                </div>
              </>
            )}

            {/* REST/GraphQL Tool Fields */}
            {(toolType === 'rest' || toolType === 'graphql') && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="endpointUrl">Endpoint URL *</Label>
                  <Input
                    id="endpointUrl"
                    type="url"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder={toolType === 'graphql' ? 'https://api.example.com/graphql' : 'https://api.example.com/v1'}
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="authType">Authentication</Label>
                    <select
                      id="authType"
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={isSubmitting}
                    >
                      <option value="none">None</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="api_key">API Key</option>
                      <option value="basic">Basic Auth</option>
                    </select>
                  </div>

                  {authType !== 'none' && (
                    <div className="space-y-2">
                      <Label htmlFor="authHeader">Auth Header Name</Label>
                      <Input
                        id="authHeader"
                        type="text"
                        value={authHeader}
                        onChange={(e) => setAuthHeader(e.target.value)}
                        placeholder={authType === 'api_key' ? 'X-API-Key' : 'Authorization'}
                        disabled={isSubmitting}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {/* MCP Tool Fields */}
            {toolType === 'mcp' && (
              <div className="p-4 border rounded-md bg-muted/50">
                <p className="text-sm text-muted-foreground">
                  MCP server configuration is coming soon. For now, please use JavaScript tools with <code>api.rest()</code> to connect to external services.
                </p>
              </div>
            )}

            {error && (
              <div className="p-4 border border-destructive bg-destructive/10 rounded-md">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <Button type="submit" disabled={isSubmitting || !!manifestError}>
                {isSubmitting
                  ? mode === 'create'
                    ? 'Creating...'
                    : 'Saving...'
                  : mode === 'create'
                    ? 'Create Tool'
                    : 'Save Changes'}
              </Button>
              <a href="/tools">
                <Button type="button" variant="outline" disabled={isSubmitting}>
                  Cancel
                </Button>
              </a>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* API Reference for JavaScript tools */}
      {toolType === 'javascript' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sandbox API Reference</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div>
              <code className="text-xs bg-muted px-1 py-0.5 rounded">api.rest(&#123; url, method?, headers?, body? &#125;)</code>
              <p className="text-xs text-muted-foreground mt-1">Make HTTP requests. Returns parsed JSON or text.</p>
            </div>
            <div>
              <code className="text-xs bg-muted px-1 py-0.5 rounded">api.graphql(&#123; url, query, variables?, headers? &#125;)</code>
              <p className="text-xs text-muted-foreground mt-1">Execute GraphQL queries. Returns data from response.</p>
            </div>
            <div>
              <code className="text-xs bg-muted px-1 py-0.5 rounded">api.secret(key)</code>
              <p className="text-xs text-muted-foreground mt-1">Get a secret value. Secrets are configured per-website.</p>
            </div>
            <div>
              <code className="text-xs bg-muted px-1 py-0.5 rounded">api.log(...args)</code>
              <p className="text-xs text-muted-foreground mt-1">Log messages. Captured and returned with results.</p>
            </div>
            <div>
              <code className="text-xs bg-muted px-1 py-0.5 rounded">api.date()</code>
              <p className="text-xs text-muted-foreground mt-1">Get current ISO timestamp.</p>
            </div>
            <div>
              <code className="text-xs bg-muted px-1 py-0.5 rounded">api.sleep(ms)</code>
              <p className="text-xs text-muted-foreground mt-1">Delay execution (max 10 seconds).</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
