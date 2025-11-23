/**
 * GitHub Service
 * Handles GitHub API interactions for content sync
 */

import { Octokit } from 'octokit'

export interface GitHubConfig {
  owner: string
  repo: string
  token: string
  branch?: string
}

export interface FileContent {
  path: string
  content: string
  message: string
}

export interface PullRequestOptions {
  title: string
  body: string
  head: string
  base: string
}

export class GitHubService {
  private octokit: Octokit
  private config: GitHubConfig

  constructor(config: GitHubConfig) {
    this.config = {
      ...config,
      branch: config.branch || 'main',
    }

    this.octokit = new Octokit({
      auth: config.token,
    })
  }

  /**
   * Get file content from repository
   */
  async getFile(path: string): Promise<string | null> {
    try {
      const response = await this.octokit.rest.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        ref: this.config.branch,
      })

      if ('content' in response.data && response.data.type === 'file') {
        return Buffer.from(response.data.content, 'base64').toString('utf-8')
      }

      return null
    } catch (error: any) {
      if (error.status === 404) {
        return null // File doesn't exist
      }
      throw error
    }
  }

  /**
   * Create or update a file in the repository
   */
  async createOrUpdateFile(file: FileContent): Promise<void> {
    try {
      // Check if file exists to get its SHA
      let sha: string | undefined

      try {
        const existingFile = await this.octokit.rest.repos.getContent({
          owner: this.config.owner,
          repo: this.config.repo,
          path: file.path,
          ref: this.config.branch,
        })

        if ('sha' in existingFile.data) {
          sha = existingFile.data.sha
        }
      } catch (error: any) {
        // File doesn't exist, that's fine
        if (error.status !== 404) throw error
      }

      // Create or update the file
      await this.octokit.rest.repos.createOrUpdateFileContents({
        owner: this.config.owner,
        repo: this.config.repo,
        path: file.path,
        message: file.message,
        content: Buffer.from(file.content).toString('base64'),
        branch: this.config.branch,
        sha,
      })
    } catch (error) {
      console.error(`Failed to create/update file ${file.path}:`, error)
      throw error
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(branchName: string, fromBranch?: string): Promise<void> {
    const baseBranch = fromBranch || this.config.branch!

    // Get the SHA of the base branch
    const refResponse = await this.octokit.rest.git.getRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `heads/${baseBranch}`,
    })

    const baseSha = refResponse.data.object.sha

    // Create new branch
    await this.octokit.rest.git.createRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    })
  }

  /**
   * Check if branch exists
   */
  async branchExists(branchName: string): Promise<boolean> {
    try {
      await this.octokit.rest.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${branchName}`,
      })
      return true
    } catch (error: any) {
      if (error.status === 404) return false
      throw error
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(options: PullRequestOptions): Promise<{ number: number; url: string }> {
    const response = await this.octokit.rest.pulls.create({
      owner: this.config.owner,
      repo: this.config.repo,
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base,
    })

    return {
      number: response.data.number,
      url: response.data.html_url,
    }
  }

  /**
   * Get pull request details
   */
  async getPullRequest(prNumber: number) {
    const response = await this.octokit.rest.pulls.get({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: prNumber,
    })

    return response.data
  }

  /**
   * Merge a pull request
   */
  async mergePullRequest(
    prNumber: number,
    commitMessage?: string
  ): Promise<{ merged: boolean; sha: string }> {
    const response = await this.octokit.rest.pulls.merge({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: prNumber,
      commit_message: commitMessage,
    })

    return {
      merged: response.data.merged,
      sha: response.data.sha,
    }
  }

  /**
   * List files changed in a pull request
   */
  async listPullRequestFiles(prNumber: number): Promise<Array<{ filename: string; status: string }>> {
    const response = await this.octokit.rest.pulls.listFiles({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: prNumber,
    })

    return response.data.map((file) => ({
      filename: file.filename,
      status: file.status,
    }))
  }

  /**
   * Delete a branch
   */
  async deleteBranch(branchName: string): Promise<void> {
    await this.octokit.rest.git.deleteRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `heads/${branchName}`,
    })
  }

  /**
   * Get repository information
   */
  async getRepositoryInfo() {
    const response = await this.octokit.rest.repos.get({
      owner: this.config.owner,
      repo: this.config.repo,
    })

    return {
      name: response.data.name,
      fullName: response.data.full_name,
      defaultBranch: response.data.default_branch,
      private: response.data.private,
      htmlUrl: response.data.html_url,
    }
  }

  /**
   * Verify token has required permissions
   */
  async verifyPermissions(): Promise<{ hasAccess: boolean; permissions: string[] }> {
    try {
      const response = await this.octokit.rest.repos.get({
        owner: this.config.owner,
        repo: this.config.repo,
      })

      const permissions = response.data.permissions as Record<string, boolean> | undefined
      const hasAccess = permissions ? (permissions.push === true && permissions.pull === true) : false

      return {
        hasAccess,
        permissions: permissions
          ? Object.entries(permissions)
              .filter(([_, value]) => value === true)
              .map(([key]) => key)
          : [],
      }
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error('Repository not found or token does not have access')
      }
      throw error
    }
  }

  /**
   * Create a GitHub Issue
   */
  async createIssue(options: {
    title: string
    body: string
    labels?: string[]
    assignees?: string[]
  }): Promise<{ number: number; url: string }> {
    const response = await this.octokit.rest.issues.create({
      owner: this.config.owner,
      repo: this.config.repo,
      title: options.title,
      body: options.body,
      labels: options.labels,
      assignees: options.assignees,
    })

    return {
      number: response.data.number,
      url: response.data.html_url,
    }
  }

  /**
   * Update a GitHub Issue
   */
  async updateIssue(
    issueNumber: number,
    options: {
      title?: string
      body?: string
      state?: 'open' | 'closed'
      labels?: string[]
    }
  ): Promise<{ number: number; url: string }> {
    const response = await this.octokit.rest.issues.update({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      title: options.title,
      body: options.body,
      state: options.state,
      labels: options.labels,
    })

    return {
      number: response.data.number,
      url: response.data.html_url,
    }
  }

  /**
   * Get GitHub Issue details
   */
  async getIssue(issueNumber: number) {
    const response = await this.octokit.rest.issues.get({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
    })

    return {
      number: response.data.number,
      title: response.data.title,
      body: response.data.body,
      state: response.data.state,
      url: response.data.html_url,
      labels: response.data.labels.map((label: any) =>
        typeof label === 'string' ? label : label.name
      ),
      assignees: response.data.assignees?.map((a: any) => a.login) || [],
      created_at: response.data.created_at,
      updated_at: response.data.updated_at,
      closed_at: response.data.closed_at,
    }
  }

  /**
   * Close a GitHub Issue
   */
  async closeIssue(issueNumber: number): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      state: 'closed',
    })
  }

  /**
   * List Issues
   */
  async listIssues(options?: {
    state?: 'open' | 'closed' | 'all'
    labels?: string[]
  }): Promise<Array<{
    number: number
    title: string
    state: string
    url: string
    labels: string[]
  }>> {
    const response = await this.octokit.rest.issues.listForRepo({
      owner: this.config.owner,
      repo: this.config.repo,
      state: options?.state || 'open',
      labels: options?.labels?.join(','),
    })

    return response.data.map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      url: issue.html_url,
      labels: issue.labels.map((label: any) =>
        typeof label === 'string' ? label : label.name
      ),
    }))
  }
}

/**
 * Parse GitHub repository URL
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const patterns = [
    /github\.com\/([^\/]+)\/([^\/\.]+)/,
    /github\.com:([^\/]+)\/([^\/\.]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1] && match[2]) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
      }
    }
  }

  return null
}
