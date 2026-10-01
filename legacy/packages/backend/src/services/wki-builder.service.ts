/**
 * Website Knowledge Index (WKI) Builder Service
 *
 * Crawls content repositories and builds/maintains indexes for:
 * - Media (images with village/category tags)
 * - Entities (villages, trails, POIs)
 * - Sitemap (pages with canonical URLs)
 *
 * These indexes enable agents to:
 * - Select relevant images (no Caribbean photos on Riomaggiore pages)
 * - Link correctly (only use URLs from sitemap-index)
 * - Understand entity relationships
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { glob } from 'glob'

// ============================================================================
// Types
// ============================================================================

export interface LocalizedString {
  en: string
  de?: string
  fr?: string
  it?: string
}

export interface MediaTags {
  village: string
  category: string
  subcategory?: string
  timeOfDay?: string
  season?: string
  mood?: string
}

export interface MediaImage {
  id: string
  url: string
  tags: MediaTags
  alt?: LocalizedString
  license: string
  photographer?: string
  dimensions?: { width: number; height: number }
  usedIn: string[]
}

export interface MediaIndex {
  version: string
  lastUpdated: string
  images: MediaImage[]
  categories: string[]
  subcategories: Record<string, string[]>
  villages: string[]
  moods: string[]
  timeOfDay: string[]
  seasons: string[]
}

export interface EntityVillage {
  slug: string
  name: LocalizedString
  canonicalUrl: LocalizedString
  aliases: string[]
  coordinates: { lat: number; lng: number }
  position: number
  character: string
  keywords: string[]
  relatedVillages: string[]
  relatedTrails: string[]
  collections: string[]
}

export interface EntityTrail {
  slug: string
  name: LocalizedString
  canonicalUrl: LocalizedString
  aliases?: string[]
  connectsVillages: string[]
  difficulty: string
  duration: string
  distance: string
  keywords?: string[]
}

export interface EntityIndex {
  version: string
  lastUpdated: string
  villages: Record<string, EntityVillage>
  trails: Record<string, EntityTrail>
  transport: Record<string, unknown>
  categories: Array<{ slug: string; name: LocalizedString; icon: string }>
}

export interface SitemapPage {
  slug: string
  canonicalUrl: LocalizedString
  title: LocalizedString
  pageType: string
  parent: string | null
  children?: string[]
  collection?: string
  entity?: string
  allowedLinkTargets: string[]
  keywords?: string[]
}

export interface SitemapIndex {
  version: string
  lastUpdated: string
  baseUrl: string
  languages: string[]
  defaultLanguage: string
  pages: Record<string, SitemapPage>
  pageTypes: Record<string, { linkDensity: { min: number; max: number }; description: string }>
}

export interface WKIBuildResult {
  success: boolean
  mediaIndex: {
    totalImages: number
    newImages: number
    updatedImages: number
  }
  entityIndex: {
    villages: number
    trails: number
  }
  sitemapIndex: {
    totalPages: number
  }
  errors: string[]
  warnings: string[]
}

// ============================================================================
// WKI Builder Service
// ============================================================================

export class WKIBuilderService {
  private contentPath: string
  private configPath: string

  constructor(contentRepoPath: string) {
    this.contentPath = contentRepoPath
    this.configPath = path.join(contentRepoPath, 'content', 'config')
  }

  /**
   * Build all WKI indexes from content repository
   */
  async buildAll(): Promise<WKIBuildResult> {
    const result: WKIBuildResult = {
      success: false,
      mediaIndex: { totalImages: 0, newImages: 0, updatedImages: 0 },
      entityIndex: { villages: 0, trails: 0 },
      sitemapIndex: { totalPages: 0 },
      errors: [],
      warnings: [],
    }

    try {
      // Build media index
      const mediaResult = await this.buildMediaIndex()
      result.mediaIndex = mediaResult

      // Build entity index
      const entityResult = await this.buildEntityIndex()
      result.entityIndex = entityResult

      // Build sitemap index
      const sitemapResult = await this.buildSitemapIndex()
      result.sitemapIndex = sitemapResult

      result.success = true
    } catch (error) {
      result.errors.push(`Build failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    return result
  }

  /**
   * Build media index by scanning all content files for image URLs
   */
  async buildMediaIndex(): Promise<{ totalImages: number; newImages: number; updatedImages: number }> {
    const existingIndex = await this.loadExistingMediaIndex()
    const discoveredImages = new Map<string, MediaImage>()

    // Scan village configs
    const villageConfigs = await glob('villages/*.json', { cwd: this.configPath })
    for (const configFile of villageConfigs) {
      const filePath = path.join(this.configPath, configFile)
      const content = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      const village = content.slug

      // Extract hero image
      if (content.hero?.image) {
        const imageId = this.generateImageId(content.hero.image, village, 'hero')
        discoveredImages.set(imageId, {
          id: imageId,
          url: content.hero.image,
          tags: {
            village,
            category: 'sights',
            subcategory: 'village-overview',
            season: 'all',
          },
          alt: content.hero.imageAlt,
          license: 'unsplash',
          usedIn: [`villages/${configFile}:hero`],
        })
      }

      // Extract lead story image
      if (content.intro?.leadStory?.image && content.intro.leadStory.image !== content.hero?.image) {
        const imageId = this.generateImageId(content.intro.leadStory.image, village, 'leadstory')
        discoveredImages.set(imageId, {
          id: imageId,
          url: content.intro.leadStory.image,
          tags: {
            village,
            category: 'sights',
            subcategory: 'editorial',
            season: 'all',
          },
          alt: content.hero?.imageAlt,
          license: 'unsplash',
          usedIn: [`villages/${configFile}:leadStory`],
        })
      }
    }

    // Scan page content files
    const pageFiles = await glob('pages/**/*.json', { cwd: path.join(this.contentPath, 'content') })
    for (const pageFile of pageFiles) {
      const filePath = path.join(this.contentPath, 'content', pageFile)
      try {
        const content = JSON.parse(await fs.readFile(filePath, 'utf-8'))
        const village = this.extractVillageFromPath(pageFile)

        // Recursively scan for image URLs
        this.extractImagesFromObject(content, village, `pages/${pageFile}`, discoveredImages)
      } catch {
        // Skip invalid JSON files
      }
    }

    // Scan collection files
    const collectionFiles = await glob('collections/**/*.json', { cwd: path.join(this.contentPath, 'content') })
    for (const collFile of collectionFiles) {
      if (collFile.includes('_schema')) continue // Skip schema files

      const filePath = path.join(this.contentPath, 'content', collFile)
      try {
        const content = JSON.parse(await fs.readFile(filePath, 'utf-8'))
        const village = this.extractVillageFromPath(collFile)
        const category = this.extractCategoryFromPath(collFile)

        // Recursively scan for image URLs
        this.extractImagesFromObject(content, village, `collections/${collFile}`, discoveredImages, category)
      } catch {
        // Skip invalid JSON files
      }
    }

    // Merge with existing index
    let newImages = 0
    let updatedImages = 0
    const existingImageMap = new Map(existingIndex.images.map(img => [img.id, img]))

    for (const [id, image] of discoveredImages) {
      const existing = existingImageMap.get(id)
      if (existing) {
        // Update usedIn list
        const allUsages = new Set([...existing.usedIn, ...image.usedIn])
        existing.usedIn = Array.from(allUsages)
        updatedImages++
      } else {
        existingIndex.images.push(image)
        newImages++
      }
    }

    // Update metadata
    existingIndex.lastUpdated = new Date().toISOString()
    existingIndex.version = '1.0.0'

    // Write updated index
    const indexPath = path.join(this.configPath, 'media-index.json')
    await fs.writeFile(indexPath, JSON.stringify(existingIndex, null, 2))

    return {
      totalImages: existingIndex.images.length,
      newImages,
      updatedImages,
    }
  }

  /**
   * Build entity index from village and trail data
   */
  async buildEntityIndex(): Promise<{ villages: number; trails: number }> {
    const entityIndex = await this.loadExistingEntityIndex()

    // Scan village configs
    const villageConfigs = await glob('villages/*.json', { cwd: this.configPath })
    for (const configFile of villageConfigs) {
      if (configFile.includes('_schema')) continue

      const filePath = path.join(this.configPath, configFile)
      const content = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      const slug = content.slug

      // Only update if not already present or if data changed
      if (!entityIndex.villages[slug]) {
        entityIndex.villages[slug] = {
          slug,
          name: { en: slug.charAt(0).toUpperCase() + slug.slice(1) },
          canonicalUrl: {
            en: `/en/${slug}`,
            de: `/de/${slug}`,
            fr: `/fr/${slug}`,
            it: `/it/${slug}`,
          },
          aliases: [],
          coordinates: { lat: 0, lng: 0 },
          position: 0,
          character: '',
          keywords: [],
          relatedVillages: [],
          relatedTrails: [],
          collections: ['restaurants', 'accommodations', 'sights', 'hikes', 'events'],
        }
      }
    }

    // Update metadata
    entityIndex.lastUpdated = new Date().toISOString()

    // Write updated index
    const indexPath = path.join(this.configPath, 'entity-index.json')
    await fs.writeFile(indexPath, JSON.stringify(entityIndex, null, 2))

    return {
      villages: Object.keys(entityIndex.villages).length,
      trails: Object.keys(entityIndex.trails || {}).length,
    }
  }

  /**
   * Build sitemap index from page structure
   */
  async buildSitemapIndex(): Promise<{ totalPages: number }> {
    const sitemapIndex = await this.loadExistingSitemapIndex()

    // Scan sitemap.json for page structure
    const sitemapPath = path.join(this.contentPath, 'content', 'sitemap.json')
    try {
      const sitemap = JSON.parse(await fs.readFile(sitemapPath, 'utf-8'))

      // Process pages from sitemap
      for (const page of sitemap.pages || []) {
        const slug = page.slug

        if (!sitemapIndex.pages[slug]) {
          sitemapIndex.pages[slug] = {
            slug,
            canonicalUrl: {
              en: `/en/${slug}`,
              de: `/de/${slug}`,
              fr: `/fr/${slug}`,
              it: `/it/${slug}`,
            },
            title: page.titles || { en: page.title },
            pageType: page.collection ? 'collection' : 'editorial',
            parent: null,
            allowedLinkTargets: ['villages', 'hikes', 'restaurants'],
            collection: page.collection,
          }
        }

        // Process children
        if (page.children) {
          sitemapIndex.pages[slug].children = page.children.map((c: { slug: string }) =>
            `${slug}/${c.slug}`
          )

          for (const child of page.children) {
            const childSlug = `${slug}/${child.slug}`
            if (!sitemapIndex.pages[childSlug]) {
              sitemapIndex.pages[childSlug] = {
                slug: childSlug,
                canonicalUrl: {
                  en: `/en/${childSlug}`,
                  de: `/de/${childSlug}`,
                  fr: `/fr/${childSlug}`,
                  it: `/it/${childSlug}`,
                },
                title: child.titles || { en: child.title },
                pageType: 'collection',
                parent: slug,
                allowedLinkTargets: ['villages', child.collection || 'sights'],
                collection: child.collection,
                entity: slug,
              }
            }
          }
        }
      }
    } catch {
      // sitemap.json doesn't exist or is invalid
    }

    // Update metadata
    sitemapIndex.lastUpdated = new Date().toISOString()

    // Write updated index
    const indexPath = path.join(this.configPath, 'sitemap-index.json')
    await fs.writeFile(indexPath, JSON.stringify(sitemapIndex, null, 2))

    return {
      totalPages: Object.keys(sitemapIndex.pages).length,
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async loadExistingMediaIndex(): Promise<MediaIndex> {
    const indexPath = path.join(this.configPath, 'media-index.json')
    try {
      return JSON.parse(await fs.readFile(indexPath, 'utf-8'))
    } catch {
      return {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        images: [],
        categories: ['sights', 'beaches', 'trails', 'food', 'accommodations', 'transport', 'events', 'culture'],
        subcategories: {},
        villages: ['riomaggiore', 'manarola', 'corniglia', 'vernazza', 'monterosso'],
        moods: [],
        timeOfDay: [],
        seasons: ['spring', 'summer', 'autumn', 'winter', 'all'],
      }
    }
  }

  private async loadExistingEntityIndex(): Promise<EntityIndex> {
    const indexPath = path.join(this.configPath, 'entity-index.json')
    try {
      return JSON.parse(await fs.readFile(indexPath, 'utf-8'))
    } catch {
      return {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        villages: {},
        trails: {},
        transport: {},
        categories: [],
      }
    }
  }

  private async loadExistingSitemapIndex(): Promise<SitemapIndex> {
    const indexPath = path.join(this.configPath, 'sitemap-index.json')
    try {
      return JSON.parse(await fs.readFile(indexPath, 'utf-8'))
    } catch {
      return {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        baseUrl: 'https://cinqueterre.travel',
        languages: ['en', 'de', 'fr', 'it'],
        defaultLanguage: 'en',
        pages: {},
        pageTypes: {},
      }
    }
  }

  private generateImageId(url: string, village: string, context: string): string {
    // Extract unique part from URL
    const match = url.match(/photo-([a-zA-Z0-9-]+)/)
    const photoId = (match && match[1]) ? match[1].substring(0, 8) : this.hashUrl(url).substring(0, 8)
    return `${village}-${context}-${photoId}`.toLowerCase()
  }

  private hashUrl(url: string): string {
    let hash = 0
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  private extractVillageFromPath(filePath: string): string {
    const villages = ['riomaggiore', 'manarola', 'corniglia', 'vernazza', 'monterosso']
    for (const village of villages) {
      if (filePath.toLowerCase().includes(village)) {
        return village
      }
    }
    return 'region'
  }

  private extractCategoryFromPath(filePath: string): string {
    const categories = ['restaurants', 'accommodations', 'hikes', 'events', 'pois', 'beaches']
    for (const category of categories) {
      if (filePath.toLowerCase().includes(category)) {
        return category
      }
    }
    return 'sights'
  }

  private extractImagesFromObject(
    obj: unknown,
    village: string,
    sourcePath: string,
    images: Map<string, MediaImage>,
    category = 'sights'
  ): void {
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.extractImagesFromObject(item, village, sourcePath, images, category)
      }
      return
    }

    const record = obj as Record<string, unknown>

    // Check for image URLs
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string' && this.isImageUrl(value)) {
        const imageId = this.generateImageId(value, village, key)
        if (!images.has(imageId)) {
          images.set(imageId, {
            id: imageId,
            url: value,
            tags: {
              village,
              category,
              season: 'all',
            },
            license: this.detectLicense(value),
            usedIn: [`${sourcePath}:${key}`],
          })
        } else {
          const existing = images.get(imageId)!
          if (!existing.usedIn.includes(`${sourcePath}:${key}`)) {
            existing.usedIn.push(`${sourcePath}:${key}`)
          }
        }
      } else if (typeof value === 'object') {
        this.extractImagesFromObject(value, village, sourcePath, images, category)
      }
    }
  }

  private isImageUrl(url: string): boolean {
    if (typeof url !== 'string') return false
    return (
      url.startsWith('https://images.unsplash.com/') ||
      url.startsWith('https://images.pexels.com/') ||
      url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i) !== null
    )
  }

  private detectLicense(url: string): string {
    if (url.includes('unsplash.com')) return 'unsplash'
    if (url.includes('pexels.com')) return 'pexels'
    return 'unknown'
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

export async function buildWKI(contentRepoPath: string): Promise<WKIBuildResult> {
  const builder = new WKIBuilderService(contentRepoPath)
  return builder.buildAll()
}
