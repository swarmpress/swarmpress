/**
 * Content Validators
 * Tools for auditing and validating content integrity
 */

// URL Checking
export {
  checkUrl,
  checkUrls,
  categorizeUrlStatus,
  isImageContentType,
  type CheckUrlInput,
  type CheckUrlOutput,
} from './check-url'

// URL Scanning
export {
  scanContentForUrls,
  groupUrlsByType,
  getUniqueUrls,
  findReferencesToUrl,
  type UrlReference,
  type ScanUrlsInput,
  type ScanUrlsOutput,
} from './scan-urls'

// Image Validation
export {
  validateImageContent,
  validateImages,
  quickImageHeuristics,
  type ValidateImageInput,
  type ValidateImageOutput,
} from './validate-image'

// Comprehensive Audit
export {
  runContentAudit,
  filterIssuesBySeverity,
  filterIssuesByCategory,
  groupIssuesByFile,
  getAutoFixableIssues,
  formatAuditReportAsMarkdown,
  type AuditInput,
  type AuditIssue,
  type AuditSummary,
  type AuditOutput,
} from './audit'
