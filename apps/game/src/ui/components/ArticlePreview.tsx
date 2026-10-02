import { useEffect, useMemo, useRef } from 'preact/hooks'
import { articleHtml, articleSummary } from '../article-preview'
import { pullRequestUrl } from '../links'
import { useStore } from '../store'
import { Badge, External, Icon, trapTab } from './common'

/** What the dialog says the preview is. It is never the live theme. */
export const PREVIEW_LABEL = 'Preview (approximation of the live theme)'

/**
 * Opens the article preview of a work item. Renders nothing until the store
 * is known to hold a page for it, so the button never leads to an empty
 * dialog.
 */
export function ReadArticleButton({ item, quiet }: { item: string; quiet?: boolean }) {
  const store = useStore()
  if (store.articleOf(item)?.page == null) return null
  return (
    <button type="button" class={quiet ? 'link-btn' : 'btn'} onClick={(e) => store.openArticle(item, e.currentTarget)}>
      Read article
    </button>
  )
}

/**
 * The article of a work item, rendered for reading before the CEO decides
 * (increment U1, ADR-0059). The page JSON is model output, so it is shown in
 * an isolated frame (docs/reference/browser-agent-studio.md §19):
 *
 * - `sandbox=""`: no script runs, the frame has an opaque origin (no access
 *   to the game page, its store, cookies or session), no forms, popups or
 *   top-level navigation.
 * - `srcdoc`: the document is built here from the page blocks with every
 *   string escaped (article-preview.ts) and carries its own
 *   Content-Security-Policy; the only network it can use is `https:` images.
 *
 * Mounted once by the overlay; `store.article` names the work item.
 */
export function ArticlePreview() {
  const store = useStore()
  const item = store.article.value
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (item) ref.current?.focus()
  }, [item])
  const record = item ? store.articleOf(item) : null
  const page = record?.page ?? null
  const planTitle = item ? store.planText.value.items[item]?.title || '' : ''
  const lang = store.site.language || 'en'
  // The document changes only with the page: the frame is not reloaded by clock ticks.
  const html = useMemo(() => (page == null ? null : articleHtml(page, { lang, fallbackTitle: planTitle })), [page, lang, planTitle])
  if (!item) return null

  const title = (page != null && articleSummary(page, lang).title) || planTitle || item
  const pr = record?.pr ?? null
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && store.closeArticle()}>
      <div
        ref={ref}
        class="modal article-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="article-preview-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            store.closeArticle()
          }
          trapTab(e, ref.current)
        }}
      >
        <header class="preview-head">
          <div class="grow">
            <p class="preview-label">
              <Badge tone="warn">{PREVIEW_LABEL}</Badge>
            </p>
            <h2 id="article-preview-title">{title}</h2>
            {record && (
              <p class="small muted">
                {record.revision === 0 ? 'First draft' : `Revision ${record.revision}`}
                {record.writer && <> · written by {store.nameOf(record.writer)}</>}
                {pr != null && (
                  <>
                    {' · '}
                    <External href={pullRequestUrl(store.site, pr)}>Pull request #{pr}</External>
                  </>
                )}
              </p>
            )}
          </div>
          <button type="button" class="icon-btn" onClick={() => store.closeArticle()} aria-label="Close preview">
            <Icon name="close" />
          </button>
        </header>
        {html != null ? (
          // `sandbox` comes before `srcdoc`: the frame is sandboxed before it has a document.
          <iframe class="preview-frame" title={`Article preview: ${title}`} sandbox="" referrerpolicy="no-referrer" srcdoc={html} />
        ) : (
          <p class="preview-empty muted" role="status">
            {record === undefined ? 'Loading…' : 'The store of this device has no page for this work item.'}
          </p>
        )}
        <footer class="preview-foot small muted">
          No script runs in the preview and it cannot reach the game. Images load from their https addresses; links are named, not followed.
        </footer>
      </div>
    </div>
  )
}
