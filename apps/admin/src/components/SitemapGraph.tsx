/**
 * SitemapGraph Component
 * React Flow-based visual sitemap editor with advanced features
 */

import React, { useCallback, useEffect, useState, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  addEdge,
  Panel,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import PageNode from './sitemap/PageNode'
import ClusterNode from './sitemap/ClusterNode'
import SitemapControls from './sitemap/SitemapControls'
import {
  buildGraphFromPages,
  applyAutoLayout,
  applyCircularLayout,
  applyForceLayout,
  type PageNodeData,
  type ClusterNodeData,
} from './sitemap/graphUtils'

// Define custom node types
const nodeTypes = {
  page: PageNode,
  cluster: ClusterNode,
}

// History entry for undo/redo
interface HistoryEntry {
  nodes: Node[]
  edges: Edge[]
}

function SitemapGraphInner() {
  const reactFlowInstance = useReactFlow()

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [websiteId, setWebsiteId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [showClusters, setShowClusters] = useState(true)

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [filterPageType, setFilterPageType] = useState<string | null>(null)

  // Undo/redo state
  // Audit item 23: history and historyIndex are mirrored into refs so the
  // keyboard handler (and async callbacks) can read the current values without
  // re-registering listeners on every history change. State is still used so
  // React renders the toolbar's canUndo/canRedo flags correctly.
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const historyRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(-1)
  const isApplyingHistory = useRef(false)

  // Helper to update both state and ref in sync
  const updateHistory = useCallback(
    (next: HistoryEntry[], nextIndex: number) => {
      historyRef.current = next
      historyIndexRef.current = nextIndex
      setHistory(next)
      setHistoryIndex(nextIndex)
    },
    []
  )

  // Save to history (reads from refs so it doesn't need to re-bind on history changes)
  const saveToHistory = useCallback((nodes: Node[], edges: Edge[]) => {
    if (isApplyingHistory.current) return

    const prev = historyRef.current
    const idx = historyIndexRef.current
    const newHistory = prev.slice(0, idx + 1)
    newHistory.push({ nodes: [...nodes], edges: [...edges] })
    // Keep only last 50 entries
    if (newHistory.length > 50) newHistory.shift()
    const newIndex = Math.min(idx + 1, 49)
    updateHistory(newHistory, newIndex)
  }, [updateHistory])

  // Undo
  const handleUndo = useCallback(() => {
    const idx = historyIndexRef.current
    const hist = historyRef.current
    if (idx <= 0) return

    isApplyingHistory.current = true
    const entry = hist[idx - 1]
    setNodes(entry.nodes)
    setEdges(entry.edges)
    historyIndexRef.current = idx - 1
    setHistoryIndex(idx - 1)

    setTimeout(() => {
      isApplyingHistory.current = false
    }, 100)
  }, [])

  // Redo
  const handleRedo = useCallback(() => {
    const idx = historyIndexRef.current
    const hist = historyRef.current
    if (idx >= hist.length - 1) return

    isApplyingHistory.current = true
    const entry = hist[idx + 1]
    setNodes(entry.nodes)
    setEdges(entry.edges)
    historyIndexRef.current = idx + 1
    setHistoryIndex(idx + 1)

    setTimeout(() => {
      isApplyingHistory.current = false
    }, 100)
  }, [])

  // Keyboard shortcuts
  // handleUndo/handleRedo are stable (empty deps) now that they read from
  // refs, so this listener is registered once per component mount.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z or Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
      // Redo: Ctrl+Y or Cmd+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        handleRedo()
      }
      // Fit view: Ctrl+F or Cmd+F
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        reactFlowInstance.fitView({ padding: 0.2 })
      }
      // Delete selected nodes: Delete or Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNode && document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault()
          setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id))
          setSelectedNode(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo, selectedNode, reactFlowInstance])

  // Handle node changes (drag, select, etc.)
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const newNodes = applyNodeChanges(changes, nds)

        // Save position changes to backend
        const positionChanges = changes.filter(
          (change) => change.type === 'position' && change.dragging === false
        )

        if (positionChanges.length > 0 && websiteId) {
          saveBulkPositions(positionChanges)
          saveToHistory(newNodes, edges)
        }

        return newNodes
      })
    },
    [websiteId, edges, saveToHistory]
  )

  // Handle edge changes
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        const newEdges = applyEdgeChanges(changes, eds)
        return newEdges
      })
    },
    []
  )

  // Handle new connections (creating links between pages)
  // Audit item 24: link creation is not yet supported by the backend.
  // We accept the visual edge in the local graph but no longer pretend to
  // persist it via createInternalLink (which was a TODO no-op). The
  // connection affordance stays available for layout previewing only.
  // TODO: enable when backend supports link creation
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        const newEdges = addEdge(connection, eds)
        saveToHistory(nodes, newEdges)
        return newEdges
      })
    },
    [nodes, saveToHistory]
  )

  // Handle node selection
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
  }, [])

  // Handle pane click (deselect)
  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  // Load sitemap data for selected website
  async function loadSitemap(websiteId: string) {
    setIsLoading(true)
    try {
      // Fetch pages
      const pagesResponse = await fetch(
        `/api/trpc/sitemap.listByWebsite?input=${encodeURIComponent(JSON.stringify({ websiteId }))}`
      )
      const pagesData = await pagesResponse.json()
      const pages = pagesData.result?.data?.items || []

      // Fetch graph positions
      const positionsResponse = await fetch(
        `/api/trpc/graphPosition.listByWebsite?input=${encodeURIComponent(JSON.stringify({ websiteId }))}`
      )
      const positionsData = await positionsResponse.json()
      const positions = positionsData.result?.data?.items || []

      // Build graph structure
      const graph = buildGraphFromPages(pages, positions)
      setNodes(graph.nodes)
      setEdges(graph.edges)

      // Initialize history (sync ref + state — see audit item 23)
      updateHistory([{ nodes: graph.nodes, edges: graph.edges }], 0)
    } catch (error) {
      console.error('Failed to load sitemap:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Save node positions in bulk
  async function saveBulkPositions(changes: NodeChange[]) {
    if (!websiteId) return

    const positions = changes
      .filter((change) => change.type === 'position' && change.position)
      .map((change: any) => ({
        node_id: change.id,
        node_type: 'page',
        position_x: change.position.x,
        position_y: change.position.y,
      }))

    if (positions.length === 0) return

    try {
      await fetch('/api/trpc/graphPosition.bulkUpdate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: websiteId,
          positions,
        }),
      })
    } catch (error) {
      console.error('Failed to save positions:', error)
    }
  }

  // Create internal link between pages
  // Audit item 24: removed the previous console.log no-op so callers don't
  // assume the link was persisted. Re-introduce when the backend supports it.
  // TODO: enable when backend supports link creation
  // async function createInternalLink(sourceId: string, targetId: string) {
  //   await fetch('/api/trpc/internalLink.create', { ... })
  // }

  // Apply layout algorithm
  const handleLayoutChange = useCallback(
    (layout: 'dagre' | 'circular' | 'force') => {
      let layoutedNodes: Node[] = []

      if (layout === 'dagre') {
        layoutedNodes = applyAutoLayout(nodes, edges)
      } else if (layout === 'circular') {
        layoutedNodes = applyCircularLayout(nodes)
      } else if (layout === 'force') {
        layoutedNodes = applyForceLayout(nodes, edges)
      }

      setNodes(layoutedNodes)
      saveToHistory(layoutedNodes, edges)

      // Fit view after layout
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2, duration: 800 })
      }, 100)
    },
    [nodes, edges, saveToHistory, reactFlowInstance]
  )

  // Filter nodes based on search and filters
  const filteredNodes = nodes.filter((node) => {
    // Hide clusters if toggled off
    if (node.type === 'cluster' && !showClusters) return false

    if (node.type === 'page') {
      const data = node.data as PageNodeData

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (
          !data.title.toLowerCase().includes(query) &&
          !data.slug.toLowerCase().includes(query)
        ) {
          return false
        }
      }

      // Status filter
      if (filterStatus && data.status !== filterStatus) return false

      // Page type filter
      if (filterPageType && data.page_type !== filterPageType) return false
    }

    return true
  })

  // Filter edges based on visible nodes
  const filteredEdges = edges.filter(
    (edge) =>
      filteredNodes.some((n) => n.id === edge.source) &&
      filteredNodes.some((n) => n.id === edge.target)
  )

  // Listen for website selection changes
  useEffect(() => {
    const handleWebsiteSelected = (event: CustomEvent) => {
      const { websiteId } = event.detail
      setWebsiteId(websiteId)
      loadSitemap(websiteId)
    }

    window.addEventListener('website-selected', handleWebsiteSelected as EventListener)
    return () => {
      window.removeEventListener('website-selected', handleWebsiteSelected as EventListener)
    }
  }, [])

  const selectedCount = filteredNodes.filter((n) => n.selected).length

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={filteredNodes}
        edges={filteredEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        }}
      >
        <Background color="#cbd5e1" gap={16} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
          style={{
            backgroundColor: '#f1f5f9',
            border: '1px solid #cbd5e1',
          }}
        />

        {/* Left Control Panel */}
        <Panel position="top-left" className="m-4" style={{ width: '300px' }}>
          <SitemapControls
            onSearch={setSearchQuery}
            onFilterStatus={setFilterStatus}
            onFilterPageType={setFilterPageType}
            onLayoutChange={handleLayoutChange}
            onToggleClusters={setShowClusters}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            nodeCount={nodes.filter((n) => n.type === 'page').length}
            selectedCount={selectedCount}
            websiteId={websiteId || undefined}
            onAddPage={() => websiteId && loadSitemap(websiteId)}
          />
        </Panel>

        {/* Node Inspector Panel */}
        {selectedNode && (
          <Panel position="top-right" className="bg-white rounded-lg shadow-md p-4 m-4 max-w-sm">
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-semibold text-gray-900">Page Details</h3>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-700">Title:</span>{' '}
                <span className="text-gray-900">{(selectedNode.data as PageNodeData).title}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Slug:</span>{' '}
                <span className="text-gray-600 font-mono text-xs">
                  {(selectedNode.data as PageNodeData).slug}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Status:</span>{' '}
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    (selectedNode.data as PageNodeData).status === 'published'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}
                >
                  {(selectedNode.data as PageNodeData).status}
                </span>
              </div>
              <div className="pt-2 border-t">
                <button className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
                  Edit Page
                </button>
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Loading overlay */}
      {isLoading && filteredNodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-600">Loading sitemap...</p>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts help */}
      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-md px-3 py-2 text-xs text-gray-600">
        <div className="font-medium mb-1">Keyboard Shortcuts:</div>
        <div>Ctrl+Z: Undo • Ctrl+Y: Redo • Ctrl+F: Fit View • Del: Delete</div>
      </div>
    </div>
  )
}

// Wrapper with ReactFlowProvider
export default function SitemapGraph() {
  return (
    <div className="w-full h-full">
      <ReactFlowProvider>
        <SitemapGraphInner />
      </ReactFlowProvider>
    </div>
  )
}
