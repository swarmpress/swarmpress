'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  Panel,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
// CSS is imported in the Astro page to avoid dynamic import issues
// import '@xyflow/react/dist/style.css'

import type { SiteDefinition, SitemapNode as SitemapNodeType, ContentType } from '@swarm-press/shared'

// Helper functions inlined to avoid pulling in server-side code from @swarm-press/shared
function getAllTypes(siteDefinition: SiteDefinition): Record<string, ContentType> {
  const result: Record<string, ContentType> = {}
  if (siteDefinition.types.pages) {
    Object.entries(siteDefinition.types.pages).forEach(([id, type]) => {
      result[id] = type
    })
  }
  if (siteDefinition.types.collections) {
    Object.entries(siteDefinition.types.collections).forEach(([id, type]) => {
      result[`collection:${id}`] = type
    })
  }
  return result
}

function isCollectionNode(nodeType: string): boolean {
  return nodeType.startsWith('collection:')
}

type LocalizedString = string | Record<string, string>

function getLocalizedValue(value: LocalizedString | undefined, locale: string = 'en'): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value[locale] || value['en'] || Object.values(value)[0] || ''
}

function hasPageStructure(contentType: ContentType | undefined): boolean {
  return !!(contentType?.pageStructure?.pages && contentType.pageStructure.pages.length > 0)
}
import { PageNode } from './nodes/PageNode'
import { CollectionNode } from './nodes/CollectionNode'
import { TemplateCollectionNode } from './nodes/TemplateCollectionNode'
import { NodePalette } from './NodePalette'
import { ContextPanel } from './ContextPanel'
import { PageEditor } from '../page-editor'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Loader2, Save, Check, AlertCircle, Plus } from 'lucide-react'
import type { PageSection } from '@swarm-press/shared'
import { usePageSections } from '../../hooks/usePageSections'

// Node types for ReactFlow
const nodeTypes = {
  page: PageNode,
  collection: CollectionNode,
  templateCollection: TemplateCollectionNode,
}

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

