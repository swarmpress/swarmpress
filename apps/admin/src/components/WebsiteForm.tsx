import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface WebsiteFormProps {
  website?: {
    id: string
    title: string
    domain: string
    description: string | null
    company_id: string
    github_repo_url: string | null
  }
  mode: 'create' | 'edit'
}

interface Company {
  id: string
  name: string
}

export default function WebsiteForm({ website, mode }: WebsiteFormProps) {
  const [title, setTitle] = useState(website?.title || '')
  const [domain, setDomain] = useState(website?.domain || '')
  const [description, setDescription] = useState(website?.description || '')
  const [companyId, setCompanyId] = useState(website?.company_id || '')
  const [githubRepoUrl, setGithubRepoUrl] = useState(website?.github_repo_url || '')
  const [companies, setCompanies] = useState<Company[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Fetch companies for dropdown via tRPC
    fetch('http://localhost:3000/api/trpc/company.list')
      .then((res) => res.json())
      .then((data) => {
        // tRPC wraps response in result.data.json
        const items = data.result?.data?.json?.items || []
        setCompanies(items)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch companies:', err)
        setError('Failed to load companies')
        setIsLoading(false)
      })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    if (!companyId) {
      setError('Please select a company')
      setIsSubmitting(false)
      return
    }

    try {
      const url =
        mode === 'create'
          ? '/api/websites'
          : `/api/websites/${website?.id}`

      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          domain,
          description,
          company_id: companyId,
          github_repo_url: githubRepoUrl || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to save website')
      }

      // Redirect to websites list on success
      window.location.href = '/websites'
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
          {mode === 'create' ? 'Create New Website' : 'Edit Website'}
        </CardTitle>
        <CardDescription>
          {mode === 'create'
            ? 'Add a new publication website to your media house.'
            : 'Update website information.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Cinqueterre Travel Blog"
              required
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              The display name of your website.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="domain">Domain *</Label>
            <Input
              id="domain"
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g., cinqueterre.travel"
              required
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              The domain name for this website (without https://).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="company">Media House *</Label>
            <Select value={companyId} onValueChange={setCompanyId} disabled={isSubmitting}>
              <SelectTrigger>
                <SelectValue placeholder="Select a media house" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              The media house that owns this website.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your website and its purpose..."
              rows={4}
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              Optional description of your website's focus and content.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="github_repo_url">GitHub Repository URL</Label>
            <Input
              id="github_repo_url"
              type="url"
              value={githubRepoUrl}
              onChange={(e) => setGithubRepoUrl(e.target.value)}
              placeholder="e.g., https://github.com/owner/repo"
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              Optional GitHub repository URL for content storage and version control.
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
                  ? 'Create Website'
                  : 'Save Changes'}
            </Button>
            <a href="/websites">
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
