/**
 * WKI Refresh Service
 * Automatically refreshes Website Knowledge Indexes when content changes
 *
 * Triggers:
 * - New page created → sitemap-index.json
 * - New collection item → entity-index.json
 * - New image uploaded → media-index.json
 * - Content published → all indexes
 */

import { WKIBuilderService } from './wki-builder.service'
import path from 'path'
import fs from 'fs/promises'

export interface WKIRefreshTrigger {
  type: 'page_created' | 'page_updated' | 'page_deleted' |
        'collection_item_created' | 'collection_item_updated' | 'collection_item_deleted' |
        'media_uploaded' | 'media_deleted' |
        'content_published' | 'full_rebuild'
  websiteId: string
  entityId?: string
  entityType?: string
  metadata?: Record<string, unknown>
}

export interface WKIRefreshResult {
  success: boolean
  trigger: WKIRefreshTrigger
  indexesUpdated: string[]
  duration: number
  error?: string
}

export class WKIRefreshService {
  private refreshQueue: WKIRefreshTrigger[] = []
  private isProcessing = false
  private debounceMs = 5000 // 5 second debounce
  private debounceTimer: NodeJS.Timeout | null = null

  constructor() {
    // Builder is created per-request with the appropriate repo path
  }

  /**
   * Queue a refresh trigger
   * Uses debouncing to batch multiple rapid changes
   */
  async queueRefresh(trigger: WKIRefreshTrigger): Promise<void> {
    console.log(`[WKIRefresh] Queued refresh: ${trigger.type} for website ${trigger.websiteId}`)
    this.refreshQueue.push(trigger)

    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // Set new debounce timer
    this.debounceTimer = setTimeout(() => {
      this.processQueue()
    }, this.debounceMs)
  }

  /**
   * Process queued refresh triggers
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.refreshQueue.length === 0) {
      return
    }

    this.isProcessing = true
    const triggers = [...this.refreshQueue]
    this.refreshQueue = []

    try {
      // Group triggers by website
      const triggersByWebsite = triggers.reduce((acc, trigger) => {
        if (!acc[trigger.websiteId]) {
          acc[trigger.websiteId] = []
        }
        acc[trigger.websiteId]!.push(trigger)
        return acc
      }, {} as Record<string, WKIRefreshTrigger[]>)

      // Process each website
      for (const [websiteId, websiteTriggers] of Object.entries(triggersByWebsite)) {
        await this.processWebsiteTriggers(websiteId, websiteTriggers)
      }
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Process triggers for a specific website
   */
  private async processWebsiteTriggers(
    websiteId: string,
    triggers: WKIRefreshTrigger[]
  ): Promise<WKIRefreshResult[]> {
    const results: WKIRefreshResult[] = []

    // Determine which indexes need updating
    const needsSitemapUpdate = triggers.some(t =>
      ['page_created', 'page_updated', 'page_deleted', 'content_published', 'full_rebuild'].includes(t.type)
    )
    const needsEntityUpdate = triggers.some(t =>
      ['collection_item_created', 'collection_item_updated', 'collection_item_deleted', 'content_published', 'full_rebuild'].includes(t.type)
    )
    const needsMediaUpdate = triggers.some(t =>
      ['media_uploaded', 'media_deleted', 'content_published', 'full_rebuild'].includes(t.type)
    )

    // If any trigger is full_rebuild, just do a full rebuild
    const needsFullRebuild = triggers.some(t => t.type === 'full_rebuild' || t.type === 'content_published')

    if (needsFullRebuild) {
      const firstTrigger = triggers[0]
      if (firstTrigger) {
        const result = await this.triggerFullRebuild(websiteId, firstTrigger)
        results.push(result)
      }
    } else {
      // Incremental updates
      if (needsSitemapUpdate) {
        const result = await this.updateSitemapIndex(websiteId, triggers.filter(t =>
          ['page_created', 'page_updated', 'page_deleted'].includes(t.type)
        ))
        results.push(result)
      }

      if (needsEntityUpdate) {
        const result = await this.updateEntityIndex(websiteId, triggers.filter(t =>
          ['collection_item_created', 'collection_item_updated', 'collection_item_deleted'].includes(t.type)
        ))
        results.push(result)
      }

      if (needsMediaUpdate) {
        const result = await this.updateMediaIndex(websiteId, triggers.filter(t =>
          ['media_uploaded', 'media_deleted'].includes(t.type)
        ))
        results.push(result)
      }
    }

    return results
  }

