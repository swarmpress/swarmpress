import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Badge } from './ui/badge'
import { ModelConfigEditor } from './agents/ModelConfigEditor'
import type { ModelConfig } from '@swarm-press/shared'

// Capability definitions with descriptions
const AVAILABLE_CAPABILITIES = [
  // Content Creation
  { name: 'content_research', label: 'Content Research', category: 'Content Creation', description: 'Research topics and gather information' },
  { name: 'content_writing', label: 'Content Writing', category: 'Content Creation', description: 'Write and create content' },
  { name: 'content_revision', label: 'Content Revision', category: 'Content Creation', description: 'Revise and improve content' },
  { name: 'content_review', label: 'Content Review', category: 'Content Creation', description: 'Review content for quality' },
  // SEO & Analytics
  { name: 'seo_optimization', label: 'SEO Optimization', category: 'SEO & Analytics', description: 'Optimize content for search engines' },
  { name: 'keyword_research', label: 'Keyword Research', category: 'SEO & Analytics', description: 'Research and analyze keywords' },
  { name: 'analytics_analysis', label: 'Analytics Analysis', category: 'SEO & Analytics', description: 'Analyze traffic and performance' },
  // Media & Design
  { name: 'image_generation', label: 'Image Generation', category: 'Media & Design', description: 'Generate images with AI' },
  { name: 'image_editing', label: 'Image Editing', category: 'Media & Design', description: 'Edit and optimize images' },
  { name: 'gallery_curation', label: 'Gallery Curation', category: 'Media & Design', description: 'Curate image galleries' },
  // Editorial
  { name: 'editorial_review', label: 'Editorial Review', category: 'Editorial', description: 'Perform editorial reviews' },
  { name: 'fact_checking', label: 'Fact Checking', category: 'Editorial', description: 'Verify facts and sources' },
  { name: 'style_enforcement', label: 'Style Enforcement', category: 'Editorial', description: 'Enforce style guidelines' },
  // Engineering
  { name: 'site_build', label: 'Site Build', category: 'Engineering', description: 'Build and compile sites' },
  { name: 'site_deploy', label: 'Site Deploy', category: 'Engineering', description: 'Deploy sites to production' },
  { name: 'code_generation', label: 'Code Generation', category: 'Engineering', description: 'Generate code and components' },
  // Governance
  { name: 'escalation_handling', label: 'Escalation Handling', category: 'Governance', description: 'Handle escalations and issues' },
  { name: 'ticket_management', label: 'Ticket Management', category: 'Governance', description: 'Manage support tickets' },
  { name: 'ceo_briefing', label: 'CEO Briefing', category: 'Governance', description: 'Prepare executive briefings' },
  // Distribution
  { name: 'social_posting', label: 'Social Posting', category: 'Distribution', description: 'Post to social media' },
  { name: 'newsletter_creation', label: 'Newsletter Creation', category: 'Distribution', description: 'Create newsletters' },
] as const

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'authoritative', label: 'Authoritative' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'enthusiastic', label: 'Enthusiastic' },
  { value: 'formal', label: 'Formal' },
  { value: 'playful', label: 'Playful' },
]

const VOCABULARY_OPTIONS = [
  { value: 'simple', label: 'Simple' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'technical', label: 'Technical' },
]

const SENTENCE_LENGTH_OPTIONS = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
  { value: 'varied', label: 'Varied' },
]

const FORMALITY_OPTIONS = [
  { value: 'very_informal', label: 'Very Informal' },
  { value: 'informal', label: 'Informal' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'formal', label: 'Formal' },
  { value: 'very_formal', label: 'Very Formal' },
]

const HUMOR_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'frequent', label: 'Frequent' },
]

const EMOJI_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'rarely', label: 'Rarely' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'often', label: 'Often' },
]

const PERSPECTIVE_OPTIONS = [
  { value: 'first_person', label: 'First Person (I/We)' },
  { value: 'second_person', label: 'Second Person (You)' },
  { value: 'third_person', label: 'Third Person (They)' },
]

const DESCRIPTIVE_STYLE_OPTIONS = [
  { value: 'factual', label: 'Factual' },
  { value: 'evocative', label: 'Evocative' },
  { value: 'poetic', label: 'Poetic' },
  { value: 'practical', label: 'Practical' },
]

