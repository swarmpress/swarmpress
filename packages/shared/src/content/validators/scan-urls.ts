/**
 * Content URL Scanner
 * Extracts all URLs from content JSON files
 */

import { readFile, readdir } from 'fs/promises'
import { join, relative } from 'path'

export interface UrlReference {
  url: string
  type: 'image' | 'internal_link' | 'external_link' | 'embed'
  file: string
  relativePath: string
  jsonPath: string
  context: string // Surrounding content for context
  fieldName?: string // The field that contains this URL (e.g., 'image', 'src', 'href')
}

export interface ScanUrlsInput {
  path: string // Content directory path
  urlTypes?: ('image' | 'link' | 'embed' | 'all')[]
  filePattern?: RegExp // Default: /\.json$/
}

export interface ScanUrlsOutput {
  urls: UrlReference[]
  totalFiles: number
  errors: Array<{ file: string; error: string }>
}

// URL patterns to look for in content
const IMAGE_FIELDS = ['image', 'src', 'backgroundImage', 'thumbnail', 'featuredImage', 'logo', 'icon', 'cover', 'poster']
const EMBED_FIELDS = ['embedUrl', 'videoUrl', 'mapUrl']

/**
 * Recursively scan a directory for JSON files and extract URLs
 */
export async function scanContentForUrls(input: ScanUrlsInput): Promise<ScanUrlsOutput> {
  const { path, urlTypes = ['all'], filePattern = /\.json$/ } = input
  const urls: UrlReference[] = []
  const errors: Array<{ file: string; error: string }> = []
  let totalFiles = 0

  const shouldIncludeImages = urlTypes.includes('all') || urlTypes.includes('image')
  const shouldIncludeLinks = urlTypes.includes('all') || urlTypes.includes('link')
  const shouldIncludeEmbeds = urlTypes.includes('all') || urlTypes.includes('embed')

  async function processDirectory(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        await processDirectory(fullPath)
      } else if (entry.isFile() && filePattern.test(entry.name)) {
        try {
          const content = await readFile(fullPath, 'utf-8')
          const json = JSON.parse(content)
          totalFiles++

          const fileUrls = extractUrls(
            json,
            fullPath,
            relative(input.path, fullPath),
            '',
            shouldIncludeImages,
            shouldIncludeLinks,
            shouldIncludeEmbeds
          )
          urls.push(...fileUrls)
        } catch (error) {
          errors.push({
            file: fullPath,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }
  }

  await processDirectory(path)

  return { urls, totalFiles, errors }
}

/**
 * Extract URLs from a JSON object recursively
 */
function extractUrls(
  obj: unknown,
  file: string,
  relativePath: string,
  jsonPath: string,
  includeImages: boolean,
  includeLinks: boolean,
  includeEmbeds: boolean,
  context: string = ''
): UrlReference[] {
  const urls: UrlReference[] = []

  if (obj === null || obj === undefined) return urls

  if (typeof obj === 'string') {
    // Check if this string is a URL
    if (isUrl(obj)) {
      // Determine type based on parent field name
      const fieldName = jsonPath.split('.').pop() || ''
      const type = categorizeUrlByField(fieldName, obj)

      if (
        (type === 'image' && includeImages) ||
        ((type === 'internal_link' || type === 'external_link') && includeLinks) ||
        (type === 'embed' && includeEmbeds)
      ) {
        urls.push({
          url: obj,
          type,
          file,
          relativePath,
          jsonPath,
          context: context.substring(0, 200), // Limit context length
          fieldName,
        })
      }
    }
    return urls
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const childPath = `${jsonPath}[${i}]`
      urls.push(
        ...extractUrls(obj[i], file, relativePath, childPath, includeImages, includeLinks, includeEmbeds, context)
      )
    }
    return urls
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>

    // Build context from title/text fields
    let currentContext = context
    if (record.title && typeof record.title === 'string') {
      currentContext = record.title
    } else if (record.text && typeof record.text === 'string') {
      currentContext = record.text
    } else if (record.type && typeof record.type === 'string') {
      currentContext = `Block: ${record.type}`
    }

    for (const [key, value] of Object.entries(record)) {
      const childPath = jsonPath ? `${jsonPath}.${key}` : key
      urls.push(
        ...extractUrls(
          value,
          file,
          relativePath,
          childPath,
          includeImages,
          includeLinks,
          includeEmbeds,
          currentContext
        )
      )
    }
    return urls
  }

  return urls
}

/**
 * Check if a string looks like a URL
 */
function isUrl(str: string): boolean {
  if (!str || typeof str !== 'string') return false

  // Check for common URL patterns
  if (str.startsWith('http://') || str.startsWith('https://')) {
    try {
      new URL(str)
      return true
    } catch {
      return false
    }
  }

  // Check for relative URLs (internal links)
  if (str.startsWith('/') && !str.startsWith('//')) {
    // Looks like an internal path, but filter out JSON paths and obvious non-links
    return !str.includes('$') && !str.includes('(') && str.length < 200
  }

  return false
}

/**
 * Categorize URL type based on field name and URL pattern
 */
function categorizeUrlByField(
  fieldName: string,
  url: string
): 'image' | 'internal_link' | 'external_link' | 'embed' {
  const lowerField = fieldName.toLowerCase()

  // Check if it's an image field
  if (IMAGE_FIELDS.some((f) => lowerField.includes(f.toLowerCase()))) {
    return 'image'
  }

  // Check if it's an embed field
  if (EMBED_FIELDS.some((f) => lowerField.includes(f.toLowerCase()))) {
    return 'embed'
  }

  // Check URL itself for hints
  if (url.startsWith('/')) {
    return 'internal_link'
  }

  // Check for common image extensions
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif']
  if (imageExtensions.some((ext) => url.toLowerCase().includes(ext))) {
    return 'image'
  }

  // Check for embed patterns
  if (
    url.includes('youtube.com') ||
    url.includes('youtu.be') ||
    url.includes('vimeo.com') ||
    url.includes('maps.google')
  ) {
    return 'embed'
  }

  return 'external_link'
}

/**
 * Group URLs by type
 */
export function groupUrlsByType(urls: UrlReference[]): {
  images: UrlReference[]
  internalLinks: UrlReference[]
  externalLinks: UrlReference[]
  embeds: UrlReference[]
} {
  return {
    images: urls.filter((u) => u.type === 'image'),
    internalLinks: urls.filter((u) => u.type === 'internal_link'),
    externalLinks: urls.filter((u) => u.type === 'external_link'),
    embeds: urls.filter((u) => u.type === 'embed'),
  }
}

/**
 * Get unique URLs from references
 */
export function getUniqueUrls(urls: UrlReference[]): string[] {
  return [...new Set(urls.map((u) => u.url))]
}

/**
 * Find all references to a specific URL
 */
export function findReferencesToUrl(urls: UrlReference[], targetUrl: string): UrlReference[] {
  return urls.filter((u) => u.url === targetUrl)
}
