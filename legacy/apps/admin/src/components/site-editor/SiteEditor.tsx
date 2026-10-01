'use client'

import { useCallback, useEffect, useState, useMemo } from 'react'
import type { SiteDefinition, SitemapNode as SitemapNodeType, ContentType } from '@swarm-press/shared'
import { getLocalizedValue, getAllTypes, isCollectionNode } from '@swarm-press/shared'
import { PageTreePanel } from './PageTreePanel'
import { CollectionsPanel } from './CollectionsPanel'
import { ContextPanel } from './ContextPanel'
import { PageEditor } from '../page-editor'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Loader2, Save, Check, AlertCircle, Plus, Map } from 'lucide-react'
import type { PageSection } from '@swarm-press/shared'
import { usePageSections } from '../../hooks/usePageSections'

interface SiteEditorProps {
  websiteId: string
  initialSiteDefinition?: SiteDefinition & { sha?: string }
  onSave?: (siteDefinition: SiteDefinition) => Promise<void>
}

type SelectionType =
  | { type: 'none' }
  | { type: 'site' }
  | { type: 'page'; nodeId: string }
  | { type: 'collection'; nodeId: string }
  | { type: 'contentType'; typeId: string }

// Editor mode type
type EditorMode = 'sitemap' | 'page-editor'

// Editing page state
interface EditingPageState {
  nodeId: string
  pageTitle: string
  pagePath: string
  sections: PageSection[]
}

