#!/usr/bin/env tsx
/**
 * Image Enrichment Script
 * Adds Unsplash stock photos to pages missing images
 * Downloads images and uploads to R2 CDN for permanent storage
 */

import dotenv from 'dotenv'
import { resolve, join } from 'path'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'crypto'

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') })

const CONTENT_DIR = resolve(__dirname, '../cinqueterre.travel/content')
const PAGES_DIR = join(CONTENT_DIR, 'pages')

// =============================================================================
// R2 STORAGE
// =============================================================================

const R2_CONFIG = {
  endpoint: process.env.R2_ENDPOINT,
  region: 'auto',
  bucket: process.env.R2_BUCKET_NAME,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  cdnUrl: process.env.R2_PUBLIC_URL,
}

let s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (!s3Client && R2_CONFIG.endpoint && R2_CONFIG.accessKeyId && R2_CONFIG.secretAccessKey) {
    s3Client = new S3Client({
      endpoint: R2_CONFIG.endpoint,
      region: R2_CONFIG.region,
      credentials: {
        accessKeyId: R2_CONFIG.accessKeyId,
        secretAccessKey: R2_CONFIG.secretAccessKey,
      },
    })
  }
  return s3Client!
}

// Image cache to avoid re-uploading same images
const imageCache = new Map<string, string>()

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

async function downloadAndUploadImage(unsplashUrl: string, photoId: string): Promise<string | null> {
  // Check cache first
  if (imageCache.has(photoId)) {
    return imageCache.get(photoId)!
  }

  const key = `images/unsplash/${photoId}.jpg`

  // Check if already in R2
  if (await checkImageExists(key)) {
    const cdnUrl = `${R2_CONFIG.cdnUrl}/${key}`
    imageCache.set(photoId, cdnUrl)
    return cdnUrl
  }

  try {
    // Download from Unsplash
    const response = await fetch(unsplashUrl)
    if (!response.ok) {
      console.error(`   ❌ Failed to download: ${response.status}`)
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // Upload to R2
    const cdnUrl = await uploadToR2(buffer, key, 'image/jpeg')
    imageCache.set(photoId, cdnUrl)

    return cdnUrl
  } catch (error) {
    console.error(`   ❌ Upload error: ${error}`)
    return null
  }
}

// =============================================================================
// UNSPLASH INTEGRATION
// =============================================================================

interface UnsplashPhoto {
  id: string
  urls: { raw: string; full: string; regular: string; small: string }
  alt_description: string | null
  user: { name: string; links: { html: string } }
  links: { download_location: string }
}

async function searchUnsplashPhotos(
  query: string,
  count: number = 5
): Promise<UnsplashPhoto[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  if (!accessKey) {
    console.warn('UNSPLASH_ACCESS_KEY not configured')
    return []
  }

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
      }
    )

    if (!response.ok) return []

    const data = await response.json() as { results: UnsplashPhoto[] }
    return data.results
  } catch {
    return []
  }
}

async function triggerUnsplashDownload(photo: UnsplashPhoto): Promise<void> {
  // Trigger download tracking (required by Unsplash API terms)
  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  if (accessKey && photo.links?.download_location) {
    try {
      await fetch(photo.links.download_location, {
        headers: { Authorization: `Client-ID ${accessKey}` },
      })
    } catch {
      // Ignore errors in download tracking
    }
  }
}

function buildUnsplashUrl(photo: UnsplashPhoto, width: number = 1200): string {
  return `${photo.urls.raw}&w=${width}&q=80&fit=crop`
}

// =============================================================================
// IMAGE SEARCH QUERIES
// =============================================================================

