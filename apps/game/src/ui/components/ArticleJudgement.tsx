import type { ComponentChildren } from 'preact'
import { measureArticle, WORD_TOLERANCE, type ArticleChecks } from '../article-checks'
import { articleSummary } from '../article-preview'
import type { ArticleReview } from '../data-source'
import { sentence } from '../format'
import { pullRequestUrl } from '../links'
import { useStore } from '../store'
import { ReadArticleButton } from './ArticlePreview'
import { Badge, External } from './common'

/**
 * What the CEO judges an article by, inside its ticket (increment U1,
 * ADR-0059; docs/design/mvp-pipeline.md §5). Everything comes from the
 * company's store (`ArticleRecord`), nothing from the sim.
 *
 * Labelled groups, kept apart (docs/reference/browser-agent-studio.md §20):
 * - **Measured checks**: counted from the page JSON, reproducible, pass or fail.
 * - **Editor's opinion**: the reviewer's score, notes and issues.
 * - **Sources**: the web research the article rests on (ADR-0068), each claim
 *   with the page that states it, so the CEO can check a flagged claim.
 *   Claims and titles are text a model and a web page wrote: shown as text.
 */
export function ArticleJudgement({ item, id, missing }: { item: string; id: string; missing?: boolean }) {
  const store = useStore()
  const record = store.articleOf(item)
  if (record === undefined) return null
  if (record?.page == null) {
    // The gate asks for a decision about text this device does not have: say so.
    return missing ? (
      <p class="small warn-text approval-missing">
        The article text is not in this device’s store (plan text is not synced between devices yet), so there is nothing to preview here. Read it in its pull
        request on GitHub before you publish.
      </p>
    ) : null
  }
  const lang = store.site.language || 'en'
  const summary = articleSummary(record.page, lang)
  const checks = measureArticle(record.page, { targetWords: record.brief?.targetWords, bannedPhrases: store.bannedPhrases })
  const sha = record.headSha ? record.headSha.slice(0, 7) : null
  return (
    // A group, not a landmark: two tickets about one article would make two regions of the same name.
    <div class="approval" role="group" aria-label="Article">
      {summary.title && <p class="approval-title">{summary.title}</p>}
      {summary.dek && <p class="approval-dek">{summary.dek}</p>}
      <p class="small muted approval-byline">
        {record.writer && <>Written by {store.nameOf(record.writer)} · </>}
        {record.editor && <>edited by {store.nameOf(record.editor)} · </>}
        {record.revision === 0 ? 'first draft, no revision' : `${record.revision} revision${record.revision === 1 ? '' : 's'}`}
      </p>

      <div class="approval-group" role="group" aria-labelledby={`${id}-measured`}>
        <h5 id={`${id}-measured`}>Measured checks</h5>
        <p class="small muted">Counted from the page; the same numbers every time.</p>
        <Measured checks={checks} />
      </div>

      <div class="approval-group" role="group" aria-labelledby={`${id}-opinion`}>
        <h5 id={`${id}-opinion`}>Editor’s opinion</h5>
        {record.review ? (
          <Opinion review={record.review} editor={record.editor ? store.nameOf(record.editor) : 'The editor'} />
        ) : (
          <p class="small muted">No review of this draft is in the store.</p>
        )}
      </div>

      <div class="approval-group" role="group" aria-labelledby={`${id}-sources`}>
        <h5 id={`${id}-sources`}>Sources</h5>
        {record.evidence.length > 0 ? (
          <>
            <p class="small muted">What the staff found on the web before writing; a claim is kept only when the search returned its page.</p>
            <ol class="sources">
              {record.evidence.map((e) => (
                <li key={e.id} data-evidence={e.id}>
                  <strong>{e.id}</strong> {e.claim}{' '}
                  <span class="small">
                    (<External href={e.url}>{e.title || hostOf(e.url)}</External>)
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p class="small muted">No web research is in the store for this article.</p>
        )}
      </div>

      <p class="approval-actions">
        <ReadArticleButton item={item} />
        {record.pr != null && (
          <span class="small">
            <External href={pullRequestUrl(store.site, record.pr)}>Pull request #{record.pr}</External>
            {sha && (
              <>
                {' '}
                · head <code>{sha}</code>
              </>
            )}
          </span>
        )}
      </p>
    </div>
  )
}

/** The host of a source, for a link without a title. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

type Status = 'pass' | 'fail' | 'info'

function Row({ name, status, children }: { name: string; status: Status; children: ComponentChildren }) {
  return (
    <div class={`check-row is-${status}`} data-check={name} data-status={status}>
      <dt>{name}</dt>
      <dd>
        {children}
        {status !== 'info' && (
          <>
            {' '}
            <Badge tone={status === 'pass' ? 'good' : 'warn'}>{status === 'pass' ? 'OK' : 'Check'}</Badge>
          </>
        )}
      </dd>
    </div>
  )
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The words line: the count against the brief's target and how far off it is. */
export function wordsText(c: ArticleChecks): string {
  const words = c.words.toLocaleString('en')
  if (c.targetWords == null || c.ratio == null) return `${words} (the brief’s target is not in the store)`
  const band = `±${Math.round(WORD_TOLERANCE * 100)}%`
  return `${words} of ${c.targetWords.toLocaleString('en')} target (${pct(c.ratio)}), ${c.withinTarget ? 'within' : 'outside'} ${band}`
}

function Measured({ checks: c }: { checks: ArticleChecks }) {
  const titleOk = c.heroes === 1 && c.heroFirst
  const closingOk = c.closingNotes === 1 && c.closingLast
  return (
    <>
      <dl class="checks">
        <Row name="Words" status={c.withinTarget == null ? 'info' : c.withinTarget ? 'pass' : 'fail'}>
          <span title="Body text: paragraphs, lists, callouts and the closing note. The title, headings and captions are not counted.">{wordsText(c)}</span>
        </Row>
        <Row name="Blocks" status={c.unknownBlocks.length ? 'fail' : 'info'}>
          {c.blocks}
          {c.unknownBlocks.length > 0 && <> · not shown in the preview: {c.unknownBlocks.join(', ')}</>}
        </Row>
        <Row name="Title" status={titleOk ? 'pass' : 'fail'}>
          {c.heroes === 0 ? 'no hero block: the page has no visible title' : c.heroes > 1 ? `${c.heroes} hero blocks` : c.heroFirst ? 'one hero block, first' : 'one hero block, not first'}
        </Row>
        <Row name="Closing note" status={closingOk ? 'pass' : 'fail'}>
          {c.closingNotes === 0 ? 'missing' : c.closingNotes > 1 ? `${c.closingNotes} closing notes` : c.closingLast ? 'present, last' : 'present, not last'}
        </Row>
        <Row name="Links" status="info">
          {c.links}
        </Row>
        <Row name="Media" status={c.mediaNotHttps ? 'fail' : 'info'}>
          {c.media}
          {c.mediaNotHttps > 0 && <> · {c.mediaNotHttps} not an https address</>}
        </Row>
        {c.banned && (
          <Row name="Banned phrases" status={c.banned.length ? 'fail' : 'pass'}>
            {c.banned.length === 0 ? 'none' : c.banned.map((h) => `“${h.phrase}” ×${h.count}`).join(', ')}
          </Row>
        )}
      </dl>
      {!c.banned && <p class="small muted">Banned phrases are not checked: this session has no style guide.</p>}
    </>
  )
}

function Opinion({ review, editor }: { review: ArticleReview; editor: string }) {
  return (
    <>
      <p class="small muted">{editor}’s judgement, not a measurement.</p>
      <p class="opinion-score">
        <strong>Score {review.score}/10</strong>
        {/* `approve`, `needs_changes`, `reject`, as the editor decided. */}
        {review.decision && <> · {sentence(review.decision)}</>}
      </p>
      {review.notes && <p class="opinion-notes">{review.notes}</p>}
      {review.issues.length > 0 && (
        <>
          <p class="small muted">{plural(review.issues.length, 'issue')}</p>
          <ul class="opinion-issues">
            {review.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </>
      )}
      {review.highRisk.length > 0 && (
        <>
          <p class="small warn-text">Flagged as high risk</p>
          <ul class="opinion-issues">
            {review.highRisk.map((risk, i) => (
              <li key={i}>{risk}</li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