  /**
   * Trigger a full WKI rebuild
   */
  async triggerFullRebuild(websiteId: string, trigger: WKIRefreshTrigger): Promise<WKIRefreshResult> {
    const startTime = Date.now()

    try {
      console.log(`[WKIRefresh] Starting full rebuild for website ${websiteId}`)

      // Get the content repo path for this website
      const repoPath = await this.getContentRepoPath(websiteId)
      if (!repoPath) {
        throw new Error(`Content repo path not found for website ${websiteId}`)
      }

      // Run the builder
      const builder = new WKIBuilderService(repoPath)
      const buildResult = await builder.buildAll()

      const duration = Date.now() - startTime

      if (buildResult.success) {
        console.log(`[WKIRefresh] Full rebuild completed in ${duration}ms`)
        return {
          success: true,
          trigger,
          indexesUpdated: ['media-index.json', 'entity-index.json', 'sitemap-index.json'],
          duration,
        }
      } else {
        throw new Error(buildResult.errors?.join(', ') || 'Build failed')
      }
    } catch (error) {
      const duration = Date.now() - startTime
      console.error(`[WKIRefresh] Full rebuild failed:`, error)
      return {
        success: false,
        trigger,
        indexesUpdated: [],
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Update sitemap index incrementally
   */
  private async updateSitemapIndex(
    websiteId: string,
    triggers: WKIRefreshTrigger[]
  ): Promise<WKIRefreshResult> {
    const startTime = Date.now()
    const trigger = triggers[0] || { type: 'page_updated' as const, websiteId }

    try {
      console.log(`[WKIRefresh] Updating sitemap index for ${triggers.length} changes`)

      const repoPath = await this.getContentRepoPath(websiteId)
      if (!repoPath) {
        throw new Error(`Content repo path not found for website ${websiteId}`)
      }

      const configPath = path.join(repoPath, 'content', 'config')
      const sitemapPath = path.join(configPath, 'sitemap-index.json')

      // Read existing sitemap
      let sitemap: { pages: Record<string, any>, lastUpdated: string } = { pages: {}, lastUpdated: '' }
      try {
        const existing = await fs.readFile(sitemapPath, 'utf-8')
        sitemap = JSON.parse(existing)
      } catch {
        // File doesn't exist, will create new
      }

      // Apply changes
      for (const t of triggers) {
        if (t.type === 'page_deleted' && t.entityId) {
          delete sitemap.pages[t.entityId]
        } else if ((t.type === 'page_created' || t.type === 'page_updated') && t.entityId && t.metadata) {
          sitemap.pages[t.entityId] = {
            slug: t.metadata.slug,
            canonicalUrl: t.metadata.canonicalUrl,
            pageType: t.metadata.pageType,
            parent: t.metadata.parent || null,
            children: t.metadata.children || [],
            lastUpdated: new Date().toISOString(),
          }
        }
      }

      sitemap.lastUpdated = new Date().toISOString()

      // Write updated sitemap
      await fs.writeFile(sitemapPath, JSON.stringify(sitemap, null, 2))

      const duration = Date.now() - startTime
      console.log(`[WKIRefresh] Sitemap index updated in ${duration}ms`)

      return {
        success: true,
        trigger,
        indexesUpdated: ['sitemap-index.json'],
        duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      console.error(`[WKIRefresh] Sitemap update failed:`, error)
      return {
        success: false,
        trigger,
        indexesUpdated: [],
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Update entity index incrementally
   */
  private async updateEntityIndex(
    websiteId: string,
    triggers: WKIRefreshTrigger[]
  ): Promise<WKIRefreshResult> {
    const startTime = Date.now()
    const trigger = triggers[0] || { type: 'collection_item_updated' as const, websiteId }

    try {
      console.log(`[WKIRefresh] Updating entity index for ${triggers.length} changes`)

      const repoPath = await this.getContentRepoPath(websiteId)
      if (!repoPath) {
        throw new Error(`Content repo path not found for website ${websiteId}`)
      }

      const configPath = path.join(repoPath, 'content', 'config')
      const entityPath = path.join(configPath, 'entity-index.json')

      // Read existing entities
      let entities: Record<string, Record<string, any>> = {}
      try {
        const existing = await fs.readFile(entityPath, 'utf-8')
        entities = JSON.parse(existing)
      } catch {
        // File doesn't exist, will create new
      }

      // Apply changes
      for (const t of triggers) {
        const entityType = t.entityType || 'items'

        if (!entities[entityType]) {
          entities[entityType] = {}
        }

        if (t.type === 'collection_item_deleted' && t.entityId) {
          delete entities[entityType][t.entityId]
        } else if ((t.type === 'collection_item_created' || t.type === 'collection_item_updated') && t.entityId && t.metadata) {
          entities[entityType][t.entityId] = {
            slug: t.metadata.slug,
            canonicalUrl: t.metadata.canonicalUrl,
            ...t.metadata,
            lastUpdated: new Date().toISOString(),
          }
        }
      }

      // Write updated entities
      await fs.writeFile(entityPath, JSON.stringify(entities, null, 2))

      const duration = Date.now() - startTime
      console.log(`[WKIRefresh] Entity index updated in ${duration}ms`)

      return {
        success: true,
        trigger,
        indexesUpdated: ['entity-index.json'],
        duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      console.error(`[WKIRefresh] Entity update failed:`, error)
      return {
        success: false,
        trigger,
        indexesUpdated: [],
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Update media index incrementally
   */
  private async updateMediaIndex(
    websiteId: string,
    triggers: WKIRefreshTrigger[]
  ): Promise<WKIRefreshResult> {
    const startTime = Date.now()
    const trigger = triggers[0] || { type: 'media_uploaded' as const, websiteId }

    try {
      console.log(`[WKIRefresh] Updating media index for ${triggers.length} changes`)

      const repoPath = await this.getContentRepoPath(websiteId)
      if (!repoPath) {
        throw new Error(`Content repo path not found for website ${websiteId}`)
      }

      const configPath = path.join(repoPath, 'content', 'config')
      const mediaPath = path.join(configPath, 'media-index.json')

      // Read existing media
      let media: { images: any[], lastUpdated: string } = { images: [], lastUpdated: '' }
      try {
        const existing = await fs.readFile(mediaPath, 'utf-8')
        media = JSON.parse(existing)
      } catch {
        // File doesn't exist, will create new
      }

      // Apply changes
      for (const t of triggers) {
        if (t.type === 'media_deleted' && t.entityId) {
          media.images = media.images.filter(img => img.id !== t.entityId)
        } else if (t.type === 'media_uploaded' && t.entityId && t.metadata) {
          // Check if image already exists
          const existingIndex = media.images.findIndex(img => img.id === t.entityId)
          const imageData = {
            id: t.entityId,
            url: t.metadata.url,
            tags: t.metadata.tags || {},
            license: t.metadata.license || 'unknown',
            photographer: t.metadata.photographer,
            dimensions: t.metadata.dimensions,
            addedAt: new Date().toISOString(),
          }

          if (existingIndex >= 0) {
            media.images[existingIndex] = imageData
          } else {
            media.images.push(imageData)
          }
        }
      }

      media.lastUpdated = new Date().toISOString()

      // Write updated media
      await fs.writeFile(mediaPath, JSON.stringify(media, null, 2))

      const duration = Date.now() - startTime
      console.log(`[WKIRefresh] Media index updated in ${duration}ms`)

      return {
        success: true,
        trigger,
        indexesUpdated: ['media-index.json'],
        duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      console.error(`[WKIRefresh] Media update failed:`, error)
      return {
        success: false,
        trigger,
        indexesUpdated: [],
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get content repository path for a website
   * This would typically query the database for the website's repo path
   */
  private async getContentRepoPath(websiteId: string): Promise<string | null> {
    // For now, use a mapping based on known websites
    // In production, this would query the websites table
    const knownRepos: Record<string, string> = {
      'cinqueterre': path.resolve(process.cwd(), 'cinqueterre.travel'),
      'default': path.resolve(process.cwd(), 'cinqueterre.travel'),
    }

    return knownRepos[websiteId] || knownRepos['default'] || null
  }
}

// Singleton instance
let refreshServiceInstance: WKIRefreshService | null = null

export function getWKIRefreshService(): WKIRefreshService {
  if (!refreshServiceInstance) {
    refreshServiceInstance = new WKIRefreshService()
  }
  return refreshServiceInstance
}

// Helper functions for triggering refreshes
export async function triggerWKIRefresh(trigger: WKIRefreshTrigger): Promise<void> {
  const service = getWKIRefreshService()
  await service.queueRefresh(trigger)
}

export async function triggerFullWKIRebuild(websiteId: string): Promise<WKIRefreshResult> {
  const service = getWKIRefreshService()
  return service.triggerFullRebuild(websiteId, {
    type: 'full_rebuild',
    websiteId,
  })
}
