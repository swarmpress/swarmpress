/**
 * GitHub Sync Service
 * Handles bidirectional sync between database and GitHub
 */

import { GitHubService, type GitHubConfig } from './github.service'
import {
  serializePageToYAML,
  serializeBlueprintToYAML,
  generateSitemapIndex,
  deserializeYAMLToPage,
} from './yaml.service'
import { pageRepository, blueprintRepository } from '../db/repositories'

export interface SyncOptions {
  websiteId: string
  githubConfig: GitHubConfig
  createPR?: boolean
  prTitle?: string
  prBody?: string
}

export interface SyncResult {
  success: boolean
  filesCreated: number
  filesUpdated: number
  pullRequestUrl?: string
  error?: string
}

export class GitHubSyncService {
  private github: GitHubService

  constructor(githubConfig: GitHubConfig) {
    this.github = new GitHubService(githubConfig)
  }

  /**
   * Sync sitemap to GitHub
   * Exports all pages as YAML files
   */
  async syncSitemapToGitHub(options: SyncOptions): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      filesCreated: 0,
      filesUpdated: 0,
    }

    try {
      // Fetch all pages for the website
      const pages = await pageRepository.findByWebsite(options.websiteId)

      if (pages.length === 0) {
        throw new Error('No pages found for this website')
      }

      // Create a branch if PR is requested
      let branchName = options.githubConfig.branch || 'main'

      if (options.createPR) {
        branchName = `sitemap-sync-${Date.now()}`
        await this.github.createBranch(branchName)
      }

      // Temporarily switch to the new branch
      const originalBranch = this.github['config'].branch
      this.github['config'].branch = branchName

      // Generate sitemap index
      const indexYAML = generateSitemapIndex(pages)
      await this.github.createOrUpdateFile({
        path: 'content/sitemap.yaml',
        content: indexYAML,
        message: '🗺️ Update sitemap index',
      })
      result.filesCreated++

      // Export each page as YAML
      for (const page of pages) {
        const pageYAML = serializePageToYAML(page)
        const filePath = `content/pages/${page.slug}.yaml`

        const existingFile = await this.github.getFile(filePath)

        await this.github.createOrUpdateFile({
          path: filePath,
          content: pageYAML,
          message: `📄 Update page: ${page.title}`,
        })

        if (existingFile) {
          result.filesUpdated++
        } else {
          result.filesCreated++
        }
      }

      // Create pull request if requested
      if (options.createPR) {
        const pr = await this.github.createPullRequest({
          title: options.prTitle || `🗺️ Sitemap Update - ${new Date().toISOString()}`,
          body:
            options.prBody ||
            `Automated sitemap sync\n\n- Pages exported: ${pages.length}\n- Files created: ${result.filesCreated}\n- Files updated: ${result.filesUpdated}`,
          head: branchName,
          base: originalBranch!,
        })

        result.pullRequestUrl = pr.url
      }

      // Restore original branch
      this.github['config'].branch = originalBranch

      result.success = true
      return result
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error'
      return result
    }
  }

  /**
   * Sync blueprints to GitHub
   */
  async syncBlueprintsToGitHub(options: Omit<SyncOptions, 'websiteId'>): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      filesCreated: 0,
      filesUpdated: 0,
    }

    try {
      const blueprints = await blueprintRepository.findAllOrdered()

      if (blueprints.length === 0) {
        throw new Error('No blueprints found')
      }

      // Create branch if PR is requested
      let branchName = options.githubConfig.branch || 'main'

      if (options.createPR) {
        branchName = `blueprints-sync-${Date.now()}`
        await this.github.createBranch(branchName)
      }

      const originalBranch = this.github['config'].branch
      this.github['config'].branch = branchName

      // Export each blueprint
      for (const blueprint of blueprints) {
        const blueprintYAML = serializeBlueprintToYAML(blueprint)
        const filePath = `content/blueprints/${blueprint.page_type}.yaml`

        const existingFile = await this.github.getFile(filePath)

        await this.github.createOrUpdateFile({
          path: filePath,
          content: blueprintYAML,
          message: `📐 Update blueprint: ${blueprint.name}`,
        })

        if (existingFile) {
          result.filesUpdated++
        } else {
          result.filesCreated++
        }
      }

      // Create PR if requested
      if (options.createPR) {
        const pr = await this.github.createPullRequest({
          title: options.prTitle || `📐 Blueprint Update - ${new Date().toISOString()}`,
          body:
            options.prBody ||
            `Automated blueprint sync\n\n- Blueprints exported: ${blueprints.length}\n- Files created: ${result.filesCreated}\n- Files updated: ${result.filesUpdated}`,
          head: branchName,
          base: originalBranch!,
        })

        result.pullRequestUrl = pr.url
      }

      this.github['config'].branch = originalBranch

      result.success = true
      return result
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error'
      return result
    }
  }

  /**
   * Import sitemap from GitHub
   * Reads YAML files and updates database
   */
  async importSitemapFromGitHub(websiteId: string): Promise<{ pagesImported: number; errors: string[] }> {
    const errors: string[] = []
    let pagesImported = 0

    try {
      // Read sitemap index
      const indexContent = await this.github.getFile('content/sitemap.yaml')

      if (!indexContent) {
        throw new Error('Sitemap index not found in repository')
      }

      const index = require('js-yaml').load(indexContent) as any
      const pageFiles = index.pages || []

      // Import each page
      for (const pageRef of pageFiles) {
        try {
          const pageContent = await this.github.getFile(pageRef.file)

          if (!pageContent) {
            errors.push(`File not found: ${pageRef.file}`)
            continue
          }

          const pageData = deserializeYAMLToPage(pageContent)

          // Check if page exists
          const existingPage = await pageRepository.findById(pageData.id!)

          if (existingPage) {
            // Update existing page
            await pageRepository.update(pageData.id!, {
              ...pageData,
              website_id: websiteId,
            } as any)
          } else {
            // Create new page
            await pageRepository.create({
              ...pageData,
              website_id: websiteId,
            } as any)
          }

          pagesImported++
        } catch (error) {
          errors.push(`Failed to import ${pageRef.file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      return { pagesImported, errors }
    } catch (error) {
      errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return { pagesImported, errors }
    }
  }

  /**
   * Create a content change PR
   * Used when agents make changes to content
   */
  async createContentChangePR(options: {
    websiteId: string
    pageIds: string[]
    title: string
    description: string
    agentId?: string
  }): Promise<{ prNumber: number; prUrl: string }> {
    const branchName = `content-update-${Date.now()}`

    // Create branch
    await this.github.createBranch(branchName)

    // Switch to new branch
    const originalBranch = this.github['config'].branch
    this.github['config'].branch = branchName

    // Export changed pages
    for (const pageId of options.pageIds) {
      const page = await pageRepository.findById(pageId)

      if (!page) continue

      const pageYAML = serializePageToYAML(page)
      await this.github.createOrUpdateFile({
        path: `content/pages/${page.slug}.yaml`,
        content: pageYAML,
        message: `✏️ Update: ${page.title}`,
      })
    }

    // Update sitemap index
    const allPages = await pageRepository.findByWebsite(options.websiteId)
    const indexYAML = generateSitemapIndex(allPages)
    await this.github.createOrUpdateFile({
      path: 'content/sitemap.yaml',
      content: indexYAML,
      message: '🗺️ Update sitemap index',
    })

    // Create PR
    const prBody = `${options.description}\n\n---\n\n**Pages Updated:** ${options.pageIds.length}\n${
      options.agentId ? `**Agent:** ${options.agentId}\n` : ''
    }**Branch:** \`${branchName}\`\n\n🤖 Generated by swarm.press`

    const pr = await this.github.createPullRequest({
      title: options.title,
      body: prBody,
      head: branchName,
      base: originalBranch!,
    })

    // Restore branch
    this.github['config'].branch = originalBranch

    return {
      prNumber: pr.number,
      prUrl: pr.url,
    }
  }

  /**
   * Get sync status
   * Compare local database with GitHub repository
   */
  async getSyncStatus(websiteId: string): Promise<{
    inSync: boolean
    localPages: number
    remotePages: number
    conflicts: string[]
  }> {
    const localPages = await pageRepository.findByWebsite(websiteId)
    const conflicts: string[] = []

    try {
      const indexContent = await this.github.getFile('content/sitemap.yaml')

      if (!indexContent) {
        return {
          inSync: false,
          localPages: localPages.length,
          remotePages: 0,
          conflicts: ['Sitemap not found in repository'],
        }
      }

      const index = require('js-yaml').load(indexContent) as any
      const remotePages = index.pages || []

      // Check for conflicts
      for (const localPage of localPages) {
        const remotePage = remotePages.find((p: any) => p.id === localPage.id)

        if (!remotePage) {
          conflicts.push(`Page not in remote: ${localPage.slug}`)
        }
      }

      for (const remotePage of remotePages) {
        const localPage = localPages.find((p) => p.id === remotePage.id)

        if (!localPage) {
          conflicts.push(`Page not in local: ${remotePage.slug}`)
        }
      }

      return {
        inSync: conflicts.length === 0 && localPages.length === remotePages.length,
        localPages: localPages.length,
        remotePages: remotePages.length,
        conflicts,
      }
    } catch (error) {
      return {
        inSync: false,
        localPages: localPages.length,
        remotePages: 0,
        conflicts: [`Failed to fetch remote: ${error instanceof Error ? error.message : 'Unknown error'}`],
      }
    }
  }
}
