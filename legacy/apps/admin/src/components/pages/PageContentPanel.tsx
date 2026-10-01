/**
 * PageContentPanel Component
 * View and edit page content with hybrid AI + manual editing
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'

interface Page {
  id: string
  title: string
  slug: string
  status: string
}

interface Blueprint {
  id: string
  name: string
  schema?: {
    components?: Array<{
      id: string
      type: string
      variant?: string
      order: number
      ai_hints?: {
        purpose?: string
        tone?: string
        min_words?: number
        max_words?: number
      }
    }>
  }
}

interface ContentItem {
  id: string
  title: string
  status: string
  body?: any[]
  metadata?: {
    content_brief?: string
    language?: string
  }
  created_at: string
  updated_at: string
}

interface PageContentPanelProps {
  pageId?: string
  page: Page | null
  blueprint?: Blueprint | null
  websiteId: string
}

type ContentStatus = 'empty' | 'brief' | 'draft' | 'ready' | 'published'

const STATUS_CONFIG: Record<ContentStatus, { label: string; color: string; icon: string }> = {
  empty: { label: 'No Content', color: 'bg-gray-100 text-gray-700', icon: '○' },
  brief: { label: 'Brief Created', color: 'bg-yellow-100 text-yellow-700', icon: '📋' },
  draft: { label: 'Draft', color: 'bg-blue-100 text-blue-700', icon: '✏️' },
  ready: { label: 'Ready for Review', color: 'bg-purple-100 text-purple-700', icon: '👁️' },
  published: { label: 'Published', color: 'bg-green-100 text-green-700', icon: '✓' },
}

export default function PageContentPanel({
  pageId,
  page,
  blueprint,
  websiteId,
}: PageContentPanelProps) {
  const [content, setContent] = useState<ContentItem | null>(null)
  const [brief, setBrief] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generatingContent, setGeneratingContent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingBlockIndex, setEditingBlockIndex] = useState<number | null>(null)
  const [editedContent, setEditedContent] = useState<string>('')

  // Fetch content for this page
  const fetchContent = useCallback(async () => {
    if (!pageId) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(
        `/api/trpc/content.listByPage?input=${encodeURIComponent(
          JSON.stringify({ json: { pageId } })
        )}`
      )
      const data = await response.json()
      if (data.result?.data?.json?.items?.length > 0) {
        const contentItem = data.result.data.json.items[0]
        setContent(contentItem)
        if (contentItem.metadata?.content_brief) {
          setBrief(contentItem.metadata.content_brief)
        }
      }
    } catch (err) {
      console.error('Error fetching content:', err)
    } finally {
      setLoading(false)
    }
  }, [pageId])

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  // Determine content status
  const getContentStatus = (): ContentStatus => {
    if (!content) return 'empty'
    if (content.status === 'published') return 'published'
    if (content.body && content.body.length > 0) return 'draft'
    if (content.metadata?.content_brief) return 'brief'
    return 'empty'
  }

  const contentStatus = getContentStatus()
  const statusConfig = STATUS_CONFIG[contentStatus]

  // Generate brief for this page
  const handleGenerateBrief = async () => {
    if (!pageId || !websiteId) return

    setGenerating(true)
    setError(null)

    try {
      const response = await fetch('/api/pages/generate-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, websiteId }),
      })

      const data = await response.json()
      if (data.success) {
        setBrief(data.brief)
        await fetchContent() // Refresh content
      } else {
        setError(data.error || 'Failed to generate brief')
      }
    } catch (err) {
      setError('Failed to generate brief')
      console.error('Error generating brief:', err)
    } finally {
      setGenerating(false)
    }
  }

  // Generate content using AI agent
  const handleGenerateContent = async () => {
    if (!pageId || !websiteId) return

    setGeneratingContent(true)
    setError(null)

    try {
      const response = await fetch('/api/pages/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, websiteId }),
      })

      const data = await response.json()
      if (data.success) {
        await fetchContent() // Refresh content
      } else {
        setError(data.error || 'Failed to generate content')
      }
    } catch (err) {
      setError('Failed to generate content')
      console.error('Error generating content:', err)
    } finally {
      setGeneratingContent(false)
    }
  }

  // Edit a content block
  const handleEditBlock = (index: number) => {
    if (!content?.body?.[index]) return
    const block = content.body[index]
    setEditingBlockIndex(index)
    setEditedContent(
      typeof block.content === 'string'
        ? block.content
        : block.markdown || block.text || JSON.stringify(block, null, 2)
    )
  }

  // Save edited block
  const handleSaveBlock = async () => {
    if (editingBlockIndex === null || !content) return

    const updatedBody = [...(content.body || [])]
    const block = updatedBody[editingBlockIndex]

    // Update the block content based on type
    if (typeof block.content === 'string') {
      block.content = editedContent
    } else if (block.markdown !== undefined) {
      block.markdown = editedContent
    } else if (block.text !== undefined) {
      block.text = editedContent
    }

    try {
      const response = await fetch('/api/trpc/content.update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            id: content.id,
            body: updatedBody,
          },
        }),
      })

      const data = await response.json()
      if (data.result?.data?.json) {
        setContent(data.result.data.json)
      }
    } catch (err) {
      console.error('Error saving block:', err)
    }

    setEditingBlockIndex(null)
    setEditedContent('')
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </CardContent>
      </Card>
    )
  }

  if (!pageId) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-4xl mb-4">💾</div>
          <p className="text-gray-500">Save the page first to manage content</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <span>Content Status</span>
                <Badge className={statusConfig.color}>
                  {statusConfig.icon} {statusConfig.label}
                </Badge>
              </CardTitle>
              <CardDescription>
                {contentStatus === 'empty' && 'Generate a brief to start creating content'}
                {contentStatus === 'brief' && 'Brief is ready, generate content with AI'}
                {contentStatus === 'draft' && 'Content is being drafted, edit before publishing'}
                {contentStatus === 'ready' && 'Content is ready for review'}
                {contentStatus === 'published' && 'Content is live on your site'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {(contentStatus === 'empty' || contentStatus === 'brief') && (
                <Button
                  variant="outline"
                  onClick={handleGenerateBrief}
                  disabled={generating}
                >
                  {generating ? 'Generating...' : brief ? 'Regenerate Brief' : 'Generate Brief'}
                </Button>
              )}
              {contentStatus === 'brief' && (
                <Button
                  onClick={handleGenerateContent}
                  disabled={generatingContent}
                >
                  {generatingContent ? 'Generating Content...' : 'Generate Content'}
                </Button>
              )}
              {(contentStatus === 'draft' || contentStatus === 'ready') && (
                <Button
                  onClick={handleGenerateContent}
                  disabled={generatingContent}
                  variant="outline"
                >
                  {generatingContent ? 'Regenerating...' : 'Regenerate Content'}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {/* Content Tabs */}
      <Tabs defaultValue={content?.body?.length ? 'content' : 'brief'}>
        <TabsList>
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="content" disabled={!content?.body?.length}>
            Content Blocks ({content?.body?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={!content?.body?.length}>
            Preview
          </TabsTrigger>
        </TabsList>

        {/* Brief Tab */}
        <TabsContent value="brief" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Content Brief</CardTitle>
              <CardDescription>
                Instructions for the AI agent to generate content
              </CardDescription>
            </CardHeader>
            <CardContent>
              {brief ? (
                <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-lg border overflow-auto max-h-[500px]">
                  {brief}
                </pre>
              ) : blueprint ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-4">📋</div>
                  <p className="text-gray-500 mb-4">
                    Generate a brief based on the blueprint structure
                  </p>
                  <Button onClick={handleGenerateBrief} disabled={generating}>
                    {generating ? 'Generating...' : 'Generate Brief'}
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>Select a blueprint first to generate a structured brief</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Content Blocks Tab */}
        <TabsContent value="content" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Content Blocks</CardTitle>
              <CardDescription>
                Click on any block to edit. Changes are saved automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {content?.body?.length ? (
                <div className="space-y-4">
                  {content.body.map((block: any, index: number) => (
                    <div
                      key={index}
                      className="border rounded-lg overflow-hidden"
                    >
                      {/* Block Header */}
                      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-sm">#{index + 1}</span>
                          <Badge variant="outline" className="capitalize">
                            {block.type || 'unknown'}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditBlock(index)}
                        >
                          Edit
                        </Button>
                      </div>

                      {/* Block Content */}
                      {editingBlockIndex === index ? (
                        <div className="p-4 space-y-3">
                          <textarea
                            value={editedContent}
                            onChange={(e) => setEditedContent(e.target.value)}
                            className="w-full min-h-[150px] px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                          <div className="flex items-center gap-2">
                            <Button onClick={handleSaveBlock}>Save</Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setEditingBlockIndex(null)
                                setEditedContent('')
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4">
                          {renderBlockContent(block)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>No content blocks yet. Generate content to see them here.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Preview Tab */}
        <TabsContent value="preview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Content Preview</CardTitle>
              <CardDescription>
                How the content will appear on the page
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="prose max-w-none">
                {content?.body?.map((block: any, index: number) => (
                  <div key={index}>{renderPreviewBlock(block)}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Helper to render block content in editor
function renderBlockContent(block: any): React.ReactNode {
  const content = block.content || block.markdown || block.text

  if (typeof content === 'string') {
    return (
      <div className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-6">
        {content}
      </div>
    )
  }

  if (block.type === 'hero') {
    return (
      <div className="space-y-1">
        <div className="font-bold text-lg">{block.title?.en || block.title}</div>
        {block.subtitle && (
          <div className="text-gray-600">{block.subtitle?.en || block.subtitle}</div>
        )}
      </div>
    )
  }

  if (block.type === 'features' && block.features) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {block.features.slice(0, 4).map((f: any, i: number) => (
          <div key={i} className="text-sm p-2 bg-gray-50 rounded">
            {f.title?.en || f.title}
          </div>
        ))}
      </div>
    )
  }

  if (block.type === 'faq' && block.items) {
    return (
      <div className="space-y-1">
        {block.items.slice(0, 3).map((item: any, i: number) => (
          <div key={i} className="text-sm">
            <strong>Q:</strong> {item.question?.en || item.question}
          </div>
        ))}
      </div>
    )
  }

  return (
    <pre className="text-xs text-gray-500 overflow-hidden max-h-24">
      {JSON.stringify(block, null, 2)}
    </pre>
  )
}

// Helper to render block in preview mode
function renderPreviewBlock(block: any): React.ReactNode {
  const content = block.content || block.markdown || block.text

  if (block.type === 'hero') {
    return (
      <div className="py-8 text-center bg-gray-50 rounded-lg my-4">
        <h1 className="text-3xl font-bold">{block.title?.en || block.title}</h1>
        {block.subtitle && (
          <p className="text-xl text-gray-600 mt-2">{block.subtitle?.en || block.subtitle}</p>
        )}
      </div>
    )
  }

  if (block.type === 'paragraph' || typeof content === 'string') {
    return <p className="my-4">{content}</p>
  }

  if (block.type === 'heading') {
    const Tag = `h${block.level || 2}` as keyof JSX.IntrinsicElements
    return <Tag className="my-4">{block.text?.en || block.text}</Tag>
  }

  return null
}
