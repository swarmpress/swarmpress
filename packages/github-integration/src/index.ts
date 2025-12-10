/**
 * @swarm-press/github-integration
 * GitHub collaboration and governance layer for swarm.press
 */

// Core client
export { GitHubClient, initializeGitHub, getGitHub } from './client'
export type { GitHubConfig } from './client'

// Content service (GitHub as source of truth)
export { GitHubContentService } from './content-service'
export type {
  GitHubContentConfig,
  WebsiteConfigFile,
  PageFile,
  CollectionSchemaFile,
  CollectionItemFile,
  TreeEntry,
  ContentFile,
} from './content-service'

// Serializers for DB <-> GitHub format conversion
export * from './serializers'

export {
  createContentPR,
  addPRComment,
  requestPRChanges,
  approvePR,
  mergePR,
  getPRDetails,
} from './pull-requests'
export type { CreateContentPRParams, PRResult } from './pull-requests'

export {
  createQuestionIssue,
  createTaskIssue,
  addIssueComment,
  closeIssue,
  updateIssueLabels,
  getIssueDetails,
} from './issues'
export type { CreateQuestionIssueParams, CreateTaskIssueParams, IssueResult } from './issues'

export { GitHubWebhooks } from './webhooks'
export type { WebhookConfig, WebhookHandlers } from './webhooks'

export {
  syncContentToGitHub,
  syncApprovalToGitHub,
  syncRejectionToGitHub,
  syncPublishToGitHub,
  syncQuestionToGitHub,
  syncTaskToGitHub,
  syncPRToInternal,
  syncPRReviewToInternal,
  syncIssueCommentToInternal,
  getGitHubMapping,
  storeGitHubMapping,
} from './sync'
