/**
 * An article's page JSON as one self-contained HTML document, for the
 * preview iframe of the publish gate (increment U1, ADR-0059;
 * docs/reference/browser-agent-studio.md §19).
 *
 * The page JSON is model output and is treated as untrusted:
 *
 * - Every string of the page reaches the document through `escapeHtml`, as
 *   text or as an attribute value. No field is ever written as markup.
 * - The two fields the live theme prints as HTML (`editorial-hero.title`,
 *   `closing-note.content`) arrive HTML-escaped by the orchestrator. Their
 *   character references are decoded once for display and the result is
 *   escaped again, so `&lt;script&gt;` shows as the text `<script>`.
 * - The only attribute that takes a page value as an address is `<img src>`,
 *   and only for an absolute `https:` URL (`httpsImageUrl`). Links are shown
 *   as text: the document has no `<a href>`, no form, no script, no frame.
 * - Block styles come from a fixed list; a block type the preview does not
 *   know is shown as a labelled placeholder.
 * - The document carries its own Content-Security-Policy: nothing loads but
 *   `https:` images and the inline stylesheet below.
 *
 * The caller puts the document into `<iframe sandbox="" srcdoc=…>`
 * (components/ArticlePreview.tsx): an opaque origin without scripts, so it
 * cannot reach the game, its store or the session even if a rule above had a
 * hole. The look is an approximation of the live theme, never the theme.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Text for HTML text content and for a double-quoted attribute value. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * Decodes HTML character references once (`&amp;` → `&`, `&#39;` → `'`),
 * for showing a field the orchestrator escaped. The result is plain text: it
 * is escaped again before it is written, never used as markup.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (whole, ref: string) => {
    if (ref[0] !== '#') return NAMED[ref.toLowerCase()] ?? whole
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return valid ? String.fromCodePoint(code) : whole
  })
}

/** A plain string or a `LocalizedString` (`{en, de?, …}`) as text; `''` for anything else. */
export function localized(value: unknown, lang = 'en'): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const map = value as Record<string, unknown>
  for (const key of [lang, 'en']) if (typeof map[key] === 'string') return map[key] as string
  const first = Object.values(map).find((v) => typeof v === 'string')
  return typeof first === 'string' ? first : ''
}

/**
 * The address of an image the preview may load: an absolute `https:` URL
 * without credentials, as the URL parser serialises it. Everything else
 * (`javascript:`, `data:`, `http:`, a relative path, a non-string) is `null`
 * and the image is not shown.
 */
export function httpsImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!/^https:\/\//i.test(raw)) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

type Block = Record<string, unknown>

const isBlock = (v: unknown): v is Block => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const blockType = (b: unknown): string => (isBlock(b) && typeof b.type === 'string' ? b.type : '')

/** The body blocks of a page; `[]` when the page has none. */
export function bodyBlocks(page: unknown): unknown[] {
  return isBlock(page) && Array.isArray(page.body) ? page.body : []
}

/** Block types that carry the page title (the theme's only `<h1>`). */
export const HERO_TYPES: ReadonlySet<string> = new Set(['editorial-hero', 'hero'])

/** Block types the preview renders; every other type becomes a placeholder. */
export const PREVIEW_BLOCKS: ReadonlySet<string> = new Set([
  'editorial-hero',
  'hero',
  'paragraph',
  'heading',
  'list',
  'callout',
  'image',
  'quote',
  'faq',
  'closing-note',
])

const CALLOUT_STYLES = new Set(['info', 'warning', 'success', 'error'])

export interface ArticleSummary {
  /** The title a reader sees: the hero's, else the page's, else the SEO title. `''` when the page names none. */
  title: string
  /** The dek: the hero's subtitle, else the SEO description. */
  dek: string
  /** The hero's badge (the category). */
  badge: string
}

/** Title and dek of an article, as plain text (entities of the hero title decoded). */
export function articleSummary(page: unknown, lang = 'en'): ArticleSummary {
  const p = isBlock(page) ? page : {}
  const hero = bodyBlocks(p).find((b) => HERO_TYPES.has(blockType(b))) as Block | undefined
  const seo = isBlock(p.seo) ? p.seo : {}
  const heroTitle = hero ? (hero.type === 'editorial-hero' ? decodeEntities(text(hero.title)) : text(hero.title)) : ''
  return {
    title: (heroTitle || localized(p.title, lang) || localized(seo.title, lang)).trim(),
    dek: ((hero && text(hero.subtitle)) || localized(seo.description, lang)).trim(),
    badge: hero ? text(hero.badge).trim() : '',
  }
}

const e = escapeHtml
const para = (cls: string, value: string) => (value ? `<p class="${cls}">${e(value)}</p>` : '')

