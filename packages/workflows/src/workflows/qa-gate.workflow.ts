/**
 * QA Gate Workflow
 * Hard stop before publishing - validates content quality
 *
 * Flow:
 * 1. Page Content Ready
 * 2. QAAgent.check_media_relevance() → FAIL? → MediaSelectorAgent.fix()
 * 3. QAAgent.check_broken_links() → FAIL? → LinkerAgent.fix()
 * 4. QAAgent.check_editorial_coherence() → FAIL? → PagePolishAgent.fix()
 * 5. PASS → Proceed to Engineering
 *
 * This workflow is the gatekeeper ensuring no broken links or mismatched
 * media ever reach production.
 */

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  invokeQAAgent,
  invokeMediaSelectorAgent,
  invokeLinkerAgent,
  invokePagePolishAgent,
  getContentItem,
  publishContentEvent,
  logAgentActivityToGitHub,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 3,
  },
})

export interface QAGateInput {
  contentId: string
  pageId?: string
  websiteId: string
  qaAgentId: string
  mediaSelectorAgentId?: string
  linkerAgentId?: string
  pagePolishAgentId?: string
  maxFixAttempts?: number
}

export interface QAGateResult {
  success: boolean
  contentId: string
  passed: boolean
  checks: {
    mediaRelevance: CheckResult
    brokenLinks: CheckResult
    editorialCoherence: CheckResult
  }
  fixesApplied: {
    mediaFixes: number
    linkFixes: number
    editorialFixes: number
  }
  error?: string
}

interface CheckResult {
  passed: boolean
  issues: string[]
  fixAttempts: number
}

/**
 * QA Gate Workflow
 *
 * Validates content before it can proceed to engineering/publishing.
 * Each check can trigger automatic fixes from specialized agents.
 */
