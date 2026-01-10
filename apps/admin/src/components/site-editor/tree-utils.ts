import type { SitemapNode, SitemapEdge, LocalizedString, ContentType } from '@swarm-press/shared'
import { getLocalizedValue, isCollectionNode } from '@swarm-press/shared'

/**
 * Tree node structure for the page hierarchy
 */
export interface TreeNode {
  id: string
  node: SitemapNode
  children: TreeNode[]
  depth: number
  url: string
  parentId: string | null
}

/**
 * Build parent-child map from edges
 */
function buildParentMap(edges: SitemapEdge[]): Map<string, string> {
  const parentMap = new Map<string, string>()
  edges
    .filter(e => e.type === 'parent-child')
    .forEach(e => {
      parentMap.set(e.target, e.source)
    })
  return parentMap
}

/**
 * Build children map from edges
 */
function buildChildrenMap(edges: SitemapEdge[]): Map<string, string[]> {
  const childrenMap = new Map<string, string[]>()
  edges
    .filter(e => e.type === 'parent-child')
    .forEach(e => {
      if (!childrenMap.has(e.source)) {
        childrenMap.set(e.source, [])
      }
      childrenMap.get(e.source)!.push(e.target)
    })
  return childrenMap
}

/**
 * Build a tree structure from flat sitemap nodes and edges
 * Filters out collection nodes - only includes page nodes
 */
export function buildPageTree(
  nodes: SitemapNode[],
  edges: SitemapEdge[],
  locale: string = 'en'
): TreeNode[] {
  // Filter to only page nodes (not collections)
  const pageNodes = nodes.filter(n => !isCollectionNode(n.type))
  const nodeMap = new Map(pageNodes.map(n => [n.id, n]))

  // Build parent-child relationships from edges
  const parentMap = buildParentMap(edges)
  const childrenMap = buildChildrenMap(edges)

  // Find root nodes (nodes without parents)
  const rootNodeIds = pageNodes
    .filter(n => !parentMap.has(n.id))
    .map(n => n.id)

  // Sort nodes by position.y (vertical position in the old graph)
  const sortNodes = (nodeIds: string[]): string[] => {
    return nodeIds.sort((a, b) => {
      const nodeA = nodeMap.get(a)
      const nodeB = nodeMap.get(b)
      const posA = nodeA?.position?.y ?? 0
      const posB = nodeB?.position?.y ?? 0
      return posA - posB
    })
  }

  // Recursively build tree node
  function buildNode(nodeId: string, depth: number, parentUrl: string): TreeNode | null {
    const node = nodeMap.get(nodeId)
    if (!node) return null

    const slug = getLocalizedValue(node.data?.slug as LocalizedString, locale) || ''
    const url = computeUrl(slug, parentUrl)
    const parentId = parentMap.get(nodeId) ?? null

    const childIds = childrenMap.get(nodeId) || []
    const sortedChildIds = sortNodes(childIds)

    const children = sortedChildIds
      .map(childId => buildNode(childId, depth + 1, url))
      .filter((child): child is TreeNode => child !== null)

    return {
      id: node.id,
      node,
      children,
      depth,
      url,
      parentId,
    }
  }

  // Build tree from roots
  const sortedRoots = sortNodes(rootNodeIds)
  return sortedRoots
    .map(rootId => buildNode(rootId, 0, ''))
    .filter((node): node is TreeNode => node !== null)
}

/**
 * Compute full URL from slug and parent URL
 */
export function computeUrl(slug: string, parentUrl: string): string {
  if (slug === '/' || slug === '') {
    return parentUrl || '/'
  }
  if (!parentUrl || parentUrl === '/') {
    return `/${slug}`
  }
  return `${parentUrl}/${slug}`.replace(/\/+/g, '/')
}

/**
 * Get translation status for a localized string
 */
export function getTranslationStatus(
  value: LocalizedString | undefined,
  locales: string[]
): { filled: string[]; missing: string[] } {
  if (!locales || locales.length === 0) return { filled: [], missing: [] }

  const normalizedValue: Record<string, unknown> =
    typeof value === 'string' ? { en: value } : value || {}

  const hasContent = (locale: string): boolean => {
    const v = normalizedValue[locale]
    return typeof v === 'string' && v.trim() !== ''
  }

  const filled = locales.filter(hasContent)
  const missing = locales.filter(l => !hasContent(l))

  return { filled, missing }
}

/**
 * Flatten tree to array (for search/filter operations)
 */
export function flattenTree(tree: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []

  function traverse(nodes: TreeNode[]) {
    for (const node of nodes) {
      result.push(node)
      if (node.children.length > 0) {
        traverse(node.children)
      }
    }
  }

  traverse(tree)
  return result
}

/**
 * Filter tree by search query (matches title or slug)
 * Returns a new tree with only matching nodes and their ancestors
 */
export function filterTree(
  tree: TreeNode[],
  query: string,
  locale: string = 'en'
): TreeNode[] {
  if (!query.trim()) return tree

  const lowerQuery = query.toLowerCase().trim()

  function nodeMatches(node: TreeNode): boolean {
    const title = getLocalizedValue(node.node.data?.title as LocalizedString, locale).toLowerCase()
    const slug = getLocalizedValue(node.node.data?.slug as LocalizedString, locale).toLowerCase()
    return title.includes(lowerQuery) || slug.includes(lowerQuery) || node.url.toLowerCase().includes(lowerQuery)
  }

  function filterNode(node: TreeNode): TreeNode | null {
    // Filter children first
    const filteredChildren = node.children
      .map(filterNode)
      .filter((child): child is TreeNode => child !== null)

    // Include node if it matches or has matching descendants
    if (nodeMatches(node) || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      }
    }

    return null
  }

  return tree
    .map(filterNode)
    .filter((node): node is TreeNode => node !== null)
}

/**
 * Get all node IDs in a tree (for expand all)
 */
export function getAllNodeIds(tree: TreeNode[]): Set<string> {
  const ids = new Set<string>()

  function traverse(nodes: TreeNode[]) {
    for (const node of nodes) {
      ids.add(node.id)
      traverse(node.children)
    }
  }

  traverse(tree)
  return ids
}

/**
 * Get ancestor IDs for a node (for auto-expanding to a search result)
 */
export function getAncestorIds(
  nodeId: string,
  edges: SitemapEdge[]
): string[] {
  const parentMap = buildParentMap(edges)
  const ancestors: string[] = []

  let currentId: string | undefined = parentMap.get(nodeId)
  while (currentId) {
    ancestors.push(currentId)
    currentId = parentMap.get(currentId)
  }

  return ancestors
}

/**
 * Status colors for page nodes
 */
export const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  in_review: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  approved: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  published: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  archived: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400' },
}

/**
 * Get status display info
 */
export function getStatusInfo(status: string): { label: string; color: typeof statusColors[string] } {
  const labels: Record<string, string> = {
    draft: 'Draft',
    in_progress: 'In Progress',
    in_review: 'In Review',
    approved: 'Approved',
    published: 'Published',
    archived: 'Archived',
  }

  return {
    label: labels[status] || status,
    color: statusColors[status] || statusColors.draft,
  }
}
