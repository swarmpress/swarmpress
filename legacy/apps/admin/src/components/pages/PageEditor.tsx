/**
 * PageEditor Component
 * Full-featured page editor with tabs for properties, blueprint, collections, SEO, and content
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import BlueprintSelector from './BlueprintSelector'
import CollectionBindings from './CollectionBindings'
import PageContentPanel from './PageContentPanel'

interface Page {
  id: string
  website_id: string
  slug: string
  title: string
  page_type: string
  status: string
  parent_id?: string
  blueprint_id?: string
  order_index?: number
  seo_profile?: {
    title_pattern?: string
    meta_description?: string
    keywords?: string[]
    canonical_url?: string
  }
  internal_links?: any
  metadata?: Record<string, any>
  created_at: string
  updated_at: string
}

interface Blueprint {
  id: string
  name: string
  description?: string
  schema?: {
    page_type?: string
    components?: any[]
    seo_template?: any
  }
}

interface PageEditorProps {
  pageId?: string
}

const PAGE_TYPES = [
  'homepage',
  'category',
  'article',
  'landing',
  'village',
  'restaurants',
  'hotels',
  'hiking',
  'beaches',
  'overview',
  'detail',
  'list',
]

const PAGE_STATUSES = [
  { value: 'draft', label: 'Draft', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'published', label: 'Published', color: 'bg-green-100 text-green-800' },
  { value: 'planned', label: 'Planned', color: 'bg-blue-100 text-blue-800' },
  { value: 'outdated', label: 'Outdated', color: 'bg-orange-100 text-orange-800' },
  { value: 'deprecated', label: 'Deprecated', color: 'bg-red-100 text-red-800' },
]

export default function PageEditor({ pageId }: PageEditorProps) {
  const [page, setPage] = useState<Page | null>(null)
  const [blueprints, setBlueprints] = useState<Blueprint[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('general')
  const [hasChanges, setHasChanges] = useState(false)

  // Form state for new pages
  const [formData, setFormData] = useState({
    title: '',
    slug: '',
    page_type: 'article',
    status: 'draft',
    parent_id: '',
    blueprint_id: '',
    seo_profile: {
      title_pattern: '',
      meta_description: '',
      keywords: [] as string[],
    },
  })

  const isNew = !pageId

  // Get website ID from cookie (product ID in session)
  const getWebsiteId = () => {
    const match = document.cookie.match(/swarmpress_product_id=([^;]+)/)
    return match ? match[1] : null
  }

  // Fetch page data
  const fetchPage = useCallback(async () => {
    if (!pageId) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`/api/trpc/sitemap.getById?input=${encodeURIComponent(JSON.stringify({ json: { id: pageId } }))}`)
      const data = await response.json()
      if (data.result?.data?.json) {
        const pageData = data.result.data.json
        setPage(pageData)
        setFormData({
          title: pageData.title || '',
          slug: pageData.slug || '',
          page_type: pageData.page_type || 'article',
          status: pageData.status || 'draft',
          parent_id: pageData.parent_id || '',
          blueprint_id: pageData.blueprint_id || '',
          seo_profile: pageData.seo_profile || {
            title_pattern: '',
            meta_description: '',
            keywords: [],
          },
        })
      }
    } catch (err) {
      setError('Failed to load page')
      console.error('Error fetching page:', err)
    }
  }, [pageId])

  // Fetch blueprints and pages
  const fetchRelatedData = useCallback(async () => {
    const websiteId = getWebsiteId()
    if (!websiteId) return

    try {
      const [blueprintsRes, pagesRes] = await Promise.all([
        fetch('/api/trpc/blueprint.list?input={}'),
        fetch(`/api/trpc/sitemap.listByWebsite?input=${encodeURIComponent(JSON.stringify({ json: { websiteId } }))}`),
      ])

      const blueprintsData = await blueprintsRes.json()
      const pagesData = await pagesRes.json()

      if (blueprintsData.result?.data?.json?.items) {
        setBlueprints(blueprintsData.result.data.json.items)
      }

      if (pagesData.result?.data?.json?.items) {
        setPages(pagesData.result.data.json.items.filter((p: Page) => p.id !== pageId))
      }
    } catch (err) {
      console.error('Error fetching related data:', err)
    }
  }, [pageId])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await Promise.all([fetchPage(), fetchRelatedData()])
      setLoading(false)
    }
    loadData()
  }, [fetchPage, fetchRelatedData])

  // Auto-generate slug from title
  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value
    setFormData((prev) => ({
      ...prev,
      title: newTitle,
      slug: isNew || !prev.slug ? generateSlug(newTitle) : prev.slug,
    }))
    setHasChanges(true)
  }

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
    setHasChanges(true)
  }

  const handleSeoChange = (field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      seo_profile: {
        ...prev.seo_profile,
        [field]: value,
      },
    }))
    setHasChanges(true)
  }

  const handleBlueprintChange = (blueprintId: string) => {
    setFormData((prev) => ({
      ...prev,
      blueprint_id: blueprintId,
    }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    const websiteId = getWebsiteId()
    if (!websiteId) {
      setError('No website selected')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload = {
        ...formData,
        website_id: websiteId,
        parent_id: formData.parent_id || undefined,
        blueprint_id: formData.blueprint_id || undefined,
      }

      let response
      if (isNew) {
        response = await fetch('/api/trpc/sitemap.create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ json: payload }),
        })
      } else {
        response = await fetch('/api/trpc/sitemap.update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ json: { id: pageId, ...payload } }),
        })
      }

      const data = await response.json()

      if (data.result?.data?.json) {
        setPage(data.result.data.json)
        setHasChanges(false)

        if (isNew) {
          // Redirect to the new page
          window.location.href = `/pages/${data.result.data.json.id}`
        }
      } else if (data.error) {
        setError(data.error.message || 'Failed to save page')
      }
    } catch (err) {
      setError('Failed to save page')
      console.error('Error saving page:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!pageId || !confirm('Are you sure you want to delete this page?')) return

    try {
      const response = await fetch('/api/trpc/sitemap.delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { id: pageId } }),
      })

      if (response.ok) {
        window.location.href = '/pages'
      } else {
        setError('Failed to delete page')
      }
    } catch (err) {
      setError('Failed to delete page')
      console.error('Error deleting page:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const selectedBlueprint = blueprints.find((b) => b.id === formData.blueprint_id)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a
            href="/pages"
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Back to Pages
          </a>
          <h1 className="text-2xl font-bold text-gray-900">
            {isNew ? 'New Page' : formData.title || 'Untitled Page'}
          </h1>
          {!isNew && (
            <Badge variant="outline" className={PAGE_STATUSES.find(s => s.value === formData.status)?.color}>
              {formData.status}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isNew && (
            <Button variant="outline" onClick={handleDelete} className="text-red-600 hover:text-red-700">
              Delete
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={saving || (!isNew && !hasChanges)}
          >
            {saving ? 'Saving...' : isNew ? 'Create Page' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="blueprint">Blueprint</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Page Properties</CardTitle>
              <CardDescription>
                Configure the basic properties of this page
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={handleTitleChange}
                    placeholder="Enter page title"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="slug">Slug</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">/</span>
                    <Input
                      id="slug"
                      value={formData.slug}
                      onChange={(e) => handleChange('slug', e.target.value)}
                      placeholder="page-slug"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="page_type">Page Type</Label>
                  <Select
                    value={formData.page_type}
                    onValueChange={(value) => handleChange('page_type', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select page type" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => handleChange('status', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_STATUSES.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="parent_id">Parent Page</Label>
                  <Select
                    value={formData.parent_id || 'none'}
                    onValueChange={(value) => handleChange('parent_id', value === 'none' ? '' : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select parent page" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No parent (root level)</SelectItem>
                      {pages.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title} ({p.slug})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Blueprint Tab */}
        <TabsContent value="blueprint" className="mt-6">
          <BlueprintSelector
            blueprints={blueprints}
            selectedBlueprintId={formData.blueprint_id}
            onSelect={handleBlueprintChange}
          />
        </TabsContent>

        {/* Collections Tab */}
        <TabsContent value="collections" className="mt-6">
          <CollectionBindings
            pageId={pageId}
            websiteId={getWebsiteId() || ''}
            blueprint={selectedBlueprint}
          />
        </TabsContent>

        {/* SEO Tab */}
        <TabsContent value="seo" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>SEO Settings</CardTitle>
              <CardDescription>
                Configure search engine optimization for this page
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title_pattern">Title Pattern</Label>
                <Input
                  id="title_pattern"
                  value={formData.seo_profile.title_pattern || ''}
                  onChange={(e) => handleSeoChange('title_pattern', e.target.value)}
                  placeholder="{{title}} | {{site_name}}"
                />
                <p className="text-sm text-gray-500">
                  Use {'{{title}}'}, {'{{site_name}}'}, {'{{village}}'} as variables
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="meta_description">Meta Description</Label>
                <textarea
                  id="meta_description"
                  value={formData.seo_profile.meta_description || ''}
                  onChange={(e) => handleSeoChange('meta_description', e.target.value)}
                  placeholder="A brief description of this page for search engines..."
                  className="w-full min-h-[100px] px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  maxLength={160}
                />
                <p className="text-sm text-gray-500">
                  {(formData.seo_profile.meta_description || '').length}/160 characters
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="keywords">Keywords</Label>
                <Input
                  id="keywords"
                  value={(formData.seo_profile.keywords || []).join(', ')}
                  onChange={(e) =>
                    handleSeoChange(
                      'keywords',
                      e.target.value.split(',').map((k) => k.trim()).filter(Boolean)
                    )
                  }
                  placeholder="keyword1, keyword2, keyword3"
                />
                <p className="text-sm text-gray-500">
                  Separate keywords with commas
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Content Tab */}
        <TabsContent value="content" className="mt-6">
          <PageContentPanel
            pageId={pageId}
            page={page}
            blueprint={selectedBlueprint}
            websiteId={getWebsiteId() || ''}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
