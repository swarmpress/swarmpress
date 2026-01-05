#!/usr/bin/env npx tsx
/**
 * Migrate Images to CDN
 *
 * This script:
 * 1. Scans all page JSON files for Unsplash image URLs
 * 2. Downloads each image
 * 3. Uploads to R2/CDN storage
 * 4. Updates the JSON files with CDN URLs
 */

import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'crypto'

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') })

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONTENT_DIR = path.join(__dirname, '../cinqueterre.travel/content/pages')
const R2_CONFIG = {
  endpoint: process.env.R2_ENDPOINT!,
  region: 'auto',
  bucket: process.env.R2_BUCKET_NAME!,
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  cdnUrl: process.env.R2_PUBLIC_URL!,
}

// Regex to match Unsplash URLs
const UNSPLASH_URL_REGEX = /https:\/\/images\.unsplash\.com\/[^\s"']+/g

// =============================================================================
// R2 CLIENT
// =============================================================================

let s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: R2_CONFIG.endpoint,
      region: R2_CONFIG.region,
      credentials: {
        accessKeyId: R2_CONFIG.accessKeyId,
        secretAccessKey: R2_CONFIG.secretAccessKey,
      },
    })
  }
  return s3Client
}

// =============================================================================
// IMAGE MIGRATION
// =============================================================================

interface ImageMapping {
  original: string
  cdn: string
}

const imageCache = new Map<string, string>() // original URL -> CDN URL

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function checkImageExists(key: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({
      Bucket: R2_CONFIG.bucket,
      Key: key,
    }))
    return true
  } catch {
    return false
  }
}

async function uploadToR2(buffer: Buffer, key: string, contentType: string): Promise<string> {
  await getS3Client().send(new PutObjectCommand({
    Bucket: R2_CONFIG.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))
  return `${R2_CONFIG.cdnUrl}/${key}`
}

function generateImageKey(url: string): string {
  // Extract photo ID from Unsplash URL
  const photoIdMatch = url.match(/photo-([a-zA-Z0-9_-]+)/)
  const photoId = photoIdMatch ? photoIdMatch[1] : crypto.createHash('md5').update(url).digest('hex').slice(0, 12)

  // Determine quality/size from URL params
  const isHero = url.includes('w=1200') || url.includes('w=2400')
  const size = isHero ? 'hero' : 'regular'

  return `images/${photoId}-${size}.jpg`
}

async function migrateImage(unsplashUrl: string): Promise<string> {
  // Check cache first
  if (imageCache.has(unsplashUrl)) {
    return imageCache.get(unsplashUrl)!
  }

  const key = generateImageKey(unsplashUrl)

  // Check if already exists in R2
  if (await checkImageExists(key)) {
    const cdnUrl = `${R2_CONFIG.cdnUrl}/${key}`
    imageCache.set(unsplashUrl, cdnUrl)
    return cdnUrl
  }

  // Download and upload
  console.log(`   ⬇️  Downloading: ${unsplashUrl.slice(0, 60)}...`)
  const buffer = await downloadImage(unsplashUrl)

  console.log(`   ⬆️  Uploading: ${key}`)
  const cdnUrl = await uploadToR2(buffer, key, 'image/jpeg')

  imageCache.set(unsplashUrl, cdnUrl)
  return cdnUrl
}

// =============================================================================
// PAGE PROCESSING
// =============================================================================

function findUnsplashUrls(obj: any): string[] {
  const urls: string[] = []

  function traverse(value: any) {
    if (typeof value === 'string') {
      const matches = value.match(UNSPLASH_URL_REGEX)
      if (matches) {
        urls.push(...matches)
      }
    } else if (Array.isArray(value)) {
      value.forEach(traverse)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(traverse)
    }
  }

  traverse(obj)
  return [...new Set(urls)] // Deduplicate
}

function replaceUrls(obj: any, mappings: Map<string, string>): any {
  if (typeof obj === 'string') {
    let result = obj
    for (const [original, cdn] of mappings) {
      result = result.replace(original, cdn)
    }
    return result
  } else if (Array.isArray(obj)) {
    return obj.map(item => replaceUrls(item, mappings))
  } else if (obj && typeof obj === 'object') {
    const result: any = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceUrls(value, mappings)
    }
    return result
  }
  return obj
}

async function processPage(filePath: string): Promise<{ updated: boolean; imageCount: number }> {
  const content = fs.readFileSync(filePath, 'utf-8')
  const pageData = JSON.parse(content)

  // Find all Unsplash URLs
  const unsplashUrls = findUnsplashUrls(pageData)

  if (unsplashUrls.length === 0) {
    return { updated: false, imageCount: 0 }
  }

  // Migrate each image
  const mappings = new Map<string, string>()
  for (const url of unsplashUrls) {
    try {
      const cdnUrl = await migrateImage(url)
      mappings.set(url, cdnUrl)
    } catch (error) {
      console.error(`   ❌ Failed to migrate: ${url}`)
      console.error(`      ${error}`)
    }
  }

  if (mappings.size === 0) {
    return { updated: false, imageCount: 0 }
  }

  // Replace URLs in page data
  const updatedData = replaceUrls(pageData, mappings)

  // Write updated file
  fs.writeFileSync(filePath, JSON.stringify(updatedData, null, 2))

  return { updated: true, imageCount: mappings.size }
}

// =============================================================================
// DISCOVERY
// =============================================================================

function discoverPages(dir: string): string[] {
  const pages: string[] = []
  const items = fs.readdirSync(dir, { withFileTypes: true })

  for (const item of items) {
    const fullPath = path.join(dir, item.name)
    if (item.isDirectory()) {
      pages.push(...discoverPages(fullPath))
    } else if (item.name.endsWith('.json')) {
      pages.push(fullPath)
    }
  }

  return pages
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('═'.repeat(60))
  console.log('  Migrate Images to CDN')
  console.log('═'.repeat(60))

  // Verify configuration
  if (!R2_CONFIG.endpoint || !R2_CONFIG.bucket || !R2_CONFIG.accessKeyId) {
    console.error('\n❌ R2 configuration missing. Set environment variables:')
    console.error('   R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL')
    process.exit(1)
  }

  console.log(`\n📦 R2 Bucket: ${R2_CONFIG.bucket}`)
  console.log(`🌐 CDN URL: ${R2_CONFIG.cdnUrl}`)

  // Discover pages
  console.log('\n📄 Discovering pages...')
  const pages = discoverPages(CONTENT_DIR)
  console.log(`   Found ${pages.length} pages`)

  // Process each page
  console.log('\n🖼️  Migrating images...\n')

  let totalImages = 0
  let pagesUpdated = 0

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const relativePath = path.relative(CONTENT_DIR, page).replace('.json', '')

    process.stdout.write(`[${i + 1}/${pages.length}] ${relativePath}`)

    try {
      const result = await processPage(page)

      if (result.updated) {
        console.log(` ✓ ${result.imageCount} image(s) migrated`)
        totalImages += result.imageCount
        pagesUpdated++
      } else {
        console.log(' ⏭️  No Unsplash images')
      }
    } catch (error) {
      console.log(` ❌ Error: ${error}`)
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('  Migration Complete')
  console.log('═'.repeat(60))
  console.log(`\n   Pages processed: ${pages.length}`)
  console.log(`   Pages updated: ${pagesUpdated}`)
  console.log(`   Images migrated: ${totalImages}`)
  console.log(`\nNext steps:`)
  console.log(`  1. node cinqueterre.travel/build-all-pages.js`)
  console.log(`  2. ./cinqueterre.travel/build-and-deploy.sh`)
}

main().catch(console.error)
