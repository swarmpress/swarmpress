import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

interface AgentFormProps {
  agent?: {
    id: string
    name: string
    role_id: string
    department_id: string
    persona: string
    virtual_email: string
    capabilities: string[]
  }
  departments: Array<{ id: string; name: string }>
  roles: Array<{ id: string; name: string; department_id: string }>
  mode: 'create' | 'edit'
}

export default function AgentForm({ agent, departments, roles, mode }: AgentFormProps) {
  const [name, setName] = useState(agent?.name || '')
  const [departmentId, setDepartmentId] = useState(agent?.department_id || '')
  const [roleId, setRoleId] = useState(agent?.role_id || '')
  const [persona, setPersona] = useState(agent?.persona || '')
  const [virtualEmail, setVirtualEmail] = useState(agent?.virtual_email || '')
  const [capabilities, setCapabilities] = useState(
    agent?.capabilities?.join(', ') || ''
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter roles by selected department
  const filteredRoles = departmentId
    ? roles.filter((role) => role.department_id === departmentId)
    : []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const url = mode === 'create' ? '/api/agents' : `/api/agents/${agent?.id}`

      const capabilitiesArray = capabilities
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0)

      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          roleId,
          departmentId,
          persona,
          virtualEmail,
          capabilities: capabilitiesArray,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to save agent')
      }

      // Redirect to agents list on success
      window.location.href = '/agents'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === 'create' ? 'Create New Agent' : 'Edit Agent'}</CardTitle>
        <CardDescription>
          {mode === 'create'
            ? 'Add a new autonomous Claude agent with specific role and capabilities.'
            : 'Update agent information and capabilities.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Alex"
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Virtual Email *</Label>
              <Input
                id="email"
                type="email"
                value={virtualEmail}
                onChange={(e) => setVirtualEmail(e.target.value)}
                placeholder="e.g., alex@cinqueterre.travel"
                required
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="department">Department *</Label>
              <select
                id="department"
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value)
                  setRoleId('') // Reset role when department changes
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                required
                disabled={isSubmitting}
              >
                <option value="">Select department...</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role *</Label>
              <select
                id="role"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                required
                disabled={isSubmitting || !departmentId}
              >
                <option value="">Select role...</option>
                {filteredRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              {!departmentId && (
                <p className="text-sm text-muted-foreground">
                  Select a department first
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona">Persona *</Label>
            <Textarea
              id="persona"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="e.g., Creative and detail-oriented content writer specializing in travel and lifestyle content"
              rows={3}
              required
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              Describe the agent's personality and expertise
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="capabilities">Capabilities</Label>
            <Input
              id="capabilities"
              type="text"
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="e.g., content_creation, research, seo_optimization"
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              Comma-separated list of capabilities
            </p>
          </div>

          {error && (
            <div className="p-4 border border-destructive bg-destructive/10 rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? mode === 'create'
                  ? 'Creating...'
                  : 'Saving...'
                : mode === 'create'
                  ? 'Create Agent'
                  : 'Save Changes'}
            </Button>
            <a href="/agents">
              <Button type="button" variant="outline" disabled={isSubmitting}>
                Cancel
              </Button>
            </a>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
