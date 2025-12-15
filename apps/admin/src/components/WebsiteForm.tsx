import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { GitHubConnector, type GitHubConnection } from './GitHubConnector'
import { DeploymentPanel } from './DeploymentPanel'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { ChevronDown, Sparkles, Globe, Users, Target } from 'lucide-react'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

interface AIContext {
  target_audience?: string
  audience_demographics?: string[]
  purpose?: string
  primary_goals?: string[]
  unique_value_proposition?: string
  primary_language?: string
  supported_languages?: string[]
  content_guidelines?: string
  keywords?: string[]
  topics_to_avoid?: string[]
}

interface WebsiteFormProps {
  website?: {
    id: string
    title: string
    domain: string
    description: string | null
    language?: string | null
    company_id: string
    github_repo_url: string | null
    github_owner?: string | null
    github_repo?: string | null
    github_installation_id?: string | null
    github_connected_at?: string | null
    metadata?: {
      ai_context?: AIContext
    } | null
  }
  mode: 'create' | 'edit'
}

interface Company {
  id: string
  name: string
}

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'German (Deutsch)' },
  { value: 'fr', label: 'French (Français)' },
  { value: 'it', label: 'Italian (Italiano)' },
  { value: 'es', label: 'Spanish (Español)' },
  { value: 'pt', label: 'Portuguese (Português)' },
  { value: 'nl', label: 'Dutch (Nederlands)' },
  { value: 'pl', label: 'Polish (Polski)' },
  { value: 'ru', label: 'Russian (Русский)' },
  { value: 'ja', label: 'Japanese (日本語)' },
  { value: 'zh', label: 'Chinese (中文)' },
  { value: 'ko', label: 'Korean (한국어)' },
]

