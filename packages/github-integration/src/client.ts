/**
 * GitHub API Client
 * Wrapper around Octokit for agent.press operations
 */

import { Octokit } from '@octokit/rest'
import { createAppAuth } from '@octokit/auth-app'

export interface GitHubConfig {
  token?: string
  appId?: string
  privateKey?: string
  installationId?: string
  owner: string
  repo: string
}

/**
 * GitHub client for agent.press
 */
export class GitHubClient {
  private octokit: Octokit
  private owner: string
  private repo: string

  constructor(config: GitHubConfig) {
    this.owner = config.owner
    this.repo = config.repo

    // Initialize Octokit with either PAT or GitHub App auth
    if (config.token) {
      // Personal Access Token (simpler for MVP)
      this.octokit = new Octokit({
        auth: config.token,
      })
    } else if (config.appId && config.privateKey && config.installationId) {
      // GitHub App (better for production)
      this.octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.appId,
          privateKey: config.privateKey,
          installationId: config.installationId,
        },
      })
    } else {
      throw new Error('GitHub authentication credentials required (token or app credentials)')
    }
  }

  /**
   * Get the underlying Octokit instance
   */
  getOctokit(): Octokit {
    return this.octokit
  }

  /**
   * Get repository info
   */
  getRepoInfo() {
    return {
      owner: this.owner,
      repo: this.repo,
    }
  }

  /**
   * Create a branch from base branch
   */
  async createBranch(branchName: string, baseBranch: string = 'main'): Promise<void> {
    // Get the SHA of the base branch
    const { data: refData } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${baseBranch}`,
    })

    // Create new branch
    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branchName}`,
      sha: refData.object.sha,
    })
  }

  /**
   * Create or update a file in the repository
   */
  async createOrUpdateFile(params: {
    path: string
    content: string
    message: string
    branch: string
    sha?: string
  }): Promise<{ sha: string; commit: string }> {
    const { path, content, message, branch, sha } = params

    // Encode content to base64
    const contentEncoded = Buffer.from(content).toString('base64')

    const response = await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      content: contentEncoded,
      branch,
      sha, // Required for updates, omit for creates
    })

    return {
      sha: response.data.content?.sha || '',
      commit: response.data.commit.sha || '',
    }
  }

  /**
   * Get file content from repository
   */
  async getFileContent(path: string, ref?: string): Promise<{
    content: string
    sha: string
  } | null> {
    try {
      const response = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
      })

      if ('content' in response.data && response.data.type === 'file') {
        return {
          content: Buffer.from(response.data.content, 'base64').toString('utf-8'),
          sha: response.data.sha,
        }
      }

      return null
    } catch (error: any) {
      if (error.status === 404) {
        return null
      }
      throw error
    }
  }

  /**
   * Delete a file from the repository
   */
  async deleteFile(params: {
    path: string
    message: string
    branch: string
    sha: string
  }): Promise<void> {
    await this.octokit.repos.deleteFile({
      owner: this.owner,
      repo: this.repo,
      path: params.path,
      message: params.message,
      branch: params.branch,
      sha: params.sha,
    })
  }

  /**
   * Check if branch exists
   */
  async branchExists(branchName: string): Promise<boolean> {
    try {
      await this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branchName}`,
      })
      return true
    } catch (error: any) {
      if (error.status === 404) {
        return false
      }
      throw error
    }
  }
}

/**
 * Singleton instance
 */
let githubClient: GitHubClient | null = null

export function initializeGitHub(config: GitHubConfig): GitHubClient {
  githubClient = new GitHubClient(config)
  return githubClient
}

export function getGitHub(): GitHubClient {
  if (!githubClient) {
    throw new Error('GitHub client not initialized. Call initializeGitHub() first.')
  }
  return githubClient
}
