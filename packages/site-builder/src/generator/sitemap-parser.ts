/**
 * Sitemap Parser
 * Parses sitemap.json from GitHub repository and builds a page tree
 * with navigation context (breadcrumbs, siblings, children)
 */

import type { GitHubContentService } from '@swarm-press/github-integration'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Raw sitemap node as defined in sitemap.yaml
 */
export interface SitemapNodeRaw {
  slug: string
  title: string
  titles?: Record<string, string>  // Translated titles by language code
  page_file: string
  in_nav?: boolean
  nav_order?: number
  collection?: string  // If set, auto-generate child pages from this collection
  children?: SitemapNodeRaw[]
  // SEO overrides
  seo_title?: string
  seo_description?: string
  priority?: number
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
}

/**
 * Processed sitemap node with computed navigation context
 */
export interface SitemapNode {
  slug: string
  path: string  // Full URL path (e.g., /villages/monterosso/)
  title: string
  titles: Record<string, string>  // All language titles
  breadcrumb_title?: string  // Short title for breadcrumbs (optional)
  breadcrumb_titles?: Record<string, string>  // Translated breadcrumb titles
  page_file: string
  in_nav: boolean
  nav_order: number
  collection?: string
  children: SitemapNode[]
  // Computed fields
  parent?: SitemapNode
  depth: number
  breadcrumb: Array<{ slug: string; path: string; title: string; titles: Record<string, string> }>
  ancestors: SitemapNode[]  // Parent chain from root to parent (not including self)
  siblings: SitemapNode[]
  prevSibling?: SitemapNode
  nextSibling?: SitemapNode
  // SEO
  seo_title?: string
  seo_description?: string
  priority: number
  changefreq: string
}

/**
 * Footer navigation link
 */
export interface FooterNavLink {
  title: string
  url: string
  titles?: Record<string, string>
}

/**
 * Footer navigation section (group of links)
 */
export interface FooterNavItem {
  title: string
  titles?: Record<string, string>
  links: FooterNavLink[]
}

/**
 * Site configuration from sitemap.json
 */
export interface SiteConfig {
  name: string  // Site name (used in nav, footer)
  title: string  // Full site title (used in <title> tag)
  tagline?: string  // Site tagline/description
  logo?: string  // Logo URL
  titles?: Record<string, string>
  base_url: string
  default_language: string
  languages: string[]
}

/**
 * SEO sitemap.xml settings
 */
export interface SitemapXmlConfig {
  changefreq_default: string
  priority_default: number
  exclude_patterns: string[]
}

/**
 * Raw sitemap as defined in sitemap.json
 */
export interface SitemapJson {
  site: SiteConfig
  pages: SitemapNodeRaw[]
  footer_nav?: FooterNavItem[]
  sitemap_xml?: SitemapXmlConfig
}

/**
 * Fully parsed sitemap with all computed navigation
 */
export interface ParsedSitemap {
  site: SiteConfig
  pages: SitemapNode[]           // Flat list with parent references
  tree: SitemapNode[]            // Hierarchical tree (root nodes)
  navItems: SitemapNode[]        // Only pages with in_nav: true (for main menu)
  footerNav: FooterNavItem[]
  sitemapXmlConfig: SitemapXmlConfig
  pageMap: Map<string, SitemapNode>  // Map from path to node for quick lookups
  // Lookup helpers
  getBySlug: (slug: string) => SitemapNode | undefined
  getByPath: (path: string) => SitemapNode | undefined
  getByPageFile: (pageFile: string) => SitemapNode | undefined
}

// =============================================================================
// PARSING FUNCTIONS
// =============================================================================

/**
 * Parse sitemap.json content into a fully processed sitemap
 */