export async function qaGateWorkflow(input: QAGateInput): Promise<QAGateResult> {
  const {
    contentId,
    pageId: _pageId,
    websiteId,
    qaAgentId,
    mediaSelectorAgentId,
    linkerAgentId,
    pagePolishAgentId,
    maxFixAttempts = 3,
  } = input

  // pageId reserved for future use (e.g., page-specific QA rules)
  void _pageId

  const result: QAGateResult = {
    success: false,
    contentId,
    passed: false,
    checks: {
      mediaRelevance: { passed: false, issues: [], fixAttempts: 0 },
      brokenLinks: { passed: false, issues: [], fixAttempts: 0 },
      editorialCoherence: { passed: false, issues: [], fixAttempts: 0 },
    },
    fixesApplied: {
      mediaFixes: 0,
      linkFixes: 0,
      editorialFixes: 0,
    },
  }

  try {
    console.log(`[QAGate] Starting QA gate workflow for content ${contentId}`)

    // Get content to validate
    const content = await getContentItem(contentId)
    if (!content) {
      throw new Error(`Content ${contentId} not found`)
    }

    // Log workflow start
    await logAgentActivityToGitHub({
      contentId,
      agentId: qaAgentId,
      agentName: 'QAAgent',
      activity: 'Starting QA Gate validation',
      details: 'Running all quality checks before publishing...',
      result: 'pending',
    })

    // ========================================================================
    // CHECK 1: Media Relevance
    // ========================================================================
    console.log(`[QAGate] Check 1: Media Relevance`)

    let mediaCheckPassed = false
    let mediaAttempts = 0

    while (!mediaCheckPassed && mediaAttempts < maxFixAttempts) {
      const mediaCheckTask = `Use your check_media_relevance tool to validate all images in content ${contentId}.

Check that:
1. All images have village tags matching their component's entity
2. No "Caribbean on Riomaggiore" scenarios
3. Images are appropriate for their block types

Return a detailed report of any mismatches.`

      const mediaCheckResult = await invokeQAAgent({
        agentId: qaAgentId,
        task: mediaCheckTask,
        contentId,
        websiteId,
      })

      if (!mediaCheckResult.success) {
        result.checks.mediaRelevance.issues.push(`Check failed: ${mediaCheckResult.error}`)
        break
      }

      const mediaIssues = mediaCheckResult.result?.issues || []
      mediaCheckPassed = mediaCheckResult.result?.passed === true || mediaIssues.length === 0

      if (mediaCheckPassed) {
        result.checks.mediaRelevance.passed = true
        console.log(`[QAGate] Media relevance check PASSED`)
      } else {
        result.checks.mediaRelevance.issues = mediaIssues
        console.log(`[QAGate] Media relevance check FAILED with ${mediaIssues.length} issues`)

        // Attempt fix if MediaSelectorAgent is available
        if (mediaSelectorAgentId && mediaAttempts < maxFixAttempts - 1) {
          console.log(`[QAGate] Attempting media fix (attempt ${mediaAttempts + 1})`)

          await logAgentActivityToGitHub({
            contentId,
            agentId: mediaSelectorAgentId,
            agentName: 'MediaSelectorAgent',
            activity: 'Fixing media relevance issues',
            details: `Issues found:\n${mediaIssues.map((i: string) => `- ${i}`).join('\n')}`,
            result: 'pending',
          })

          const fixTask = `Fix media relevance issues in content ${contentId}.

Issues to fix:
${mediaIssues.map((i: string) => `- ${i}`).join('\n')}

Use your find_matching_images tool to find properly tagged images that match the entity context of each component. Replace any mismatched images.`

          const fixResult = await invokeMediaSelectorAgent({
            agentId: mediaSelectorAgentId,
            task: fixTask,
            contentId,
            websiteId,
          })

          if (fixResult.success) {
            result.fixesApplied.mediaFixes++
            await logAgentActivityToGitHub({
              contentId,
              agentId: mediaSelectorAgentId,
              agentName: 'MediaSelectorAgent',
              activity: 'Media fixes applied',
              details: 'Replaced mismatched images with properly tagged alternatives.',
              result: 'success',
            })
          }
        }
      }

      mediaAttempts++
      result.checks.mediaRelevance.fixAttempts = mediaAttempts

      if (!mediaCheckPassed && mediaAttempts < maxFixAttempts) {
        await sleep('2 seconds')
      }
    }

    // ========================================================================
    // CHECK 2: Broken Internal Links
    // ========================================================================
    console.log(`[QAGate] Check 2: Broken Internal Links`)

    let linksCheckPassed = false
    let linksAttempts = 0

    while (!linksCheckPassed && linksAttempts < maxFixAttempts) {
      const linksCheckTask = `Use your check_broken_internal_links tool to validate all internal links in content ${contentId}.

Check that:
1. All internal link URLs exist in sitemap-index.json
2. No invented or guessed URLs
3. All href attributes resolve to valid pages

Return a detailed report of any broken links.`

      const linksCheckResult = await invokeQAAgent({
        agentId: qaAgentId,
        task: linksCheckTask,
        contentId,
        websiteId,
      })

      if (!linksCheckResult.success) {
        result.checks.brokenLinks.issues.push(`Check failed: ${linksCheckResult.error}`)
        break
      }

      const linkIssues = linksCheckResult.result?.issues || []
      linksCheckPassed = linksCheckResult.result?.passed === true || linkIssues.length === 0

      if (linksCheckPassed) {
        result.checks.brokenLinks.passed = true
        console.log(`[QAGate] Broken links check PASSED`)
      } else {
        result.checks.brokenLinks.issues = linkIssues
        console.log(`[QAGate] Broken links check FAILED with ${linkIssues.length} issues`)

        // Attempt fix if LinkerAgent is available
        if (linkerAgentId && linksAttempts < maxFixAttempts - 1) {
          console.log(`[QAGate] Attempting link fix (attempt ${linksAttempts + 1})`)

          await logAgentActivityToGitHub({
            contentId,
            agentId: linkerAgentId,
            agentName: 'LinkerAgent',
            activity: 'Fixing broken links',
            details: `Issues found:\n${linkIssues.map((i: string) => `- ${i}`).join('\n')}`,
            result: 'pending',
          })

          const fixTask = `Fix broken internal links in content ${contentId}.

Issues to fix:
${linkIssues.map((i: string) => `- ${i}`).join('\n')}

Use your validate_links tool to find correct URLs from sitemap-index.json, then use insert_links to update the content with valid links.`

          const fixResult = await invokeLinkerAgent({
            agentId: linkerAgentId,
            task: fixTask,
            contentId,
            websiteId,
          })

          if (fixResult.success) {
            result.fixesApplied.linkFixes++
            await logAgentActivityToGitHub({
              contentId,
              agentId: linkerAgentId,
              agentName: 'LinkerAgent',
              activity: 'Link fixes applied',
              details: 'Replaced broken links with valid URLs from sitemap-index.',
              result: 'success',
            })
          }
        }
      }

      linksAttempts++
      result.checks.brokenLinks.fixAttempts = linksAttempts

      if (!linksCheckPassed && linksAttempts < maxFixAttempts) {
        await sleep('2 seconds')
      }
    }

    // ========================================================================
    // CHECK 3: Editorial Coherence
    // ========================================================================
    console.log(`[QAGate] Check 3: Editorial Coherence`)

    let editorialCheckPassed = false
    let editorialAttempts = 0

    while (!editorialCheckPassed && editorialAttempts < maxFixAttempts) {
      const editorialCheckTask = `Use your run_full_qa tool to check editorial coherence for content ${contentId}.

Check that:
1. Consistent voice throughout (Giulia Rossi persona)
2. No jarring transitions between sections
3. No redundant information
4. Natural reading flow

Return a detailed report of any coherence issues.`

      const editorialCheckResult = await invokeQAAgent({
        agentId: qaAgentId,
        task: editorialCheckTask,
        contentId,
        websiteId,
      })

      if (!editorialCheckResult.success) {
        result.checks.editorialCoherence.issues.push(`Check failed: ${editorialCheckResult.error}`)
        break
      }

      const editorialIssues = editorialCheckResult.result?.coherence_issues || []
      editorialCheckPassed = editorialCheckResult.result?.passed === true || editorialIssues.length === 0

      if (editorialCheckPassed) {
        result.checks.editorialCoherence.passed = true
        console.log(`[QAGate] Editorial coherence check PASSED`)
      } else {
        result.checks.editorialCoherence.issues = editorialIssues
        console.log(`[QAGate] Editorial coherence check FAILED with ${editorialIssues.length} issues`)

        // Attempt fix if PagePolishAgent is available
        if (pagePolishAgentId && editorialAttempts < maxFixAttempts - 1) {
          console.log(`[QAGate] Attempting editorial fix (attempt ${editorialAttempts + 1})`)

          await logAgentActivityToGitHub({
            contentId,
            agentId: pagePolishAgentId,
            agentName: 'PagePolishAgent',
            activity: 'Fixing editorial coherence issues',
            details: `Issues found:\n${editorialIssues.map((i: string) => `- ${i}`).join('\n')}`,
            result: 'pending',
          })

          const fixTask = `Fix editorial coherence issues in content ${contentId}.

Issues to fix:
${editorialIssues.map((i: string) => `- ${i}`).join('\n')}

Use your tools to:
1. rewrite_transitions - smooth section connections
2. remove_redundancy - consolidate repeated info
3. unify_voice - ensure Giulia Rossi persona throughout
4. polish_prose - improve sentence-level quality`

          const fixResult = await invokePagePolishAgent({
            agentId: pagePolishAgentId,
            task: fixTask,
            contentId,
            websiteId,
          })

          if (fixResult.success) {
            result.fixesApplied.editorialFixes++
            await logAgentActivityToGitHub({
              contentId,
              agentId: pagePolishAgentId,
              agentName: 'PagePolishAgent',
              activity: 'Editorial fixes applied',
              details: 'Improved transitions, removed redundancy, unified voice.',
              result: 'success',
            })
          }
        }
      }

      editorialAttempts++
      result.checks.editorialCoherence.fixAttempts = editorialAttempts

      if (!editorialCheckPassed && editorialAttempts < maxFixAttempts) {
        await sleep('2 seconds')
      }
    }

    // ========================================================================
    // FINAL VERDICT
    // ========================================================================
    const allChecksPassed =
      result.checks.mediaRelevance.passed &&
      result.checks.brokenLinks.passed &&
      result.checks.editorialCoherence.passed

    result.passed = allChecksPassed
    result.success = true

    if (allChecksPassed) {
      console.log(`[QAGate] All checks PASSED - content ready for engineering`)

      await logAgentActivityToGitHub({
        contentId,
        agentId: qaAgentId,
        agentName: 'QAAgent',
        activity: '✅ QA Gate PASSED',
        details: `All quality checks passed. Content is ready for publishing.

**Summary:**
- Media Relevance: ✅ PASSED
- Broken Links: ✅ PASSED
- Editorial Coherence: ✅ PASSED

**Fixes Applied:**
- Media fixes: ${result.fixesApplied.mediaFixes}
- Link fixes: ${result.fixesApplied.linkFixes}
- Editorial fixes: ${result.fixesApplied.editorialFixes}`,
        result: 'success',
      })

      // Publish QA passed event
      await publishContentEvent({
        type: 'content.qaGatePassed',
        contentId,
        data: {
          content_id: contentId,
          qa_agent_id: qaAgentId,
          fixes_applied: result.fixesApplied,
        },
      })
    } else {
      console.log(`[QAGate] Some checks FAILED - content blocked from publishing`)

      const failedChecks: string[] = []
      if (!result.checks.mediaRelevance.passed) failedChecks.push('Media Relevance')
      if (!result.checks.brokenLinks.passed) failedChecks.push('Broken Links')
      if (!result.checks.editorialCoherence.passed) failedChecks.push('Editorial Coherence')

      await logAgentActivityToGitHub({
        contentId,
        agentId: qaAgentId,
        agentName: 'QAAgent',
        activity: '❌ QA Gate FAILED',
        details: `Content blocked from publishing due to quality issues.

**Failed Checks:** ${failedChecks.join(', ')}

**Media Relevance:** ${result.checks.mediaRelevance.passed ? '✅' : '❌'}
${result.checks.mediaRelevance.issues.length > 0 ? result.checks.mediaRelevance.issues.map(i => `- ${i}`).join('\n') : ''}

**Broken Links:** ${result.checks.brokenLinks.passed ? '✅' : '❌'}
${result.checks.brokenLinks.issues.length > 0 ? result.checks.brokenLinks.issues.map(i => `- ${i}`).join('\n') : ''}

**Editorial Coherence:** ${result.checks.editorialCoherence.passed ? '✅' : '❌'}
${result.checks.editorialCoherence.issues.length > 0 ? result.checks.editorialCoherence.issues.map(i => `- ${i}`).join('\n') : ''}

**Fix Attempts:**
- Media fixes: ${result.fixesApplied.mediaFixes}
- Link fixes: ${result.fixesApplied.linkFixes}
- Editorial fixes: ${result.fixesApplied.editorialFixes}`,
        result: 'failure',
      })

      // Publish QA failed event
      await publishContentEvent({
        type: 'content.qaGateFailed',
        contentId,
        data: {
          content_id: contentId,
          qa_agent_id: qaAgentId,
          failed_checks: failedChecks,
          issues: {
            media: result.checks.mediaRelevance.issues,
            links: result.checks.brokenLinks.issues,
            editorial: result.checks.editorialCoherence.issues,
          },
        },
      })
    }

    return result
  } catch (error) {
    console.error(`[QAGate] Workflow failed:`, error)
    return {
      ...result,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