interface WritingStyle {
  tone?: string
  vocabulary_level?: string
  sentence_length?: string
  formality?: string
  humor?: string
  emoji_usage?: string
  perspective?: string
  descriptive_style?: string
}

interface AgentFormProps {
  agent?: {
    id: string
    name: string
    role_id: string
    department_id: string
    persona: string
    virtual_email: string
    description?: string
    avatar_url?: string
    profile_image_url?: string
    hobbies?: string[]
    writing_style?: WritingStyle
    capabilities: (string | { name: string; enabled?: boolean })[]
    model_config?: {
      model?: string
      temperature?: number
      max_tokens?: number
    }
    status?: string
  }
  departments: Array<{ id: string; name: string }>
  roles: Array<{ id: string; name: string; department_id: string }>
  mode: 'create' | 'edit'
}

export default function AgentForm({ agent, departments, roles, mode }: AgentFormProps) {
  // Basic info
  const [name, setName] = useState(agent?.name || '')
  const [departmentId, setDepartmentId] = useState(agent?.department_id || '')
  const [roleId, setRoleId] = useState(agent?.role_id || '')
  const [persona, setPersona] = useState(agent?.persona || '')
  const [virtualEmail, setVirtualEmail] = useState(agent?.virtual_email || '')
  const [description, setDescription] = useState(agent?.description || '')

  // Visual identity
  const [avatarUrl, setAvatarUrl] = useState(agent?.avatar_url || '')
  const [profileImageUrl, setProfileImageUrl] = useState(agent?.profile_image_url || '')

  // Personality
  const [hobbies, setHobbies] = useState(agent?.hobbies?.join(', ') || '')

  // Writing style
  const [writingStyle, setWritingStyle] = useState<WritingStyle>(agent?.writing_style || {})

  // Model configuration
  const [modelConfig, setModelConfig] = useState<ModelConfig>(agent?.model_config || {})

  // Capabilities (extract names from objects if needed)
  const initialCapabilities = (agent?.capabilities || []).map(c =>
    typeof c === 'string' ? c : c.name
  )
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>(initialCapabilities)

  // Status
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter roles by selected department
  const filteredRoles = departmentId
    ? roles.filter((role) => role.department_id === departmentId)
    : []

  const toggleCapability = (capName: string) => {
    setSelectedCapabilities(prev =>
      prev.includes(capName)
        ? prev.filter(c => c !== capName)
        : [...prev, capName]
    )
  }

  const updateWritingStyle = (key: keyof WritingStyle, value: string) => {
    setWritingStyle(prev => ({
      ...prev,
      [key]: value || undefined
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const url = mode === 'create' ? '/api/agents' : `/api/agents/${agent?.id}`

      const hobbiesArray = hobbies
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h.length > 0)

      // Convert capabilities to typed format
      const capabilities = selectedCapabilities.map(name => ({
        name,
        enabled: true
      }))

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
          description: description || undefined,
          avatarUrl: avatarUrl || undefined,
          profileImageUrl: profileImageUrl || undefined,
          hobbies: hobbiesArray.length > 0 ? hobbiesArray : undefined,
          writingStyle: Object.keys(writingStyle).length > 0 ? writingStyle : undefined,
          modelConfig: Object.keys(modelConfig).length > 0 ? modelConfig : undefined,
          capabilities,
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

  // Group capabilities by category
  const capabilitiesByCategory = AVAILABLE_CAPABILITIES.reduce((acc, cap) => {
    if (!acc[cap.category]) acc[cap.category] = []
    acc[cap.category].push(cap)
    return acc
  }, {} as Record<string, typeof AVAILABLE_CAPABILITIES[number][]>)

  return (
    <form onSubmit={handleSubmit}>
      <Tabs defaultValue="basic" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="identity">Visual Identity</TabsTrigger>
          <TabsTrigger value="style">Writing Style</TabsTrigger>
          <TabsTrigger value="model">Model & Prompts</TabsTrigger>
          <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
        </TabsList>

        {/* Basic Info Tab */}
        <TabsContent value="basic">
          <Card>
            <CardHeader>
              <CardTitle>{mode === 'create' ? 'Create New Agent' : 'Edit Agent'}</CardTitle>
              <CardDescription>
                Basic information about the autonomous Claude agent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                      setRoleId('')
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
                  placeholder="Describe the agent's personality, expertise, and background..."
                  rows={4}
                  required
                  disabled={isSubmitting}
                />
                <p className="text-sm text-muted-foreground">
                  A detailed description of the agent's personality, expertise, and how they approach their work.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Short Description</Label>
                <Input
                  id="description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One-line description for listings"
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hobbies">Hobbies & Interests</Label>
                <Input
                  id="hobbies"
                  type="text"
                  value={hobbies}
                  onChange={(e) => setHobbies(e.target.value)}
                  placeholder="e.g., hiking, photography, Italian cuisine"
                  disabled={isSubmitting}
                />
                <p className="text-sm text-muted-foreground">
                  Comma-separated list of interests that shape the agent's personality
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Visual Identity Tab */}
        <TabsContent value="identity">
          <Card>
            <CardHeader>
              <CardTitle>Visual Identity</CardTitle>
              <CardDescription>
                Profile images that represent this agent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="avatarUrl">Avatar URL</Label>
                    <Input
                      id="avatarUrl"
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://example.com/avatar.jpg"
                      disabled={isSubmitting}
                    />
                    <p className="text-sm text-muted-foreground">
                      Small thumbnail image (recommended: 100x100px)
                    </p>
                  </div>
                  {avatarUrl && (
                    <div className="border rounded-lg p-4 bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">Preview:</p>
                      <img
                        src={avatarUrl}
                        alt="Avatar preview"
                        className="w-24 h-24 rounded-full object-cover border"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="profileImageUrl">Profile Image URL</Label>
                    <Input
                      id="profileImageUrl"
                      type="url"
                      value={profileImageUrl}
                      onChange={(e) => setProfileImageUrl(e.target.value)}
                      placeholder="https://example.com/profile.jpg"
                      disabled={isSubmitting}
                    />
                    <p className="text-sm text-muted-foreground">
                      Large hero image for agent detail view
                    </p>
                  </div>
                  {profileImageUrl && (
                    <div className="border rounded-lg p-4 bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">Preview:</p>
                      <img
                        src={profileImageUrl}
                        alt="Profile preview"
                        className="w-full max-w-sm h-48 object-cover rounded-lg border"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Writing Style Tab */}
        <TabsContent value="style">
          <Card>
            <CardHeader>
              <CardTitle>Writing Style</CardTitle>
              <CardDescription>
                Configure how this agent writes content. These settings are included in the agent's system prompt and directly influence how content is generated.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {/* Tone */}
              <div className="grid grid-cols-3 gap-4 items-start">
                <div className="space-y-2">
                  <Label htmlFor="tone" className="text-base font-medium">Tone</Label>
                  <select
                    id="tone"
                    value={writingStyle.tone || ''}
                    onChange={(e) => updateWritingStyle('tone', e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    disabled={isSubmitting}
                  >
                    <option value="">Select tone...</option>
                    {TONE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 text-sm text-muted-foreground pt-7">
                  <strong>How it affects content:</strong> Sets the emotional quality and attitude of the writing.
                  Professional tone creates authoritative, business-like content. Friendly tone makes content approachable and warm.
                  Enthusiastic tone adds energy and excitement. Formal tone maintains distance and respect.
                </div>
              </div>

              {/* Vocabulary Level */}
              <div className="grid grid-cols-3 gap-4 items-start border-t pt-6">
                <div className="space-y-2">
                  <Label htmlFor="vocabulary" className="text-base font-medium">Vocabulary Level</Label>
                  <select
                    id="vocabulary"
                    value={writingStyle.vocabulary_level || ''}
                    onChange={(e) => updateWritingStyle('vocabulary_level', e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    disabled={isSubmitting}
                  >
                    <option value="">Select vocabulary...</option>
                    {VOCABULARY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 text-sm text-muted-foreground pt-7">
                  <strong>How it affects content:</strong> Controls word choice complexity and reading level.
                  Simple vocabulary uses everyday words accessible to all readers. Moderate balances clarity with sophistication.
                  Advanced uses richer vocabulary for educated audiences. Technical includes industry jargon and specialized terms.
                </div>
              </div>

              {/* Sentence Length */}
              <div className="grid grid-cols-3 gap-4 items-start border-t pt-6">
                <div className="space-y-2">
                  <Label htmlFor="sentenceLength" className="text-base font-medium">Sentence Length</Label>
                  <select
                    id="sentenceLength"
                    value={writingStyle.sentence_length || ''}
                    onChange={(e) => updateWritingStyle('sentence_length', e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    disabled={isSubmitting}
                  >
                    <option value="">Select length...</option>
                    {SENTENCE_LENGTH_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 text-sm text-muted-foreground pt-7">
                  <strong>How it affects content:</strong> Determines the rhythm and readability of text.
                  Short sentences create punchy, easy-to-scan content ideal for web. Medium provides balanced readability.
                  Long sentences allow for complex ideas and flowing prose. Varied mixes lengths for natural, engaging rhythm.
                </div>
              </div>

              {/* Formality */}
              <div className="grid grid-cols-3 gap-4 items-start border-t pt-6">
                <div className="space-y-2">
                  <Label htmlFor="formality" className="text-base font-medium">Formality</Label>
                  <select
                    id="formality"
                    value={writingStyle.formality || ''}
                    onChange={(e) => updateWritingStyle('formality', e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    disabled={isSubmitting}
                  >
                    <option value="">Select formality...</option>
                    {FORMALITY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 text-sm text-muted-foreground pt-7">
                  <strong>How it affects content:</strong> Controls the level of professionalism and social distance.
                  Very informal uses contractions, slang, and casual expressions. Informal is relaxed but respectful.
                  Neutral is balanced for general audiences. Formal avoids contractions and maintains professionalism.
                  Very formal uses elevated language suitable for official documents.
                </div>
              </div>

              {/* Humor */}
              <div className="grid grid-cols-3 gap-4 items-start border-t pt-6">
                <div className="space-y-2">
                  <Label htmlFor="humor" className="text-base font-medium">Humor</Label>
                  <select
                    id="humor"
                    value={writingStyle.humor || ''}
                    onChange={(e) => updateWritingStyle('humor', e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    disabled={isSubmitting}
                  >
                    <option value="">Select humor level...</option>
                    {HUMOR_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 text-sm text-muted-foreground pt-7">
                  <strong>How it affects content:</strong> Determines how much wit and levity appears in the writing.
                  None keeps content purely informational and serious. Subtle adds occasional light touches and wordplay.
                  Moderate includes jokes and amusing observations regularly. Frequent makes humor a defining characteristic of the content.
                </div>
              </div>

              {/* Emoji Usage */}
              <div className="grid grid-cols-3 gap-4 items-start border-t pt-6">
                <div className="space-y-2">
                  <Label htmlFor="emoji" className="text-base font-medium">Emoji Usage</Label>
                  <select
                    id="emoji"
                    value={writingStyle.emoji_usage || ''}
                    onChange={(e) => updateWritingStyle('emoji_usage', e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    disabled={isSubmitting}
                  >
                    <option value="">Select emoji usage...</option>
                    {EMOJI_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 text-sm text-muted-foreground pt-7">
                  <strong>How it affects content:</strong> Controls visual expression and modern communication style.
                  Never keeps content emoji-free for traditional or formal contexts. Rarely uses them only for emphasis.
                  Sometimes adds personality and visual breaks to content. Often makes emojis a regular part of communication, ideal for social media.
                </div>
              </div>

              {/* Perspective */}
              <div className="grid grid-cols-3 gap-4 items-start border-t pt-6">
                <div className="space-y-2">
                  <Label htmlFor="perspective" className="text-base font-medium">Perspective</Label>
                  <select
                    id="perspective"
                    value={writingStyle.perspective || ''}
                    onChange={(e) => updateWritingStyle('perspective', e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    disabled={isSubmitting}
                  >
                    <option value="">Select perspective...</option>
                    {PERSPECTIVE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 text-sm text-muted-foreground pt-7">
                  <strong>How it affects content:</strong> Sets the narrative voice and reader relationship.
                  First person (I/We) creates personal, experiential content that shares the author's perspective.
                  Second person (You) directly addresses readers, making content instructional and engaging.
                  Third person (They) provides objective, journalistic distance suitable for factual reporting.
                </div>
              </div>

              {/* Descriptive Style */}
              <div className="grid grid-cols-3 gap-4 items-start border-t pt-6">
                <div className="space-y-2">
                  <Label htmlFor="descriptiveStyle" className="text-base font-medium">Descriptive Style</Label>
                  <select
                    id="descriptiveStyle"
                    value={writingStyle.descriptive_style || ''}
                    onChange={(e) => updateWritingStyle('descriptive_style', e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    disabled={isSubmitting}
                  >
                    <option value="">Select style...</option>
                    {DESCRIPTIVE_STYLE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 text-sm text-muted-foreground pt-7">
                  <strong>How it affects content:</strong> Determines how places and experiences are portrayed.
                  Factual presents objective information and data without embellishment.
                  Evocative uses sensory details to help readers imagine being there.
                  Poetic employs metaphor and lyrical language to create emotional impact.
                  Practical focuses on actionable information readers can use immediately.
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Model & Prompts Tab */}
        <TabsContent value="model">
          <div className="space-y-6">
            <ModelConfigEditor
              value={modelConfig}
              onChange={setModelConfig}
              roleType={roles.find(r => r.id === roleId)?.name}
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Prompt Templates</CardTitle>
                <CardDescription>
                  System prompts are managed in the database using a 3-level hierarchy:
                  Company &rarr; Website &rarr; Agent. The agent's prompt inherits from these levels.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <h4 className="font-medium text-sm mb-2">How Prompts Work</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>1. <strong>Company Level:</strong> Baseline prompts for all agents</li>
                      <li>2. <strong>Website Level:</strong> Brand-specific overrides per website</li>
                      <li>3. <strong>Agent Level:</strong> Individual agent prompt bindings</li>
                    </ul>
                    <p className="text-sm text-muted-foreground mt-3">
                      Prompts use Handlebars templates with variables like <code className="bg-background px-1 rounded">{'{{agent_name}}'}</code>,
                      <code className="bg-background px-1 rounded">{'{{persona}}'}</code>, and
                      <code className="bg-background px-1 rounded">{'{{writing_style_section}}'}</code>.
                    </p>
                  </div>

                  <div className="flex items-center gap-4 pt-2">
                    <a
                      href="/prompts"
                      className="text-sm text-primary hover:underline"
                    >
                      Manage Prompt Templates &rarr;
                    </a>
                    {agent?.id && (
                      <a
                        href={`/agents/${agent.id}/prompts`}
                        className="text-sm text-primary hover:underline"
                      >
                        View Agent Prompt Bindings &rarr;
                      </a>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Capabilities Tab */}
        <TabsContent value="capabilities">
          <Card>
            <CardHeader>
              <CardTitle>Capabilities</CardTitle>
              <CardDescription>
                Select the capabilities this agent should have. Capabilities determine what tools and actions the agent can perform.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {Object.entries(capabilitiesByCategory).map(([category, caps]) => (
                  <div key={category} className="space-y-3">
                    <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                      {category}
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {caps.map((cap) => (
                        <label
                          key={cap.name}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            selectedCapabilities.includes(cap.name)
                              ? 'border-primary bg-primary/5'
                              : 'border-input hover:border-muted-foreground/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedCapabilities.includes(cap.name)}
                            onChange={() => toggleCapability(cap.name)}
                            className="mt-1"
                            disabled={isSubmitting}
                          />
                          <div>
                            <div className="font-medium text-sm">{cap.label}</div>
                            <div className="text-xs text-muted-foreground">{cap.description}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}

                {selectedCapabilities.length > 0 && (
                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground mb-2">
                      Selected capabilities ({selectedCapabilities.length}):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedCapabilities.map(cap => (
                        <Badge key={cap} variant="secondary">
                          {AVAILABLE_CAPABILITIES.find(c => c.name === cap)?.label || cap}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {error && (
        <div className="mt-6 p-4 border border-destructive bg-destructive/10 rounded-md">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="mt-6 flex gap-3">
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
  )
}
