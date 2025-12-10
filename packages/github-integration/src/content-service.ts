/**
 * GitHub Content Service
 * High-level service for reading/writing content to GitHub repositories
 * Used when GitHub is the source of truth for website content
 */

import { GitHubClient } from './client'

export interface GitHubContentConfig {
  owner: string
  repo: string
  token: string
  branch?: string // default: 'main'
  contentPath?: string // default: 'content'
}

export interface WebsiteConfigFile {
  id: string
  domain: string
  title: string
  description?: string
  collections: Array<{
    type: string
    displayName: string
  }>
  settings?: Record<string, unknown>
}

export interface PageFile {
  id: string
  slug: string
  title: string
  description?: string
  template?: string
  page_type?: string
  seo?: {
    title?: string
    description?: string
    keywords?: string[]
  }
  body: Array<Record<string, unknown>> // Content blocks
  metadata?: Record<string, unknown>
  status: string
  created_at: string
  updated_at: string
}

export interface CollectionSchemaFile {
  type: string
  display_name: string
  singular_name?: string
  description?: string
  icon?: string
  color?: string
  json_schema: Record<string, unknown>
  field_metadata?: Record<string, unknown>
  title_field?: string
  summary_field?: string
  image_field?: string
  date_field?: string
}

export interface CollectionItemFile {
  id: string
  slug: string
  data: Record<string, unknown>
  published: boolean
  featured?: boolean
  created_at: string
  updated_at: string
}

export interface TreeEntry {
  path: string
  type: 'file' | 'dir'
  sha: string
}

export interface ContentFile<T = unknown> {
  path: string
  content: T
  sha: string
}

/**
 * GitHub Content Service
 * Provides high-level content operations for GitHub-based storage
 */
export class GitHubContentService {
  private client: GitHubClient
  private branch: string
  private contentPath: string

  constructor(config: GitHubContentConfig) {
    this.client = new GitHubClient({
      owner: config.owner,
      repo: config.repo,
      token: config.token,
    })
    this.branch = config.branch || 'main'
    this.contentPath = config.contentPath || 'content'
  }

  // ============================================================
  // Website Config Operations
  // ============================================================

  /**
   * Get website configuration from config.json
   */
  async getConfig(): Promise<WebsiteConfigFile | null> {
    const result = await this.client.getFileContent(
      `${this.contentPath}/config.json`,
      this.branch
    )
    if (!result) return null
    return JSON.parse(result.content) as WebsiteConfigFile
  }

  /**
   * Save website configuration
   */
  async saveConfig(
    config: WebsiteConfigFile,
    message = 'Update website config'
  ): Promise<{ sha: string; commit: string }> {
    const path = `${this.contentPath}/config.json`
    const existing = await this.client.getFileContent(path, this.branch)

    return this.client.createOrUpdateFile({
      path,
      content: JSON.stringify(config, null, 2),
      message,
      branch: this.branch,
      sha: existing?.sha,
    })
  }

  // ============================================================
  // Page Operations
  // ============================================================

  /**
   * Get a page by slug
   */
  async getPage(slug: string): Promise<ContentFile<PageFile> | null> {
    const path = `${this.contentPath}/pages/${slug}.json`
    const result = await this.client.getFileContent(path, this.branch)
    if (!result) return null

    return {
      path,
      content: JSON.parse(result.content) as PageFile,
      sha: result.sha,
    }
  }

  /**
   * List all pages
   */
  async listPages(): Promise<ContentFile<PageFile>[]> {
    const pagesPath = `${this.contentPath}/pages`
    const tree = await this.getTree(pagesPath)

    const pages: ContentFile<PageFile>[] = []
    for (const entry of tree) {
      if (entry.type === 'file' && entry.path.endsWith('.json')) {
        const result = await this.client.getFileContent(entry.path, this.branch)
        if (result) {
          pages.push({
            path: entry.path,
            content: JSON.parse(result.content) as PageFile,
            sha: result.sha,
          })
        }
      }
    }

    return pages
  }

