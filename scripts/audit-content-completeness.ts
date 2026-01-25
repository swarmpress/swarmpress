#!/usr/bin/env npx tsx
/**
 * Content Completeness Audit
 * Checks for missing pages, broken internal links, and incomplete content
 */

import { readFile, readdir, stat } from 'fs/promises'
import { join, basename } from 'path'
import { existsSync } from 'fs'

const contentPath = process.argv[2] || 'cinqueterre.travel/content'
const resolvedPath = contentPath.startsWith('/') ? contentPath : join(process.cwd(), contentPath)

interface Issue {
  category: 'missing_page' | 'missing_blog' | 'orphan_page' | 'broken_internal_link' | 'missing_collection_page' | 'empty_content'
  severity: 'critical' | 'high' | 'medium' | 'low'
  file?: string
  description: string
  details?: Record<string, any>
}

const issues: Issue[] = []

// Collect all page files that exist
const existingPages = new Map<string, string>()
const existingBlogs = new Map<string, string>()

async function collectExistingFiles() {
  // Collect pages
  const pagesDir = join(resolvedPath, 'pages')
  await walkDir(pagesDir, (file) => {
    if (file.endsWith('.json')) {
      const slug = basename(file, '.json')
      existingPages.set(slug, file)
    }
  })

  // Collect blogs
  const blogDir = join(resolvedPath, 'blog')
  if (existsSync(blogDir)) {
    await walkDir(blogDir, (file) => {
      if (file.endsWith('.json')) {
        const slug = basename(file, '.json')
        existingBlogs.set(slug, file)
      }
    })
  }

  // Also check pages/blog
  const pagesBlogDir = join(resolvedPath, 'pages', 'blog')
  if (existsSync(pagesBlogDir)) {
    await walkDir(pagesBlogDir, (file) => {
      if (file.endsWith('.json')) {
        const slug = basename(file, '.json')
        existingBlogs.set(slug, file)
      }
    })
  }
}

async function walkDir(dir: string, callback: (file: string) => void) {
  if (!existsSync(dir)) return

  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkDir(fullPath, callback)
    } else {
      callback(fullPath)
    }
  }
}

async function checkSitemapPages() {
  console.log('\n📄 Checking sitemap pages...')

  const sitemapPath = join(resolvedPath, 'sitemap.json')
  if (!existsSync(sitemapPath)) {
    issues.push({
      category: 'missing_page',
      severity: 'critical',
      description: 'sitemap.json not found',
    })
    return
  }

  const sitemap = JSON.parse(await readFile(sitemapPath, 'utf-8'))

  function checkPage(page: any, parentPath = '') {
    const pageFile = page.page_file
    if (!pageFile) return

    const fullPath = join(resolvedPath, 'pages', pageFile)
    if (!existsSync(fullPath)) {
      issues.push({
        category: 'missing_page',
        severity: 'critical',
        file: pageFile,
        description: `Page file referenced in sitemap does not exist: ${pageFile}`,
        details: { slug: page.slug, title: page.title },
      })
    }

    // Check children
    if (page.children) {
      for (const child of page.children) {
        checkPage(child, page.slug)
      }
    }
  }

  for (const page of sitemap.pages || []) {
    checkPage(page)
  }
}

async function checkBlogPosts() {
  console.log('\n📝 Checking blog posts...')

  // Check blog-index.json for referenced posts
  const blogIndexPath = join(resolvedPath, 'pages', 'blog-index.json')
  if (!existsSync(blogIndexPath)) {
    console.log('  No blog-index.json found')
    return
  }

  const blogIndex = JSON.parse(await readFile(blogIndexPath, 'utf-8'))

  // Find the blog-index block
  const blogBlock = blogIndex.body?.find((b: any) => b.type === 'blog-index')
  if (!blogBlock?.stories) {
    console.log('  No stories found in blog-index')
    return
  }

  console.log(`  Found ${blogBlock.stories.length} blog posts referenced`)

  for (const story of blogBlock.stories) {
    const slug = story.slug
    const blogExists = existingBlogs.has(slug)

    if (!blogExists) {
      issues.push({
        category: 'missing_blog',
        severity: 'critical',
        description: `Blog post referenced in index does not exist: ${slug}`,
        details: {
          title: story.title,
          author: story.author,
          category: story.category,
        },
      })
    }
  }
}

