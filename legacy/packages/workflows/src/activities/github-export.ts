/**
 * GitHub Export Activities
 * Temporal activities for exporting content from database to GitHub
 */

import { GitHubContentService } from '@swarm-press/github-integration'
import {
  collectionItemRepository,
  websiteCollectionRepository,
  websiteRepository,
} from '@swarm-press/backend'
import { events } from '@swarm-press/event-bus'

// Extended website type that may include GitHub Pages fields
interface WebsiteWithGitHub {
  id: string
  github_owner?: string
  github_repo?: string
  github_access_token?: string
  github_pages_branch?: string
  github_pages_enabled?: boolean
  github_pages_url?: string
  settings?: Record<string, unknown>
  domain?: string
}

/**
 * Export collection items to GitHub repository
 */
export async function exportCollectionToGitHubActivity(params: {
  websiteId: string
  collectionType: string
  publishedOnly?: boolean
}): Promise<{
  itemsExported: number
  commitSha?: string
  errors: string[]
}> {
  // Get website with GitHub config
  const website = await websiteRepository.findById(params.websiteId) as WebsiteWithGitHub | null
  if (!website) {
    throw new Error(`Website ${params.websiteId} not found`)
  }

  if (!website.github_owner || !website.github_repo || !website.github_access_token) {
    throw new Error('Website not connected to GitHub')
  }

  // Get branch from settings or default to main
  const branch = website.github_pages_branch ||
    (website.settings as Record<string, unknown>)?.github_pages_branch as string ||
    'main'

  // Initialize GitHub service
  const github = new GitHubContentService({
    owner: website.github_owner,
    repo: website.github_repo,
    token: website.github_access_token,
    branch,
  })

  // Get website collection
  const collection = await websiteCollectionRepository.findByType(
    params.websiteId,
    params.collectionType
  )

  if (!collection) {
    throw new Error(
      `Collection ${params.collectionType} not found for website ${params.websiteId}`
    )
  }

  // Get collection items from database
  const allItems = await collectionItemRepository.findByCollection(collection.id)
  const items = params.publishedOnly !== false
    ? allItems.filter((item) => item.published)
    : allItems

  let itemsExported = 0
  let lastCommit: string | undefined
  const errors: string[] = []

  for (const item of items) {
    try {
      // Serialize item to GitHub format
      const serialized = {
        id: item.id,
        slug: item.slug,
        data: item.data,
        published: item.published,
        featured: item.featured,
        created_at: item.created_at instanceof Date ? item.created_at.toISOString() : item.created_at,
        updated_at: item.updated_at instanceof Date ? item.updated_at.toISOString() : item.updated_at,
      }

      // Save to GitHub using standard method
      const result = await github.saveCollectionItem(
        params.collectionType,
        item.slug,
        serialized,
        `Export ${item.slug} to GitHub`
      )

      lastCommit = result.commit
      itemsExported++
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`Failed to export ${item.slug}: ${errorMsg}`)
    }
  }

  // Emit event
  if (itemsExported > 0) {
    await events.collectionExported(params.collectionType, params.websiteId, itemsExported)
  }

  console.log(
    `[GitHubExport] Exported ${itemsExported} items to GitHub, ${errors.length} errors`
  )

  return { itemsExported, commitSha: lastCommit, errors }
}

/**
 * Import collection items from GitHub to database
 */
export async function importCollectionFromGitHubActivity(params: {
  websiteId: string
  collectionType: string
  overwrite?: boolean
}): Promise<{
  itemsImported: number
  itemsSkipped: number
  errors: string[]
}> {
  // Get website with GitHub config
  const website = await websiteRepository.findById(params.websiteId) as WebsiteWithGitHub | null
  if (!website) {
    throw new Error(`Website ${params.websiteId} not found`)
  }

  if (!website.github_owner || !website.github_repo || !website.github_access_token) {
    throw new Error('Website not connected to GitHub')
  }

  // Get branch from settings or default to main
  const branch = website.github_pages_branch ||
    (website.settings as Record<string, unknown>)?.github_pages_branch as string ||
    'main'

  // Initialize GitHub service
  const github = new GitHubContentService({
    owner: website.github_owner,
    repo: website.github_repo,
    token: website.github_access_token,
    branch,
  })

  // Get website collection
  const collection = await websiteCollectionRepository.findByType(
    params.websiteId,
    params.collectionType
  )

  if (!collection) {
    throw new Error(
      `Collection ${params.collectionType} not found for website ${params.websiteId}`
    )
  }

  // Get all items from GitHub
  const allCollections = await github.getAllCollections()
  const collectionData = allCollections.get(params.collectionType)

  if (!collectionData) {
    return { itemsImported: 0, itemsSkipped: 0, errors: [`Collection ${params.collectionType} not found in GitHub`] }
  }

  const { items: githubItems } = collectionData

  let itemsImported = 0
  let itemsSkipped = 0
  const errors: string[] = []

  for (const ghItem of githubItems) {
    try {
      // Check if item already exists
      const existing = await collectionItemRepository.findBySlug(collection.id, ghItem.slug)

      if (existing && !params.overwrite) {
        itemsSkipped++
        continue
      }

      if (existing) {
        // Update existing
        await collectionItemRepository.update(existing.id, {
          data: ghItem.data,
          published: ghItem.published,
          featured: ghItem.featured || false,
        })
      } else {
        // Create new
        await collectionItemRepository.create({
          website_collection_id: collection.id,
          slug: ghItem.slug,
          data: ghItem.data,
          published: ghItem.published,
          featured: ghItem.featured || false,
        })
      }
      itemsImported++
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`Failed to import ${ghItem.slug}: ${errorMsg}`)
    }
  }

  // Emit event
  if (itemsImported > 0) {
    await events.collectionImported(params.collectionType, params.websiteId, itemsImported)
  }

  console.log(
    `[GitHubImport] Imported ${itemsImported} items from GitHub, skipped ${itemsSkipped}, ${errors.length} errors`
  )

  return { itemsImported, itemsSkipped, errors }
}
