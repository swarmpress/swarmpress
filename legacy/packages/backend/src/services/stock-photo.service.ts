/**
 * Stock Photo Service
 * Search and download images from Unsplash and Pexels
 *
 * This service:
 * - Searches for photos by keyword
 * - Downloads selected photos
 * - Tracks proper attribution (required by API terms)
 * - Returns buffer + attribution for upload to our CDN
 */

// =============================================================================
// TYPES
// =============================================================================

export type PhotoSource = 'unsplash' | 'pexels'
export type PhotoOrientation = 'landscape' | 'portrait' | 'square'

export interface PhotoResult {
  id: string
  source: PhotoSource
  previewUrl: string           // Small preview for selection
  fullUrl: string              // Full resolution for download
  downloadUrl?: string         // Trigger download tracking (Unsplash)
  width: number
  height: number
  photographer: string
  photographerUrl: string
  attribution: string          // Full attribution text
  description?: string
  tags?: string[]
}

export interface SearchOptions {
  query: string
  orientation?: PhotoOrientation
  count?: number  // Max results to return
  page?: number
}

export interface SearchResult {
  success: boolean
  photos: PhotoResult[]
  total?: number
  error?: string
}

export interface DownloadResult {
  success: boolean
  buffer?: Buffer
  mimeType?: string
  attribution?: string
  error?: string
}

// =============================================================================
// STOCK PHOTO SERVICE
// =============================================================================

export class StockPhotoService {
  private unsplashKey: string | null
  private pexelsKey: string | null

  constructor() {
    this.unsplashKey = process.env.UNSPLASH_ACCESS_KEY || null
    this.pexelsKey = process.env.PEXELS_API_KEY || null
  }

  /**
   * Check which services are configured
   */
  getAvailableSources(): PhotoSource[] {
    const sources: PhotoSource[] = []
    if (this.unsplashKey) sources.push('unsplash')
    if (this.pexelsKey) sources.push('pexels')
    return sources
  }

  /**
   * Search for photos across all configured services
   */
  async search(options: SearchOptions): Promise<SearchResult> {
    const sources = this.getAvailableSources()

    if (sources.length === 0) {
      return {
        success: false,
        photos: [],
        error: 'No stock photo APIs configured. Set UNSPLASH_ACCESS_KEY or PEXELS_API_KEY.',
      }
    }

    // Search all available sources in parallel
    const results = await Promise.all(
      sources.map(source =>
        source === 'unsplash'
          ? this.searchUnsplash(options)
          : this.searchPexels(options)
      )
    )

    // Combine results
    const allPhotos = results.flatMap(r => r.photos)
    const hasError = results.some(r => !r.success)

    return {
      success: !hasError || allPhotos.length > 0,
      photos: allPhotos.slice(0, options.count || 10),
      total: allPhotos.length,
      error: hasError ? results.find(r => r.error)?.error : undefined,
    }
  }