function SiteEditorInner({ websiteId, initialSiteDefinition, onSave }: SiteEditorProps) {
  const { fitView, getNodes, getEdges } = useReactFlow()

  const [siteDefinition, setSiteDefinition] = useState<SiteDefinition | null>(
    initialSiteDefinition ?? null
  )
  const [sha, setSha] = useState<string | undefined>(initialSiteDefinition?.sha)
  const [nodes, setNodesState, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdgesState, onEdgesChange] = useEdgesState<Edge>([])
  const [selection, setSelection] = useState<SelectionType>({ type: 'none' })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Page Editor state
  const [editorMode, setEditorMode] = useState<EditorMode>('sitemap')
  const [editingPage, setEditingPage] = useState<EditingPageState | null>(null)
  const [isLoadingSections, setIsLoadingSections] = useState(false)

  // Page sections hook
  const { loadSections, saveSections } = usePageSections(websiteId)

  // Get flattened types map
  const typesMap = siteDefinition ? getAllTypes(siteDefinition) : {}

  // Convert site definition to ReactFlow nodes/edges
  useEffect(() => {
    if (!siteDefinition) return

    const newNodes: Node[] = []
    const newEdges: Edge[] = []
    const types = getAllTypes(siteDefinition)

    // Add sitemap nodes
    siteDefinition.sitemap.nodes.forEach((node, index) => {
      const isCollection = isCollectionNode(node.type)
      const contentType = types[node.type]
      const title = getLocalizedValue(node.data?.title, siteDefinition.defaultLocale)

      // Determine the node component type:
      // - Collections with pageStructure use templateCollection
      // - Regular collections use collection
      // - Pages use page
      const nodeComponentType = isCollection
        ? (hasPageStructure(contentType) ? 'templateCollection' : 'collection')
        : 'page'

      newNodes.push({
        id: node.id,
        type: nodeComponentType,
        position: node.position ?? { x: 200 + (index % 5) * 250, y: 100 + Math.floor(index / 5) * 200 },
        data: {
          id: node.id,
          nodeType: node.type,
          slug: node.data?.slug || '',
          title: title || node.id,
          status: node.data?.status || 'draft',
          contentType,
          locale: siteDefinition.defaultLocale,
          prompts: node.data?.prompts,
          filter: node.data?.filter,
          // Template collection specific data
          isTemplate: node.data?.isTemplate,
          instanceOverrides: node.data?.instanceOverrides,
        },
      })
    })

    // Add edges
    siteDefinition.sitemap.edges?.forEach((edge) => {
      const isCollectionLink = edge.type === 'collection-link'
      newEdges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: isCollectionLink,
        style: isCollectionLink
          ? { stroke: '#f97316', strokeWidth: 1, strokeDasharray: '5 5' }
          : { stroke: '#94a3b8', strokeWidth: 2 },
      })
    })

    setNodesState(newNodes)
    setEdgesState(newEdges)
  }, [siteDefinition, setNodesState, setEdgesState])

  // Handle connection between nodes
  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge: Edge = {
        id: `${params.source}-${params.target}`,
        source: params.source!,
        target: params.target!,
        type: 'smoothstep',
        style: { stroke: '#94a3b8', strokeWidth: 2 },
      }
      setEdgesState((eds) => addEdge(newEdge, eds))
      setHasUnsavedChanges(true)
    },
    [setEdgesState]
  )

  // Handle node click for selection
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const nodeData = node.data as { nodeType?: string }
    if (nodeData.nodeType && isCollectionNode(nodeData.nodeType)) {
      setSelection({ type: 'collection', nodeId: node.id })
    } else {
      setSelection({ type: 'page', nodeId: node.id })
    }
  }, [])

  // Handle node double-click to enter page editor
  const onNodeDoubleClick = useCallback(async (_: React.MouseEvent, node: Node) => {
    const nodeData = node.data as { nodeType?: string; title?: string; slug?: string }

    // Only enter page editor for page nodes, not collections
    if (nodeData.nodeType && !isCollectionNode(nodeData.nodeType)) {
      const sitemapNode = siteDefinition?.sitemap.nodes.find((n) => n.id === node.id)
      const title = getLocalizedValue(sitemapNode?.data?.title, siteDefinition?.defaultLocale) || node.id
      const slug = sitemapNode?.data?.slug || node.id

      // Build page path from slug
      const pagePath = slug === '/' ? 'index' : slug.replace(/^\//, '')

      setIsLoadingSections(true)
      try {
        // Load sections from GitHub via tRPC
        const sections = await loadSections(pagePath)

        setEditingPage({
          nodeId: node.id,
          pageTitle: title,
          pagePath,
          sections,
        })
        setEditorMode('page-editor')
      } catch (err) {
        console.error('Failed to load page sections:', err)
        // Still enter editor with empty sections on error
        setEditingPage({
          nodeId: node.id,
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

  // Handle pane click to deselect or show site settings
  const onPaneClick = useCallback(() => {
    setSelection({ type: 'site' })
  }, [])

  // Handle node position change
  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (!siteDefinition) return

    setHasUnsavedChanges(true)
    setSiteDefinition((prev) => {
      if (!prev) return prev

      // Update position in sitemap nodes
      const updatedNodes = prev.sitemap.nodes.map((n) =>
        n.id === node.id ? { ...n, position: node.position } : n
      )

      return {
        ...prev,
        sitemap: {
          ...prev.sitemap,
          nodes: updatedNodes,
        },
      }
    })
  }, [siteDefinition])

  // Build site definition from current state
  const buildSiteDefinitionFromState = useCallback((): SiteDefinition | null => {
    if (!siteDefinition) return null

    const currentNodes = getNodes()
    const currentEdges = getEdges()

    // Update node positions from ReactFlow state
    const updatedSitemapNodes = siteDefinition.sitemap.nodes.map((node) => {
      const reactFlowNode = currentNodes.find((n) => n.id === node.id)
      return reactFlowNode
        ? { ...node, position: reactFlowNode.position }
        : node
    })

    // Convert edges back to sitemap format
    const updatedEdges = currentEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: (edge.animated ? 'collection-link' : 'parent-child') as 'parent-child' | 'collection-link',
    }))

    return {
      ...siteDefinition,
      sitemap: {
        ...siteDefinition.sitemap,
        nodes: updatedSitemapNodes,
        edges: updatedEdges,
      },
      updatedAt: new Date().toISOString(),
    }
  }, [siteDefinition, getNodes, getEdges])

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

  // Get selected item data
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
  const addPageNode = useCallback((typeId: string, position?: { x: number; y: number }) => {
    if (!siteDefinition) return

    const newId = `page-${Date.now()}`
    const newNode: SitemapNodeType = {
      id: newId,
      type: typeId,
      position: position ?? { x: 400, y: 300 },
      data: {
        slug: `new-page-${Date.now()}`,
        status: 'draft',
      },
    }

    setSiteDefinition((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        sitemap: {
          ...prev.sitemap,
          nodes: [...prev.sitemap.nodes, newNode],
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
            position: { x: 400, y: 100 },
            data: {
              slug: '/',
              title: 'Home',
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
    return (
      <PageEditor
        pageId={editingPage.nodeId}
        pageTitle={editingPage.pageTitle}
        websiteId={websiteId}
        initialSections={editingPage.sections}
        onBack={handleExitPageEditor}
        onSave={handleSavePageSections}
      />
    )
  }

  return (
    <div className="flex h-full">
      {/* Left: Node Palette */}
      <NodePalette
        types={typesMap}
        onAddPage={addPageNode}
        onSelectType={(typeId) => setSelection({ type: 'contentType', typeId })}
      />

      {/* Center: ReactFlow Canvas */}
      <div className="flex-1 h-full relative">
        {/* Loading overlay when loading sections */}
        {isLoadingSections && (
          <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 z-50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading page sections...</span>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          className="bg-slate-50 dark:bg-slate-900"
        >
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              const data = node.data as { nodeType?: string; contentType?: ContentType }
              if (data.nodeType && isCollectionNode(data.nodeType)) {
                // Template collections (with pageStructure) show as purple
                if (hasPageStructure(data.contentType)) return '#9333ea'
                // Regular collections show as orange
                return '#f97316'
              }
              return '#3b82f6'
            }}
          />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />

          {/* Top Panel: Save Status */}
          <Panel position="top-right" className="flex items-center gap-2">
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
          </Panel>
        </ReactFlow>
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

export function SiteEditor(props: SiteEditorProps) {
  return (
    <ReactFlowProvider>
      <SiteEditorInner {...props} />
    </ReactFlowProvider>
  )
}
