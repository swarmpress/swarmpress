#!/usr/bin/env npx tsx
/**
 * Fix Broken Images Script
 * Replaces broken image URLs with working Unsplash images
 */

import { readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY

if (!UNSPLASH_ACCESS_KEY) {
  console.error('❌ UNSPLASH_ACCESS_KEY environment variable is required')
  process.exit(1)
}

// Parse arguments
const args = process.argv.slice(2)
const contentPath = args[0] || 'cinqueterre.travel/content'
const dryRun = args.includes('--dry-run')

interface BrokenImage {
  url: string
  file: string
  relativePath: string
  jsonPath: string
  context?: string
}

interface UnsplashPhoto {
  id: string
  urls: {
    raw: string
    full: string
    regular: string
    small: string
  }
  user: {
    name: string
    username: string
  }
  alt_description?: string
}

// Context-based search queries for different image types
function getSearchQuery(url: string, jsonPath: string, fileName: string): string {
  const urlLower = url.toLowerCase()
  const pathLower = jsonPath.toLowerCase()
  const fileLower = fileName.toLowerCase()

  // Accommodation-specific queries
  if (fileLower.includes('accommodation') || pathLower.includes('accommodation')) {
    if (pathLower.includes('exterior') || urlLower.includes('exterior')) {
      return 'italian hotel exterior cinque terre'
    }
    if (pathLower.includes('interior') || urlLower.includes('interior') || urlLower.includes('room')) {
      return 'hotel room interior mediterranean'
    }
    if (pathLower.includes('view') || urlLower.includes('view') || urlLower.includes('terrace')) {
      return 'hotel terrace sea view italy'
    }
    if (pathLower.includes('bathroom') || urlLower.includes('bathroom')) {
      return 'hotel bathroom modern'
    }
    if (pathLower.includes('breakfast') || urlLower.includes('breakfast')) {
      return 'italian breakfast terrace'
    }
    return 'italian hotel room mediterranean'
  }

  // Restaurant-specific queries
  if (fileLower.includes('restaurant') || pathLower.includes('restaurant')) {
    if (urlLower.includes('terrace') || urlLower.includes('view')) {
      return 'italian restaurant terrace sea view'
    }
    if (urlLower.includes('wine')) {
      return 'italian wine glasses restaurant'
    }
    if (urlLower.includes('bruschetta') || urlLower.includes('food')) {
      return 'italian food bruschetta'
    }
    if (urlLower.includes('anchov')) {
      return 'italian anchovies food'
    }
    return 'italian restaurant cinque terre'
  }

  // Village-specific queries
  const villages = ['riomaggiore', 'manarola', 'corniglia', 'vernazza', 'monterosso']
  for (const village of villages) {
    if (fileLower.includes(village) || urlLower.includes(village)) {
      return `${village} cinque terre italy colorful houses`
    }
  }

  // Generic Cinque Terre query
  if (urlLower.includes('aerial') || urlLower.includes('panoram')) {
    return 'cinque terre aerial view italy'
  }
  if (urlLower.includes('sunset')) {
    return 'cinque terre sunset italy'
  }
  if (urlLower.includes('beach')) {
    return 'cinque terre beach italy'
  }
  if (urlLower.includes('hiking') || urlLower.includes('trail')) {
    return 'cinque terre hiking trail'
  }

  return 'cinque terre italy colorful village'
}

// Search Unsplash for images
async function searchUnsplash(query: string): Promise<UnsplashPhoto | null> {
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`
    const response = await fetch(url, {
      headers: {
        'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`,
      },
    })

    if (!response.ok) {
      console.error(`Unsplash API error: ${response.status}`)
      return null
    }

    const data = await response.json()
    if (data.results && data.results.length > 0) {
      return data.results[0]
    }
    return null
  } catch (error) {
    console.error('Unsplash search error:', error)
    return null
  }
}

// Cache for replacement URLs to avoid duplicate searches
const replacementCache = new Map<string, string>()
const searchCache = new Map<string, UnsplashPhoto | null>()

// Get a replacement URL for a broken image
async function getReplacementUrl(brokenUrl: string, jsonPath: string, fileName: string): Promise<string | null> {
  // Check cache first
  if (replacementCache.has(brokenUrl)) {
    return replacementCache.get(brokenUrl)!
  }

  const query = getSearchQuery(brokenUrl, jsonPath, fileName)

  // Check if we've already searched for this query
  let photo: UnsplashPhoto | null
  if (searchCache.has(query)) {
    photo = searchCache.get(query)!
  } else {
    console.log(`  🔍 Searching: "${query}"`)
    photo = await searchUnsplash(query)
    searchCache.set(query, photo)

    // Rate limiting - Unsplash has a 50 requests/hour limit for demo apps
    await new Promise(r => setTimeout(r, 100))
  }

  if (photo) {
    // Use regular size for content images
    const newUrl = photo.urls.regular
    replacementCache.set(brokenUrl, newUrl)
    return newUrl
  }

  return null
}

