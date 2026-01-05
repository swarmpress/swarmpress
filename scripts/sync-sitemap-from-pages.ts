#!/usr/bin/env npx tsx
/**
 * Sync Sitemap from Pages
 *
 * Reads all page JSON files and generates complete sitemap.nodes for site.json
 * Also updates the theme to Black Tomato
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const CONTENT_DIR = join(__dirname, '../cinqueterre.travel/content')
const PAGES_DIR = join(CONTENT_DIR, 'pages')
const SITE_JSON_PATH = join(CONTENT_DIR, 'site.json')

// Black Tomato Theme Configuration
const BLACK_TOMATO_THEME = {
  name: "Black Tomato",
  extends: "black-tomato",
  mode: "light",
  colors: {
    primary: {
      "50": "#f0fdfa",
      "100": "#ccfbf1",
      "200": "#99f6e4",
      "300": "#5eead4",
      "400": "#2dd4bf",
      "500": "#14b8a6",
      "600": "#0d9488",
      "700": "#0f766e",
      "800": "#115e59",
      "900": "#134e4a"
    },
    secondary: {
      "50": "#f8fafc",
      "100": "#f1f5f9",
      "200": "#e2e8f0",
      "300": "#cbd5e1",
      "400": "#94a3b8",
      "500": "#64748b",
      "600": "#475569",
      "700": "#334155",
      "800": "#1e293b",
      "900": "#0f172a"
    },
    accent: "#0d9488",
    background: "#ffffff",
    foreground: "#0a1628",
    muted: "#64748b"
  },
  fonts: {
    display: "Cormorant Garamond, Georgia, serif",
    sans: "Inter, system-ui, -apple-system, sans-serif",
    mono: "JetBrains Mono, monospace"
  },
  borderRadius: "0.5rem",
  shadows: "md",
  semanticColors: {
    background: "#ffffff",
    backgroundAlt: "#fafaf9",
    surface: "#ffffff",
    foreground: "#0a1628",
    foregroundMuted: "#64748b",
    border: "#e5e7eb",
    brand: "#0d9488",
    brandForeground: "#ffffff",
    accent: "#0d9488",
    accentForeground: "#ffffff"
  },
  gradients: {
    hero: "linear-gradient(180deg, rgba(10,22,40,0.6) 0%, rgba(10,22,40,0.3) 100%)",
    card: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(10,22,40,0.7) 100%)",
    overlay: "linear-gradient(180deg, transparent 0%, rgba(10,22,40,0.5) 100%)"
  },
  overlays: {
    dark: "rgba(10,22,40,0.5)",
    light: "rgba(255,255,255,0.9)",
    brand: "rgba(13,148,136,0.1)"
  }
}

interface SitemapNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    slug: string
    title: { en: string; de?: string }
    status: string
    parentId?: string
  }
}

interface PageData {
  title?: string
  seo?: { title?: string }
  [key: string]: unknown
}

function discoverPages(dir: string, basePath: string = ''): { path: string; slug: string }[] {
  const pages: { path: string; slug: string }[] = []
  const items = readdirSync(dir, { withFileTypes: true })

  for (const item of items) {
    const fullPath = join(dir, item.name)

    if (item.isDirectory()) {
      pages.push(...discoverPages(fullPath, basePath ? `${basePath}/${item.name}` : item.name))
    } else if (item.name.endsWith('.json')) {
      const slug = item.name.replace('.json', '')
      const pageSlug = basePath
        ? (slug === 'index' ? `/${basePath}` : `/${basePath}/${slug}`)
        : (slug === 'index' ? '/' : `/${slug}`)

      pages.push({ path: fullPath, slug: pageSlug })
    }
  }

  return pages
}

function getPageType(slug: string): string {
  if (slug === '/') return 'landing-page'

  const parts = slug.split('/').filter(Boolean)
  const lastPart = parts[parts.length - 1]

  // Village main pages
  const villages = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']
  if (parts.length === 1 && villages.includes(lastPart)) {
    return 'village-guide'
  }

  // Topic pages
  const topicTypes = ['restaurants', 'hotels', 'hiking', 'beaches', 'events', 'weather', 'getting-here', 'sights', 'boat-tours', 'camping', 'apartments', 'agriturismi', 'overview', 'faq', 'blog', 'insights', 'maps', 'things-to-do']
  if (topicTypes.includes(lastPart)) {
    return 'topic-page'
  }

  return 'topic-page'
}

function getParentId(slug: string): string | undefined {
  if (slug === '/') return undefined

  const parts = slug.split('/').filter(Boolean)

  if (parts.length === 1) {
    // Top-level pages (villages, cinque-terre, etc.)
    return 'home'
  }

  if (parts.length === 2) {
    // Sub-pages like /monterosso/restaurants
    return parts[0]  // Parent is the village
  }

  return undefined
}

function generateNodeId(slug: string): string {
  if (slug === '/') return 'home'
  return slug.replace(/^\//, '').replace(/\//g, '-')
}

function getPageTitle(pageData: PageData, slug: string): string {
  if (pageData.title) return pageData.title
  if (pageData.seo?.title) return pageData.seo.title

  // Generate title from slug
  const parts = slug.split('/').filter(Boolean)
  const lastPart = parts[parts.length - 1] || 'Home'
  return lastPart.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function main() {
  console.log('═'.repeat(60))
  console.log('  Sync Sitemap from Pages')
  console.log('═'.repeat(60))

  // Read current site.json
  const siteJson = JSON.parse(readFileSync(SITE_JSON_PATH, 'utf-8'))

  // Discover all pages
  console.log('\n📄 Discovering pages...')
  const pages = discoverPages(PAGES_DIR)
  console.log(`   Found ${pages.length} pages`)

  // Generate sitemap nodes
  console.log('\n🗺️  Generating sitemap nodes...')
  const nodes: SitemapNode[] = []
  const edges: { id: string; source: string; target: string; type: string }[] = []

  // Grid layout configuration
  const GRID = {
    startX: 100,
    startY: 100,
    colWidth: 200,
    rowHeight: 100
  }

  // Group pages by parent
  const pagesByParent: Map<string, typeof pages> = new Map()

  for (const page of pages) {
    const parentId = getParentId(page.slug) || 'root'
    if (!pagesByParent.has(parentId)) {
      pagesByParent.set(parentId, [])
    }
    pagesByParent.get(parentId)!.push(page)
  }

  let row = 0
  let col = 0

  // Process pages level by level
  const processedIds = new Set<string>()

  // Level 0: Root pages (home, cinque-terre, villages)
  const rootPages = pagesByParent.get('root') || []
  for (const page of rootPages) {
    const nodeId = generateNodeId(page.slug)
    if (processedIds.has(nodeId)) continue
    processedIds.add(nodeId)

    try {
      const pageData = JSON.parse(readFileSync(page.path, 'utf-8')) as PageData
      const title = getPageTitle(pageData, page.slug)

      nodes.push({
        id: nodeId,
        type: getPageType(page.slug),
        position: { x: GRID.startX + col * GRID.colWidth, y: GRID.startY },
        data: {
          slug: page.slug,
          title: { en: title },
          status: 'published'
        }
      })
      col++
    } catch (e) {
      console.error(`   ❌ Error reading ${page.path}: ${e}`)
    }
  }

  // Level 1: Pages with home as parent
  row = 1
  col = 0
  const homeChildren = pagesByParent.get('home') || []
  for (const page of homeChildren) {
    const nodeId = generateNodeId(page.slug)
    if (processedIds.has(nodeId)) continue
    processedIds.add(nodeId)

    try {
      const pageData = JSON.parse(readFileSync(page.path, 'utf-8')) as PageData
      const title = getPageTitle(pageData, page.slug)

      nodes.push({
        id: nodeId,
        type: getPageType(page.slug),
        position: { x: GRID.startX + col * GRID.colWidth, y: GRID.startY + row * GRID.rowHeight },
        data: {
          slug: page.slug,
          title: { en: title },
          status: 'published',
          parentId: 'home'
        }
      })

      edges.push({
        id: `e-home-${nodeId}`,
        source: 'home',
        target: nodeId,
        type: 'parent-child'
      })

      col++
      if (col > 6) {
        col = 0
        row++
      }
    } catch (e) {
      console.error(`   ❌ Error reading ${page.path}: ${e}`)
    }
  }

  // Level 2+: Village subpages and cinque-terre subpages
  row++
  col = 0

  const villages = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore', 'cinque-terre']
  for (const village of villages) {
    const villagePages = pagesByParent.get(village) || []

    for (const page of villagePages) {
      const nodeId = generateNodeId(page.slug)
      if (processedIds.has(nodeId)) continue
      processedIds.add(nodeId)

      try {
        const pageData = JSON.parse(readFileSync(page.path, 'utf-8')) as PageData
        const title = getPageTitle(pageData, page.slug)

        nodes.push({
          id: nodeId,
          type: getPageType(page.slug),
          position: { x: GRID.startX + col * GRID.colWidth, y: GRID.startY + row * GRID.rowHeight },
          data: {
            slug: page.slug,
            title: { en: title },
            status: 'published',
            parentId: village
          }
        })

        edges.push({
          id: `e-${village}-${nodeId}`,
          source: village,
          target: nodeId,
          type: 'parent-child'
        })

        col++
        if (col > 6) {
          col = 0
          row++
        }
      } catch (e) {
        console.error(`   ❌ Error reading ${page.path}: ${e}`)
      }
    }
  }

  console.log(`   Generated ${nodes.length} nodes and ${edges.length} edges`)

  // Update site.json
  console.log('\n✏️  Updating site.json...')

  // Update theme to Black Tomato
  siteJson.theme = BLACK_TOMATO_THEME

  // Update sitemap
  siteJson.sitemap = {
    nodes,
    edges
  }

  // Update timestamp
  siteJson.updatedAt = new Date().toISOString()

  // Write updated site.json
  writeFileSync(SITE_JSON_PATH, JSON.stringify(siteJson, null, 2))

  console.log('\n' + '═'.repeat(60))
  console.log('  Sync Complete')
  console.log('═'.repeat(60))
  console.log(`\n   Theme: ${BLACK_TOMATO_THEME.name}`)
  console.log(`   Nodes: ${nodes.length}`)
  console.log(`   Edges: ${edges.length}`)
  console.log('\nNext steps:')
  console.log('  1. Update build-all-pages.js with Black Tomato theme')
  console.log('  2. node cinqueterre.travel/build-all-pages.js')
  console.log('  3. ./cinqueterre.travel/build-and-deploy.sh')
}

main()
