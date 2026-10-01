import type { APIRoute } from 'astro'
import * as fs from 'fs/promises'
import * as path from 'path'

interface IndexStatus {
  exists: boolean
  lastUpdated?: string
  version?: string
  stats?: Record<string, unknown>
}

interface WKIStatus {
  contentRepoPath: string
  mediaIndex: IndexStatus
  entityIndex: IndexStatus
  sitemapIndex: IndexStatus
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const contentRepoPath = url.searchParams.get('contentRepoPath') ||
      path.join(process.cwd(), 'cinqueterre.travel')

    const configPath = path.join(contentRepoPath, 'content', 'config')
    const status: WKIStatus = {
      contentRepoPath,
      mediaIndex: { exists: false },
      entityIndex: { exists: false },
      sitemapIndex: { exists: false },
    }

    // Check media index
    try {
      const mediaIndexPath = path.join(configPath, 'media-index.json')
      const mediaContent = JSON.parse(await fs.readFile(mediaIndexPath, 'utf-8'))
      status.mediaIndex = {
        exists: true,
        lastUpdated: mediaContent.lastUpdated,
        version: mediaContent.version,
        stats: {
          totalImages: mediaContent.images?.length || 0,
          villages: [...new Set(mediaContent.images?.map((img: { tags: { village: string } }) => img.tags.village) || [])],
          categories: [...new Set(mediaContent.images?.map((img: { tags: { category: string } }) => img.tags.category) || [])],
        },
      }
    } catch {
      // Index doesn't exist
    }

    // Check entity index
    try {
      const entityIndexPath = path.join(configPath, 'entity-index.json')
      const entityContent = JSON.parse(await fs.readFile(entityIndexPath, 'utf-8'))
      status.entityIndex = {
        exists: true,
        lastUpdated: entityContent.lastUpdated,
        version: entityContent.version,
        stats: {
          villages: Object.keys(entityContent.villages || {}).length,
          trails: Object.keys(entityContent.trails || {}).length,
          categories: entityContent.categories?.length || 0,
        },
      }
    } catch {
      // Index doesn't exist
    }

    // Check sitemap index
    try {
      const sitemapIndexPath = path.join(configPath, 'sitemap-index.json')
      const sitemapContent = JSON.parse(await fs.readFile(sitemapIndexPath, 'utf-8'))
      status.sitemapIndex = {
        exists: true,
        lastUpdated: sitemapContent.lastUpdated,
        version: sitemapContent.version,
        stats: {
          totalPages: Object.keys(sitemapContent.pages || {}).length,
          languages: sitemapContent.languages,
          pageTypes: Object.keys(sitemapContent.pageTypes || {}),
        },
      }
    } catch {
      // Index doesn't exist
    }

    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error getting WKI status:', error)
    return new Response(
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Failed to get WKI status',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