async function checkInternalLinks() {
  console.log('\n🔗 Checking internal links...')

  // Build a set of valid slugs
  const validSlugs = new Set<string>()

  // Add root
  validSlugs.add('/')
  validSlugs.add('/en')
  validSlugs.add('/de')
  validSlugs.add('/fr')
  validSlugs.add('/it')

  // Add from sitemap
  const sitemapPath = join(resolvedPath, 'sitemap.json')
  if (existsSync(sitemapPath)) {
    const sitemap = JSON.parse(await readFile(sitemapPath, 'utf-8'))

    function addSlugs(page: any, parentSlug = '') {
      const slug = parentSlug ? `${parentSlug}/${page.slug}` : `/${page.slug}`
      validSlugs.add(slug)
      validSlugs.add(`/en${slug}`)
      validSlugs.add(`/de${slug}`)
      validSlugs.add(`/fr${slug}`)
      validSlugs.add(`/it${slug}`)

      // Also add with trailing slash
      validSlugs.add(`${slug}/`)
      validSlugs.add(`/en${slug}/`)

      if (page.children) {
        for (const child of page.children) {
          addSlugs(child, slug)
        }
      }
    }

    for (const page of sitemap.pages || []) {
      addSlugs(page)
    }
  }

  // Now scan all JSON files for internal links
  const pagesDir = join(resolvedPath, 'pages')
  const internalLinkPattern = /["'](\/[a-z]{2}\/[^"']*|\/[a-z-]+\/?)['"]/g

  await walkDir(pagesDir, async (file) => {
    if (!file.endsWith('.json')) return

    try {
      const content = await readFile(file, 'utf-8')
      const matches = content.matchAll(internalLinkPattern)

      for (const match of matches) {
        let link = match[1]
        // Normalize: remove trailing slash for comparison
        const normalizedLink = link.endsWith('/') ? link.slice(0, -1) : link

        // Check if it's a valid internal link
        if (!validSlugs.has(link) && !validSlugs.has(normalizedLink) && !validSlugs.has(link + '/')) {
          // Skip anchors and special paths
          if (link.includes('#') || link.includes('?')) continue
          if (link.startsWith('/api/') || link.startsWith('/assets/')) continue

          issues.push({
            category: 'broken_internal_link',
            severity: 'high',
            file: file.replace(resolvedPath + '/', ''),
            description: `Internal link points to non-existent page: ${link}`,
          })
        }
      }
    } catch (e) {
      // Skip invalid JSON
    }
  })
}

async function checkVillagePages() {
  console.log('\n🏘️ Checking village sub-pages...')

  const villages = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']
  const expectedSubpages = ['restaurants', 'accommodations', 'hikes', 'events', 'sights', 'weather', 'agriturismi', 'apartments', 'beaches', 'insights']

  for (const village of villages) {
    const villageDir = join(resolvedPath, 'pages', village)

    if (!existsSync(villageDir)) {
      issues.push({
        category: 'missing_page',
        severity: 'high',
        description: `Village directory missing: pages/${village}/`,
      })
      continue
    }

    const files = await readdir(villageDir)
    const existingSubpages = files.filter(f => f.endsWith('.json')).map(f => basename(f, '.json'))

    console.log(`  ${village}: ${existingSubpages.length} sub-pages`)
  }
}

async function checkEmptyContent() {
  console.log('\n📋 Checking for empty or minimal content...')

  const pagesDir = join(resolvedPath, 'pages')

  await walkDir(pagesDir, async (file) => {
    if (!file.endsWith('.json')) return

    try {
      const content = JSON.parse(await readFile(file, 'utf-8'))

      // Check if body is empty or too short
      if (!content.body || content.body.length === 0) {
        issues.push({
          category: 'empty_content',
          severity: 'medium',
          file: file.replace(resolvedPath + '/', ''),
          description: 'Page has no content blocks',
        })
      } else if (content.body.length === 1 && content.body[0].type === 'hero-section') {
        issues.push({
          category: 'empty_content',
          severity: 'low',
          file: file.replace(resolvedPath + '/', ''),
          description: 'Page only has a hero section, no other content',
        })
      }
    } catch (e) {
      // Skip invalid JSON
    }
  })
}

async function checkFeaturedContent() {
  console.log('\n⭐ Checking featured/trending content references...')

  // Look for featured-carousel, trending-now, editor-picks, etc.
  const pagesDir = join(resolvedPath, 'pages')
  const featuredPatterns = ['featured-carousel', 'trending-now', 'editor-picks', 'latest-stories', 'curated-escapes']

  await walkDir(pagesDir, async (file) => {
    if (!file.endsWith('.json')) return

    try {
      const content = JSON.parse(await readFile(file, 'utf-8'))

      for (const block of content.body || []) {
        if (featuredPatterns.includes(block.type)) {
          // Check if it has actual items or just placeholder
          if (block.items && block.items.length > 0) {
            for (const item of block.items) {
              if (item.slug || item.href) {
                const link = item.slug || item.href
                // Check if this is a valid internal link
                if (link.startsWith('/') && !existingPages.has(link.replace(/^\/[a-z]{2}\//, '').replace(/\/$/, ''))) {
                  issues.push({
                    category: 'broken_internal_link',
                    severity: 'high',
                    file: file.replace(resolvedPath + '/', ''),
                    description: `Featured content links to non-existent page: ${link}`,
                    details: { blockType: block.type, title: item.title },
                  })
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // Skip
    }
  })
}

async function main() {
  console.log('\n🔍 Content Completeness Audit')
  console.log('=============================\n')
  console.log(`📁 Content path: ${resolvedPath}`)

  await collectExistingFiles()
  console.log(`\n📊 Found ${existingPages.size} pages, ${existingBlogs.size} blog posts`)

  await checkSitemapPages()
  await checkBlogPosts()
  await checkVillagePages()
  await checkEmptyContent()
  await checkFeaturedContent()
  await checkInternalLinks()

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('\n📊 Content Completeness Summary')
  console.log('================================\n')

  const byCategory = new Map<string, Issue[]>()
  for (const issue of issues) {
    const list = byCategory.get(issue.category) || []
    list.push(issue)
    byCategory.set(issue.category, list)
  }

  const categoryLabels: Record<string, string> = {
    'missing_page': '📄 Missing Pages',
    'missing_blog': '📝 Missing Blog Posts',
    'broken_internal_link': '🔗 Broken Internal Links',
    'empty_content': '📋 Empty/Minimal Content',
    'orphan_page': '👻 Orphan Pages',
    'missing_collection_page': '📚 Missing Collection Pages',
  }

  let totalCritical = 0
  let totalHigh = 0
  let totalMedium = 0

  for (const [category, categoryIssues] of byCategory) {
    console.log(`\n${categoryLabels[category] || category} (${categoryIssues.length})`)
    console.log('-'.repeat(40))

    for (const issue of categoryIssues.slice(0, 10)) {
      const emoji = issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟠' : '🟡'
      console.log(`${emoji} ${issue.description}`)
      if (issue.file) console.log(`   File: ${issue.file}`)
      if (issue.details) {
        for (const [key, value] of Object.entries(issue.details)) {
          console.log(`   ${key}: ${value}`)
        }
      }

      if (issue.severity === 'critical') totalCritical++
      else if (issue.severity === 'high') totalHigh++
      else totalMedium++
    }

    if (categoryIssues.length > 10) {
      console.log(`   ... and ${categoryIssues.length - 10} more`)
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log(`\n📈 Total Issues: ${issues.length}`)
  console.log(`   🔴 Critical: ${totalCritical}`)
  console.log(`   🟠 High: ${totalHigh}`)
  console.log(`   🟡 Medium: ${totalMedium}`)

  // List of content that needs to be created
  const missingBlogs = issues.filter(i => i.category === 'missing_blog')
  if (missingBlogs.length > 0) {
    console.log('\n\n📝 BLOG POSTS TO CREATE:')
    console.log('========================')
    for (const issue of missingBlogs) {
      console.log(`\n• ${issue.details?.title || 'Unknown'}`)
      console.log(`  Slug: ${issue.description.match(/: (.+)$/)?.[1]}`)
      console.log(`  Author: ${issue.details?.author}`)
      console.log(`  Category: ${issue.details?.category}`)
    }
  }

  const missingPages = issues.filter(i => i.category === 'missing_page')
  if (missingPages.length > 0) {
    console.log('\n\n📄 PAGES TO CREATE:')
    console.log('===================')
    for (const issue of missingPages) {
      console.log(`• ${issue.file || issue.description}`)
    }
  }
}

main().catch(console.error)
