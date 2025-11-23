/**
 * Graph Utilities
 * Helper functions for converting data to React Flow format
 */

import type { Node, Edge } from '@xyflow/react'

// Type definitions for node data
export interface PageNodeData {
  id: string
  slug: string
  title: string
  page_type: string
  status: string
  priority: string
  freshness_score?: number
  alerts?: number
  tasks?: number
  page: any // Full page object
}

export interface ClusterNodeData {
  id: string
  name: string
  topics: string[]
  page_count: number
  primary_keyword?: string
}

export interface GraphPosition {
  id: string
  website_id: string
  node_id: string
  node_type: string
  position_x: number
  position_y: number
  collapsed: boolean
  hidden: boolean
}

export interface Page {
  id: string
  website_id: string
  slug: string
  title: string
  page_type: string
  status: string
  priority?: string
  parent_id?: string
  topics?: string[]
  seo_profile?: {
    primary_keyword?: string
    secondary_keywords?: string[]
    freshness_score?: number
  }
  internal_links?: {
    outgoing: Array<{ to: string; anchor: string }>
    incoming: Array<{ from: string; anchor: string }>
  }
  tasks?: any[]
  alerts?: any[]
}

/**
 * Build React Flow graph from pages and positions
 */
export function buildGraphFromPages(
  pages: Page[],
  positions: GraphPosition[]
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const positionMap = new Map<string, GraphPosition>()

  // Create position lookup map
  positions.forEach((pos) => {
    positionMap.set(`${pos.node_type}_${pos.node_id}`, pos)
  })

  // Convert pages to nodes
  pages.forEach((page, index) => {
    const posKey = `page_${page.id}`
    const savedPosition = positionMap.get(posKey)

    // Calculate default position if not saved
    const position = savedPosition
      ? { x: savedPosition.position_x, y: savedPosition.position_y }
      : calculateDefaultPosition(index, pages.length)

    const node: Node<PageNodeData> = {
      id: page.id,
      type: 'page',
      position,
      data: {
        id: page.id,
        slug: page.slug,
        title: page.title,
        page_type: page.page_type,
        status: page.status,
        priority: page.priority || 'medium',
        freshness_score: page.seo_profile?.freshness_score,
        alerts: page.alerts?.length,
        tasks: page.tasks?.length,
        page,
      },
    }

    nodes.push(node)
  })

  // Create edges for parent-child relationships
  pages.forEach((page) => {
    if (page.parent_id) {
      edges.push({
        id: `parent_${page.parent_id}_${page.id}`,
        source: page.parent_id,
        target: page.id,
        type: 'smoothstep',
        style: { stroke: '#3b82f6', strokeWidth: 2 },
        label: 'parent',
        labelStyle: { fontSize: 10, fill: '#6b7280' },
      })
    }
  })

  // Create edges for internal links
  pages.forEach((page) => {
    if (page.internal_links?.outgoing) {
      page.internal_links.outgoing.forEach((link) => {
        // Find target page by slug
        const targetPage = pages.find((p) => p.slug === link.to)
        if (targetPage) {
          edges.push({
            id: `link_${page.id}_${targetPage.id}`,
            source: page.id,
            target: targetPage.id,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#10b981', strokeWidth: 1, strokeDasharray: '5,5' },
            label: link.anchor,
            labelStyle: { fontSize: 9, fill: '#059669' },
          })
        }
      })
    }
  })

  // Group pages by topic clusters (optional enhancement)
  const clusters = extractTopicalClusters(pages)
  clusters.forEach((cluster, index) => {
    const clusterNode: Node<ClusterNodeData> = {
      id: `cluster_${index}`,
      type: 'cluster',
      position: { x: -300, y: index * 400 },
      data: {
        id: `cluster_${index}`,
        name: cluster.name,
        topics: cluster.topics,
        page_count: cluster.pageIds.length,
        primary_keyword: cluster.primary_keyword,
      },
    }
    nodes.push(clusterNode)

    // Create edges from cluster to pages
    cluster.pageIds.forEach((pageId) => {
      edges.push({
        id: `cluster_${index}_${pageId}`,
        source: `cluster_${index}`,
        target: pageId,
        type: 'smoothstep',
        style: { stroke: '#a855f7', strokeWidth: 1, opacity: 0.4 },
      })
    })
  })

  return { nodes, edges }
}

/**
 * Calculate default position for a node using a grid layout
 */
function calculateDefaultPosition(index: number, total: number): { x: number; y: number } {
  const columns = Math.ceil(Math.sqrt(total))
  const row = Math.floor(index / columns)
  const col = index % columns

  return {
    x: col * 350 + 50,
    y: row * 200 + 50,
  }
}

/**
 * Extract topical clusters from pages based on topics and keywords
 */
