# BPMN 2.0 Workflow Definitions

This directory contains BPMN 2.0 workflow definitions for swarm.press core processes.

## Workflows

### 1. Content Production Workflow (`content-production.bpmn`)

**Purpose:** Orchestrates the creation of content from brief to draft submission.

**Flow:**
1. Start: Content brief created
2. Writer creates draft using JSON blocks
3. Transition to draft state
4. Writer submits for review
5. Publish content.submittedForReview event
6. Check if revision needed (optional loop back to step 2)
7. End: Draft submitted to editorial

**Key Actors:**
- Writer Agent

**State Transitions:**
- `brief_created` → `draft` (writer.started)
- `draft` → `in_editorial_review` (submit_for_review)

**Events Published:**
- `content.submittedForReview`

---

### 2. Editorial Review Workflow (`editorial-review.bpmn`)

**Purpose:** Reviews content for quality and appropriateness before publication.

**Flow:**
1. Start: Receive content.submittedForReview event
2. Editor retrieves content
3. Editor reviews content (quality scoring)
4. Detect high-risk content
5. **Decision:** Is high-risk?
   - **Yes:** Escalate to CEO → Wait for CEO decision
     - CEO Approved: Continue to quality check
     - CEO Rejected: Reject content
   - **No:** Continue to quality check
6. **Decision:** Quality acceptable? (score >= 7)
   - **Yes:** Approve content → Publish content.approved event
   - **No:** Reject content → Publish content.needsChanges event
7. End: Content approved OR needs changes

**Key Actors:**
- Editor Agent
- CEO (human approval for high-risk content)

**State Transitions:**
- `in_editorial_review` → `approved` (approve)
- `in_editorial_review` → `needs_changes` (request_changes)

**Events Published:**
- `content.approved`
- `content.needsChanges`

**Question Tickets:**
- Created when high-risk content detected
- Escalated to CEO for approval

---

### 3. Publishing Workflow (`publishing.bpmn`)

**Purpose:** Builds and deploys approved content to production website.

**Flow:**
1. Start: Receive content.approved event
2. SEO agent optimizes content
3. Transition to scheduled state
4. Publish content.scheduled event
5. Engineering agent validates content structure
6. Engineering agent validates assets (images, alt text, URLs)
7. **Decision:** Validation passed?
   - **No:** Handle failure → Publish deploy.failed event → End
   - **Yes:** Continue
8. Engineering agent builds static site with Astro
9. **Decision:** Build successful?
   - **No:** Handle failure → End
   - **Yes:** Continue
10. Engineering agent deploys to production
11. **Decision:** Deploy successful?
    - **No:** Handle failure → End
    - **Yes:** Continue
12. Transition to published state
13. Publish deploy.success event
14. End: Published successfully

**Key Actors:**
- SEO Agent
- Engineering Agent

**State Transitions:**
- `approved` → `scheduled` (ready_for_publish)
- `scheduled` → `published` (deploy_success)

**Events Published:**
- `content.scheduled`
- `deploy.success`
- `deploy.failed`

---

## BPMN Elements Used

### Service Tasks
- Represent automated tasks executed by agents
- Each service task maps to agent tool calls or state transitions

### Exclusive Gateways
- Represent decision points in the workflow
- Based on conditions like quality scores, validation results, CEO decisions

### Message Events
- **Start Events:** Triggered by CloudEvents from previous workflows
- **Intermediate Throw Events:** Publish CloudEvents for downstream consumers
- **End Events:** Terminal states of the workflow

### User Tasks
- Represent human intervention points (e.g., CEO approval for high-risk content)

## Viewing BPMN Diagrams

These BPMN files can be viewed using:
- [bpmn.io](https://bpmn.io/) - Web-based BPMN viewer/editor
- Camunda Modeler
- Any BPMN 2.0 compatible tool

## Integration with Temporal

The BPMN diagrams serve as documentation and design specifications.
The actual executable workflows are implemented in TypeScript using Temporal.io:
- `packages/workflows/src/workflows/content-production.workflow.ts`
- `packages/workflows/src/workflows/editorial-review.workflow.ts`
- `packages/workflows/src/workflows/publishing.workflow.ts`

## Workflow Orchestration Pattern

All workflows follow this pattern:
1. Triggered by CloudEvent or API call
2. Execute agent activities synchronously via Temporal
3. Perform state machine transitions
4. Publish CloudEvents for next workflow stage
5. Handle errors and failures gracefully
