/**
 * Migration Script: Convert ContentItems to Pages
 * Migrates existing content_items to the new pages table
 */

import { db } from '../db/connection'

interface MigrationStats {
  total_items: number
  migrated: number
  skipped: number
  errors: number
}

/**
 * Map content status to page status
 */
function mapContentStatusToPageStatus(contentStatus: string): string {
  const mapping: Record<string, string> = {
    'idea': 'planned',
    'brief_created': 'planned',
    'draft': 'draft',
    'in_editorial_review': 'draft',
    'needs_changes': 'draft',
    'approved': 'published',
    'scheduled': 'published',
    'published': 'published',
    'archived': 'deprecated'
  }
  return mapping[contentStatus] || 'draft'
}

/**
 * Generate slug from title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .substring(0, 200) // Limit length
}

/**
 * Extract SEO profile from content metadata
 */
function extractSEOProfile(item: any): any {
  const metadata = item.metadata || {}

  return {
    primary_keyword: metadata.primary_keyword || metadata.keyword,
    secondary_keywords: metadata.secondary_keywords || [],
    meta_description: metadata.description || metadata.meta_description,
    canonical: metadata.canonical_url,
    freshness_score: metadata.freshness_score || 100
  }
}

/**
 * Determine page type from content type
 */
function determinePageType(contentType: string): string {
  const typeMapping: Record<string, string> = {
    'article': 'article',
    'page': 'standard_page',
    'guide': 'guide',
    'landing': 'landing_page',
    'blog_post': 'blog_post'
  }
  return typeMapping[contentType] || 'article'
}

/**
 * Main migration function
 */
export async function migrateContentToPages(): Promise<MigrationStats> {
  console.log('🚀 Starting migration: ContentItems → Pages\n')

  const stats: MigrationStats = {
    total_items: 0,
    migrated: 0,
    skipped: 0,
    errors: 0
  }

  try {
    // Get all content items that should be pages
    const result = await db.query(`
      SELECT * FROM content_items
      WHERE type IN ('article', 'page', 'guide', 'landing', 'blog_post')
      ORDER BY created_at ASC
    `)

    stats.total_items = result.rows.length
    console.log(`Found ${stats.total_items} content items to migrate\n`)

    for (const item of result.rows) {
      try {
        // Generate slug
        const slug = item.metadata?.slug || generateSlug(item.title || `content-${item.id}`)

        // Check if page already exists
        const existing = await db.query(
          'SELECT id FROM pages WHERE website_id = $1 AND slug = $2',
          [item.website_id, slug]
        )

        if (existing.rows.length > 0) {
          console.log(`⏭️  Skipping: ${slug} (already exists)`)
          stats.skipped++
          continue
        }

        // Prepare page data
        const pageType = determinePageType(item.type)
        const status = mapContentStatusToPageStatus(item.status)
        const seoProfile = extractSEOProfile(item)

        // Extract topics from metadata or tags
        const topics = item.metadata?.tags || item.metadata?.topics || []

        // Insert into pages table
        await db.query(`
          INSERT INTO pages (
            id,
            website_id,
            slug,
            title,
            page_type,
            status,
            topics,
            seo_profile,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          item.id, // Keep same ID for referential integrity
          item.website_id,
          slug,
          item.title || 'Untitled',
          pageType,
          status,
          topics,
          JSON.stringify(seoProfile),
          item.created_at,
          item.updated_at
        ])

        // Add history entry
        await db.query(`
          UPDATE pages
          SET history = jsonb_build_array(
            jsonb_build_object(
              'date', NOW()::text,
              'change', 'Migrated from content_items',
              'agent', 'system'
            )
          )
          WHERE id = $1
        `, [item.id])

        console.log(`✅ Migrated: ${slug} (${pageType}, ${status})`)
        stats.migrated++

      } catch (error) {
        console.error(`❌ Error migrating item ${item.id}:`, error)
        stats.errors++
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50))
    console.log('Migration Summary:')
    console.log('='.repeat(50))
    console.log(`Total items:  ${stats.total_items}`)
    console.log(`Migrated:     ${stats.migrated} ✅`)
    console.log(`Skipped:      ${stats.skipped} ⏭️`)
    console.log(`Errors:       ${stats.errors} ❌`)
    console.log('='.repeat(50) + '\n')

  } catch (error) {
    console.error('Fatal error during migration:', error)
    throw error
  }

  return stats
}

/**
 * Run migration if executed directly
 */
if (require.main === module) {
  migrateContentToPages()
    .then(stats => {
      if (stats.errors > 0) {
        console.log('⚠️  Migration completed with errors')
        process.exit(1)
      } else {
        console.log('🎉 Migration completed successfully!')
        process.exit(0)
      }
    })
    .catch(error => {
      console.error('Migration failed:', error)
      process.exit(1)
    })
}
