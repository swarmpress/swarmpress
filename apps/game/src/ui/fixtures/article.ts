/**
 * The article behind the mock company's publish-approval ticket
 * (fixtures/inbox.json `ticket-7`, work item `work-item-1`).
 *
 * The page and the brief are the agents crate's golden fixtures: the article
 * shape the orchestrator assembles (docs/design/mvp-pipeline.md §4), so the
 * mock UI previews what a real approval will show. The review and the pull
 * request are written here in the shapes the orchestrator stores
 * (`orchestrator::ArtifactRecord`, `agents::EditorReview`).
 */
import brief from '../../../../../crates/agents/tests/fixtures/article/brief.json'
import page from '../../../../../crates/agents/tests/fixtures/article/page.golden.json'
import styleGuide from '../../../../../crates/agents/tests/fixtures/style-guide.json'
import type { ArticleRecord } from '../data-source'

export const FIXTURE_ARTICLE_ITEM = 'work-item-1'
export const FIXTURE_ARTICLE_PR = 31

/** A fresh copy of the fixture article (the page is the golden fixture, unchanged). */
export function fixtureArticle(): ArticleRecord {
  return {
    page: structuredClone(page),
    review: {
      decision: 'approve',
      score: 8,
      notes: 'Much tighter. The practical notes answer what a visitor will ask, and the piece stays out of the pickers’ way.',
      issues: ['The trenino paragraph could name one grower.'],
      highRisk: [],
    },
    revision: 1,
    path: `content/pages/blog/${brief.slug}.json`,
    branch: `drafts/${brief.content_id}`,
    pr: FIXTURE_ARTICLE_PR,
    headSha: '9f2c1aa7b3e4d5f60718293a4b5c6d7e8f901234',
    mergedSha: null,
    brief: { title: brief.title, angle: brief.angle, slug: brief.slug, keywords: [...brief.keywords], targetWords: brief.target_words },
    writer: 'staff-1',
    editor: 'staff-5',
  }
}

/** The banned phrases of the agents crate's style-guide fixture (the one a session binds, session.ts `SITE`). */
export const FIXTURE_BANNED_PHRASES: readonly string[] = styleGuide.vocabulary.avoid
