import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { AlertCircle, Check, Edit, Plus, X, Eye } from 'lucide-react'

interface CompanyPrompt {
  id: string
  role_name: string
  capability: string
  version: string
  template: string
  description?: string
  default_variables?: Record<string, string>
}

interface WebsitePrompt {
  id: string
  company_prompt_template_id: string
  version: string
  template_override?: string
  template_additions?: string
  variables_override?: Record<string, string>
  is_active: boolean
  role_name?: string
  capability?: string
}

interface WebsitePromptOverridesProps {
  websiteId: string
  websiteName: string
  companyPrompts: CompanyPrompt[]
  websitePrompts: WebsitePrompt[]
}

export default function WebsitePromptOverrides({
  websiteId,
  websiteName,
  companyPrompts,
  websitePrompts
}: WebsitePromptOverridesProps) {
  const [overrides, setOverrides] = useState<WebsitePrompt[]>(websitePrompts)
  const [editingPrompt, setEditingPrompt] = useState<CompanyPrompt | null>(null)
  const [editingOverride, setEditingOverride] = useState<WebsitePrompt | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Form state for editing
  const [formData, setFormData] = useState({
    template_override: '',
    template_additions: '',
    variables_override: {} as Record<string, string>,
    version: '1.0.0'
  })

  // Get existing override for a company prompt
  const getOverride = (companyPromptId: string) => {
    return overrides.find(o => o.company_prompt_template_id === companyPromptId)
  }

  // Start editing an override
  const startEdit = (companyPrompt: CompanyPrompt, existingOverride?: WebsitePrompt) => {
    setEditingPrompt(companyPrompt)
    setEditingOverride(existingOverride || null)
    setFormData({
      template_override: existingOverride?.template_override || '',
      template_additions: existingOverride?.template_additions || '',
      variables_override: existingOverride?.variables_override || {},
      version: existingOverride ? incrementVersion(existingOverride.version) : '1.0.0'
    })
    setError(null)
  }

  const incrementVersion = (version: string): string => {
    const parts = version.split('.').map(Number)
    parts[2] = (parts[2] || 0) + 1
    return parts.join('.')
  }

  const handleSave = async () => {
    if (!editingPrompt) return

    setSaving(true)
    setError(null)

    try {
      const method = editingOverride ? 'PUT' : 'POST'
      const url = editingOverride
        ? `/api/prompts/website/${editingOverride.id}`
        : '/api/prompts/website'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: websiteId,
          company_prompt_template_id: editingPrompt.id,
          ...formData
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to save override')
      }

      const result = await response.json()

      // Update local state
      if (editingOverride) {
        setOverrides(overrides.map(o => o.id === result.id ? result : o))
      } else {
        setOverrides([...overrides, result])
      }

      setEditingPrompt(null)
      setEditingOverride(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editingOverride) return

    if (!confirm('Are you sure you want to remove this override?')) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/prompts/website/${editingOverride.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to delete override')
      }

      setOverrides(overrides.filter(o => o.id !== editingOverride.id))
      setEditingPrompt(null)
      setEditingOverride(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setSaving(false)
    }
  }

  // Render preview combining company prompt with override
  const renderPreview = () => {
    if (!editingPrompt) return ''

    let template = formData.template_override || editingPrompt.template

    // Apply additions
    if (formData.template_additions) {
      template += '\n\n' + formData.template_additions
    }

    // Apply variables
    const variables = {
      ...editingPrompt.default_variables,
      ...formData.variables_override
    }

    for (const [key, value] of Object.entries(variables)) {
      template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }

    // Highlight remaining variables
    template = template.replace(
      /\{\{(\w+)\}\}/g,
      '<span class="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">{{$1}}</span>'
    )

    return template
  }

  // Group company prompts by role
  const promptsByRole = companyPrompts.reduce((acc: Record<string, CompanyPrompt[]>, prompt) => {
    if (!acc[prompt.role_name]) {
      acc[prompt.role_name] = []
    }
    acc[prompt.role_name].push(prompt)
    return acc
  }, {})

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt Overrides</CardTitle>
        <CardDescription>
          Customize company prompts for {websiteName}. Override templates, add content, or change variables.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {Object.keys(promptsByRole).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No company prompts available to override.</p>
            <a href="/prompts/company/new" className="text-primary hover:underline">
              Create company prompts first
            </a>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(promptsByRole).map(([roleName, prompts]) => (
              <div key={roleName} className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Badge variant="outline">{roleName}</Badge>
                </h3>
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {prompts.map(prompt => {
                    const override = getOverride(prompt.id)
                    return (
                      <div
                        key={prompt.id}
                        className={`p-3 rounded-lg border ${override ? 'border-primary bg-primary/5' : 'bg-card'}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{prompt.capability}</span>
                          <div className="flex items-center gap-1">
                            {override && (
                              <Badge variant="default" className="text-xs">
                                Overridden
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-xs">
                              v{prompt.version}
                            </Badge>
                          </div>
                        </div>
                        {prompt.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
                            {prompt.description}
                          </p>
                        )}
                        <Button
                          variant={override ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => startEdit(prompt, override)}
                          className="w-full"
                        >
                          {override ? (
                            <>
                              <Edit className="h-3 w-3 mr-1" /> Edit Override
                            </>
                          ) : (
                            <>
                              <Plus className="h-3 w-3 mr-1" /> Create Override
                            </>
                          )}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit Dialog */}
        {editingPrompt && (
          <Dialog open={!!editingPrompt} onOpenChange={() => setEditingPrompt(null)}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingOverride ? 'Edit' : 'Create'} Override: {editingPrompt.capability}
                </DialogTitle>
                <DialogDescription>
                  Customize the {editingPrompt.role_name}/{editingPrompt.capability} prompt for {websiteName}
                </DialogDescription>
              </DialogHeader>

              {error && (
                <div className="flex items-center gap-2 p-3 text-destructive bg-destructive/10 rounded-lg">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {/* Version */}
                <div className="space-y-2">
                  <Label>Version</Label>
                  <Input
                    value={formData.version}
                    onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                    placeholder="1.0.0"
                  />
                </div>

                {/* Original Template (read-only) */}
                <div className="space-y-2">
                  <Label>Original Company Template</Label>
                  <Textarea
                    value={editingPrompt.template}
                    readOnly
                    className="font-mono text-sm bg-muted min-h-[150px]"
                  />
                </div>

                {/* Template Override */}
                <div className="space-y-2">
                  <Label>Template Override (optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Completely replace the company template. Leave empty to use the original.
                  </p>
                  <Textarea
                    value={formData.template_override}
                    onChange={(e) => setFormData({ ...formData, template_override: e.target.value })}
                    placeholder="Leave empty to use the original template..."
                    className="font-mono text-sm min-h-[150px]"
                  />
                </div>

                {/* Template Additions */}
                <div className="space-y-2">
                  <Label>Template Additions (optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Add content to the end of the template (e.g., brand-specific guidelines)
                  </p>
                  <Textarea
                    value={formData.template_additions}
                    onChange={(e) => setFormData({ ...formData, template_additions: e.target.value })}
                    placeholder="Additional instructions for this website..."
                    className="font-mono text-sm min-h-[100px]"
                  />
                </div>

                {/* Variable Overrides */}
                <div className="space-y-2">
                  <Label>Variable Overrides</Label>
                  <p className="text-xs text-muted-foreground">
                    Override default variable values for this website
                  </p>
                  <div className="space-y-2">
                    {Object.entries(editingPrompt.default_variables || {}).map(([key, defaultValue]) => (
                      <div key={key} className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono min-w-[120px]">
                          {`{{${key}}}`}
                        </Badge>
                        <Input
                          value={formData.variables_override[key] ?? ''}
                          onChange={(e) => setFormData({
                            ...formData,
                            variables_override: {
                              ...formData.variables_override,
                              [key]: e.target.value
                            }
                          })}
                          placeholder={defaultValue}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Preview Toggle */}
                <div className="flex items-center justify-between border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowPreview(!showPreview)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    {showPreview ? 'Hide Preview' : 'Show Preview'}
                  </Button>
                </div>

                {/* Preview */}
                {showPreview && (
                  <div className="p-4 rounded-lg border bg-muted/30">
                    <Label className="text-sm font-medium mb-2 block">Final Template Preview</Label>
                    <div
                      className="whitespace-pre-wrap text-sm font-mono"
                      dangerouslySetInnerHTML={{ __html: renderPreview() }}
                    />
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-between pt-4 border-t">
                  <div>
                    {editingOverride && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={handleDelete}
                        disabled={saving}
                      >
                        Remove Override
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditingPrompt(null)}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? 'Saving...' : editingOverride ? 'Update Override' : 'Create Override'}
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  )
}