export default function WebsiteForm({ website, mode }: WebsiteFormProps) {
  const [title, setTitle] = useState(website?.title || '')
  const [domain, setDomain] = useState(website?.domain || '')
  const [description, setDescription] = useState(website?.description || '')
  const [companyId, setCompanyId] = useState(website?.company_id || '')
  const [githubConnection, setGithubConnection] = useState<GitHubConnection>({
    github_repo_url: website?.github_repo_url || undefined,
    github_owner: website?.github_owner || undefined,
    github_repo: website?.github_repo || undefined,
    github_installation_id: website?.github_installation_id || undefined,
    github_connected_at: website?.github_connected_at || undefined,
  })
  const [companies, setCompanies] = useState<Company[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aiContextOpen, setAiContextOpen] = useState(true)

  // AI Context state
  const existingAiContext = website?.metadata?.ai_context || {}
  const [targetAudience, setTargetAudience] = useState(existingAiContext.target_audience || '')
  const [audienceDemographics, setAudienceDemographics] = useState(existingAiContext.audience_demographics?.join(', ') || '')
  const [purpose, setPurpose] = useState(existingAiContext.purpose || '')
  const [primaryGoals, setPrimaryGoals] = useState(existingAiContext.primary_goals?.join(', ') || '')
  const [uniqueValueProposition, setUniqueValueProposition] = useState(existingAiContext.unique_value_proposition || '')
  const [primaryLanguage, setPrimaryLanguage] = useState(website?.language || existingAiContext.primary_language || 'en')
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>(existingAiContext.supported_languages || ['en'])
  const [contentGuidelines, setContentGuidelines] = useState(existingAiContext.content_guidelines || '')
  const [keywords, setKeywords] = useState(existingAiContext.keywords?.join(', ') || '')
  const [topicsToAvoid, setTopicsToAvoid] = useState(existingAiContext.topics_to_avoid?.join(', ') || '')

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

      // Helper to parse comma-separated strings into arrays
      const parseList = (str: string): string[] =>
        str.split(',').map(s => s.trim()).filter(Boolean)

      // Build AI context object
      const aiContext: AIContext = {
        target_audience: targetAudience || undefined,
        audience_demographics: audienceDemographics ? parseList(audienceDemographics) : undefined,
        purpose: purpose || undefined,
        primary_goals: primaryGoals ? parseList(primaryGoals) : undefined,
        unique_value_proposition: uniqueValueProposition || undefined,
        primary_language: primaryLanguage || undefined,
        supported_languages: supportedLanguages.length > 0 ? supportedLanguages : undefined,
        content_guidelines: contentGuidelines || undefined,
        keywords: keywords ? parseList(keywords) : undefined,
        topics_to_avoid: topicsToAvoid ? parseList(topicsToAvoid) : undefined,
      }

      // Remove undefined values
      Object.keys(aiContext).forEach(key => {
        if (aiContext[key as keyof AIContext] === undefined) {
          delete aiContext[key as keyof AIContext]
        }
      })

      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          domain,
          description,
          language: primaryLanguage,
          company_id: companyId,
          metadata: {
            ai_context: Object.keys(aiContext).length > 0 ? aiContext : undefined,
          },
          github_repo_url: githubConnection.github_repo_url || null,
          github_owner: githubConnection.github_owner || null,
          github_repo: githubConnection.github_repo || null,
          github_installation_id: githubConnection.github_installation_id || null,
          github_connected_at: githubConnection.github_connected_at || null,
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

          {/* AI Context Section */}
          <Collapsible open={aiContextOpen} onOpenChange={setAiContextOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-600" />
                  <span className="font-semibold">AI Content Settings</span>
                  <Badge variant="secondary" className="ml-2">
                    Optimize AI-generated content
                  </Badge>
                </div>
                <ChevronDown className={cn(
                  "h-5 w-5 transition-transform",
                  aiContextOpen && "rotate-180"
                )} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-6">
              {/* Target Audience Section */}
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-blue-600" />
                  <h4 className="font-medium">Target Audience</h4>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="targetAudience">Who is your target audience?</Label>
                  <Textarea
                    id="targetAudience"
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    placeholder="e.g., Travelers planning a trip to Cinque Terre, Italy"
                    rows={2}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="audienceDemographics">Audience demographics (comma-separated)</Label>
                  <Input
                    id="audienceDemographics"
                    value={audienceDemographics}
                    onChange={(e) => setAudienceDemographics(e.target.value)}
                    placeholder="e.g., 25-45 year olds, Travel enthusiasts, First-time visitors"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Purpose Section */}
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-green-600" />
                  <h4 className="font-medium">Website Purpose & Goals</h4>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purpose">Primary purpose of this website</Label>
                  <Textarea
                    id="purpose"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="e.g., Comprehensive travel guide for the Cinque Terre region"
                    rows={2}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="primaryGoals">Primary goals (comma-separated)</Label>
                  <Input
                    id="primaryGoals"
                    value={primaryGoals}
                    onChange={(e) => setPrimaryGoals(e.target.value)}
                    placeholder="e.g., Inform visitors, Provide practical tips, Inspire travel"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="uniqueValueProposition">Unique value proposition</Label>
                  <Input
                    id="uniqueValueProposition"
                    value={uniqueValueProposition}
                    onChange={(e) => setUniqueValueProposition(e.target.value)}
                    placeholder="e.g., The most comprehensive Cinque Terre guide by locals"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Languages Section */}
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="h-4 w-4 text-purple-600" />
                  <h4 className="font-medium">Languages</h4>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="primaryLanguage">Primary language</Label>
                  <Select value={primaryLanguage} onValueChange={setPrimaryLanguage} disabled={isSubmitting}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select primary language" />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Supported languages</Label>
                  <div className="flex flex-wrap gap-2">
                    {LANGUAGE_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={supportedLanguages.includes(option.value) ? "default" : "outline"}
                        onClick={() => {
                          if (supportedLanguages.includes(option.value)) {
                            setSupportedLanguages(supportedLanguages.filter(l => l !== option.value))
                          } else {
                            setSupportedLanguages([...supportedLanguages, option.value])
                          }
                        }}
                        disabled={isSubmitting}
                      >
                        {option.label.split(' ')[0]}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Content Guidelines Section */}
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-yellow-600" />
                  <h4 className="font-medium">Content Guidelines</h4>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contentGuidelines">Content guidelines</Label>
                  <Textarea
                    id="contentGuidelines"
                    value={contentGuidelines}
                    onChange={(e) => setContentGuidelines(e.target.value)}
                    placeholder="e.g., Focus on practical information, include local perspectives, use vivid descriptions"
                    rows={3}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="keywords">Target keywords (comma-separated)</Label>
                  <Input
                    id="keywords"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="e.g., Cinque Terre, Italy travel, hiking trails, coastal villages"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="topicsToAvoid">Topics to avoid (comma-separated)</Label>
                  <Input
                    id="topicsToAvoid"
                    value={topicsToAvoid}
                    onChange={(e) => setTopicsToAvoid(e.target.value)}
                    placeholder="e.g., Negative reviews, Political content, Controversial topics"
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {mode === 'edit' && website?.id && (
            <div className="space-y-2">
              <Label>GitHub Integration (Optional)</Label>
              <GitHubConnector
                websiteId={website.id}
                connection={githubConnection}
                onConnect={(connection) => setGithubConnection(connection)}
                onDisconnect={() =>
                  setGithubConnection({
                    github_repo_url: undefined,
                    github_owner: undefined,
                    github_repo: undefined,
                    github_installation_id: undefined,
                    github_connected_at: undefined,
                  })
                }
                disabled={isSubmitting}
              />
            </div>
          )}

          {mode === 'edit' && website?.id && (
            <div className="space-y-2">
              <Label>Deployment</Label>
              <DeploymentPanel
                websiteId={website.id}
                isConnectedToGitHub={Boolean(githubConnection.github_repo_url)}
                disabled={isSubmitting}
              />
            </div>
          )}

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
