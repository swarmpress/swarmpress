/**
 * Storage Service
 * Simple R2/S3 storage operations without database dependency
 *
 * This service handles:
 * - Direct file uploads to Cloudflare R2 or S3
 * - CDN URL generation
 * - Downloading from external URLs and re-uploading
 * - Optional image variant generation
 *
 * No PostgreSQL - URLs are stored directly in content JSON files
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'
import { randomUUID } from 'crypto'
import path from 'path'

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface StorageConfig {
  provider: 'r2' | 's3' | 'spaces'
  endpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  cdnUrl?: string // Public CDN URL (e.g., https://cdn.cinqueterre.travel)
}

// =============================================================================
// TYPES
// =============================================================================

export interface UploadOptions {
  buffer: Buffer
  filename: string
  mimeType: string
  folder?: string // e.g., 'cinqueterre/images/2024/12'
}

export interface UploadFromUrlOptions {
  sourceUrl: string
  filename: string
  folder?: string
  convertToWebp?: boolean // Auto-convert images to WebP
}

export interface UploadResult {
  url: string
  key: string
  size: number
  mimeType: string
}

export interface PresignedUploadResult {
  uploadUrl: string
  key: string
  publicUrl: string
}

export interface ImageVariants {
  original: string
  large?: string    // 1600px wide
  medium?: string   // 800px wide
  small?: string    // 400px wide
  thumbnail?: string // 150x150
}

// =============================================================================
// STORAGE SERVICE CLASS
// =============================================================================

export class StorageService {
  private s3Client: S3Client
  private config: StorageConfig

  constructor(config: StorageConfig) {
    this.config = config

    // Initialize S3 client (works with R2, S3, and S3-compatible services)
    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Required for R2
      forcePathStyle: config.provider === 'r2',
    })
  }

  /**
   * Upload a buffer directly to storage
   * Returns the public CDN URL
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    const { buffer, filename, mimeType, folder } = options

    // Generate unique filename to prevent collisions
    const ext = path.extname(filename)
    const baseName = path.basename(filename, ext)
    const uniqueFilename = `${this.slugify(baseName)}-${randomUUID().slice(0, 8)}${ext}`

    // Build storage key (path)
    const key = folder
      ? `${folder}/${uniqueFilename}`
      : uniqueFilename

    // Upload to S3/R2
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Make publicly readable
        ACL: this.config.provider === 'r2' ? undefined : 'public-read',
      })
    )

    // Generate public URL
    const url = this.getPublicUrl(key)

    return {
      url,
      key,
      size: buffer.length,
      mimeType,
    }
  }

  /**
   * Download an image from external URL and upload to our storage
   * Optionally converts to WebP for better performance
   */
  async uploadFromUrl(options: UploadFromUrlOptions): Promise<UploadResult> {
    const { sourceUrl, filename, folder, convertToWebp = true } = options

    // Download the image
    const response = await fetch(sourceUrl)
    if (!response.ok) {
      throw new Error(`Failed to download image from ${sourceUrl}: ${response.statusText}`)
    }

    let buffer = Buffer.from(await response.arrayBuffer())
    let mimeType = response.headers.get('content-type') || 'application/octet-stream'
    let finalFilename = filename

    // Convert to WebP if requested and it's an image
    if (convertToWebp && mimeType.startsWith('image/') && !mimeType.includes('svg')) {
      try {
        buffer = await sharp(buffer)
          .webp({ quality: 85 })
          .toBuffer()
        mimeType = 'image/webp'
        finalFilename = filename.replace(/\.[^.]+$/, '.webp')
      } catch (error) {
        console.warn('WebP conversion failed, using original format:', error)
      }
    }

    return this.upload({
      buffer,
      filename: finalFilename,
      mimeType,
      folder,
    })
  }

  /**
   * Generate a presigned URL for direct browser upload
   * Client uploads directly to R2/S3, bypassing the server
   */
  async getPresignedUploadUrl(options: {
    filename: string
    mimeType: string
    folder?: string
    expiresIn?: number // seconds, default 1 hour
  }): Promise<PresignedUploadResult> {
    const { filename, mimeType, folder, expiresIn = 3600 } = options

    // Generate unique key
    const ext = path.extname(filename)
    const baseName = path.basename(filename, ext)
    const uniqueFilename = `${this.slugify(baseName)}-${randomUUID().slice(0, 8)}${ext}`
    const key = folder ? `${folder}/${uniqueFilename}` : uniqueFilename

    // Generate presigned URL
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: mimeType,
    })

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn })

    return {
      uploadUrl,
      key,
      publicUrl: this.getPublicUrl(key),
    }
  }

  /**
   * Delete an object from storage
   */
  async delete(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      })
    )
  }

  /**
   * Generate image variants (different sizes) for responsive images
   * Returns URLs for each variant
   */
  async generateVariants(options: {
    sourceBuffer: Buffer
    baseFilename: string
    folder?: string
  }): Promise<ImageVariants> {
    const { sourceBuffer, baseFilename, folder } = options

    const baseName = path.basename(baseFilename, path.extname(baseFilename))
    const folderPath = folder || 'images'

    // Upload original
    const original = await this.upload({
      buffer: sourceBuffer,
      filename: `${baseName}.webp`,
      mimeType: 'image/webp',
      folder: folderPath,
    })

    const variants: ImageVariants = {
      original: original.url,
    }

    // Generate resized variants
    const sizes = [
      { name: 'large', width: 1600 },
      { name: 'medium', width: 800 },
      { name: 'small', width: 400 },
      { name: 'thumbnail', width: 150, height: 150 },
    ]

    for (const size of sizes) {
      try {
        const resized = await sharp(sourceBuffer)
          .resize(size.width, size.height, {
            fit: size.height ? 'cover' : 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toBuffer()

        const result = await this.upload({
          buffer: resized,
          filename: `${baseName}-${size.name}.webp`,
          mimeType: 'image/webp',
          folder: folderPath,
        })

        variants[size.name as keyof ImageVariants] = result.url
      } catch (error) {
        console.warn(`Failed to generate ${size.name} variant:`, error)
      }
    }

    return variants
  }

  /**
   * Get the public URL for a storage key
   */
  getPublicUrl(key: string): string {
    if (this.config.cdnUrl) {
      return `${this.config.cdnUrl}/${key}`
    }

    // Fallback to S3/R2 URL
    if (this.config.provider === 'r2' && this.config.endpoint) {
      // R2 public URL format
      const accountId = this.config.endpoint.match(/([a-f0-9]{32})/)?.[1]
      if (accountId) {
        return `https://pub-${accountId}.r2.dev/${key}`
      }
    }

    // Generic S3 URL
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`
  }

  /**
   * Slugify a string for use in filenames
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) // Limit length
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

let storageServiceInstance: StorageService | null = null

/**
 * Get or create a storage service instance from environment variables
 */
export function getStorageService(): StorageService {
  if (storageServiceInstance) {
    return storageServiceInstance
  }

  const config: StorageConfig = {
    provider: (process.env.R2_PROVIDER || process.env.MEDIA_STORAGE_PROVIDER || 'r2') as 'r2' | 's3' | 'spaces',
    endpoint: process.env.R2_ENDPOINT || process.env.MEDIA_STORAGE_ENDPOINT,
    region: process.env.R2_REGION || process.env.MEDIA_STORAGE_REGION || 'auto',
    bucket: process.env.R2_BUCKET_NAME || process.env.MEDIA_STORAGE_BUCKET || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.MEDIA_STORAGE_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.MEDIA_STORAGE_SECRET_ACCESS_KEY || '',
    cdnUrl: process.env.R2_PUBLIC_URL || process.env.MEDIA_CDN_URL,
  }

  // Validate config
  if (!config.bucket) {
    console.warn('[StorageService] No bucket configured - storage operations will fail')
  }

  storageServiceInstance = new StorageService(config)
  return storageServiceInstance
}

/**
 * Check if storage is configured
 */
export function isStorageConfigured(): boolean {
  return !!(
    (process.env.R2_BUCKET_NAME || process.env.MEDIA_STORAGE_BUCKET) &&
    (process.env.R2_ACCESS_KEY_ID || process.env.MEDIA_STORAGE_ACCESS_KEY_ID) &&
    (process.env.R2_SECRET_ACCESS_KEY || process.env.MEDIA_STORAGE_SECRET_ACCESS_KEY)
  )
}
