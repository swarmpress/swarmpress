# GitHub Integration for agent.press

This package provides GitHub-based collaboration and governance for agent.press, implementing the **Option B: Hybrid Sync Model**.

## Architecture

- **PostgreSQL + Temporal**: Canonical system of record for operational state
- **GitHub**: Transparent collaboration surface and human interface
- **Bidirectional Sync**: Internal state ↔ GitHub state

## Components

### 1. GitHub Client (`client.ts`)
Wrapper around Octokit for repository operations:
- Create/update files
- Manage branches
- Read content

### 2. Pull Requests (`pull-requests.ts`)
Content review workflow via PRs:
- Create PR for content review
- Add comments and feedback
- Request changes or approve
- Merge approved content

### 3. Issues (`issues.ts`)
Tasks and question tickets via GitHub Issues:
- Create issues for QuestionTickets
- Create issues for Tasks
- Track status with labels

### 4. Webhooks (`webhooks.ts`)
Process GitHub events:
- `pull_request.opened` → Trigger editorial review
- `pull_request_review.submitted` → Sync approval/rejection
- `pull_request.closed` → Trigger publishing (if merged)
- `issue_comment.created` → Sync CEO answers

### 5. Sync Layer (`sync.ts`)
Bidirectional state synchronization:

**Internal → GitHub:**
- Content transitions to review → Create PR
- Content approved → Approve PR
- Content published → Merge PR
- QuestionTicket created → Create Issue

**GitHub → Internal:**
- PR opened → Trigger workflow
- PR review → Update content state
- Issue comment (CEO) → Answer ticket

## Setup

### 1. GitHub Repository

Create a repository to store content and track collaboration:

```bash
gh repo create myorg/agentpress-content --private
```

### 2. Authentication

**Option A: Personal Access Token (Simple)**

```env
GITHUB_TOKEN=ghp_your_token_here
GITHUB_OWNER=myorg
GITHUB_REPO=agentpress-content
```

**Option B: GitHub App (Production)**

```env
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_INSTALLATION_ID=78910
GITHUB_OWNER=myorg
GITHUB_REPO=agentpress-content
```

### 3. Webhooks

Configure webhook in GitHub repository settings:
- **Payload URL**: `https://your-api.com/api/webhooks/github`
- **Content type**: `application/json`
- **Secret**: Set `GITHUB_WEBHOOK_SECRET`
- **Events**: Pull requests, Pull request reviews, Issues, Issue comments

### 4. Initialize Client

```typescript
import { initializeGitHub } from '@agent-press/github-integration'

initializeGitHub({
  token: process.env.GITHUB_TOKEN,
  owner: process.env.GITHUB_OWNER!,
  repo: process.env.GITHUB_REPO!,
})
```

## Usage

### Content Review Workflow

```typescript
import { syncContentToGitHub } from '@agent-press/github-integration'

// When content transitions to in_editorial_review
await syncContentToGitHub(contentId)
// → Creates PR with content JSON
// → Adds labels: content-review, status:in-review
// → Triggers editorial review
```

### Editorial Approval

```typescript
import { syncApprovalToGitHub } from '@agent-press/github-integration'

// When editor approves content
await syncApprovalToGitHub(contentId, 'Content looks great!', 'editor-agent')
// → Approves PR
// → Updates labels to status:approved
```

### CEO Question

```typescript
import { syncQuestionToGitHub } from '@agent-press/github-integration'

// When high-risk content escalated
await syncQuestionToGitHub(ticketId)
// → Creates Issue with label: question-ticket
// → Assigns to CEO
// → CEO answers via comment
// → Webhook syncs answer back
```

### Publishing

```typescript
import { syncPublishToGitHub } from '@agent-press/github-integration'

// When content is published
await syncPublishToGitHub(contentId)
// → Merges PR (squash)
// → Updates labels to status:published
// → Content JSON now in main branch
```

## Repository Structure

```
agentpress-content/
├── content/
│   ├── website-1/
│   │   ├── article-1.json
│   │   ├── article-2.json
│   │   └── ...
│   └── website-2/
│       └── ...
├── .github/
│   └── workflows/
│       ├── publish.yml      # Trigger on PR merge
│       └── validate.yml     # Run on PR open
└── README.md
```

## State Mapping

| Internal State | GitHub State |
|----------------|--------------|
| `draft` | Branch created |
| `in_editorial_review` | PR open with `status:in-review` |
| `needs_changes` | PR with changes requested + `status:needs-changes` |
| `approved` | PR approved + `status:approved` |
| `published` | PR merged + `status:published` |

| Internal Entity | GitHub Entity |
|-----------------|---------------|
| ContentItem | Pull Request |
| QuestionTicket | Issue with `question-ticket` label |
| Task | Issue with `task` label |

## Benefits

### For CEO
- ✅ Full transparency - all work visible
- ✅ Comment directly on content PRs
- ✅ Approve/reject via GitHub UI
- ✅ See complete discussion history
- ✅ No custom dashboard needed

### For Agents
- ✅ LLM-friendly context (PRs, Issues, Comments)
- ✅ Can learn from historical decisions
- ✅ Standard collaboration interface

### For System
- ✅ Auditability out of the box
- ✅ Version control for content
- ✅ Familiar developer workflow
- ✅ GitHub Actions for CI/CD

## Future Enhancements

- Store content as Markdown + frontmatter (instead of pure JSON)
- Use GitHub Discussions for broader collaboration
- Implement branch protection rules
- Add GitHub Actions for automated validation
- Multi-repo support for multi-tenancy