export function parseSitemap(jsonContent: string): ParsedSitemap {
  const raw = JSON.parse(jsonContent) as SitemapJson

  if (!raw.site) {
    throw new Error('sitemap.json must have a "site" section')
  }
  if (!raw.pages || !Array.isArray(raw.pages)) {
    throw new Error('sitemap.json must have a "pages" array')
  }

  // Default sitemap.xml config
  const sitemapXmlConfig: SitemapXmlConfig = {
    changefreq_default: raw.sitemap_xml?.changefreq_default || 'weekly',
    priority_default: raw.sitemap_xml?.priority_default || 0.5,
    exclude_patterns: raw.sitemap_xml?.exclude_patterns || [],
  }

  // Process pages recursively
  const pages: SitemapNode[] = []
  const tree: SitemapNode[] = []
  const slugMap = new Map<string, SitemapNode>()
  const pageFileMap = new Map<string, SitemapNode>()

  function processNode(
    raw: SitemapNodeRaw,
    parent: SitemapNode | undefined,
    depth: number,
    siblings: SitemapNodeRaw[]
  ): SitemapNode {
    // Build path from parent chain
    let path = ''
    const ancestors: SitemapNode[] = []
    let current = parent
    while (current) {
      ancestors.unshift(current)
      current = current.parent
    }
    // Build path: /parent1/parent2/slug/
    const pathParts = ancestors.map(a => a.slug)
    pathParts.push(raw.slug)
    path = raw.slug === 'index' || raw.slug === '' ? '/' : `/${pathParts.join('/')}/`

    // Build breadcrumb from ancestors
    const breadcrumb: SitemapNode['breadcrumb'] = ancestors.map(a => ({
      slug: a.slug,
      path: a.path,
      title: a.title,
      titles: a.titles,
    }))

    // Create node
    const node: SitemapNode = {
      slug: raw.slug,
      path,
      title: raw.title,
      titles: raw.titles || { en: raw.title },  // Default to English
      breadcrumb_title: raw.seo_title,  // Use SEO title as breadcrumb if provided
      page_file: raw.page_file,
      in_nav: raw.in_nav ?? true,  // Default to true
      nav_order: raw.nav_order ?? 0,
      collection: raw.collection,
      children: [],
      parent,
      depth,
      breadcrumb,
      ancestors,
      siblings: [],  // Will be populated after all siblings are processed
      seo_title: raw.seo_title,
      seo_description: raw.seo_description,
      priority: raw.priority ?? sitemapXmlConfig.priority_default,
      changefreq: raw.changefreq ?? sitemapXmlConfig.changefreq_default,
    }

    // Add to flat list and maps
    pages.push(node)
    slugMap.set(node.slug, node)
    pageFileMap.set(node.page_file, node)

    // Process children
    if (raw.children && raw.children.length > 0) {
      // Sort children by nav_order
      const sortedChildren = [...raw.children].sort((a, b) => (a.nav_order ?? 0) - (b.nav_order ?? 0))

      for (const childRaw of sortedChildren) {
        const childNode = processNode(childRaw, node, depth + 1, sortedChildren)
        node.children.push(childNode)
      }
    }

    return node
  }

  // Process root-level pages
  const sortedRootPages = [...raw.pages].sort((a, b) => (a.nav_order ?? 0) - (b.nav_order ?? 0))

  for (const pageRaw of sortedRootPages) {
    const node = processNode(pageRaw, undefined, 0, sortedRootPages)
    tree.push(node)
  }

  // Second pass: populate siblings and prev/next
  function populateSiblings(nodes: SitemapNode[]): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      node.siblings = nodes
      node.prevSibling = i > 0 ? nodes[i - 1] : undefined
      node.nextSibling = i < nodes.length - 1 ? nodes[i + 1] : undefined

      // Recurse to children
      if (node.children.length > 0) {
        populateSiblings(node.children)
      }
    }
  }
  populateSiblings(tree)

  // Build nav items (only pages with in_nav: true)
  const navItems = pages.filter(p => p.in_nav && p.depth <= 1)  // Top-level nav only

  // Build path map for quick lookups
  const pathMap = new Map<string, SitemapNode>()
  for (const page of pages) {
    pathMap.set(page.path, page)
  }

  // Footer nav - ensure links array exists
  const footerNav: FooterNavItem[] = (raw.footer_nav || []).map(section => ({
    title: section.title,
    titles: section.titles,
    links: section.links || [],
  }))

  // Ensure site has required fields
  const site: SiteConfig = {
    name: raw.site.name || raw.site.title,
    title: raw.site.title,
    tagline: raw.site.tagline,
    logo: raw.site.logo,
    titles: raw.site.titles,
    base_url: raw.site.base_url,
    default_language: raw.site.default_language || 'en',
    languages: raw.site.languages || ['en'],
  }

  return {
    site,
    pages,
    tree,
    navItems,
    footerNav,
    sitemapXmlConfig,
    pageMap: pathMap,
    getBySlug: (slug: string) => slugMap.get(slug),
    getByPath: (path: string) => pathMap.get(path),
    getByPageFile: (pageFile: string) => pageFileMap.get(pageFile),
  }
}

/**
 * Load sitemap.json from GitHub repository
 */