const imageQueries: Record<string, string[]> = {
  // Villages
  monterosso: ['Monterosso al Mare beach Italy', 'Monterosso Cinque Terre colorful'],
  vernazza: ['Vernazza harbor Cinque Terre', 'Vernazza Italy boats'],
  corniglia: ['Corniglia hilltop Cinque Terre', 'Corniglia vineyards Italy'],
  manarola: ['Manarola sunset Italy', 'Manarola colorful houses'],
  riomaggiore: ['Riomaggiore harbor Cinque Terre', 'Riomaggiore Italy'],

  // Page types
  restaurants: ['Italian seafood restaurant', 'Cinque Terre dining ocean view'],
  hotels: ['Boutique hotel Italy coast', 'Italian Riviera accommodation'],
  hiking: ['Cinque Terre coastal trail', 'Liguria hiking path sea view'],
  beaches: ['Cinque Terre beach swimming', 'Italian Riviera beach'],
  weather: ['Cinque Terre sunny coast', 'Italian Mediterranean coastline'],
  transport: ['Cinque Terre train', 'Italian coastal railway'],
  events: ['Italian festival celebration', 'Cinque Terre local event'],
  overview: ['Cinque Terre panorama aerial', 'Five villages Italy coast'],
  region: ['Cinque Terre aerial view', 'Italian Riviera coastline'],

  // Default
  default: ['Cinque Terre Italy colorful', 'Italian Riviera coast'],
}

function getSearchQuery(pageType: string, village?: string): string {
  // Try village-specific query first
  if (village && imageQueries[village]) {
    return imageQueries[village][Math.floor(Math.random() * imageQueries[village].length)]
  }

  // Then page type
  if (imageQueries[pageType]) {
    return imageQueries[pageType][Math.floor(Math.random() * imageQueries[pageType].length)]
  }

  // Default
  return imageQueries.default[Math.floor(Math.random() * imageQueries.default.length)]
}

// =============================================================================
// PAGE PROCESSING
// =============================================================================

interface PageSection {
  type: string
  variant?: string
  image?: string
  backgroundImage?: string
  [key: string]: unknown
}

interface PageData {
  body: PageSection[]
  [key: string]: unknown
}

function hasImage(section: PageSection): boolean {
  return !!(section.image || section.backgroundImage)
}

function needsImage(section: PageSection): boolean {
  const imageTypes = ['hero-section', 'content-section', 'gallery-section', 'testimonial-section']
  return imageTypes.includes(section.type) && !hasImage(section)
}

async function enrichPageWithImages(
  pagePath: string,
  pageType: string,
  village?: string,
  dryRun: boolean = false
): Promise<{ updated: boolean; imagesAdded: number }> {
  const pageData = JSON.parse(readFileSync(pagePath, 'utf-8')) as PageData
  let imagesAdded = 0

  if (!pageData.body || !Array.isArray(pageData.body)) {
    return { updated: false, imagesAdded: 0 }
  }

  // Check if R2 is configured for CDN upload
  const useR2 = !!(R2_CONFIG.endpoint && R2_CONFIG.bucket && R2_CONFIG.accessKeyId && R2_CONFIG.cdnUrl)

  for (const section of pageData.body) {
    if (needsImage(section)) {
      // Get search query
      const query = getSearchQuery(pageType, village)

      // Search Unsplash
      const photos = await searchUnsplashPhotos(query, 3)

      if (photos.length > 0) {
        const photo = photos[Math.floor(Math.random() * photos.length)]

        let imageUrl: string | null = null

        if (useR2) {
          // Download from Unsplash and upload to R2 CDN
          const unsplashUrl = buildUnsplashUrl(photo)
          console.log(`   ⬇️  Downloading ${photo.id}...`)

          // Trigger Unsplash download tracking (required by API terms)
          await triggerUnsplashDownload(photo)

          imageUrl = await downloadAndUploadImage(unsplashUrl, photo.id)

          if (imageUrl) {
            console.log(`   ⬆️  Uploaded to CDN`)
          }
        } else {
          // Fallback to direct Unsplash URL (not recommended for production)
          console.warn('   ⚠️  R2 not configured - using Unsplash URL directly')
          imageUrl = buildUnsplashUrl(photo)
        }

        if (imageUrl) {
          // Add image to section
          section.image = imageUrl
          imagesAdded++
        }
      }
    }
  }

  if (imagesAdded > 0 && !dryRun) {
    writeFileSync(pagePath, JSON.stringify(pageData, null, 2))
  }

  return { updated: imagesAdded > 0, imagesAdded }
}

// =============================================================================
// PAGE DISCOVERY
// =============================================================================

interface PageInfo {
  path: string
  relativePath: string
  pageType: string
  village?: string
}

