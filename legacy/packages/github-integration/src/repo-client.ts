/**
 * RepoClient
 *
 * Per-website abstraction over GitHub. Single API surface for ALL agent and
 * workflow GitHub operations. Replaces the previous global `getGitHub()`
 * singleton with a memoized, website-scoped client.
 *
 * Architectural context (repo-canonical migration):
 *   Each `websites` row carries its own GitHub credentials and target repo.
 *   Pages, collections, sitemap and site config live in that repo (canonical
 *   store of record). Postgres only holds operational metadata. RepoClient is
 *   the gate every agent / workflow goes through to read or write that repo.
 *
 * Usage:
 *   const repo = await getRepoClient(websiteId)
 *   await repo.savePageByPath('content/pages/index.json', page)
 *   await repo.createPR({ contentId, content, branchName, agentId })
 *
 * Surface (kept compatible with `GitHubContentService` so callers using the
 * existing `getGitHubContentService(websiteId)` shim can be redirected here
 * with no method-rename churn — see WS2/WS3):
 *   - Content (delegates to GitHubContentService instance):
 *       getPage, savePage, getPageByPath, savePageByPath, listPages,
 *       getCollectionItem, saveCollectionItem, saveCollectionItemByVillage,
 *       listCollectionItems, getCollectionSchema, saveCollectionSchema,
 *       saveCollectionSchemaByVillage, getAllCollections, getConfig,
 *       saveConfig, getSiteDefinition, saveSiteDefinition, getTree,
 *       getBranch, getContentPath
 *   - File primitives (delegates to GitHubClient):
 *       getFileContent, createOrUpdateFile, deleteFile, branchExists,
 *       createBranch
 *   - PRs:
 *       createPR, mergePR, approvePR, requestPRChanges, closePR,
 *       commentOnPR, getPR, listPRs
 *   - Issues:
 *       createIssue, createTaskIssue, closeIssue, commentOnIssue,
 *       updateIssueLabels, getIssue
 *   - Low-level escape hatches:
 *       getOctokit(), getRepoInfo(), getClient()
 */

import { Octokit } from '@octokit/rest'
import { GitHubClient } from './client'
import {
  GitHubContentService,
  type CollectionItemFile,
  type CollectionSchemaFile,
  type ContentFile,
  type PageFile,
  type TreeEntry,
  type WebsiteConfigFile,
} from './content-service'
import {
  addPRComment,
  approvePR,
  closePR,
  createContentPR,
  getPRDetails,
  listPRs,
  mergePR,
  requestPRChanges,
  type CreateContentPRParams,
  type PRResult,
} from './pull-requests'
import {
  addIssueComment,
  closeIssue,
  createQuestionIssue,
  createTaskIssue,
  getIssueDetails,
  updateIssueLabels,
  type CreateQuestionIssueParams,
  type CreateTaskIssueParams,
  type IssueResult,
} from './issues'
import type { SiteDefinition } from '@swarm-press/shared'

/**
 * Construction options for a RepoClient. All resolved at credential-fetch
 * time; callers should never construct this directly — use
 * `getRepoClient(websiteId)`.
 */
export interface RepoClientOptions {
  websiteId: string
  owner: string
  repo: string
  token: string
  branch?: string // default: 'main' (the working branch — typically the deploy branch too)
  contentPath?: string // default: 'content'
  pagesPath?: string // default: 'content/pages'
}

/**
 * RepoClient — the single API for per-website GitHub operations.
 *
 * The constructor is intentionally NOT marked `private` (TypeScript private
 * does not survive runtime, and we want to allow tests to construct one with
 * a stub `GitHubClient`). Production code paths must go through
 * `getRepoClient(websiteId)`.
 */
export class RepoClient {
  readonly websiteId: string
  private readonly client: GitHubClient
  private readonly content: GitHubContentService
  private readonly branch: string

  constructor(options: RepoClientOptions) {
    this.websiteId = options.websiteId
    this.branch = options.branch || 'main'

    this.client = new GitHubClient({
      owner: options.owner,
      repo: options.repo,
      token: options.token,
    })

    this.content = new GitHubContentService({
      client: this.client,
      branch: this.branch,
      contentPath: options.contentPath || 'content',
      pagesPath: options.pagesPath || 'content/pages',
    })
  }

  // ============================================================
  // Low-level escape hatches
  // ============================================================

  /** Underlying Octokit instance — for operations not yet wrapped here. */
  getOctokit(): Octokit {
    return this.client.getOctokit()
  }

  /** `{ owner, repo }` for this website's repo. */
  getRepoInfo() {
    return this.client.getRepoInfo()
  }

  /** Underlying low-level `GitHubClient`. */
  getClient(): GitHubClient {
    return this.client
  }

  /** The branch this client operates against (typically `main`). */
  getBranch(): string {
    return this.branch
  }

  /** The configured content path (typically `content`). */
  getContentPath(): string {
    return this.content.getContentPath()
  }

  // ============================================================
  // File primitives (delegate to GitHubClient)
  // ============================================================