function placeholder(message: string): string {
  return `<div class="placeholder">${message}</div>`
}

/** `<img>` for an https address, else a placeholder that says why nothing is shown. */
function image(src: unknown, alt: string, cls: string): string {
  const url = httpsImageUrl(src)
  if (url) return `<img class="${cls}" src="${e(url)}" alt="${e(alt)}" referrerpolicy="no-referrer">`
  return placeholder(`Image not shown: the preview loads images from <code>https:</code> addresses only.${alt ? ` <span class="alt">${e(alt)}</span>` : ''}`)
}

/** The page title block. Only the first one of a page is the `<h1>`. */
function hero(b: Block, first: boolean): string {
  const editorial = b.type === 'editorial-hero'
  const title = editorial ? decodeEntities(text(b.title)) : text(b.title)
  const src = editorial ? b.image : (b.backgroundImage ?? b.image)
  const tag = first ? 'h1' : 'h2'
  return (
    `<header class="hero">` +
    (src != null && src !== '' ? image(src, '', 'hero-image') : '') +
    para('badge', text(b.badge)) +
    `<${tag} class="title">${e(title)}</${tag}>` +
    para('dek', text(b.subtitle)) +
    `</header>`
  )
}

function list(b: Block): string {
  const items = (Array.isArray(b.items) ? b.items : []).map((i) => (isBlock(i) ? text(i.text) : text(i))).filter(Boolean)
  const tag = b.ordered === true ? 'ol' : 'ul'
  return `<${tag}>${items.map((i) => `<li>${e(i)}</li>`).join('')}</${tag}>`
}

function faq(b: Block): string {
  const items = (Array.isArray(b.items) ? b.items : []).filter(isBlock)
  return `<dl class="faq">${items.map((i) => `<dt>${e(text(i.question ?? i.q))}</dt><dd>${e(text(i.answer ?? i.a))}</dd>`).join('')}</dl>`
}

function closingNote(b: Block): string {
  const actions = (Array.isArray(b.actions) ? b.actions : []).filter(isBlock)
  // Links are named, not followed: the preview has nothing to navigate to.
  const links = actions.map((a) => `<li><span class="action">${e(text(a.label))}</span> <span class="target">${e(text(a.href))}</span></li>`).join('')
  return (
    `<section class="closing">` +
    para('badge', text(b.badge)) +
    (text(b.title) ? `<h2>${e(text(b.title))}</h2>` : '') +
    para('closing-text', decodeEntities(text(b.content))) +
    (links ? `<p class="links-label">Links</p><ul class="actions">${links}</ul>` : '') +
    `</section>`
  )
}

function renderBlock(b: unknown, state: { h1: boolean }): string {
  if (!isBlock(b)) return placeholder('A block that is not an object is not shown.')
  const type = blockType(b)
  switch (type) {
    case 'editorial-hero':
    case 'hero': {
      const first = !state.h1
      state.h1 = true
      return hero(b, first)
    }
    case 'paragraph':
      // The theme prints `markdown` literally; so does the preview.
      return para('text', text(b.markdown ?? b.text))
    case 'heading': {
      // A section heading never competes with the page title: levels 2 to 6.
      const level = Math.min(6, Math.max(2, Math.trunc(Number(b.level)) || 2))
      return `<h${level}>${e(text(b.text))}</h${level}>`
    }
    case 'list':
      return list(b)
    case 'callout': {
      const style = CALLOUT_STYLES.has(text(b.style)) ? text(b.style) : 'info'
      return `<aside class="callout callout-${style}">${text(b.title) ? `<p class="callout-title">${e(text(b.title))}</p>` : ''}${para('text', text(b.content ?? b.text))}</aside>`
    }
    case 'image':
      return `<figure>${image(b.src, text(b.alt), 'inline-image')}${text(b.caption) ? `<figcaption>${e(text(b.caption))}</figcaption>` : ''}</figure>`
    case 'quote':
      return `<blockquote>${para('text', text(b.text ?? b.quote))}${text(b.attribution) ? `<footer>${e(text(b.attribution))}</footer>` : ''}</blockquote>`
    case 'faq':
      return faq(b)
    case 'closing-note':
      return closingNote(b)
    default:
      return placeholder(`Block <code>${e(type || '(no type)')}</code> is not shown in this preview.`)
  }
}

