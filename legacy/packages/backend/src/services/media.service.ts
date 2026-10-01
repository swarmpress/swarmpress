/**
 * Media Service
 * Handles file uploads, storage, and processing for images and other media
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import path from 'path';
import { Pool } from 'pg';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface MediaConfig {
  provider: 'r2' | 's3' | 'spaces';
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  cdnUrl?: string; // Optional CDN URL (e.g., Cloudflare CDN)
}

// =============================================================================
// IMAGE VARIANT CONFIGURATION
// =============================================================================

interface ImageVariant {
  name: string;
  width: number;
  height?: number; // If not specified, maintains aspect ratio
  format?: 'webp' | 'jpeg' | 'png';
  quality?: number;
}

const IMAGE_VARIANTS: ImageVariant[] = [
  { name: 'thumbnail', width: 150, height: 150, format: 'webp', quality: 85 },
  { name: 'small', width: 400, format: 'webp', quality: 85 },
  { name: 'medium', width: 800, format: 'webp', quality: 85 },
  { name: 'large', width: 1600, format: 'webp', quality: 90 },
  { name: 'hero', width: 2400, format: 'webp', quality: 90 },
];

// =============================================================================
// TYPES
// =============================================================================

interface UploadOptions {
  websiteId: string;
  file: Buffer;
  filename: string;
  mimeType: string;
  altText?: string;
  caption?: string;
  title?: string;
  tags?: string[];
  category?: string;
  uploadedByAgentId?: string;
  uploadedByUserId?: string;
  uploadSource?: string;
}

interface MediaRecord {
  id: string;
  website_id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  storage_provider: string;
  storage_bucket: string;
  storage_path: string;
  storage_region: string | null;
  url: string;
  cdn_provider: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  variants: any[];
  alt_text: string | null;
  caption: string | null;
  title: string | null;
  seo_filename: string | null;
  tags: string[];
  category: string | null;
  used_in_collections: string[];
  usage_count: number;
  last_used_at: Date | null;
  processing_status: string;
  processing_error: string | null;
  variants_generated: boolean;
  uploaded_by_agent_id: string | null;
  uploaded_by_user_id: string | null;
  upload_source: string | null;
  ai_description: string | null;
  ai_tags: string[] | null;
  ai_alt_text: string | null;
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// MEDIA SERVICE CLASS
// =============================================================================

export class MediaService {
  private s3Client: S3Client;
  private config: MediaConfig;
  private db: Pool;

  constructor(config: MediaConfig, db: Pool) {
    this.config = config;
    this.db = db;

    // Initialize S3 client
    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /**
   * Upload a file to S3/R2 storage
   */
  async uploadMedia(options: UploadOptions): Promise<MediaRecord> {
    const {
      websiteId,
      file,
      filename,
      mimeType,
      altText,
      caption,
      title,
      tags = [],
      category,
      uploadedByAgentId,
      uploadedByUserId,
      uploadSource = 'user_uploaded',
    } = options;

    // Generate unique filename
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext);
    const uniqueFilename = `${baseName}-${randomUUID()}${ext}`;
    const storagePath = `${websiteId}/media/${uniqueFilename}`;

    // Get file metadata
    const sizeBytes = file.length;
    let width: number | null = null;
    let height: number | null = null;
    let format: string | null = null;

    // If it's an image, get dimensions
    if (mimeType.startsWith('image/')) {
      try {
        const metadata = await sharp(file).metadata();
        width = metadata.width || null;
        height = metadata.height || null;
        format = metadata.format || null;
      } catch (error) {
        console.error('Error getting image metadata:', error);
      }
    }

    // Upload original file to S3/R2
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: storagePath,
        Body: file,
        ContentType: mimeType,
      })
    );

    // Generate URL
    const url = this.config.cdnUrl
      ? `${this.config.cdnUrl}/${storagePath}`
      : `https://${this.config.bucket}.${this.config.endpoint?.replace('https://', '')}/${storagePath}`;

    // Generate SEO-friendly filename
    const seoFilename = baseName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Insert into database
    const result = await this.db.query<MediaRecord>(
      `INSERT INTO media (
        website_id, filename, original_filename, mime_type, size_bytes,
        storage_provider, storage_bucket, storage_path, storage_region,
        url, cdn_provider, width, height, format,
        alt_text, caption, title, seo_filename, tags, category,
        uploaded_by_agent_id, uploaded_by_user_id, upload_source,
        processing_status, variants_generated
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20,
        $21, $22, $23,
        $24, $25
      ) RETURNING *`,
      [
        websiteId,
        uniqueFilename,
        filename,
        mimeType,
        sizeBytes,
        this.config.provider,
        this.config.bucket,
        storagePath,
        this.config.region,
        url,
        this.config.cdnUrl ? 'cloudflare' : null,
        width,
        height,
        format,
        altText || null,
        caption || null,
        title || null,
        seoFilename,
        tags,
        category || null,
        uploadedByAgentId || null,
        uploadedByUserId || null,
        uploadSource,
        mimeType.startsWith('image/') ? 'pending' : 'completed',
        false,
      ]
    );

    const mediaRecord = result.rows[0];

    // Queue variant generation for images
    if (mimeType.startsWith('image/')) {
      await this.queueMediaProcessing(mediaRecord.id, 'generate_variants');
    }

    return mediaRecord;
  }

  /**
   * Generate image variants (thumbnails, different sizes)
   */
  async generateVariants(mediaId: string): Promise<void> {
    // Get media record
    const result = await this.db.query<MediaRecord>(
      'SELECT * FROM media WHERE id = $1',
      [mediaId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    const media = result.rows[0];

    if (!media.mime_type.startsWith('image/')) {
      throw new Error('Media is not an image');
    }

    try {
      // Download original image from S3
      const getCommand = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: media.storage_path,
      });

      const response = await this.s3Client.send(getCommand);
      const originalBuffer = Buffer.from(await response.Body!.transformToByteArray());

      const variants = [];

      // Generate each variant
      for (const variantConfig of IMAGE_VARIANTS) {
        const variantFilename = `${path.basename(
          media.filename,
          path.extname(media.filename)
        )}-${variantConfig.name}.${variantConfig.format || 'webp'}`;

        const variantPath = `${media.website_id}/media/variants/${variantFilename}`;

        // Resize and optimize image
        let pipeline = sharp(originalBuffer).resize(
          variantConfig.width,
          variantConfig.height,
          {
            fit: variantConfig.height ? 'cover' : 'inside',
            withoutEnlargement: true,
          }
        );

        // Convert to target format
        if (variantConfig.format === 'webp') {
          pipeline = pipeline.webp({ quality: variantConfig.quality || 85 });
        } else if (variantConfig.format === 'jpeg') {
          pipeline = pipeline.jpeg({ quality: variantConfig.quality || 85 });
        } else if (variantConfig.format === 'png') {
          pipeline = pipeline.png({ quality: variantConfig.quality || 85 });
        }

        const variantBuffer = await pipeline.toBuffer();
        const variantMetadata = await sharp(variantBuffer).metadata();

        // Upload variant to S3
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: variantPath,
            Body: variantBuffer,
            ContentType: `image/${variantConfig.format || 'webp'}`,
          })
        );

        // Generate URL
        const variantUrl = this.config.cdnUrl
          ? `${this.config.cdnUrl}/${variantPath}`
          : `https://${this.config.bucket}.${this.config.endpoint?.replace('https://', '')}/${variantPath}`;

        variants.push({
          name: variantConfig.name,
          url: variantUrl,
          width: variantMetadata.width,
          height: variantMetadata.height,
          format: variantConfig.format || 'webp',
          size_bytes: variantBuffer.length,
        });
      }

      // Update media record with variants
      await this.db.query(
        `UPDATE media
         SET variants = $1,
             variants_generated = true,
             processing_status = 'completed',
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(variants), mediaId]
      );
    } catch (error) {
      // Update processing status to failed
      await this.db.query(
        `UPDATE media
         SET processing_status = 'failed',
             processing_error = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [error instanceof Error ? error.message : 'Unknown error', mediaId]
      );

      throw error;
    }
  }

  /**
   * Generate a presigned URL for direct upload from the browser
   */
  async generatePresignedUploadUrl(
    websiteId: string,
    filename: string,
    mimeType: string,
    expiresIn: number = 3600
  ): Promise<{ url: string; key: string }> {
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext);
    const uniqueFilename = `${baseName}-${randomUUID()}${ext}`;
    const key = `${websiteId}/media/${uniqueFilename}`;

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: mimeType,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn });

    return { url, key };
  }

  /**
   * Generate a presigned URL for downloading a file
   */
  async generatePresignedDownloadUrl(
    storagePath: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: storagePath,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Delete a media file and all its variants
   */
  async deleteMedia(mediaId: string): Promise<void> {
    // Get media record
    const result = await this.db.query<MediaRecord>(
      'SELECT * FROM media WHERE id = $1',
      [mediaId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    const media = result.rows[0];

    // Delete original file from S3
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: media.storage_path,
      })
    );

    // Delete variants if they exist
    if (media.variants && media.variants.length > 0) {
      for (const variant of media.variants) {
        const variantPath = new URL(variant.url).pathname.substring(1);
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.config.bucket,
            Key: variantPath,
          })
        );
      }
    }

    // Delete from database
    await this.db.query('DELETE FROM media WHERE id = $1', [mediaId]);
  }

  /**
   * Queue media processing task
   */
  private async queueMediaProcessing(
    mediaId: string,
    taskType: string
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO media_processing_queue (media_id, task_type, priority)
       VALUES ($1, $2, $3)`,
      [mediaId, taskType, 5]
    );
  }

  /**
   * Get media by ID
   */
  async getMedia(mediaId: string): Promise<MediaRecord | null> {
    const result = await this.db.query<MediaRecord>(
      'SELECT * FROM media WHERE id = $1',
      [mediaId]
    );

    return result.rows[0] || null;
  }

  /**
   * List media for a website
   */
  async listMedia(
    websiteId: string,
    options: {
      limit?: number;
      offset?: number;
      category?: string;
      tags?: string[];
      mimeType?: string;
    } = {}
  ): Promise<{ items: MediaRecord[]; total: number }> {
    const { limit = 50, offset = 0, category, tags, mimeType } = options;

    let whereConditions = ['website_id = $1'];
    const params: any[] = [websiteId];
    let paramIndex = 2;

    if (category) {
      whereConditions.push(`category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    if (tags && tags.length > 0) {
      whereConditions.push(`tags && $${paramIndex}`);
      params.push(tags);
      paramIndex++;
    }

    if (mimeType) {
      whereConditions.push(`mime_type LIKE $${paramIndex}`);
      params.push(`${mimeType}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countResult = await this.db.query(
      `SELECT COUNT(*) as count FROM media WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get items
    const itemsResult = await this.db.query<MediaRecord>(
      `SELECT * FROM media
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      items: itemsResult.rows,
      total,
    };
  }

  /**
   * Update media metadata
   */
  async updateMedia(
    mediaId: string,
    updates: {
      altText?: string;
      caption?: string;
      title?: string;
      tags?: string[];
      category?: string;
    }
  ): Promise<MediaRecord> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.altText !== undefined) {
      fields.push(`alt_text = $${paramIndex++}`);
      values.push(updates.altText);
    }

    if (updates.caption !== undefined) {
      fields.push(`caption = $${paramIndex++}`);
      values.push(updates.caption);
    }

    if (updates.title !== undefined) {
      fields.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }

    if (updates.tags !== undefined) {
      fields.push(`tags = $${paramIndex++}`);
      values.push(updates.tags);
    }

    if (updates.category !== undefined) {
      fields.push(`category = $${paramIndex++}`);
      values.push(updates.category);
    }

    fields.push(`updated_at = NOW()`);

    values.push(mediaId);

    const result = await this.db.query<MediaRecord>(
      `UPDATE media SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    return result.rows[0];
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a media service instance from environment variables
 */
export function createMediaService(db: Pool): MediaService {
  const config: MediaConfig = {
    provider: (process.env.MEDIA_STORAGE_PROVIDER || 'r2') as 'r2' | 's3' | 'spaces',
    endpoint: process.env.MEDIA_STORAGE_ENDPOINT,
    region: process.env.MEDIA_STORAGE_REGION || 'auto',
    bucket: process.env.MEDIA_STORAGE_BUCKET || '',
    accessKeyId: process.env.MEDIA_STORAGE_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.MEDIA_STORAGE_SECRET_ACCESS_KEY || '',
    cdnUrl: process.env.MEDIA_CDN_URL,
  };

  if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error('Media storage configuration is incomplete');
  }

  return new MediaService(config, db);
}
