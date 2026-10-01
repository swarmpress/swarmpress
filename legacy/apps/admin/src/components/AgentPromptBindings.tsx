import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Switch } from './ui/switch'
import { AlertCircle, Plus, Settings, Trash2, Beaker } from 'lucide-react'

interface CompanyPrompt {
  id: string
  role_name: string
  capability: string
  version: string
  template: string
  description?: string
}

interface WebsitePrompt {
  id: string
  company_prompt_template_id: string
  version: string
  website?: { id: string; title: string; domain: string }
}

interface Binding {
  id: string
  agent_id: string
  capability: string
  company_prompt_template_id?: string
  website_prompt_template_id?: string
  custom_variables?: Record<string, string>
  ab_test_group?: string
  ab_test_weight?: number
  is_active: boolean
}

interface AgentPromptBindingsProps {
  agentId: string
  agentName: string
  bindings: Binding[]
  companyPrompts: CompanyPrompt[]
  websitePrompts: WebsitePrompt[]
}

export default function AgentPromptBindings({
  agentId,
  agentName,
  bindings: initialBindings,
  companyPrompts,
  websitePrompts
}: AgentPromptBindingsProps) {
  const [bindings, setBindings] = useState<Binding[]>(initialBindings)
  const [editingBinding, setEditingBinding] = useState<Binding | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    capability: '',
    company_prompt_template_id: '',
    website_prompt_template_id: '',
    custom_variables: {} as Record<string, string>,
    ab_test_group: '',
    ab_test_weight: 1.0,
    is_active: true
  })

  // Get unique capabilities from company prompts
  const availableCapabilities = [...new Set(companyPrompts.map(p => p.capability))]
  const boundCapabilities = new Set(bindings.map(b => b.capability))
  const unboundCapabilities = availableCapabilities.filter(c => !boundCapabilities.has(c))

  const startNew = () => {
    setIsNew(true)
    setEditingBinding(null)
    setFormData({
      capability: unboundCapabilities[0] || '',
      company_prompt_template_id: '',
      website_prompt_template_id: '',
      custom_variables: {},
      ab_test_group: '',
      ab_test_weight: 1.0,
      is_active: true
    })
    setError(null)
  }

  const startEdit = (binding: Binding) => {
    setIsNew(false)
    setEditingBinding(binding)
    setFormData({
      capability: binding.capability,
      company_prompt_template_id: binding.company_prompt_template_id || '',
      website_prompt_template_id: binding.website_prompt_template_id || '',
      custom_variables: binding.custom_variables || {},
      ab_test_group: binding.ab_test_group || '',
      ab_test_weight: binding.ab_test_weight || 1.0,
      is_active: binding.is_active
    })
    setError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      const method = isNew ? 'POST' : 'PUT'
      const url = isNew
        ? '/api/prompts/binding'
        : `/api/prompts/binding/${agentId}/${editingBinding?.capability}`

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          ...formData,
          company_prompt_template_id: formData.company_prompt_template_id || null,
          website_prompt_template_id: formData.website_prompt_template_id || null,
          ab_test_group: formData.ab_test_group || null,
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to save binding')
      }

      const result = await response.json()

      if (isNew) {
        setBindings([...bindings, result])
      } else {
        setBindings(bindings.map(b =>
          b.capability === editingBinding?.capability ? result : b
        ))
      }

      setEditingBinding(null)
      setIsNew(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editingBinding) return
    if (!confirm(`Remove binding for ${editingBinding.capability}?`)) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/prompts/binding/${agentId}/${editingBinding.capability}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to delete')
      }

      setBindings(bindings.filter(b => b.capability !== editingBinding.capability))
      setEditingBinding(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setSaving(false)
    }
  }

  // Get prompt info for display
  const getPromptInfo = (binding: Binding) => {
    if (binding.website_prompt_template_id) {
      const wp = websitePrompts.find(p => p.id === binding.website_prompt_template_id)
      if (wp?.website) {
        return { type: 'Website', name: wp.website.title || wp.website.domain, version: wp.version }
      }
    }
    if (binding.company_prompt_template_id) {
      const cp = companyPrompts.find(p => p.id === binding.company_prompt_template_id)
      if (cp) {
        return { type: 'Company', name: `${cp.role_name}/${cp.capability}`, version: cp.version }
      }
    }
    return { type: 'Auto', name: 'Resolution at runtime', version: '-' }
  }

  // Get company prompts for selected capability
  const getPromptsForCapability = (capability: string) => {
    return companyPrompts.filter(p => p.capability === capability)
  }

  // Get website prompts for selected company prompt
  const getWebsitePromptsForCompany = (companyPromptId: string) => {
    return websitePrompts.filter(p => p.company_prompt_template_id === companyPromptId)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Prompt Bindings</CardTitle>
            <CardDescription>
              Configure which prompts {agentName} uses for each capability
            </CardDescription>
          </div>
          {unboundCapabilities.length > 0 && (
            <Button onClick={startNew}>
              <Plus className="h-4 w-4 mr-2" />
              Add Binding
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {bindings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Settings className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No prompt bindings configured</p>
            <p className="text-sm">Add bindings to control which prompts this agent uses</p>
            {unboundCapabilities.length > 0 && (
              <Button variant="outline" className="mt-4" onClick={startNew}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Binding
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {bindings.map(binding => {
              const promptInfo = getPromptInfo(binding)
              return (
                <div
                  key={binding.capability}
                  className={`flex items-center justify-between p-4 rounded-lg border ${binding.is_active ? 'bg-card' : 'bg-muted/50 opacity-60'}`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{binding.capability}</span>
                      {binding.ab_test_group && (
                        <Badge variant="outline" className="text-xs">
                          <Beaker className="h-3 w-3 mr-1" />
                          A/B: {binding.ab_test_group}
                        </Badge>
                      )}
                      {!binding.is_active && (
                        <Badge variant="secondary" className="text-xs">Inactive</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <Badge variant="outline" className="text-xs mr-2">{promptInfo.type}</Badge>
                      {promptInfo.name}
                      {promptInfo.version !== '-' && (
                        <span className="ml-2">v{promptInfo.version}</span>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => startEdit(binding)}>
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}

        {/* Edit/Create Dialog */}
        <Dialog open={isNew || !!editingBinding} onOpenChange={() => { setEditingBinding(null); setIsNew(false) }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {isNew ? 'Add Prompt Binding' : `Edit: ${editingBinding?.capability}`}
              </DialogTitle>
              <DialogDescription>
                Configure how this agent resolves prompts for a capability
              </DialogDescription>
            </DialogHeader>

            {error && (
              <div className="flex items-center gap-2 p-3 text-destructive bg-destructive/10 rounded-lg">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="space-y-4">
              {/* Capability */}
              <div className="space-y-2">
                <Label>Capability</Label>
                {isNew ? (
                  <Select
                    value={formData.capability}
                    onValueChange={(value) => setFormData({ ...formData, capability: value, company_prompt_template_id: '', website_prompt_template_id: '' })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select capability..." />
                    </SelectTrigger>
                    <SelectContent>
                      {unboundCapabilities.map(cap => (
                        <SelectItem key={cap} value={cap}>{cap}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={formData.capability} disabled />
                )}
              </div>

              {/* Company Prompt */}
              <div className="space-y-2">
                <Label>Company Prompt (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  Pin to a specific company prompt, or leave empty for automatic resolution
                </p>
                <Select
                  value={formData.company_prompt_template_id}
                  onValueChange={(value) => setFormData({ ...formData, company_prompt_template_id: value, website_prompt_template_id: '' })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auto-resolve (recommended)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Auto-resolve</SelectItem>
                    {getPromptsForCapability(formData.capability).map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.role_name}/{p.capability} v{p.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Website Prompt */}
              {formData.company_prompt_template_id && getWebsitePromptsForCompany(formData.company_prompt_template_id).length > 0 && (
                <div className="space-y-2">
                  <Label>Website Override (optional)</Label>
                  <Select
                    value={formData.website_prompt_template_id}
                    onValueChange={(value) => setFormData({ ...formData, website_prompt_template_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Use company default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Company default</SelectItem>
                      {getWebsitePromptsForCompany(formData.company_prompt_template_id).map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.website?.title || p.website?.domain} v{p.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* A/B Testing */}
              <div className="space-y-2 pt-4 border-t">
                <Label>A/B Testing (optional)</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Test Group</Label>
                    <Input
                      value={formData.ab_test_group}
                      onChange={(e) => setFormData({ ...formData, ab_test_group: e.target.value })}
                      placeholder="e.g., variant-a"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Weight (0-1)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={formData.ab_test_weight}
                      onChange={(e) => setFormData({ ...formData, ab_test_weight: parseFloat(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between pt-4 border-t">
                <div>
                  <Label>Active</Label>
                  <p className="text-xs text-muted-foreground">Enable this binding</p>
                </div>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked: boolean) => setFormData({ ...formData, is_active: checked })}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-between pt-4 border-t">
                <div>
                  {!isNew && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={saving}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setEditingBinding(null); setIsNew(false) }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={saving || !formData.capability}>
                    {saving ? 'Saving...' : isNew ? 'Create Binding' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