function discoverPages(): PageInfo[] {
  const pages: PageInfo[] = []

  function scanDirectory(dir: string, baseSlug: string = '') {
    const items = readdirSync(dir, { withFileTypes: true })

    for (const item of items) {
      const fullPath = join(dir, item.name)

      if (item.isDirectory()) {
        scanDirectory(fullPath, baseSlug ? `${baseSlug}/${item.name}` : item.name)
      } else if (item.name.endsWith('.json')) {
        const slug = item.name.replace('.json', '')
        const relativePath = baseSlug ? `${baseSlug}/${slug}` : slug
        const pathParts = relativePath.split('/')

        // Determine page type
        let pageType = 'general'
        if (pathParts.includes('restaurants')) pageType = 'restaurants'
        else if (pathParts.includes('hotels') || pathParts.includes('accommodations')) pageType = 'hotels'
        else if (pathParts.includes('hiking') || pathParts.includes('hikes')) pageType = 'hiking'
        else if (pathParts.includes('beaches')) pageType = 'beaches'
        else if (pathParts.includes('events')) pageType = 'events'
        else if (pathParts.includes('weather')) pageType = 'weather'
        else if (pathParts.includes('transport')) pageType = 'transport'
        else if (slug === 'cinque-terre') pageType = 'region'
        else if (['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'].includes(slug)) {
          pageType = 'village'
        }

        // Determine village
        const villages = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']
        const village = pathParts.find(p => villages.includes(p)) ||
          (villages.includes(slug) ? slug : undefined)

        pages.push({ path: fullPath, relativePath, pageType, village })
      }
    }
  }

  scanDirectory(PAGES_DIR)
  return pages
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const verbose = !args.includes('--quiet')

  console.log('\n' + '═'.repeat(60))
  console.log('  cinqueterre.travel Image Enrichment')
  console.log('═'.repeat(60))

  if (dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be saved')
  }

  // Check Unsplash API
  if (!process.env.UNSPLASH_ACCESS_KEY) {
    console.error('\n❌ UNSPLASH_ACCESS_KEY not configured')
    process.exit(1)
  }

  // Check R2 configuration
  const useR2 = !!(R2_CONFIG.endpoint && R2_CONFIG.bucket && R2_CONFIG.accessKeyId && R2_CONFIG.cdnUrl)
  if (useR2) {
    console.log(`\n📦 R2 Storage: ${R2_CONFIG.bucket}`)
    console.log(`🌐 CDN URL: ${R2_CONFIG.cdnUrl}`)
  } else {
    console.warn('\n⚠️  R2 not configured - images will use Unsplash URLs directly')
    console.warn('   Set R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL')
  }

  // Discover pages
  console.log('\n📄 Discovering pages...')
  const pages = discoverPages()
  console.log(`   Found ${pages.length} pages`)

  // Process pages
  console.log('\n🖼️  Adding images...')

  let processed = 0
  let updated = 0
  let totalImages = 0

  for (const page of pages) {
    processed++

    if (verbose) {
      console.log(`\n[${processed}/${pages.length}] ${page.relativePath}`)
    }

    try {
      const result = await enrichPageWithImages(
        page.path,
        page.pageType,
        page.village,
        dryRun
      )

      if (result.updated) {
        updated++
        totalImages += result.imagesAdded
        if (verbose) {
          console.log(`   ✓ Added ${result.imagesAdded} image(s)`)
        }
      } else if (verbose) {
        console.log(`   ⏭️  No images needed`)
      }

      // Rate limit Unsplash API
      await sleep(500)
    } catch (error) {
      console.error(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`)
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('  Enrichment Complete')
  console.log('═'.repeat(60))
  console.log(`\n   Pages processed: ${processed}`)
  console.log(`   Pages updated: ${updated}`)
  console.log(`   Images added: ${totalImages}`)

  console.log('\nNext steps:')
  console.log('  1. tsx scripts/audit-generated-content.ts')
  console.log('  2. tsx scripts/deploy-cinqueterre.ts')
  console.log('')
}

main().catch(err => {
  console.error('Enrichment failed:', err)
  process.exit(1)
})