export async function loadSitemapFromGitHub(
  contentService: GitHubContentService
): Promise<ParsedSitemap> {
  const sitemapPath = 'content/sitemap.json'

  try {
    const content = await contentService.getFileContent(sitemapPath)
    if (!content) {
      throw new Error(`sitemap.json not found at ${sitemapPath}`)
    }
    return parseSitemap(content)
  } catch (error) {
    console.warn(`[SitemapParser] Could not load sitemap.json: ${error}`)
    throw new Error(`Failed to load sitemap.json from GitHub: ${error}`)
  }
}

// =============================================================================
// NAVIGATION HELPERS
// =============================================================================

/**
 * Get localized title for a node
 */
export function getLocalizedTitle(node: SitemapNode, lang: string): string {
  return node.titles[lang] || node.title
}

/**
 * Get localized breadcrumb title for a single node (shorter version for breadcrumbs)
 * Returns breadcrumb_title if set, otherwise falls back to title
 */
export function getLocalizedBreadcrumb(node: SitemapNode, lang: string): string {
  // First try breadcrumb-specific titles
  if (node.breadcrumb_titles && node.breadcrumb_titles[lang]) {
    return node.breadcrumb_titles[lang]
  }
  // Fall back to breadcrumb_title or regular title
  return node.breadcrumb_title || node.titles[lang] || node.title
}

/**
 * Get full localized breadcrumb trail for a node
 */
export function getLocalizedBreadcrumbTrail(
  node: SitemapNode,
  lang: string
): Array<{ path: string; title: string }> {
  return node.breadcrumb.map(b => ({
    path: b.path,
    title: b.titles[lang] || b.title,
  }))
}

/**
 * Get all pages that have a specific collection
 * (for linking collection pages to their parent sitemap nodes)
 */
export function getCollectionPages(sitemap: ParsedSitemap, collectionType: string): SitemapNode[] {
  return sitemap.pages.filter(p => p.collection === collectionType)
}

/**
 * Build flat list of all slugs for a given language
 */
export function getAllSlugsForLanguage(sitemap: ParsedSitemap, lang: string): string[] {
  return sitemap.pages.map(p => `/${lang}${p.slug}`)
}

// =============================================================================
// SITEMAP.XML GENERATION
// =============================================================================

/**
 * Generate sitemap.xml content
 */
export function generateSitemapXml(
  sitemap: ParsedSitemap,
  includeCollectionItems?: Array<{ slug: string; lastmod?: string }>
): string {
  const { site, pages, sitemapXmlConfig } = sitemap
  const urls: string[] = []

  // Check if URL should be excluded
  const shouldExclude = (slug: string): boolean => {
    return sitemapXmlConfig.exclude_patterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'))
      return regex.test(slug)
    })
  }

  // Add pages (use path which already includes the full URL path)
  for (const page of pages) {
    if (shouldExclude(page.path)) continue

    // For multi-language sites, add hreflang alternates
    let alternates = ''
    if (site.languages.length > 1) {
      alternates = site.languages
        .map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${site.base_url}/${l}${page.path}" />`)
        .join('\n') + '\n'
    }

    urls.push(`  <url>
    <loc>${site.base_url}${page.path}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
${alternates}  </url>`)
  }

  // Add collection items if provided
  if (includeCollectionItems) {
    for (const item of includeCollectionItems) {
      if (shouldExclude(item.slug)) continue

      urls.push(`  <url>
    <loc>${site.base_url}${item.slug}</loc>
    <lastmod>${item.lastmod || new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`)
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate sitemap structure
 */
export function validateSitemap(sitemap: ParsedSitemap): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check required site fields
  if (!sitemap.site.title) {
    errors.push('site.title is required')
  }
  if (!sitemap.site.base_url) {
    errors.push('site.base_url is required')
  }
  if (!sitemap.site.default_language) {
    errors.push('site.default_language is required')
  }
  if (!sitemap.site.languages || sitemap.site.languages.length === 0) {
    errors.push('site.languages must have at least one language')
  }

  // Check for duplicate slugs
  const slugs = new Set<string>()
  for (const page of sitemap.pages) {
    if (slugs.has(page.slug)) {
      errors.push(`Duplicate slug: ${page.slug}`)
    }
    slugs.add(page.slug)
  }

  // Check for duplicate page_files
  const pageFiles = new Set<string>()
  for (const page of sitemap.pages) {
    if (pageFiles.has(page.page_file)) {
      errors.push(`Duplicate page_file: ${page.page_file}`)
    }
    pageFiles.add(page.page_file)
  }

  // Check that default_language is in languages array
  if (!sitemap.site.languages.includes(sitemap.site.default_language)) {
    errors.push(`default_language "${sitemap.site.default_language}" must be in languages array`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
