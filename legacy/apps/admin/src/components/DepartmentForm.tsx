import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

interface DepartmentFormProps {
  department?: {
    id: string
    name: string
    company_id: string
    description: string | null
  }
  companies: Array<{ id: string; name: string }>
  mode: 'create' | 'edit'
}

export default function DepartmentForm({ department, companies, mode }: DepartmentFormProps) {
  const [name, setName] = useState(department?.name || '')
  const [companyId, setCompanyId] = useState(department?.company_id || '')
  const [description, setDescription] = useState(department?.description || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const url =
        mode === 'create'
          ? '/api/departments'
          : `/api/departments/${department?.id}`

      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, companyId, description }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to save department')
      }

      // Redirect to departments list on success
      window.location.href = '/departments'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {mode === 'create' ? 'Create New Department' : 'Edit Department'}
        </CardTitle>
        <CardDescription>
          {mode === 'create'
            ? 'Add a new department to organize teams within a media house.'
            : 'Update department information.'}
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
              placeholder="e.g., Editorial, Engineering, Governance"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company">Media House *</Label>
            <select
              id="company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              required
              disabled={isSubmitting || mode === 'edit'}
            >
              <option value="">Select media house...</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            {mode === 'edit' && (
              <p className="text-sm text-muted-foreground">
                Media house cannot be changed after creation
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this department's purpose..."
              rows={4}
              disabled={isSubmitting}
            />
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
                  ? 'Create Department'
                  : 'Save Changes'}
            </Button>
            <a href="/departments">
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
