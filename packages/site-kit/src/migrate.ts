/**
 * `kit migrate v1..v2` — codemods for the schema drift found in cinqueterre
 * content. Each rule rewrites blocks in place and records what it changed;
 * nothing is dropped: fields the target schema has no place for move into the
 * page's `metadata` (which is free-form).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { walkJson } from './content/load'
import { isLocalized } from './i18n'

export interface Change {
  rule: string
  /** JSON pointer of the block. */
  path: string
  detail: string
}

export interface FileChange {
  file: string
  changes: Change[]
  before: unknown
  after: unknown
}

type Obj = Record<string, any>

export interface CodemodRule {
  id: string
  description: string
  blockType: string
  apply: (block: Obj, page: Obj, record: (detail: string) => void) => Obj
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Joins a (possibly localized) list of paragraphs into one string with blank lines. */
export function joinParagraphs(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join('\n\n')
  if (isLocalized(v)) return Object.fromEntries(Object.entries(v).map(([l, x]) => [l, joinParagraphs(x)]))
  return v
}

/** Splits a (possibly localized) list of paragraphs in two halves. */
function splitParagraphs(v: unknown): [unknown, unknown] | undefined {
  if (Array.isArray(v)) {
    if (v.length < 2) return undefined
    const mid = Math.ceil(v.length / 2)
    return [v.slice(0, mid).join('\n\n'), v.slice(mid).join('\n\n')]
  }
  if (isLocalized(v)) {
    const entries = Object.entries(v)
    if (!entries.every(([, x]) => Array.isArray(x) && x.length >= 2)) return undefined
    const halves = entries.map(([l, x]) => [l, splitParagraphs(x)!] as const)
    return [Object.fromEntries(halves.map(([l, h]) => [l, h[0]])), Object.fromEntries(halves.map(([l, h]) => [l, h[1]]))]
  }
  return undefined
}

function button(b: Obj, fallbackVariant: 'primary' | 'secondary'): Obj {
  const out: Obj = { label: b.label ?? b.text ?? b.title ?? '', href: b.href ?? b.url ?? '' }
  out.variant = b.variant === 'secondary' ? 'secondary' : b.variant === 'primary' ? 'primary' : fallbackVariant
  return out
}

function stash(page: Obj, key: string, value: Obj): void {
  if (Object.keys(value).length === 0) return
  page.metadata = isObj(page.metadata) ? page.metadata : {}
  page.metadata[key] = { ...(isObj(page.metadata[key]) ? page.metadata[key] : {}), ...value }
}

const BLOG_ITEM_KEYS = new Set(['type', 'text', 'level', 'src', 'alt', 'caption', 'items', 'ordered'])

/** Normalizes one item of `blog-article.content` to the core sub-block shape. */
function blogItems(x: Obj): Obj[] {
  switch (x.type) {
    case 'lead':
      return [{ type: 'paragraph', text: x.text }]
    case 'tip-list':
      return (Array.isArray(x.items) ? x.items : []).flatMap((it: Obj) => [
        ...(it.title ? [{ type: 'heading', level: 3, text: it.title }] : []),
        ...(it.text ? [{ type: 'paragraph', text: it.text }] : []),
      ])
    case 'image-pair':
      return (Array.isArray(x.images) ? x.images : []).map((im: Obj) => ({ type: 'image', src: im.src, ...(im.alt ? { alt: im.alt } : {}), ...(im.caption ? { caption: im.caption } : {}) }))
    default: {
      const out: Obj = {}
      for (const [k, v] of Object.entries(x)) if (BLOG_ITEM_KEYS.has(k)) out[k] = v
      if (x.type === 'list' && Array.isArray(x.items)) out.items = x.items.map((i: unknown) => (isObj(i) && !isLocalized(i) ? i.text ?? i.title ?? '' : i))
      return [out]
    }
  }
}

export const RULES: CodemodRule[] = [
  {
    id: 'editorial-intro/content-to-leftContent',
    blockType: 'editorial-intro',
    description: 'editorial-intro: `content` → `leftContent` (+ `rightContent` from the second half of multi-paragraph content)',
    apply(b, _page, record) {
      if (b.content === undefined || b.leftContent !== undefined) return b
      const { content, ...rest } = b
      const split = rest.rightContent === undefined ? splitParagraphs(content) : undefined
      if (split) {
        record('content → leftContent + rightContent (split paragraphs)')
        return { ...rest, leftContent: split[0], rightContent: split[1] }
      }
      record('content → leftContent')
      return { ...rest, leftContent: joinParagraphs(content) }
    },
  },
  {
    id: 'closing-note/buttons-to-actions',
    blockType: 'closing-note',
    description: 'closing-note: `buttons` / `primaryButton` / `secondaryButton` ({text,url}) → `actions` ({label,href,variant})',
    apply(b, _page, record) {
      if (b.buttons === undefined && b.primaryButton === undefined && b.secondaryButton === undefined) return b
      const { buttons, primaryButton, secondaryButton, ...rest } = b
      const actions: Obj[] = Array.isArray(rest.actions) ? [...rest.actions] : []
      if (Array.isArray(buttons)) actions.push(...buttons.filter(isObj).map((x, i) => button(x, i === 0 ? 'primary' : 'secondary')))
      if (isObj(primaryButton)) actions.push(button(primaryButton, 'primary'))
      if (isObj(secondaryButton)) actions.push(button(secondaryButton, 'secondary'))
      record(`${[buttons !== undefined && 'buttons', primaryButton !== undefined && 'primaryButton', secondaryButton !== undefined && 'secondaryButton'].filter(Boolean).join(' + ')} → actions (${actions.length})`)
      return { ...rest, actions }
    },
  },
  {
    id: 'closing-note/content-paragraphs',
    blockType: 'closing-note',
    description: 'closing-note: list-of-paragraphs `content` → one text value',
    apply(b, page, record) {
      let out = b
      if (Array.isArray(b.content) || (isLocalized(b.content) && Object.values(b.content).some(Array.isArray))) {
        record('content paragraphs joined')
        out = { ...out, content: joinParagraphs(b.content) }
      }
      if (out.author !== undefined) {
        const { author, ...rest } = out
        stash(page, 'closingNote', { author })
        record('author → page.metadata.closingNote.author')
        out = rest
      }
      return out
    },
  },
  {
    id: 'faq-section/faqs-to-items',
    blockType: 'faq-section',
    description: 'faq-section: `faqs` → `items` (and `heading` → `title`)',
    apply(b, _page, record) {
      let out = b
      if (b.faqs !== undefined && b.items === undefined) {
        const { faqs, ...rest } = out
        out = { ...rest, items: faqs }
        record('faqs → items')
      }
      if (out.heading !== undefined && out.title === undefined) {
        const { heading, ...rest } = out
        out = { ...rest, title: heading }
        record('heading → title')
      }
      if (typeof out.variant === 'string' && out.variant === 'accordion') {
        out = { ...out, variant: 'centered-accordion' }
        record('variant accordion → centered-accordion')
      }
      return out
    },
  },
  {
    id: 'blog-article/unwrap-post',
    blockType: 'blog-article',
    description: 'blog-article: unwrap the legacy `post` wrapper and `{intro, sections, quote}` content into the core shape; extras → page.metadata.blog',
    apply(b, page, record) {
      let src: Obj = b
      if (isObj(b.post)) {
        const { post, content, ...rest } = b
        const items: Obj[] = []
        if (isObj(content)) {
          if (content.intro) items.push({ type: 'paragraph', text: content.intro })
          for (const s of Array.isArray(content.sections) ? content.sections : []) {
            if (s?.title) items.push({ type: 'heading', level: 2, text: s.title })
            if (s?.text) items.push({ type: 'paragraph', text: s.text })
          }
          if (isObj(content.quote) && content.quote.text) {
            items.push({ type: 'quote', text: content.quote.text })
            if (content.quote.author) stash(page, 'blog', { quoteAuthor: content.quote.author })
          }
        } else if (Array.isArray(content)) items.push(...content)
        src = { ...rest, ...post, content: items }
        record(`post wrapper unwrapped (${items.length} content items)`)
      }
      const out: Obj = { type: 'blog-article' }
      const extras: Obj = {}
      for (const [k, v] of Object.entries(src)) {
        switch (k) {
          case 'type':
            break
          case 'title':
          case 'date':
          case 'readTime':
          case 'category':
          case 'heroImage':
          case 'authorImage':
          case 'sidebar':
            if (isObj(v) && Array.isArray(v.relatedPosts) && v.relatedPosts.some((r: unknown) => isObj(r) && r.url === undefined && typeof r.slug === 'string')) {
              out.sidebar = {
                ...v,
                relatedPosts: v.relatedPosts.map((r: unknown) => {
                  if (!isObj(r) || r.url !== undefined || typeof r.slug !== 'string') return r
                  const { slug, ...rest } = r
                  return { ...rest, url: `/blog/${slug}` }
                }),
              }
              record('sidebar.relatedPosts slug → url')
            } else out.sidebar = v
            break
          case 'image':
            if (src.heroImage === undefined) {
              out.heroImage = v
              record('image → heroImage')
            } else extras.image = v
            break
          case 'author':
            if (isObj(v) && !isLocalized(v)) {
              out.author = v.name
              if (v.image && src.authorImage === undefined) out.authorImage = v.image
              const { name: _n, image: _i, ...more } = v
              if (Object.keys(more).length) extras.author = more
              record('author object → author name (+ bio to metadata)')
            } else out.author = v
            break
          case 'content':
            out.content = Array.isArray(v) ? v.filter(isObj).flatMap(blogItems) : []
            break
          default:
            extras[k] = v
        }
      }
      if (Object.keys(extras).length) {
        stash(page, 'blog', extras)
        record(`${Object.keys(extras).join(', ')} → page.metadata.blog`)
      }
      if (JSON.stringify(out.content) !== JSON.stringify(src.content) && !isObj(b.post)) record('content items normalized (lead/tip-list/image-pair)')
      return out
    },
  },
  {
    id: 'blog-index/intro-fields',
    blockType: 'blog-index',
    description: 'blog-index: `title`/`subtitle` → `introTitle`/`introSubtitle`, `newsletter{title,description}` → `newsletterTitle`/`newsletterSubtitle`; extras → page.metadata.blogIndex',
    apply(b, page, record) {
      const known = new Set(['type', 'stories', 'categories', 'introTitle', 'introSubtitle', 'newsletterTitle', 'newsletterSubtitle'])
      if (Object.keys(b).every((k) => known.has(k))) return b
      const out: Obj = {}
      const extras: Obj = {}
      for (const [k, v] of Object.entries(b)) {
        if (known.has(k)) out[k] = v
        else if (k === 'title' && b.introTitle === undefined) out.introTitle = v
        else if (k === 'subtitle' && b.introSubtitle === undefined) out.introSubtitle = v
        else if (k === 'newsletter' && isObj(v)) {
          const { title, description, subtitle, ...more } = v
          if (title !== undefined && b.newsletterTitle === undefined) out.newsletterTitle = title
          if ((subtitle ?? description) !== undefined && b.newsletterSubtitle === undefined) out.newsletterSubtitle = subtitle ?? description
          if (Object.keys(more).length) extras.newsletter = more
        } else extras[k] = v
      }
      stash(page, 'blogIndex', extras)
      record(`intro/newsletter fields renamed${Object.keys(extras).length ? `; ${Object.keys(extras).join(', ')} → page.metadata.blogIndex` : ''}`)
      return out
    },
  },
]

/** Applies every rule to one page document. Returns the new page and the changes. */
export function migratePage(page: unknown, rules: CodemodRule[] = RULES): { page: unknown; changes: Change[] } {
  if (!isObj(page) || !Array.isArray(page.body)) return { page, changes: [] }
  const next: Obj = JSON.parse(JSON.stringify(page))
  const changes: Change[] = []
  next.body = next.body.map((block: Obj, i: number) => {
    if (!isObj(block)) return block
    let b = block
    for (const rule of rules.filter((r) => r.blockType === block.type)) {
      b = rule.apply(b, next, (detail) => changes.push({ rule: rule.id, path: `/body/${i}`, detail }))
    }
    return b
  })
  return { page: changes.length ? next : page, changes }
}

function indentOf(text: string): number | string {
  const m = text.match(/\n([ \t]+)"/)
  return m ? (m[1].includes('\t') ? '\t' : m[1].length) : 2
}

export interface MigrateResult {
  files: FileChange[]
  scanned: number
  byRule: Record<string, number>
}

/** Runs the codemods over `<root>/<contentDir>/pages/**.json`. Dry run unless `write`. */
export function migrateContent(root: string, opts: { contentDir?: string; write?: boolean } = {}): MigrateResult {
  const dir = join(root, opts.contentDir ?? 'content', 'pages')
  const files: FileChange[] = []
  const byRule: Record<string, number> = {}
  let scanned = 0
  for (const full of walkJson(dir)) {
    scanned++
    const text = readFileSync(full, 'utf8')
    let before: unknown
    try {
      before = JSON.parse(text)
    } catch {
      continue
    }
    const { page: after, changes } = migratePage(before)
    if (!changes.length) continue
    for (const c of changes) byRule[c.rule] = (byRule[c.rule] ?? 0) + 1
    const file = relative(root, full).split(sep).join('/')
    files.push({ file, changes, before, after })
    if (opts.write) writeFileSync(full, JSON.stringify(after, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''))
  }
  return { files, scanned, byRule }
}

export function formatMigrateSummary(r: MigrateResult, write: boolean, verbose = false): string {
  const lines: string[] = []
  const n = r.files.reduce((a, f) => a + f.changes.length, 0)
  lines.push(`${write ? 'migrated' : 'would migrate'} ${r.files.length}/${r.scanned} page files (${n} block changes)${write ? '' : ' — dry run, pass --write to apply'}`)
  for (const [rule, count] of Object.entries(r.byRule).sort((a, b) => b[1] - a[1])) lines.push(`  ${String(count).padStart(5)}  ${rule}`)
  if (verbose) {
    for (const f of r.files) {
      lines.push(`\n--- ${f.file}`)
      for (const c of f.changes) lines.push(`  ${c.path.padEnd(10)} ${c.rule}: ${c.detail}`)
    }
  }
  return lines.join('\n')
}