function extractTopicalClusters(pages: Page[]): Array<{
  name: string
  topics: string[]
  pageIds: string[]
  primary_keyword?: string
}> {
  const clusterMap = new Map<string, {
    topics: Set<string>
    pageIds: string[]
    keywords: string[]
  }>()

  // Group pages by primary keyword
  pages.forEach((page) => {
    const keyword = page.seo_profile?.primary_keyword
    if (keyword) {
      if (!clusterMap.has(keyword)) {
        clusterMap.set(keyword, {
          topics: new Set(),
          pageIds: [],
          keywords: [],
        })
      }
      const cluster = clusterMap.get(keyword)!
      cluster.pageIds.push(page.id)
      if (page.topics) {
        page.topics.forEach((topic) => cluster.topics.add(topic))
      }
      if (page.seo_profile?.secondary_keywords) {
        cluster.keywords.push(...page.seo_profile.secondary_keywords)
      }
    }
  })

  // Convert to array format
  const clusters: Array<{
    name: string
    topics: string[]
    pageIds: string[]
    primary_keyword?: string
  }> = []

  clusterMap.forEach((cluster, keyword) => {
    // Only create cluster if it has multiple pages
    if (cluster.pageIds.length > 1) {
      clusters.push({
        name: keyword.charAt(0).toUpperCase() + keyword.slice(1),
        topics: Array.from(cluster.topics),
        pageIds: cluster.pageIds,
        primary_keyword: keyword,
      })
    }
  })

  return clusters
}

/**
 * Apply auto-layout using dagre for hierarchical layout
 */
export function applyAutoLayout(nodes: Node[], edges: Edge[]): Node[] {
  // Dynamically import dagre (will be bundled)
  const dagre = require('dagre')

  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  // Configure graph layout
  dagreGraph.setGraph({
    rankdir: 'TB', // Top to bottom
    align: 'UL', // Upper left alignment
    nodesep: 100, // Horizontal spacing between nodes
    ranksep: 150, // Vertical spacing between ranks
    edgesep: 50, // Spacing between edges
    marginx: 50,
    marginy: 50,
  })

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    // Estimate node dimensions based on type
    const width = node.type === 'cluster' ? 300 : 250
    const height = node.type === 'cluster' ? 150 : 120

    dagreGraph.setNode(node.id, { width, height })
  })

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  // Run layout algorithm
  dagre.layout(dagreGraph)

  // Apply calculated positions
  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)

    return {
      ...node,
      position: {
        // Dagre positions are center-based, adjust to top-left
        x: nodeWithPosition.x - nodeWithPosition.width / 2,
        y: nodeWithPosition.y - nodeWithPosition.height / 2,
      },
    }
  })
}

/**
 * Apply circular layout for topical clusters
 */
export function applyCircularLayout(nodes: Node[], centerX = 0, centerY = 0, radius = 400): Node[] {
  const angleStep = (2 * Math.PI) / nodes.length

  return nodes.map((node, index) => {
    const angle = index * angleStep
    return {
      ...node,
      position: {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      },
    }
  })
}

/**
 * Apply force-directed layout (simple spring simulation)
 */
export function applyForceLayout(nodes: Node[], edges: Edge[], iterations = 100): Node[] {
  // Simple force-directed algorithm
  const positions = new Map(nodes.map(n => [n.id, { ...n.position }]))
  const velocities = new Map(nodes.map(n => [n.id, { x: 0, y: 0 }]))

  const k = 200 // Spring constant
  const repulsion = 50000 // Repulsion strength
  const damping = 0.8 // Velocity damping

  for (let iter = 0; iter < iterations; iter++) {
    // Reset forces
    const forces = new Map(nodes.map(n => [n.id, { x: 0, y: 0 }]))

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const pos1 = positions.get(nodes[i].id)!
        const pos2 = positions.get(nodes[j].id)!

        const dx = pos2.x - pos1.x
        const dy = pos2.y - pos1.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1

        const force = repulsion / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force

        const f1 = forces.get(nodes[i].id)!
        const f2 = forces.get(nodes[j].id)!

        f1.x -= fx
        f1.y -= fy
        f2.x += fx
        f2.y += fy
      }
    }

    // Attraction along edges
    edges.forEach(edge => {
      const pos1 = positions.get(edge.source)
      const pos2 = positions.get(edge.target)

      if (!pos1 || !pos2) return

      const dx = pos2.x - pos1.x
      const dy = pos2.y - pos1.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1

      const force = (dist - k) * 0.1
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force

      const f1 = forces.get(edge.source)
      const f2 = forces.get(edge.target)

      if (f1 && f2) {
        f1.x += fx
        f1.y += fy
        f2.x -= fx
        f2.y -= fy
      }
    })

    // Update velocities and positions
    nodes.forEach(node => {
      const vel = velocities.get(node.id)!
      const force = forces.get(node.id)!
      const pos = positions.get(node.id)!

      vel.x = (vel.x + force.x) * damping
      vel.y = (vel.y + force.y) * damping

      pos.x += vel.x
      pos.y += vel.y
    })
  }

  return nodes.map(node => ({
    ...node,
    position: positions.get(node.id)!
  }))
}