// Update a value at a JSON path
function setValueAtPath(obj: any, path: string, value: any): void {
  const parts = path.split(/\.|\[|\]/).filter(p => p !== '')
  let current = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    const key = isNaN(Number(part)) ? part : Number(part)
    current = current[key]
    if (current === undefined) return
  }

  const lastPart = parts[parts.length - 1]
  const lastKey = isNaN(Number(lastPart)) ? lastPart : Number(lastPart)
  current[lastKey] = value
}

// Load broken images from audit report
async function loadBrokenImages(auditReportPath: string): Promise<BrokenImage[]> {
  const content = await readFile(auditReportPath, 'utf-8')
  const report = JSON.parse(content)

  return report.issues
    .filter((i: any) => i.category === 'broken_image')
    .map((i: any) => ({
      url: i.url,
      file: i.file,
      relativePath: i.relativePath,
      jsonPath: i.jsonPath,
      context: i.details?.context,
    }))
}

// Find the most recent audit report
async function findLatestAuditReport(contentPath: string): Promise<string | null> {
  const files = await readdir(contentPath)
  const auditFiles = files
    .filter(f => f.startsWith('audit-report-') && f.endsWith('.json'))
    .sort()
    .reverse()

  if (auditFiles.length === 0) return null
  return join(contentPath, auditFiles[0])
}

async function main() {
  console.log('\n🔧 Fix Broken Images')
  console.log('====================\n')

  const resolvedPath = contentPath.startsWith('/') ? contentPath : join(process.cwd(), contentPath)

  if (!existsSync(resolvedPath)) {
    console.error(`❌ Content path not found: ${resolvedPath}`)
    process.exit(1)
  }

  // Find the latest audit report
  const auditReportPath = await findLatestAuditReport(resolvedPath)
  if (!auditReportPath) {
    console.error('❌ No audit report found. Run the audit first.')
    process.exit(1)
  }

  console.log(`📄 Using audit report: ${auditReportPath}`)
  console.log(`🔧 Dry run: ${dryRun}`)
  console.log('')

  // Load broken images
  const brokenImages = await loadBrokenImages(auditReportPath)
  console.log(`📷 Found ${brokenImages.length} broken image references`)

  // Get unique URLs
  const uniqueUrls = [...new Set(brokenImages.map(b => b.url))]
  console.log(`🔗 ${uniqueUrls.length} unique broken URLs\n`)

  // Group by file for efficient updates
  const byFile = new Map<string, BrokenImage[]>()
  for (const img of brokenImages) {
    const list = byFile.get(img.relativePath) || []
    list.push(img)
    byFile.set(img.relativePath, list)
  }

  console.log(`📁 Affected files: ${byFile.size}\n`)

  // Process each file
  let totalFixed = 0
  let totalFailed = 0

  for (const [relativePath, images] of byFile) {
    const filePath = join(resolvedPath, relativePath)
    console.log(`\n📄 Processing: ${relativePath}`)

    try {
      const content = await readFile(filePath, 'utf-8')
      let json = JSON.parse(content)
      let fileFixed = 0

      // Get unique broken URLs in this file
      const fileUrls = [...new Set(images.map(i => i.url))]

      for (const brokenUrl of fileUrls) {
        // Find the first image with this URL to get context
        const img = images.find(i => i.url === brokenUrl)!

        const replacement = await getReplacementUrl(brokenUrl, img.jsonPath, relativePath)

        if (replacement) {
          console.log(`  ✅ ${brokenUrl.substring(0, 60)}...`)
          console.log(`     → ${replacement.substring(0, 60)}...`)

          // Replace all occurrences in the file content
          const contentStr = JSON.stringify(json)
          const updatedStr = contentStr.split(brokenUrl).join(replacement)
          json = JSON.parse(updatedStr)

          fileFixed++
          totalFixed++
        } else {
          console.log(`  ❌ No replacement found for: ${brokenUrl.substring(0, 60)}...`)
          totalFailed++
        }
      }

      // Write the updated file
      if (!dryRun && fileFixed > 0) {
        await writeFile(filePath, JSON.stringify(json, null, 2))
        console.log(`  💾 Saved ${fileFixed} fixes`)
      }

    } catch (error) {
      console.error(`  ❌ Error processing file: ${error}`)
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log(`\n✅ Fixed: ${totalFixed} images`)
  console.log(`❌ Failed: ${totalFailed} images`)

  if (dryRun) {
    console.log('\n⚠️  Dry run - no files were modified')
    console.log('   Run without --dry-run to apply changes')
  }
}

main().catch(error => {
  console.error('\n❌ Script failed:', error)
  process.exit(1)
})
