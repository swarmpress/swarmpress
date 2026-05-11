/**
 * @swarm-press/github-integration
 * GitHub collaboration and governance layer for swarm.press.
 *
 * Public surface (post repo-canonical migration WS1):
 *   - `RepoClient` + `getRepoClient(websiteId)` — per-website abstraction.
 *     This is what agents and workflows should consume.
 *   - `GitHubClient` — low-level Octokit wrapper. Used internally by
 *     `RepoClient`; external consumers should not need it directly.
 *   - `GitHubContentService` — content-shaped wrapper around `GitHubClient`.
 *     Kept exported because existing call sites in `packages/site-builder`,
 *     `packages/workflows`, and operational scripts construct it directly
 *     (with raw credentials) for build-time / one-off use cases that have no
 *     `websiteId` context. New code should prefer `RepoClient`.
 *   - PR/issue helpers — re-exported but they now require a `RepoClient`
 *     instance as their first argument. Prefer `RepoClient.createPR(...)`
 *     etc.
 *   - `GitHubWebhooks` — unchanged, framework-agnostic dispatcher.
 *
 * REMOVED in this migration:
 *   - `initializeGitHub(config)` and `getGitHub()` global singleton. swarm.press
 *     is multi-site, so a process-wide GitHub client is the wrong shape.
 */

// Per-website abstraction (preferred entry point)
export { RepoClient, getRepoClient, clearRepoClientCache } from './repo-client'
export type { RepoClientOptions } from './repo-client'

// Low-level client
export { GitHubClient } from './client'
export type { GitHubConfig } from './client'

// Content service (kept exported for legacy direct construction)
export { GitHubContentService } from './content-service'
export type {
  GitHubContentConfig,
  GitHubContentClientConfig,
  WebsiteConfigFile,
  PageFile,
  CollectionSchemaFile,
  CollectionItemFile,
  TreeEntry,
  ContentFile,
} from './content-service'

// Serializers for DB <-> GitHub format conversion
export * from './serializers'

// PR helpers — note: each now takes a RepoClient as its first argument.
// Prefer `repoClient.createPR(...)` etc. on the RepoClient instance.
export {
  createContentPR,
  addPRComment,
  requestPRChanges,
  approvePR,
  mergePR,
  closePR,
  getPRDetails,
  listPRs,
  sanitizePRTitle,
} from './pull-requests'
export type { CreateContentPRParams, PRResult } from './pull-requests'

// Issue helpers — same: each takes a RepoClient first.
export {
  createQuestionIssue,
  createTaskIssue,
  addIssueComment,
  closeIssue,
  updateIssueLabels,
  getIssueDetails,
} from './issues'
export type {
  CreateQuestionIssueParams,
  CreateTaskIssueParams,
  IssueResult,
} from './issues'

// Webhook dispatcher (framework-agnostic; no GitHub credentials needed)
export { GitHubWebhooks } from './webhooks'
export type { WebhookConfig, WebhookHandlers } from './webhooks'

// Sync exports temporarily disabled - need to fix backend exports first
// export {
//   syncContentToGitHub,
//   syncApprovalToGitHub,
//   syncRejectionToGitHub,
//   syncPublishToGitHub,
//   syncQuestionToGitHub,
//   syncTaskToGitHub,
//   syncPRToInternal,
//   syncPRReviewToInternal,
//   syncIssueCommentToInternal,
//   getGitHubMapping,
//   storeGitHubMapping,
// } from './sync'
