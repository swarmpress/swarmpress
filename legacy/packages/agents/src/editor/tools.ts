/**
 * EditorAgent Tool Definitions
 * Tools for editorial review and content quality management
 */

import {
  ToolDefinition,
  stringProp,
  numberProp,
  arrayProp,
} from '../base/tools'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Get content for review - fetch content with full details
 */
export const getContentForReviewTool: ToolDefinition = {
  name: 'get_content_for_review',
  description:
    'Fetch a content item by ID for editorial review. Returns the full content including title, brief, body blocks, metadata, and current status.',
  input_schema: {
    type: 'object',
    properties: {
      content_id: stringProp('The UUID of the content item to review'),
    },
    required: ['content_id'],
  },
}

/**
 * Approve content - transition to approved status
 */
export const approveContentTool: ToolDefinition = {
  name: 'approve_content',
  description:
    'Approve content that meets quality standards. The content must be in "in_editorial_review" status. This transitions the content to "approved" status, allowing it to proceed to publication.',
  input_schema: {
    type: 'object',
    properties: {
      content_id: stringProp('The UUID of the content item to approve'),
      quality_score: numberProp(
        'Quality score from 1-10 (7+ required for approval)'
      ),
      notes: stringProp('Optional approval notes'),
    },
    required: ['content_id', 'quality_score'],
  },
}

/**
 * Request changes - send content back for revision
 */
export const requestChangesTool: ToolDefinition = {
  name: 'request_changes',
  description:
    'Request changes to content that needs improvement. The content will be sent back to the writer for revision. Provide specific, actionable feedback.',
  input_schema: {
    type: 'object',
    properties: {
      content_id: stringProp('The UUID of the content item'),
      quality_score: numberProp('Quality score from 1-10'),
      feedback: stringProp('Detailed feedback for the writer'),
      required_changes: arrayProp(
        'List of specific changes required',
        stringProp('A specific change that must be made')
      ),
    },
    required: ['content_id', 'quality_score', 'feedback', 'required_changes'],
  },
}

/**
 * Reject content - reject content that cannot be salvaged
 */
export const rejectContentTool: ToolDefinition = {
  name: 'reject_content',
  description:
    'Reject content that cannot be improved through revision. Use this for content that fundamentally fails to meet requirements or is inappropriate.',
  input_schema: {
    type: 'object',
    properties: {
      content_id: stringProp('The UUID of the content item to reject'),
      reason: stringProp('Clear explanation for why the content is rejected'),
    },
    required: ['content_id', 'reason'],
  },
}

/**
 * Escalate to CEO - create question ticket for high-risk content
 */
export const escalateToCEOTool: ToolDefinition = {
  name: 'escalate_to_ceo',
  description: `Escalate high-risk content to the CEO for approval. Use this when content contains:
- Legal claims or advice
- Medical or health claims
- Financial advice
- Controversial or polarizing topics
- Potentially defamatory statements
- Sensitive political or social issues

The content will be placed on hold until the CEO responds.`,
  input_schema: {
    type: 'object',
    properties: {
      content_id: stringProp('The UUID of the content item'),
      subject: stringProp('Brief subject line for the escalation'),
      reason: stringProp('Detailed explanation of why this needs CEO review'),
      risk_factors: arrayProp(
        'List of identified risk factors',
        stringProp('A specific risk factor (e.g., "legal claims", "medical advice")')
      ),
    },
    required: ['content_id', 'subject', 'reason', 'risk_factors'],
  },
}

// ============================================================================
// Export All Tools
// ============================================================================

export const editorTools = [
  getContentForReviewTool,
  approveContentTool,
  requestChangesTool,
  rejectContentTool,
  escalateToCEOTool,
]
