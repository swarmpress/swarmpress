import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Key, Plus, Trash2, AlertCircle, Eye, EyeOff, Shield } from 'lucide-react'

interface Website {
  id: string
  domain: string
  title: string
}

interface SecretKey {
  key: string
  created_at: string
}

interface ToolSecretsManagerProps {
  toolId: string
  toolName: string
  websites: Website[]
}

export default function ToolSecretsManager({ toolId, toolName, websites }: ToolSecretsManagerProps) {
  const [selectedWebsite, setSelectedWebsite] = useState<string>('')
  const [secrets, setSecrets] = useState<SecretKey[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // New secret form
  const [newSecretKey, setNewSecretKey] = useState('')
  const [newSecretValue, setNewSecretValue] = useState('')
  const [showValue, setShowValue] = useState(false)

  // Fetch secrets when website is selected
  useEffect(() => {
    if (selectedWebsite) {
      fetchSecrets(selectedWebsite)
    } else {
      setSecrets([])
    }
  }, [selectedWebsite, toolId])

  async function fetchSecrets(websiteId: string) {
    try {
      setLoading(true)
      setError(null)
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
    if (!selectedWebsite || !newSecretKey || !newSecretValue) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/tools/${toolId}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: selectedWebsite,
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
      await fetchSecrets(selectedWebsite)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add secret')
    } finally {
      setSaving(false)
    }
  }

  async function deleteSecret(secretKey: string) {
    if (!selectedWebsite) return
    if (!confirm(`Are you sure you want to delete the secret "${secretKey}"?`)) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/tools/${toolId}/secrets`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: selectedWebsite,
          secret_key: secretKey,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to delete secret')
      }

      await fetchSecrets(selectedWebsite)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete secret')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Secrets Management
        </CardTitle>
        <CardDescription>
          Manage secrets for "{toolName}" per website. Secrets are encrypted and accessible via <code className="bg-muted px-1 rounded">api.secret('key')</code> in your tool code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Website selector */}
        <div className="space-y-2">
          <Label>Select Website</Label>
          <Select value={selectedWebsite} onValueChange={setSelectedWebsite}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a website to manage secrets..." />
            </SelectTrigger>
            <SelectContent>
              {websites.map(website => (
                <SelectItem key={website.id} value={website.id}>
                  {website.title} ({website.domain})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedWebsite && (
          <>
            {/* Add new secret */}
            <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add New Secret
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="secret-key" className="text-xs">Key</Label>
                  <Input
                    id="secret-key"
                    placeholder="API_KEY"
                    value={newSecretKey}
                    onChange={(e) => setNewSecretKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="secret-value" className="text-xs">Value</Label>
                  <div className="relative">
                    <Input
                      id="secret-value"
                      type={showValue ? 'text' : 'password'}
                      placeholder="sk-..."
                      value={newSecretValue}
                      onChange={(e) => setNewSecretValue(e.target.value)}
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowValue(!showValue)}
                    >
                      {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                onClick={addSecret}
                disabled={!newSecretKey || !newSecretValue || saving}
                size="sm"
              >
                Add Secret
              </Button>
            </div>

            {/* Existing secrets */}
            {loading ? (
              <div className="text-center py-4 text-muted-foreground">Loading secrets...</div>
            ) : secrets.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No secrets configured</p>
                <p className="text-sm">Add secrets above to use in your tool code</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm">Existing Secrets</Label>
                {secrets.map(secret => (
                  <div
                    key={secret.key}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-3">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <code className="text-sm font-medium">{secret.key}</code>
                        <div className="text-xs text-muted-foreground">
                          Added {new Date(secret.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteSecret(secret.key)}
                      disabled={saving}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {!selectedWebsite && (
          <div className="text-center py-6 text-muted-foreground">
            <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Select a website to manage secrets</p>
            <p className="text-sm">Secrets are stored per-website for security</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