export function SiteEditor({ websiteId, initialSiteDefinition, onSave }: SiteEditorProps) {
  const [siteDefinition, setSiteDefinition] = useState<SiteDefinition | null>(
    initialSiteDefinition ?? null
  )
  const [sha, setSha] = useState<string | undefined>(initialSiteDefinition?.sha)
  const [selection, setSelection] = useState<SelectionType>({ type: 'site' })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Page Editor state
  const [editorMode, setEditorMode] = useState<EditorMode>('sitemap')
  const [editingPage, setEditingPage] = useState<EditingPageState | null>(null)
  const [isLoadingSections, setIsLoadingSections] = useState(false)

  // Agents and departments for page editor prompts
  const [agents, setAgents] = useState<Array<{ id: string; name: string; departmentId: string; avatarUrl?: string }>>([])
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])

  // Page sections hook
  const { loadSections, saveSections } = usePageSections(websiteId)

  // Fetch agents and departments on mount
  useEffect(() => {
    const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ceo:admin@swarm.press',
    }

    async function fetchAgentsAndDepartments() {
      try {
        const [agentsRes, deptsRes] = await Promise.all([
          fetch(`${API_URL}/api/trpc/agent.list?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`, { headers }),
          fetch(`${API_URL}/api/trpc/department.list?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`, { headers }),
        ])

        if (agentsRes.ok) {
          const agentsData = await agentsRes.json()
          const agentItems = agentsData.result?.data?.json?.items || []
          setAgents(agentItems.map((a: any) => ({
            id: a.id,
            name: a.name,
            departmentId: a.department_id,
            avatarUrl: a.avatar_url,
          })))
        }

        if (deptsRes.ok) {
          const deptsData = await deptsRes.json()
          const deptItems = deptsData.result?.data?.json?.items || []
          setDepartments(deptItems.map((d: any) => ({
            id: d.id,
            name: d.name,
          })))
        }
      } catch (error) {
        console.error('Failed to fetch agents/departments:', error)
      }
    }

    fetchAgentsAndDepartments()
  }, [])

  // Get flattened types map
  const typesMap = useMemo(() => siteDefinition ? getAllTypes(siteDefinition) : {}, [siteDefinition])

  // Handle node selection
  const handleSelectNode = useCallback((nodeId: string) => {
    if (!siteDefinition) return

    const node = siteDefinition.sitemap.nodes.find(n => n.id === nodeId)
    if (!node) return

    if (isCollectionNode(node.type)) {
      setSelection({ type: 'collection', nodeId })
    } else {
      setSelection({ type: 'page', nodeId })
    }
  }, [siteDefinition])

  // Handle double-click to enter page editor
  const handleDoubleClickNode = useCallback(async (nodeId: string) => {
    if (!siteDefinition) return

    const node = siteDefinition.sitemap.nodes.find(n => n.id === nodeId)
    if (!node) return

    // Only enter page editor for page nodes, not collections
    if (!isCollectionNode(node.type)) {
      const title = getLocalizedValue(node.data?.title, siteDefinition.defaultLocale) || nodeId
      const slug = node.data?.slug || nodeId

      // Build page path from slug
      const pagePath = slug === '/' ? 'index' : String(slug).replace(/^\//, '')

      setIsLoadingSections(true)
      try {
        // Load sections from GitHub via tRPC
        const sections = await loadSections(pagePath)

        setEditingPage({
          nodeId,
          pageTitle: title,
          pagePath,
          sections,
        })
        setEditorMode('page-editor')
      } catch (err) {
        console.error('Failed to load page sections:', err)
        // Still enter editor with empty sections on error
        setEditingPage({
          nodeId,
          pageTitle: title,
          pagePath,
          sections: [],
        })
        setEditorMode('page-editor')
      } finally {
        setIsLoadingSections(false)
      }
    }
  }, [siteDefinition, loadSections])

  // Handle exiting page editor
  const handleExitPageEditor = useCallback(() => {
    setEditorMode('sitemap')
    setEditingPage(null)
  }, [])

  // Handle saving page sections
  const handleSavePageSections = useCallback(async (sections: PageSection[]) => {
    if (!editingPage) return

    // Save sections to page JSON file via GitHub API
    await saveSections(
      editingPage.pagePath,
      sections,
      `Update sections for ${editingPage.pageTitle}`
    )

    // Update local state
    setEditingPage((prev) => prev ? { ...prev, sections } : null)
  }, [editingPage, saveSections])

  // Build site definition from current state
  const buildSiteDefinitionFromState = useCallback((): SiteDefinition | null => {
    if (!siteDefinition) return null

    return {
      ...siteDefinition,
      updatedAt: new Date().toISOString(),
    }
  }, [siteDefinition])

  // Save handler
  const handleSave = useCallback(async () => {
    const updatedDefinition = buildSiteDefinitionFromState()
    if (!updatedDefinition || !onSave) return

    setSaveStatus('saving')
    try {
      await onSave(updatedDefinition)
      setSaveStatus('saved')
      setHasUnsavedChanges(false)
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      console.error('Failed to save site definition:', error)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [buildSiteDefinitionFromState, onSave])

  // Update a page node
  const updatePageNode = useCallback((nodeId: string, updates: Partial<SitemapNodeType>) => {
    setSiteDefinition((prev) => {
      if (!prev) return prev
      const updatedNodes = prev.sitemap.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...updates } : node
      )
      return {
        ...prev,
        sitemap: { ...prev.sitemap, nodes: updatedNodes },
      }
    })
    setHasUnsavedChanges(true)
  }, [])

  // Update a content type
  const updateContentType = useCallback((typeId: string, updates: Partial<ContentType>) => {
    setSiteDefinition((prev) => {
      if (!prev) return prev

      // Determine if it's a page or collection type
      const isCollection = typeId.startsWith('collection:')
      const actualId = isCollection ? typeId.replace('collection:', '') : typeId

      if (isCollection && prev.types.collections?.[actualId]) {
        return {
          ...prev,
          types: {
            ...prev.types,
            collections: {
              ...prev.types.collections,
              [actualId]: { ...prev.types.collections[actualId], ...updates },
            },
          },
        }
      } else if (!isCollection && prev.types.pages?.[typeId]) {
        return {
          ...prev,
          types: {
            ...prev.types,
            pages: {
              ...prev.types.pages,
              [typeId]: { ...prev.types.pages[typeId], ...updates },
            },
          },
        }
      }

      return prev
    })
    setHasUnsavedChanges(true)
  }, [])

  // Update site settings
  const updateSiteSettings = useCallback((updates: Partial<SiteDefinition>) => {
    setSiteDefinition((prev) => {
      if (!prev) return prev
      return { ...prev, ...updates }
    })
    setHasUnsavedChanges(true)
  }, [])

  // Get selected item data for ContextPanel
  const getSelectedItem = useCallback(() => {
    if (!siteDefinition) return null

    switch (selection.type) {
      case 'page':
      case 'collection': {
        const node = siteDefinition.sitemap.nodes.find((n) => n.id === selection.nodeId)
        if (!node) return null
        const contentType = typesMap[node.type]
        return {
          type: selection.type as 'page' | 'collection',
          data: node,
          contentType,
        }
      }
      case 'contentType': {
        const contentType = typesMap[selection.typeId]
        if (!contentType) return null
        return { type: 'contentType' as const, data: contentType }
      }
      case 'site':
        return { type: 'site' as const, data: siteDefinition }
      default:
        return null
    }
  }, [siteDefinition, selection, typesMap])

  // Add a new page node
  const addPageNode = useCallback((parentId: string | null) => {
    if (!siteDefinition) return

    const newId = `page-${Date.now()}`

    // Get first available page type
    const pageTypes = Object.keys(siteDefinition.types.pages || {})
    const typeId = pageTypes[0] || 'page'

    const newNode: SitemapNodeType = {
      id: newId,
      type: typeId,
      data: {
        slug: `new-page-${Date.now()}`,
        title: { en: 'New Page' },
        status: 'draft',
      },
    }

    // Create edge if parent specified
    const newEdge = parentId ? {
      id: `${parentId}-${newId}`,
      source: parentId,
      target: newId,
      type: 'parent-child' as const,
    } : null

    setSiteDefinition((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        sitemap: {
          ...prev.sitemap,
          nodes: [...prev.sitemap.nodes, newNode],
          edges: newEdge
            ? [...(prev.sitemap.edges || []), newEdge]
            : prev.sitemap.edges,
        },
      }
    })
    setHasUnsavedChanges(true)
    setSelection({ type: 'page', nodeId: newId })
  }, [siteDefinition])

  // Create initial site definition
  const createInitialSiteDefinition = useCallback(async () => {
    const defaultDefinition: SiteDefinition = {
      id: websiteId,
      name: 'New Website',
      description: 'Site definition created by Site Editor',
      version: '1.0.0',
      locales: ['en'],
      defaultLocale: 'en',
      types: {
        pages: {
          'page': {
            id: 'page',
            name: 'Page',
            kind: 'page',
            icon: 'file-text',
            description: 'Standard content page',
            schema: {
              sections: [
                { type: 'hero', required: false },
                { type: 'paragraph', required: true, multiple: true },
                { type: 'image', required: false, multiple: true },
              ],
            },
          },
          'landing-page': {
            id: 'landing-page',
            name: 'Landing Page',
            kind: 'page',
            icon: 'home',
            color: '#3b82f6',
            description: 'Landing page with hero section',
            schema: {
              sections: [
                { type: 'hero', required: true },
                { type: 'paragraph', required: false, multiple: true },
                { type: 'callout', required: false },
              ],
            },
          },
        },
        collections: {},
      },
      sitemap: {
        nodes: [
          {
            id: 'home',
            type: 'landing-page',
            data: {
              slug: '/',
              title: { en: 'Home' },
              status: 'draft',
            },
          },
        ],
        edges: [],
      },
      agentConfig: {
        contentProduction: {
          enabled: true,
          autoResearch: true,
        },
        publishing: {
          requireApproval: true,
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    setSiteDefinition(defaultDefinition)
    setHasUnsavedChanges(true)
    setSelection({ type: 'site' })
  }, [websiteId])

  // No site definition state
  if (!siteDefinition) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-50">
        <div className="text-center max-w-md p-8 bg-white rounded-xl shadow-sm border">
          <div className="text-6xl mb-4">🗺️</div>
          <h3 className="text-xl font-semibold mb-2">No Site Definition Found</h3>
          <p className="text-muted-foreground mb-6">
            This website doesn't have a site definition yet. Click below to create one with default page types and a home page.
          </p>
          <Button size="lg" onClick={createInitialSiteDefinition}>
            <Plus className="h-5 w-5 mr-2" />
            Create Site Definition
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            The site definition will be saved to content/site.json in your GitHub repository.
          </p>
        </div>
      </div>
    )
  }

  // Render Page Editor when in page-editor mode
  if (editorMode === 'page-editor' && editingPage) {
    const pageNode = siteDefinition.sitemap.nodes.find((n) => n.id === editingPage.nodeId)

    return (
      <PageEditor
        pageId={editingPage.nodeId}
        pageTitle={editingPage.pageTitle}
        pagePath={editingPage.pagePath}
        websiteId={websiteId}
        initialSections={editingPage.sections}
        onBack={handleExitPageEditor}
        onSave={handleSavePageSections}
        siteDefinition={siteDefinition}
        pageNode={pageNode}
        agents={agents}
        departments={departments}
      />
    )
  }

  // Get selected node ID for tree/collections panels
  const selectedNodeId = selection.type === 'page' || selection.type === 'collection'
    ? selection.nodeId
    : null

  return (
    <div className="flex h-full">
      {/* Left: Page Tree + Collections */}
      <div className="w-72 border-r flex flex-col bg-background">
        <PageTreePanel
          siteDefinition={siteDefinition}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
          onDoubleClickNode={handleDoubleClickNode}
          onAddPage={addPageNode}
        />
        <CollectionsPanel
          siteDefinition={siteDefinition}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
        />
      </div>

      {/* Center: Empty state with site info */}
      <div className="flex-1 flex flex-col bg-slate-50">
        {/* Top bar with save button */}
        <div className="flex items-center justify-end gap-2 p-3 border-b bg-background">
          {hasUnsavedChanges && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Unsaved changes
            </Badge>
          )}
          <Button
            size="sm"
            variant={hasUnsavedChanges ? 'default' : 'outline'}
            onClick={handleSave}
            disabled={saveStatus === 'saving' || !hasUnsavedChanges}
          >
            {saveStatus === 'saving' ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : saveStatus === 'saved' ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Saved
              </>
            ) : saveStatus === 'error' ? (
              <>
                <AlertCircle className="h-4 w-4 mr-2" />
                Error
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save
              </>
            )}
          </Button>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex items-center justify-center">
          {/* Loading overlay when loading sections */}
          {isLoadingSections ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading page sections...</span>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">
              <Map className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">Select a page to edit</p>
              <p className="text-sm mt-1">Double-click a page to open the editor</p>
            </div>
          )}
        </div>
      </div>

      {/* Right: Context Panel */}
      <ContextPanel
        selection={getSelectedItem()}
        siteDefinition={siteDefinition}
        onUpdatePage={updatePageNode}
        onUpdateType={updateContentType}
        onUpdateSite={updateSiteSettings}
      />
    </div>
  )
}
