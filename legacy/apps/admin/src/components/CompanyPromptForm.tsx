import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Badge } from './ui/badge'
import { AlertCircle, Plus, X, Play, Eye } from 'lucide-react'

interface CompanyPromptFormProps {
  mode: 'create' | 'edit'
  companyId: string
  prompt?: {
    id: string
    role_name: string
    capability: string
    version: string
    template: string
    description?: string
    changelog?: string
    examples?: Array<{ input: string; output: string }>
    default_variables?: Record<string, string>
    is_active?: boolean
  }
  roles?: Array<{ name: string }>
}

const COMMON_CAPABILITIES = [
  'write_draft',
  'revise_draft',
  'review_content',
  'generate_seo',
  'summarize',
  'translate',
  'format_content',
  'fact_check',
  'generate_title',
  'generate_meta',
]

const COMMON_ROLES = [
  'writer',
  'editor',
  'seo_specialist',
  'media_specialist',
  'engineering',
  'ceo_assistant',
]

export default function CompanyPromptForm({ mode, companyId, prompt, roles }: CompanyPromptFormProps) {
  const [formData, setFormData] = useState({
    role_name: prompt?.role_name || '',
    capability: prompt?.capability || '',
    version: prompt?.version || '1.0.0',
    template: prompt?.template || '',
    description: prompt?.description || '',
    changelog: prompt?.changelog || '',
    examples: prompt?.examples || [],
    default_variables: prompt?.default_variables || {},
  })

  const [newVariable, setNewVariable] = useState({ key: '', value: '' })
  const [newExample, setNewExample] = useState({ input: '', output: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Extract variables from template
  const extractVariables = (template: string): string[] => {
    const matches = template.match(/\{\{(\w+)\}\}/g) || []
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))]
  }

  const templateVariables = extractVariables(formData.template)

  const addVariable = () => {
    if (newVariable.key && newVariable.value) {
      setFormData({
        ...formData,
        default_variables: {
          ...formData.default_variables,
          [newVariable.key]: newVariable.value,
        },
      })
      setNewVariable({ key: '', value: '' })
    }
  }

  const removeVariable = (key: string) => {
    const { [key]: _, ...rest } = formData.default_variables
    setFormData({ ...formData, default_variables: rest })
  }

  const addExample = () => {
    if (newExample.input && newExample.output) {
      setFormData({
        ...formData,
        examples: [...formData.examples, newExample],
      })
      setNewExample({ input: '', output: '' })
    }
  }

  const removeExample = (index: number) => {
    setFormData({
      ...formData,
      examples: formData.examples.filter((_, i) => i !== index),
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const url = mode === 'create' ? '/api/prompts/company' : `/api/prompts/company/${prompt?.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          ...formData,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to save prompt')
      }

      const result = await response.json()
      window.location.href = `/prompts/company/${result.id}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save prompt')
    } finally {
      setSaving(false)
    }
  }

  // Render preview with variable substitution
  const renderPreview = () => {
    let preview = formData.template
    for (const [key, value] of Object.entries(formData.default_variables)) {
      preview = preview.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    // Highlight remaining variables
    preview = preview.replace(/\{\{(\w+)\}\}/g, '<span class="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">{{$1}}</span>')
    return preview
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 p-4 text-destructive bg-destructive/10 rounded-lg">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>
            Define the role and capability this prompt serves
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="role_name">Role Name *</Label>
              <Select
                value={formData.role_name}
                onValueChange={(value) => setFormData({ ...formData, role_name: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select or type a role..." />
                </SelectTrigger>
                <SelectContent>
                  {(roles?.map(r => r.name) || COMMON_ROLES).map(role => (
                    <SelectItem key={role} value={role}>{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id="role_name"
                value={formData.role_name}
                onChange={(e) => setFormData({ ...formData, role_name: e.target.value })}
                placeholder="Or enter custom role..."
                className="mt-2"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="capability">Capability *</Label>
              <Select
                value={formData.capability}
                onValueChange={(value) => setFormData({ ...formData, capability: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a capability..." />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_CAPABILITIES.map(cap => (
                    <SelectItem key={cap} value={cap}>{cap}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id="capability"
                value={formData.capability}
                onChange={(e) => setFormData({ ...formData, capability: e.target.value })}
                placeholder="Or enter custom capability..."
                className="mt-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="version">Version *</Label>
              <Input
                id="version"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                placeholder="1.0.0"
                pattern="\d+\.\d+\.\d+"
              />
              <p className="text-xs text-muted-foreground">Semantic versioning (e.g., 1.0.0)</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of this prompt..."
              />
            </div>
          </div>

          {mode === 'edit' && (
            <div className="space-y-2">
              <Label htmlFor="changelog">Changelog</Label>
              <Textarea
                id="changelog"
                value={formData.changelog}
                onChange={(e) => setFormData({ ...formData, changelog: e.target.value })}
                placeholder="What changed in this version..."
                rows={2}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Template */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Prompt Template</CardTitle>
              <CardDescription>
                Use {'{{variable}}'} syntax for dynamic content
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
            >
              <Eye className="h-4 w-4 mr-2" />
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={formData.template}
            onChange={(e) => setFormData({ ...formData, template: e.target.value })}
            placeholder={`You are a professional {{role}} specializing in {{domain}}.

Your task is to {{task_description}}.

Guidelines:
- Be concise and clear
- Follow brand voice: {{brand_voice}}
- Target audience: {{audience}}

Input:
{{input}}

Please provide your response:`}
            className="font-mono text-sm min-h-[300px]"
          />

          {templateVariables.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-muted-foreground">Variables found:</span>
              {templateVariables.map(v => (
                <Badge key={v} variant="secondary">{`{{${v}}}`}</Badge>
              ))}
            </div>
          )}

          {showPreview && (
            <div className="p-4 rounded-lg border bg-muted/30">
              <Label className="text-sm font-medium mb-2 block">Preview</Label>
              <div
                className="whitespace-pre-wrap text-sm font-mono"
                dangerouslySetInnerHTML={{ __html: renderPreview() }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Default Variables */}
      <Card>
        <CardHeader>
          <CardTitle>Default Variables</CardTitle>
          <CardDescription>
            Set default values for template variables. These can be overridden at website or agent level.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(formData.default_variables).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">{`{{${key}}}`}</Badge>
              <Input value={value} readOnly className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeVariable(key)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex items-end gap-2 pt-2 border-t">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Variable Name</Label>
              <Input
                value={newVariable.key}
                onChange={(e) => setNewVariable({ ...newVariable, key: e.target.value })}
                placeholder="variable_name"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Default Value</Label>
              <Input
                value={newVariable.value}
                onChange={(e) => setNewVariable({ ...newVariable, value: e.target.value })}
                placeholder="Default value..."
              />
            </div>
            <Button type="button" onClick={addVariable} disabled={!newVariable.key || !newVariable.value}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Examples */}
      <Card>
        <CardHeader>
          <CardTitle>Examples (Few-Shot)</CardTitle>
          <CardDescription>
            Provide input/output examples to guide the model's behavior
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formData.examples.map((example, index) => (
            <div key={index} className="p-4 rounded-lg border space-y-2">
              <div className="flex items-center justify-between">
                <Badge>Example {index + 1}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeExample(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Input</Label>
                <div className="p-2 rounded bg-muted text-sm font-mono whitespace-pre-wrap">
                  {example.input}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Expected Output</Label>
                <div className="p-2 rounded bg-muted text-sm font-mono whitespace-pre-wrap">
                  {example.output}
                </div>
              </div>
            </div>
          ))}

          <div className="space-y-4 pt-2 border-t">
            <div className="space-y-2">
              <Label>New Example Input</Label>
              <Textarea
                value={newExample.input}
                onChange={(e) => setNewExample({ ...newExample, input: e.target.value })}
                placeholder="Example input..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Expected Output</Label>
              <Textarea
                value={newExample.output}
                onChange={(e) => setNewExample({ ...newExample, output: e.target.value })}
                placeholder="Expected output..."
                rows={3}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addExample}
              disabled={!newExample.input || !newExample.output}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Example
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <a href="/prompts">
          <Button type="button" variant="outline">Cancel</Button>
        </a>
        <Button type="submit" disabled={saving || !formData.role_name || !formData.capability || !formData.template}>
          {saving ? 'Saving...' : mode === 'create' ? 'Create Prompt' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}