  async getFileContent(path: string, ref?: string) {
    return this.client.getFileContent(path, ref ?? this.branch)
  }

  async createOrUpdateFile(params: {
    path: string
    content: string
    message: string
    branch?: string
    sha?: string
  }) {
    return this.client.createOrUpdateFile({
      ...params,
      branch: params.branch ?? this.branch,
    })
  }

  async deleteFile(params: {
    path: string
    message: string
    branch?: string
    sha: string
  }) {
    return this.client.deleteFile({
      ...params,
      branch: params.branch ?? this.branch,
    })
  }

  async branchExists(branchName: string): Promise<boolean> {
    return this.client.branchExists(branchName)
  }

  async createBranch(branchName: string, baseBranch?: string): Promise<void> {
    return this.client.createBranch(branchName, baseBranch ?? this.branch)
  }

  // ============================================================
  // Content: Pages
  // ============================================================

  async getPage(slug: string): Promise<ContentFile<PageFile> | null> {
    return this.content.getPage(slug)
  }

  async savePage(slug: string, page: PageFile, message?: string) {
    return this.content.savePage(slug, page, message)
  }

  async getPageByPath(filePath: string): Promise<ContentFile<PageFile> | null> {
    return this.content.getPageByPath(filePath)
  }

  async savePageByPath(filePath: string, page: PageFile, message?: string) {
    return this.content.savePageByPath(filePath, page, message)
  }

  async listPages(): Promise<ContentFile<PageFile>[]> {
    return this.content.listPages()
  }

  async deletePage(slug: string, message?: string): Promise<void> {
    return this.content.deletePage(slug, message)
  }

  // ============================================================
  // Content: Collections
  // ============================================================

  async getCollectionItem(
    collectionType: string,
    slug: string
  ): Promise<ContentFile<CollectionItemFile> | null> {
    return this.content.getCollectionItem(collectionType, slug)
  }

  async listCollectionItems(
    collectionType: string
  ): Promise<ContentFile<CollectionItemFile>[]> {
    return this.content.listCollectionItems(collectionType)
  }

  async saveCollectionItem(
    collectionType: string,
    slug: string,
    item: CollectionItemFile,
    message?: string
  ) {
    return this.content.saveCollectionItem(collectionType, slug, item, message)
  }

  async saveCollectionItemByVillage(
    collectionType: string,
    village: string,
    slug: string,
    item: CollectionItemFile,
    message?: string
  ) {
    return this.content.saveCollectionItemByVillage(
      collectionType,
      village,
      slug,
      item,
      message
    )
  }

  async deleteCollectionItem(
    collectionType: string,
    slug: string,
    message?: string
  ): Promise<void> {
    return this.content.deleteCollectionItem(collectionType, slug, message)
  }

  async getCollectionSchema(
    collectionType: string
  ): Promise<ContentFile<CollectionSchemaFile> | null> {
    return this.content.getCollectionSchema(collectionType)
  }

  async saveCollectionSchema(
    collectionType: string,
    schema: CollectionSchemaFile,
    message?: string
  ) {
    return this.content.saveCollectionSchema(collectionType, schema, message)
  }

  async saveCollectionSchemaByVillage(
    collectionType: string,
    schema: CollectionSchemaFile,
    message?: string
  ) {
    return this.content.saveCollectionSchemaByVillage(
      collectionType,
      schema,
      message
    )
  }

  async listCollectionTypes(): Promise<string[]> {
    return this.content.listCollectionTypes()
  }

  async getAllCollections(): Promise<
    Map<string, { schema: CollectionSchemaFile; items: CollectionItemFile[] }>
  > {
    return this.content.getAllCollections()
  }

  // ============================================================
  // Content: Site config + tree
  // ============================================================

  async getConfig(): Promise<WebsiteConfigFile | null> {
    return this.content.getConfig()
  }

  async saveConfig(config: WebsiteConfigFile, message?: string) {
    return this.content.saveConfig(config, message)
  }

  async getSiteDefinition(): Promise<ContentFile<SiteDefinition> | null> {
    return this.content.getSiteDefinition()
  }

  async saveSiteDefinition(siteDefinition: SiteDefinition, message?: string) {
    return this.content.saveSiteDefinition(siteDefinition, message)
  }

  async hasSiteDefinition(): Promise<boolean> {
    return this.content.hasSiteDefinition()
  }

  async getTree(path?: string): Promise<TreeEntry[]> {
    return this.content.getTree(path)
  }

  /** Convenience: read a file at any path (raw string). */
  async getRawFile(path: string): Promise<string | null> {
    return this.content.getFileContent(path)
  }

  // ============================================================
  // Pull Requests
  // ============================================================

  async createPR(params: CreateContentPRParams): Promise<PRResult> {
    return createContentPR(this, params)
  }

  async mergePR(prNumber: number, commitMessage?: string) {
    return mergePR(this, prNumber, commitMessage)
  }

  async approvePR(prNumber: number, approvalMessage: string, agentId: string) {
    return approvePR(this, prNumber, approvalMessage, agentId)
  }