/** Nothing but https images and the inline stylesheet; no script, frame, font, form or connection. */
export const PREVIEW_CSP = "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #fbf8f3; color: #1f2430; font: 17px/1.6 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; }
article { max-width: 680px; margin: 0 auto; padding: 0 20px 48px; }
.hero { margin: 0 -20px 24px; padding: 0 20px 20px; border-bottom: 1px solid #e4dccd; }
.hero-image { display: block; width: calc(100% + 40px); max-width: none; margin: 0 -20px 20px; height: 260px; object-fit: cover; background: #e9e2d4; }
.badge { margin: 20px 0 6px; font: 600 12px/1.3 system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #8a5a1c; }
h1, h2, h3, h4, h5, h6 { line-height: 1.2; margin: 1.6em 0 0.5em; }
h1.title, h2.title { margin: 8px 0; font-size: 34px; }
h2 { font-size: 24px; }
h3 { font-size: 20px; }
h4, h5, h6 { font-size: 17px; }
.dek { margin: 8px 0 0; font-size: 20px; line-height: 1.4; color: #4a5060; }
p { margin: 0 0 1em; }
.text { white-space: pre-line; }
ul, ol { margin: 0 0 1em; padding-left: 1.4em; }
li { margin: 0.25em 0; }
figure { margin: 1.5em 0; }
.inline-image { display: block; width: 100%; height: auto; max-height: 420px; object-fit: cover; background: #e9e2d4; }
figcaption { margin-top: 6px; font: 13px/1.4 system-ui, sans-serif; color: #5b6170; }
blockquote { margin: 1.5em 0; padding: 4px 0 4px 18px; border-left: 3px solid #c69a4b; font-style: italic; }
blockquote footer { font: 13px/1.4 system-ui, sans-serif; font-style: normal; color: #5b6170; }
.callout { margin: 1.5em 0; padding: 14px 16px; border-radius: 8px; border: 1px solid #c9d6ea; background: #eef4fc; font: 15px/1.5 system-ui, sans-serif; }
.callout p { margin: 0; }
.callout-title { font-weight: 700; margin-bottom: 4px !important; }
.callout-warning { border-color: #e6cf94; background: #fdf5dc; }
.callout-success { border-color: #b4d9bf; background: #ebf7ee; }
.callout-error { border-color: #e6b3ad; background: #fcecea; }
.faq dt { font-weight: 700; margin-top: 1em; }
.faq dd { margin: 0.25em 0 0; }
.closing { margin: 2.5em -20px 0; padding: 8px 20px 20px; background: #232a3a; color: #f3efe7; }
.closing .badge { color: #e3b864; }
.closing h2 { margin-top: 4px; }
.links-label { margin: 1em 0 4px; font: 600 12px/1.3 system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #c9cedb; }
.actions { list-style: none; padding: 0; font: 14px/1.5 system-ui, sans-serif; }
.action { font-weight: 600; }
.target { font-family: ui-monospace, monospace; font-size: 12px; color: #c9cedb; overflow-wrap: anywhere; }
.placeholder { margin: 1.5em 0; padding: 10px 12px; border: 1px dashed #9a8f7a; border-radius: 6px; background: #f1ebdf; color: #4a4435; font: 13px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
.hero .placeholder { margin: 16px 0 0; }
.placeholder .alt { display: block; font-style: italic; }
.empty { margin: 32px 0; font: 15px/1.5 system-ui, sans-serif; color: #5b6170; }
`

export interface PreviewOptions {
  /** Language of the localized strings to show; `en` when unset or not a two-letter code. */
  lang?: string
  /** The title to show when the page itself names none (the work item's title in the plan). */
  fallbackTitle?: string
}

/**
 * The page as an HTML document for `<iframe sandbox="" srcdoc>`. It always
 * has exactly one `<h1>`: the first hero block, else the page title above the
 * body. `page` may be anything; what is not understood is shown as a
 * placeholder, never executed and never dropped silently.
 */
export function articleHtml(page: unknown, opts: PreviewOptions = {}): string {
  const lang = opts.lang && /^[a-z]{2}$/.test(opts.lang) ? opts.lang : 'en'
  const blocks = bodyBlocks(page)
  const summary = articleSummary(page, lang)
  const title = summary.title || (opts.fallbackTitle ?? '').trim() || 'Untitled article'
  const state = { h1: false }
  let body = ''
  // No hero block: the page title stands in, so the reader still sees what the article is.
  if (!blocks.some((b) => HERO_TYPES.has(blockType(b)))) {
    state.h1 = true
    body += `<header class="hero"><h1 class="title">${e(title)}</h1>${para('dek', summary.dek)}</header>`
  }
  body += blocks.map((b) => renderBlock(b, state)).join('\n')
  if (blocks.length === 0) body += `<p class="empty">This page has no body blocks.</p>`
  return (
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${e(PREVIEW_CSP)}">` +
    `<meta name="referrer" content="no-referrer">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${e(title)}</title><style>${STYLE}</style></head>` +
    `<body><article>\n${body}\n</article></body></html>`
  )
}
