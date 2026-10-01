import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Badge } from './ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import {
  Wrench,
  Key,
  Plus,
  Trash2,
  AlertCircle,
  Eye,
  EyeOff,
  Settings,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

interface Website {
  id: string
  domain: string
  title: string
}

interface ToolConfig {
  id: string
  name: string
  display_name: string | null
  description: string | null
  type: 'rest' | 'graphql' | 'mcp' | 'builtin' | 'javascript'
  endpoint_url: string | null
  config: Record<string, unknown>
}

interface WebsiteTool {
  id: string
  website_id: string | null
  tool_config_id: string
  enabled: boolean
  priority: number
  tool_config: ToolConfig
}

interface SecretKey {
  key: string
  created_at: string
}

export default function WebsiteToolsManager() {
  const [websites, setWebsites] = useState<Website[]>([])
  const [selectedWebsite, setSelectedWebsite] = useState<string>('')
  const [tools, setTools] = useState<WebsiteTool[]>([])
  const [allTools, setAllTools] = useState<ToolConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track expanded tools for secrets management
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

  // Fetch websites on mount
  useEffect(() => {
    fetchWebsites()
    fetchAllTools()
  }, [])

  // Fetch tools when website is selected
  useEffect(() => {
    if (selectedWebsite) {
      fetchWebsiteTools(selectedWebsite)
    } else {
      setTools([])
    }
  }, [selectedWebsite])

  async function fetchWebsites() {
    try {
      const response = await fetch('/api/websites')
      const data = await response.json()
      setWebsites(data.items || [])
      // Auto-select first website
      if (data.items?.length > 0) {
        setSelectedWebsite(data.items[0].id)
      }
    } catch (err) {
      console.error('Failed to fetch websites:', err)
    }
  }

  async function fetchAllTools() {
    try {
      const response = await fetch('/api/tools')
      const data = await response.json()
      setAllTools(data.items || [])
    } catch (err) {
      console.error('Failed to fetch all tools:', err)
    }
  }

  async function fetchWebsiteTools(websiteId: string) {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/tools/website/${websiteId}`)
      if (!response.ok) throw new Error('Failed to fetch tools')
      const data = await response.json()
      setTools(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools')
    } finally {
      setLoading(false)
    }
  }

  async function toggleToolEnabled(toolConfigId: string, enabled: boolean) {
    try {
      const response = await fetch(`/api/tools/${toolConfigId}/assignments/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: selectedWebsite,
          enabled,
        }),
      })
      if (!response.ok) throw new Error('Failed to toggle tool')
      await fetchWebsiteTools(selectedWebsite)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle tool')
    }
  }

  async function addToolToWebsite(toolConfigId: string) {
    try {
      const response = await fetch(`/api/tools/${toolConfigId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: selectedWebsite,
          enabled: true,
        }),
      })
      if (!response.ok) throw new Error('Failed to add tool')
      await fetchWebsiteTools(selectedWebsite)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add tool')
    }
  }

  async function removeToolFromWebsite(toolConfigId: string) {
    if (!confirm('Remove this tool from the website?')) return
    try {
      const response = await fetch(`/api/tools/${toolConfigId}/assignments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: selectedWebsite,
        }),
      })
      if (!response.ok) throw new Error('Failed to remove tool')
      await fetchWebsiteTools(selectedWebsite)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove tool')
    }
  }

  function toggleExpanded(toolId: string) {
    setExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(toolId)) {
        next.delete(toolId)
      } else {
        next.add(toolId)
      }
      return next
    })
  }

  function getTypeBadgeVariant(type: string): 'default' | 'secondary' | 'outline' {
    switch (type) {
      case 'javascript':
        return 'default'
      case 'rest':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  // Get tools not yet assigned to this website
  const unassignedTools = allTools.filter(
    tool => !tools.some(wt => wt.tool_config_id === tool.id)
  )

  const currentWebsite = websites.find(w => w.id === selectedWebsite)

  return (
    <div className="space-y-6">
      {/* Header with Website Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Website Tools</h1>
          <p className="text-muted-foreground mt-2">
            Manage external tools and API credentials for your website
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={selectedWebsite} onValueChange={setSelectedWebsite}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select website..." />
            </SelectTrigger>
            <SelectContent>
              {websites.map(website => (
                <SelectItem key={website.id} value={website.id}>
                  {website.title || website.domain}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedWebsite && unassignedTools.length > 0 && (
            <AddToolDialog
              tools={unassignedTools}
              onAdd={addToolToWebsite}
            />
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm p-4 border border-destructive/20 rounded-lg bg-destructive/5">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {!selectedWebsite ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Wrench className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg">Select a website to manage its tools</p>
            <p className="text-sm">Each website can have its own set of tools and API credentials</p>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading tools...
          </CardContent>
        </Card>
      ) : tools.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No Tools Configured</CardTitle>
            <CardDescription>
              Add tools to enable agents to access external APIs and data sources for{' '}
              <strong>{currentWebsite?.title || currentWebsite?.domain}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {unassignedTools.length > 0 ? (
              <AddToolDialog tools={unassignedTools} onAdd={addToolToWebsite} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No tool configurations available. Create tools in the global tool catalog first.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {tools.map(tool => (
            <ToolCard
              key={tool.id}
              tool={tool}
              websiteId={selectedWebsite}
              expanded={expandedTools.has(tool.tool_config_id)}
              onToggleExpand={() => toggleExpanded(tool.tool_config_id)}
              onToggleEnabled={(enabled) => toggleToolEnabled(tool.tool_config_id, enabled)}
              onRemove={() => removeToolFromWebsite(tool.tool_config_id)}
              getTypeBadgeVariant={getTypeBadgeVariant}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Tool Card Component
interface ToolCardProps {
  tool: WebsiteTool
  websiteId: string
  expanded: boolean
  onToggleExpand: () => void
  onToggleEnabled: (enabled: boolean) => void
  onRemove: () => void
  getTypeBadgeVariant: (type: string) => 'default' | 'secondary' | 'outline'
}

function ToolCard({
  tool,
  websiteId,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onRemove,
  getTypeBadgeVariant,
}: ToolCardProps) {
  const config = tool.tool_config
  const needsCredentials = config.type === 'rest' && config.config?.auth_type !== 'none'

  return (
    <Card className={!tool.enabled ? 'opacity-60' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onToggleExpand}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">
                  {config.display_name || config.name}
                </CardTitle>
                <Badge variant={getTypeBadgeVariant(config.type)}>
                  {config.type}
                </Badge>
                {needsCredentials && (
                  <Badge variant="outline" className="gap-1">
                    <Key className="h-3 w-3" />
                    API Key Required
                  </Badge>
                )}
              </div>
              {config.description && (
                <CardDescription className="mt-1">{config.description}</CardDescription>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor={`enabled-${tool.id}`} className="text-sm text-muted-foreground">
                Enabled
              </Label>
              <Switch
                id={`enabled-${tool.id}`}
                checked={tool.enabled}
                onCheckedChange={onToggleEnabled}
              />
            </div>
            <Button variant="ghost" size="icon" onClick={onRemove}>
              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t pt-4">
          <div className="grid grid-cols-2 gap-6">
            {/* Tool Info */}
            <div className="space-y-3">
              <h4 className="font-medium text-sm">Configuration</h4>
              {config.endpoint_url && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Endpoint:</span>
                  <span className="ml-2 font-mono text-xs bg-muted px-2 py-1 rounded">
                    {config.endpoint_url}
                  </span>
                </div>
              )}
              {config.config?.auth_type && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Auth:</span>
                  <span className="ml-2">{String(config.config.auth_type)}</span>
                </div>
              )}
              <div className="text-sm">
                <span className="text-muted-foreground">Priority:</span>
                <span className="ml-2">{tool.priority}</span>
              </div>
            </div>

            {/* Secrets Management */}
            {needsCredentials && (
              <div>
                <ToolSecretsInline
                  toolId={config.id}
                  toolName={config.display_name || config.name}
                  websiteId={websiteId}
                />
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// Inline Secrets Manager
interface ToolSecretsInlineProps {
  toolId: string
  toolName: string
  websiteId: string
}

function ToolSecretsInline({ toolId, toolName, websiteId }: ToolSecretsInlineProps) {
  const [secrets, setSecrets] = useState<SecretKey[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New secret form
  const [newSecretKey, setNewSecretKey] = useState('')
  const [newSecretValue, setNewSecretValue] = useState('')
  const [showValue, setShowValue] = useState(false)

  useEffect(() => {
    fetchSecrets()
  }, [toolId, websiteId])

  async function fetchSecrets() {
    try {
      setLoading(true)
      const response = await fetch(`/api/tools/${toolId}/secrets?website_id=${websiteId}`)
      if (!response.ok) throw new Error('Failed to fetch secrets')
      const data = await response.json()
      setSecrets(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load secrets')
    } finally {
      setLoading(false)
    }
  }

  async function addSecret() {
    if (!newSecretKey || !newSecretValue) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/tools/${toolId}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: websiteId,
          secret_key: newSecretKey,
          value: newSecretValue,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to add secret')
      }

      setNewSecretKey('')
      setNewSecretValue('')
      setShowValue(false)
      await fetchSecrets()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add secret')
    } finally {
      setSaving(false)
    }
  }

  async function deleteSecret(secretKey: string) {
    if (!confirm(`Delete secret "${secretKey}"?`)) return

    setSaving(true)
    try {
      const response = await fetch(`/api/tools/${toolId}/secrets`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: websiteId,
          secret_key: secretKey,
        }),
      })

      if (!response.ok) throw new Error('Failed to delete secret')
      await fetchSecrets()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete secret')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <h4 className="font-medium text-sm flex items-center gap-2">
        <Key className="h-4 w-4" />
        API Credentials
      </h4>

      {error && (
        <div className="text-destructive text-xs flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <>
          {/* Existing secrets */}
          {secrets.length > 0 && (
            <div className="space-y-2">
              {secrets.map(secret => (
                <div
                  key={secret.key}
                  className="flex items-center justify-between p-2 rounded border bg-muted/30"
                >
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    <code className="text-xs font-medium">{secret.key}</code>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => deleteSecret(secret.key)}
                    disabled={saving}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add new secret */}
          <div className="space-y-2 p-3 rounded border bg-muted/20">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Key</Label>
                <Input
                  placeholder="API_KEY"
                  value={newSecretKey}
                  onChange={(e) => setNewSecretKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Value</Label>
                <div className="relative">
                  <Input
                    type={showValue ? 'text' : 'password'}
                    placeholder="sk-..."
                    value={newSecretValue}
                    onChange={(e) => setNewSecretValue(e.target.value)}
                    className="h-8 text-xs pr-8"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-8 w-8"
                    onClick={() => setShowValue(!showValue)}
                  >
                    {showValue ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            </div>
            <Button
              onClick={addSecret}
              disabled={!newSecretKey || !newSecretValue || saving}
              size="sm"
              className="h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Credential
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// Add Tool Dialog
interface AddToolDialogProps {
  tools: ToolConfig[]
  onAdd: (toolId: string) => void
}

function AddToolDialog({ tools, onAdd }: AddToolDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Tool
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Tool to Website</DialogTitle>
          <DialogDescription>
            Select a tool from the global catalog to add to this website
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {tools.map(tool => (
            <div
              key={tool.id}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
              onClick={() => {
                onAdd(tool.id)
                setOpen(false)
              }}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{tool.display_name || tool.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {tool.type}
                  </Badge>
                </div>
                {tool.description && (
                  <p className="text-sm text-muted-foreground mt-1">{tool.description}</p>
                )}
              </div>
              <Plus className="h-4 w-4 text-muted-foreground" />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