  async requestPRChanges(prNumber: number, feedback: string, agentId: string) {
    return requestPRChanges(this, prNumber, feedback, agentId)
  }

  async closePR(prNumber: number, closeComment?: string): Promise<void> {
    return closePR(this, prNumber, closeComment)
  }

  async commentOnPR(prNumber: number, comment: string): Promise<void> {
    return addPRComment(this, prNumber, comment)
  }

  async getPR(prNumber: number) {
    return getPRDetails(this, prNumber)
  }

  async listPRs(options?: {
    state?: 'open' | 'closed' | 'all'
    perPage?: number
  }) {
    return listPRs(this, options)
  }

  // ============================================================
  // Issues
  // ============================================================

  async createIssue(params: CreateQuestionIssueParams): Promise<IssueResult> {
    return createQuestionIssue(this, params)
  }

  async createTaskIssue(params: CreateTaskIssueParams): Promise<IssueResult> {
    return createTaskIssue(this, params)
  }

  async closeIssue(issueNumber: number, closeComment?: string): Promise<void> {
    return closeIssue(this, issueNumber, closeComment)
  }

  async commentOnIssue(issueNumber: number, comment: string): Promise<void> {
    return addIssueComment(this, issueNumber, comment)
  }

  async updateIssueLabels(issueNumber: number, labels: string[]): Promise<void> {
    return updateIssueLabels(this, issueNumber, labels)
  }

  async getIssue(issueNumber: number) {
    return getIssueDetails(this, issueNumber)
  }
}

// ============================================================
// Factory: getRepoClient(websiteId) with per-(websiteId, branch) memoization
// ============================================================

/**
 * Memoization key includes branch so callers that need to operate on a draft
 * branch (rare) get a distinct instance and cannot accidentally read/write
 * against the wrong ref.
 */
const repoClientCache = new Map<string, RepoClient>()

function cacheKey(websiteId: string, branch: string): string {
  return `${websiteId}::${branch}`
}

/**
 * Resolve a per-website RepoClient. Reads credentials from the `websites`
 * table (`github_owner`, `github_repo`, `github_access_token`,
 * `github_pages_branch`). Memoized per (websiteId, branch).
 *
 * Throws if the website is not found or has no GitHub repo connected.
 *
 * Uses dynamic import to avoid a static dependency on `@swarm-press/backend`
 * (which would create a circular dep — the backend depends on github-
 * integration, not the other way around).
 */
export async function getRepoClient(
  websiteId: string,
  options: { branch?: string } = {}
): Promise<RepoClient> {
  // Dynamic import to avoid a circular workspace dependency:
  // @swarm-press/backend depends on @swarm-press/github-integration, so we
  // cannot list backend as a static dependency here. Resolved at runtime via
  // workspace symlinks (same pattern @swarm-press/agents uses in
  // packages/agents/src/writer/handlers.ts).
  // @ts-ignore — backend is not in this package's deps; resolved at runtime
  const mod: any = await import('@swarm-press/backend/src/db/repositories/website-repository')
  const websiteRepository = mod.websiteRepository

  // findById returns the raw row; extra columns like `github_pages_branch`
  // flow through (the Zod `Website` schema does not declare every DB column).
  const website: any = await websiteRepository.findById(websiteId)

  if (!website) {
    throw new Error(`getRepoClient: website ${websiteId} not found`)
  }
  if (!website.github_repo || !website.github_owner) {
    throw new Error(
      `getRepoClient: website ${websiteId} has no GitHub repo connected ` +
        `(github_owner=${website.github_owner ?? 'null'}, github_repo=${website.github_repo ?? 'null'})`
    )
  }
  if (!website.github_access_token) {
    throw new Error(
      `getRepoClient: website ${websiteId} has no github_access_token; ` +
        `connect the repo via OAuth first`
    )
  }

  // Default to the deploy branch ('main' for cinqueterre.travel; whatever
  // the website declares for its GitHub Pages source).
  const branch =
    options.branch || website.github_pages_branch || 'main'

  const key = cacheKey(websiteId, branch)
  const cached = repoClientCache.get(key)
  if (cached) return cached

  const client = new RepoClient({
    websiteId,
    owner: website.github_owner,
    repo: website.github_repo,
    token: website.github_access_token,
    branch,
    // Defaults match the cinqueterre.travel content layout. Per-website
    // overrides should land on `websites.settings` later.
    contentPath: 'content',
    pagesPath: 'content/pages',
  })
  repoClientCache.set(key, client)
  return client
}

/**
 * Drop a memoized client (useful after rotating an access token, or in tests).
 * Pass `websiteId` only to drop all branches for that website; pass nothing
 * to clear the entire cache.
 */
export function clearRepoClientCache(websiteId?: string, branch?: string): void {
  if (!websiteId) {
    repoClientCache.clear()
    return
  }
  if (branch) {
    repoClientCache.delete(cacheKey(websiteId, branch))
    return
  }
  for (const key of Array.from(repoClientCache.keys())) {
    if (key.startsWith(`${websiteId}::`)) {
      repoClientCache.delete(key)
    }
  }
}