  /**
   * Save a page
   */
  async savePage(
    slug: string,
    page: PageFile,
    message?: string
  ): Promise<{ sha: string; commit: string }> {
    const path = `${this.contentPath}/pages/${slug}.json`
    const existing = await this.client.getFileContent(path, this.branch)

    return this.client.createOrUpdateFile({
      path,
      content: JSON.stringify(page, null, 2),
      message: message || `Update page: ${slug}`,
      branch: this.branch,
      sha: existing?.sha,
    })
  }

  /**
   * Delete a page
   */
  async deletePage(slug: string, message?: string): Promise<void> {
    const path = `${this.contentPath}/pages/${slug}.json`
    const existing = await this.client.getFileContent(path, this.branch)
    if (!existing) return

    await this.client.deleteFile({
      path,
      message: message || `Delete page: ${slug}`,
      branch: this.branch,
      sha: existing.sha,
    })
  }

  // ============================================================
  // Collection Schema Operations
  // ============================================================

  /**
   * Get collection schema
   */
  async getCollectionSchema(
    collectionType: string
  ): Promise<ContentFile<CollectionSchemaFile> | null> {
    const path = `${this.contentPath}/${collectionType}/_schema.json`
    const result = await this.client.getFileContent(path, this.branch)
    if (!result) return null

    return {
      path,
      content: JSON.parse(result.content) as CollectionSchemaFile,
      sha: result.sha,
    }
  }

  /**
   * List all collection types (by finding _schema.json files)
   */
  async listCollectionTypes(): Promise<string[]> {
    const tree = await this.getTree(this.contentPath)
    const types: string[] = []

    for (const entry of tree) {
      if (entry.type === 'dir' && entry.path !== `${this.contentPath}/pages`) {
        // Check if this directory has a _schema.json
        const schemaPath = `${entry.path}/_schema.json`
        const schema = await this.client.getFileContent(schemaPath, this.branch)
        if (schema) {
          // Extract collection type from path
          const type = entry.path.replace(`${this.contentPath}/`, '')
          types.push(type)
        }
      }
    }

    return types
  }

  /**
   * Save collection schema
   */
  async saveCollectionSchema(
    collectionType: string,
    schema: CollectionSchemaFile,
    message?: string
  ): Promise<{ sha: string; commit: string }> {
    const path = `${this.contentPath}/${collectionType}/_schema.json`
    const existing = await this.client.getFileContent(path, this.branch)

    return this.client.createOrUpdateFile({
      path,
      content: JSON.stringify(schema, null, 2),
      message: message || `Update ${collectionType} schema`,
      branch: this.branch,
      sha: existing?.sha,
    })
  }

  // ============================================================
  // Collection Item Operations
  // ============================================================

  /**
   * Get a collection item by slug
   */
  async getCollectionItem(
    collectionType: string,
    slug: string
  ): Promise<ContentFile<CollectionItemFile> | null> {
    const path = `${this.contentPath}/${collectionType}/${slug}.json`
    const result = await this.client.getFileContent(path, this.branch)
    if (!result) return null

    return {
      path,
      content: JSON.parse(result.content) as CollectionItemFile,
      sha: result.sha,
    }
  }

  /**
   * List all items in a collection
   */
  async listCollectionItems(
    collectionType: string
  ): Promise<ContentFile<CollectionItemFile>[]> {
    const collectionPath = `${this.contentPath}/${collectionType}`
    const tree = await this.getTree(collectionPath)

    const items: ContentFile<CollectionItemFile>[] = []
    for (const entry of tree) {
      // Skip _schema.json
      if (
        entry.type === 'file' &&
        entry.path.endsWith('.json') &&
        !entry.path.endsWith('_schema.json')
      ) {
        const result = await this.client.getFileContent(entry.path, this.branch)
        if (result) {
          items.push({
            path: entry.path,
            content: JSON.parse(result.content) as CollectionItemFile,
            sha: result.sha,
          })
        }
      }
    }

    return items
  }

  /**
   * Save a collection item
   */
  async saveCollectionItem(
    collectionType: string,
    slug: string,
    item: CollectionItemFile,
    message?: string
  ): Promise<{ sha: string; commit: string }> {
    const path = `${this.contentPath}/${collectionType}/${slug}.json`
    const existing = await this.client.getFileContent(path, this.branch)

    return this.client.createOrUpdateFile({
      path,
      content: JSON.stringify(item, null, 2),
      message: message || `Update ${collectionType}: ${slug}`,
      branch: this.branch,
      sha: existing?.sha,
    })
  }

