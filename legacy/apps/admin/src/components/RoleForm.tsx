import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface RoleFormProps {
  role?: {
    id: string
    name: string
    description: string | null
    department_id: string
  }
  mode: 'create' | 'edit'
}

interface Department {
  id: string
  name: string
}

export default function RoleForm({ role, mode }: RoleFormProps) {
  const [name, setName] = useState(role?.name || '')
  const [description, setDescription] = useState(role?.description || '')
  const [departmentId, setDepartmentId] = useState(role?.department_id || '')
  const [departments, setDepartments] = useState<Department[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Fetch departments for dropdown
    fetch('/api/departments')
      .then((res) => res.json())
      .then((data) => {
        setDepartments(data.items || [])
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch departments:', err)
        setError('Failed to load departments')
        setIsLoading(false)
      })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    if (!departmentId) {
      setError('Please select a department')
      setIsSubmitting(false)
      return
    }

    try {
      const url =
        mode === 'create'
          ? '/api/roles'
          : `/api/roles/${role?.id}`

      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description, department_id: departmentId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to save role')
      }

      // Redirect to roles list on success
      window.location.href = '/roles'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Loading...
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {mode === 'create' ? 'Create New Role' : 'Edit Role'}
        </CardTitle>
        <CardDescription>
          {mode === 'create'
            ? 'Define a new organizational role within a department.'
            : 'Update role information.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Content Writer"
              required
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              The name of this role (e.g., Writer, Editor, SEO Specialist).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="department">Department *</Label>
            <Select value={departmentId} onValueChange={setDepartmentId} disabled={isSubmitting}>
              <SelectTrigger>
                <SelectValue placeholder="Select a department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              The department this role belongs to.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the responsibilities of this role..."
              rows={4}
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              Optional description of the role's responsibilities and duties.
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
                  ? 'Create Role'
                  : 'Save Changes'}
            </Button>
            <a href="/roles">
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