  /**
   * Search Unsplash for photos
   */
  async searchUnsplash(options: SearchOptions): Promise<SearchResult> {
    if (!this.unsplashKey) {
      return { success: false, photos: [], error: 'Unsplash API key not configured' }
    }

    try {
      const params = new URLSearchParams({
        query: options.query,
        per_page: String(options.count || 10),
        page: String(options.page || 1),
      })

      if (options.orientation) {
        // Unsplash uses 'squarish' for square
        const orientationMap: Record<PhotoOrientation, string> = {
          landscape: 'landscape',
          portrait: 'portrait',
          square: 'squarish',
        }
        params.set('orientation', orientationMap[options.orientation])
      }

      const response = await fetch(
        `https://api.unsplash.com/search/photos?${params}`,
        {
          headers: {
            Authorization: `Client-ID ${this.unsplashKey}`,
            'Accept-Version': 'v1',
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Unsplash API error: ${response.status}`)
      }

      const data = await response.json() as { results: unknown[]; total: number }

      const photos: PhotoResult[] = data.results.map((photo: unknown) => {
        const p = photo as Record<string, unknown>
        const urls = p.urls as Record<string, string>
        const links = p.links as Record<string, string>
        const user = p.user as Record<string, unknown>
        const userLinks = user.links as Record<string, string>
        const tags = p.tags as Array<{ title: string }> | undefined
        return {
          id: p.id as string,
          source: 'unsplash' as PhotoSource,
          previewUrl: urls.small,
          fullUrl: urls.regular,
          downloadUrl: links.download_location, // Triggers download tracking
          width: p.width as number,
          height: p.height as number,
          photographer: user.name as string,
          photographerUrl: userLinks.html,
          attribution: `Photo by ${user.name} on Unsplash`,
          description: (p.alt_description || p.description) as string | undefined,
          tags: tags?.map((t) => t.title) || [],
        }
      })

      return {
        success: true,
        photos,
        total: data.total,
      }
    } catch (error) {
      console.error('[StockPhoto] Unsplash search error:', error)
      return {
        success: false,
        photos: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Search Pexels for photos
   */
  async searchPexels(options: SearchOptions): Promise<SearchResult> {
    if (!this.pexelsKey) {
      return { success: false, photos: [], error: 'Pexels API key not configured' }
    }

    try {
      const params = new URLSearchParams({
        query: options.query,
        per_page: String(options.count || 10),
        page: String(options.page || 1),
      })

      if (options.orientation) {
        params.set('orientation', options.orientation)
      }

      const response = await fetch(
        `https://api.pexels.com/v1/search?${params}`,
        {
          headers: {
            Authorization: this.pexelsKey,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Pexels API error: ${response.status}`)
      }

      const data = await response.json() as { photos: unknown[]; total_results: number }

      const photos: PhotoResult[] = data.photos.map((photo: unknown) => {
        const p = photo as Record<string, unknown>
        const src = p.src as Record<string, string>
        return {
          id: String(p.id),
          source: 'pexels' as PhotoSource,
          previewUrl: src.medium,
          fullUrl: src.large2x,
          width: p.width as number,
          height: p.height as number,
          photographer: p.photographer as string,
          photographerUrl: p.photographer_url as string,
          attribution: `Photo by ${p.photographer} on Pexels`,
          description: p.alt as string | undefined,
        }
      })

      return {
        success: true,
        photos,
        total: data.total_results,
      }
    } catch (error) {
      console.error('[StockPhoto] Pexels search error:', error)
      return {
        success: false,
        photos: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Download a photo by ID
   * Triggers download tracking for Unsplash (required by API terms)
   */
  async download(photoId: string, source: PhotoSource): Promise<DownloadResult> {
    try {
      // First, get the photo details and download URL
      const photoDetails = await this.getPhotoDetails(photoId, source)

      if (!photoDetails) {
        return { success: false, error: `Photo not found: ${photoId}` }
      }

      // For Unsplash, trigger download tracking first
      if (source === 'unsplash' && photoDetails.downloadUrl && this.unsplashKey) {
        await fetch(photoDetails.downloadUrl, {
          headers: { Authorization: `Client-ID ${this.unsplashKey}` },
        })
      }

      // Download the full resolution image
      const response = await fetch(photoDetails.fullUrl)

      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const mimeType = response.headers.get('content-type') || 'image/jpeg'

      return {
        success: true,
        buffer,
        mimeType,
        attribution: photoDetails.attribution,
      }
    } catch (error) {
      console.error('[StockPhoto] Download error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get photo details by ID
   */
  async getPhotoDetails(photoId: string, source: PhotoSource): Promise<PhotoResult | null> {
    if (source === 'unsplash') {
      return this.getUnsplashPhoto(photoId)
    } else {
      return this.getPexelsPhoto(photoId)
    }
  }

  /**
   * Get Unsplash photo by ID
   */
  private async getUnsplashPhoto(photoId: string): Promise<PhotoResult | null> {
    if (!this.unsplashKey) return null

    try {
      const response = await fetch(
        `https://api.unsplash.com/photos/${photoId}`,
        {
          headers: {
            Authorization: `Client-ID ${this.unsplashKey}`,
            'Accept-Version': 'v1',
          },
        }
      )

      if (!response.ok) return null

      const photo = await response.json() as Record<string, unknown>
      const urls = photo.urls as Record<string, string>
      const links = photo.links as Record<string, string>
      const user = photo.user as Record<string, unknown>
      const userLinks = user.links as Record<string, string>
      const tags = photo.tags as Array<{ title: string }> | undefined

      return {
        id: photo.id as string,
        source: 'unsplash',
        previewUrl: urls.small,
        fullUrl: urls.full,
        downloadUrl: links.download_location,
        width: photo.width as number,
        height: photo.height as number,
        photographer: user.name as string,
        photographerUrl: userLinks.html,
        attribution: `Photo by ${user.name} on Unsplash`,
        description: (photo.alt_description || photo.description) as string | undefined,
        tags: tags?.map((t) => t.title) || [],
      }
    } catch (error) {
      console.error('[StockPhoto] Error getting Unsplash photo:', error)
      return null
    }
  }

  /**
   * Get Pexels photo by ID
   */
  private async getPexelsPhoto(photoId: string): Promise<PhotoResult | null> {
    if (!this.pexelsKey) return null

    try {
      const response = await fetch(
        `https://api.pexels.com/v1/photos/${photoId}`,
        {
          headers: { Authorization: this.pexelsKey },
        }
      )

      if (!response.ok) return null

      const photo = await response.json() as Record<string, unknown>
      const src = photo.src as Record<string, string>

      return {
        id: String(photo.id),
        source: 'pexels',
        previewUrl: src.medium,
        fullUrl: src.original,
        width: photo.width as number,
        height: photo.height as number,
        photographer: photo.photographer as string,
        photographerUrl: photo.photographer_url as string,
        attribution: `Photo by ${photo.photographer} on Pexels`,
        description: photo.alt as string | undefined,
      }
    } catch (error) {
      console.error('[StockPhoto] Error getting Pexels photo:', error)
      return null
    }
  }

  /**
   * Search specifically for travel/destination photos
   * Adds relevant keywords for better results
   */
  async searchTravel(
    location: string,
    options?: {
      type?: 'landscape' | 'landmark' | 'food' | 'culture' | 'people' | 'hotel' | 'beach'
      orientation?: PhotoOrientation
      count?: number
    }
  ): Promise<SearchResult> {
    const typeKeywords: Record<string, string> = {
      landscape: 'scenic view nature',
      landmark: 'famous landmark architecture',
      food: 'local cuisine restaurant',
      culture: 'traditional culture festival',
      people: 'tourists travelers',
      hotel: 'hotel resort accommodation',
      beach: 'beach coast ocean',
    }

    const keywords = options?.type ? typeKeywords[options.type] : ''
    const query = `${location} ${keywords}`.trim()

    return this.search({
      query,
      orientation: options?.orientation || 'landscape',
      count: options?.count || 10,
    })
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let stockPhotoServiceInstance: StockPhotoService | null = null

/**
 * Get or create the stock photo service instance
 */
export function getStockPhotoService(): StockPhotoService {
  if (!stockPhotoServiceInstance) {
    stockPhotoServiceInstance = new StockPhotoService()
  }
  return stockPhotoServiceInstance
}

/**
 * Check if any stock photo service is configured
 */
export function isStockPhotoConfigured(): boolean {
  return !!(process.env.UNSPLASH_ACCESS_KEY || process.env.PEXELS_API_KEY)
}