  /**
   * Save a collection item organized by village
   * Path: content/collections/{collectionType}/{village}/{slug}.json
   */
  async saveCollectionItemByVillage(
    collectionType: string,
    village: string,
    slug: string,
    item: CollectionItemFile,
    message?: string
  ): Promise<{ sha: string; commit: string }> {
    const path = `${this.contentPath}/collections/${collectionType}/${village}/${slug}.json`
    const existing = await this.client.getFileContent(path, this.branch)

    return this.client.createOrUpdateFile({
      path,
      content: JSON.stringify(item, null, 2),
      message: message || `Update ${collectionType}/${village}: ${slug}`,
      branch: this.branch,
      sha: existing?.sha,
    })
  }

  /**
   * Save collection schema for village-organized collections
   * Path: content/collections/{collectionType}/_schema.json
   */
  async saveCollectionSchemaByVillage(
    collectionType: string,
    schema: CollectionSchemaFile,
    message?: string
  ): Promise<{ sha: string; commit: string }> {
    const path = `${this.contentPath}/collections/${collectionType}/_schema.json`
    const existing = await this.client.getFileContent(path, this.branch)

    return this.client.createOrUpdateFile({
      path,
      content: JSON.stringify(schema, null, 2),
      message: message || `Update ${collectionType} schema`,
      branch: this.branch,
      sha: existing?.sha,
    })
  }

  /**
   * Delete a collection item
   */
  async deleteCollectionItem(
    collectionType: string,
    slug: string,
    message?: string
  ): Promise<void> {
    const path = `${this.contentPath}/${collectionType}/${slug}.json`
    const existing = await this.client.getFileContent(path, this.branch)
    if (!existing) return

    await this.client.deleteFile({
      path,
      message: message || `Delete ${collectionType}: ${slug}`,
      branch: this.branch,
      sha: existing.sha,
    })
  }

  // ============================================================
  // Bulk Operations
  // ============================================================

  /**
   * Get all collections with their items (for site builds)
   */
  async getAllCollections(): Promise<
    Map<string, { schema: CollectionSchemaFile; items: CollectionItemFile[] }>
  > {
    const types = await this.listCollectionTypes()
    const collections = new Map<
      string,
      { schema: CollectionSchemaFile; items: CollectionItemFile[] }
    >()

    for (const type of types) {
      const schemaFile = await this.getCollectionSchema(type)
      if (schemaFile) {
        const itemFiles = await this.listCollectionItems(type)
        collections.set(type, {
          schema: schemaFile.content,
          items: itemFiles.map((f) => f.content),
        })
      }
    }

    return collections
  }

  /**
   * Get file tree for a directory
   */
  async getTree(path?: string): Promise<TreeEntry[]> {
    const octokit = this.client.getOctokit()
    const { owner, repo } = this.client.getRepoInfo()

    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path: path || this.contentPath,
        ref: this.branch,
      })

      if (!Array.isArray(response.data)) {
        return []
      }

      return response.data.map((item) => ({
        path: item.path,
        type: item.type === 'dir' ? 'dir' : 'file',
        sha: item.sha,
      }))
    } catch (error: any) {
      if (error.status === 404) {
        return []
      }
      throw error
    }
  }

  /**
   * Batch get multiple files by path
   */
  async batchGetFiles<T>(paths: string[]): Promise<ContentFile<T>[]> {
    const files: ContentFile<T>[] = []

    for (const path of paths) {
      const result = await this.client.getFileContent(path, this.branch)
      if (result) {
        files.push({
          path,
          content: JSON.parse(result.content) as T,
          sha: result.sha,
        })
      }
    }

    return files
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Check if content folder exists (repo is initialized)
   */
  async isInitialized(): Promise<boolean> {
    const config = await this.getConfig()
    return config !== null
  }

  /**
   * Initialize a new content repository with default structure
   */
  async initialize(websiteConfig: WebsiteConfigFile): Promise<void> {
    // Create config.json
    await this.saveConfig(websiteConfig, 'Initialize website content')
  }

  /**
   * Get the underlying GitHubClient for advanced operations
   */
  getClient(): GitHubClient {
    return this.client
  }
}
