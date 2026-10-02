/**
 * Rich text for renderers. Renderers never parse Markdown (ADR-0014): text is
 * split into paragraphs on blank lines and stray emphasis markers are removed.
 * Legacy fields that already hold HTML (`<p>…</p>`) are passed through a strict
 * tag allowlist so a content file can never inject scripts or styles.
 */

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'span', 'small', 'sup', 'sub'])
const VOID = new Set(['br'])

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function looksLikeHtml(s: string): boolean {
  return /<\/?(p|br|strong|b|em|i|a|ul|ol|li|h[2-4]|blockquote)\b[^>]*>/i.test(s)
}

/** Removes Markdown emphasis markers without interpreting them. */
export function stripEmphasis(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1$2')
}

/** Plain text → paragraphs. */
export function paragraphs(s: string): string[] {
  return s
    .split(/\n\s*\n/)
    .map((p) => stripEmphasis(p.trim()))
    .filter(Boolean)
}

/**
 * Sanitizes legacy HTML to an allowlist of inline/structural tags. Attributes
 * are dropped except a safe `href` on links (rewritten with `resolveHref`).
 */
export function sanitizeHtml(html: string, resolveHref: (href: string) => string = (h) => h): string {
  // Drop dangerous elements with their content.
  let s = html.replace(/<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (tag, nameIn: string, attrs: string) => {
    const name = nameIn.toLowerCase()
    if (!ALLOWED.has(name)) return ''
    if (tag.startsWith('</')) return VOID.has(name) ? '' : `</${name}>`
    if (name === 'a') {
      const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i)
      const href = (m?.[2] ?? m?.[3] ?? m?.[4] ?? '').trim()
      if (href && /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) {
        const external = /^https?:\/\//i.test(href)
        return `<a href="${escapeHtml(resolveHref(href))}"${external ? ' rel="noopener"' : ''}>`
      }
      return '<a>'
    }
    return VOID.has(name) ? `<${name}>` : `<${name}>`
  })
}

/** Renders text (plain or legacy HTML) to safe HTML paragraphs. */
export function richTextHtml(text: string, resolveHref?: (href: string) => string): string {
  if (!text) return ''
  if (looksLikeHtml(text)) {
    const clean = sanitizeHtml(text, resolveHref)
    return /^\s*<(p|ul|ol|h[2-4]|blockquote)\b/i.test(clean) ? clean : `<p>${clean}</p>`
  }
  return paragraphs(text)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}
