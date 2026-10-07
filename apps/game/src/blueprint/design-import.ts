/**
 * Importing a design (FEAT-093, ADR-0072, design §8): an HTML page or a ZIP
 * of pages (a Claude Design export, any static export) becomes a proposed
 * blueprint, deterministically, in the browser.
 *
 * 1. **Section tree.** Each page's body is cut into its top-level sections
 *    (landmarks and `<section>`s, else the body's children), and each section
 *    is described by facts: its heading, images, links, paragraphs, forms
 *    with an email field, question lists, buttons, numbers, and whether its
 *    children repeat (cards).
 * 2. **Blocks by rule.** Each section maps to one catalogue block by a fixed
 *    list of rules (newsletter, FAQ, gallery, cards, hero, stats, call to
 *    action, content); the rule that fired is kept as the reason, so the
 *    canvas can show why. Headers and footers become globals only when the
 *    site has a block for them (`x:site-header`, `x:site-footer`).
 * 3. **Page types.** One per page: `index.html` is `home`, any other page is
 *    named after its file. Slots follow the sections in order; consecutive
 *    sections of the same block become one repeated slot.
 * 4. **Tokens.** CSS custom properties on `:root` become token candidates.
 *
 * Imported files are untrusted data: they are parsed with `DOMParser`
 * (scripts never run), nothing is fetched, and sizes are capped.
 * Re-importing a changed export and diffing the two blueprints
 * (`diffBlueprints`) gives the concept's semantic reconciliation.
 */
import type { Blueprint, BlueprintPageType, BlueprintSlot } from './types'

/** Largest file read from an export, bytes; larger ones are skipped. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024
/** Most pages one import reads. */
export const MAX_PAGES = 24

export interface SectionFacts {
  /** `header`, `nav`, `main`, `section`, `footer`, `aside`, `form`, `div`… */
  tag: string
  heading: string | null
  headingLevel: number | null
  images: number
  links: number
  paragraphs: number
  words: number
  emailForm: boolean
  questions: number
  buttons: number
  numbers: number
  /** Children that look alike (same tag and class), when at least three. */
  repeated: number
}

export interface MappedSection {
  facts: SectionFacts
  block: string
  /** The rule that chose the block. */
  rule: string
}

export interface DesignPage {
  path: string
  title: string
  sections: MappedSection[]
}

export interface DesignImport {
  pages: DesignPage[]
  blueprint: Blueprint
  /** `--name: value` from `:root` rules. */
  tokens: Record<string, string>
  /** Files skipped and why. */
  skipped: { path: string; why: string }[]
}

/** The element's text, its text nodes joined by spaces (adjacent elements do not run together). */
const text = (el: Element) => {
  const parts: string[] = []
  const walk = (n: Node) => {
    if (n.nodeType === 3) parts.push(n.nodeValue ?? '')
    else n.childNodes.forEach(walk)
  }
  walk(el)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** A section's facts (pure over the DOM). */
export function factsOf(el: Element): SectionFacts {
  const h = el.querySelector('h1, h2, h3')
  const words = text(el).split(' ').filter(Boolean).length
  const kids = Array.from(el.children)
  // Cards: the largest group of siblings with the same tag and class, at any depth up to 3.
  let repeated = 0
  const scan = (parent: Element, depth: number) => {
    const groups = new Map<string, number>()
    for (const c of Array.from(parent.children)) {
      const key = `${c.tagName}.${c.getAttribute('class') ?? ''}`
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    for (const n of groups.values()) if (n >= 3) repeated = Math.max(repeated, n)
    if (depth < 3) for (const c of Array.from(parent.children)) scan(c, depth + 1)
  }
  scan(el, 0)
  return {
    tag: el.tagName.toLowerCase(),
    heading: h ? text(h).slice(0, 120) : null,
    headingLevel: h ? Number(h.tagName[1]) : null,
    images: el.querySelectorAll('img, picture, svg image').length,
    links: el.querySelectorAll('a[href]').length,
    paragraphs: el.querySelectorAll('p').length,
    words,
    emailForm: !!el.querySelector('input[type="email"], input[name*="mail" i]'),
    questions: el.querySelectorAll('details, dt').length,
    buttons: el.querySelectorAll('button, a[role="button"], .button, .btn').length,
    numbers: (text(el).match(/\b\d[\d.,]*\s?(%|k|m|\+)?\b/gi) ?? []).length,
    repeated: kids.length ? repeated : 0,
  }
}

/** The top-level sections of a page body. */
export function sectionsOf(doc: Document): Element[] {
  const body = doc.body
  if (!body) return []
  const main = body.querySelector('main')
  const landmarks = Array.from(body.children).filter((c) => ['HEADER', 'NAV', 'FOOTER'].includes(c.tagName))
  const inner = Array.from((main ?? body).children).filter((c) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META'].includes(c.tagName))
  const content = main ? inner : inner.filter((c) => !landmarks.includes(c))
  // A single wrapper div: its children are the sections.
  const flat = content.length === 1 && content[0].tagName === 'DIV' && content[0].children.length > 1 ? Array.from(content[0].children) : content
  const head = landmarks.filter((c) => c.tagName !== 'FOOTER')
  const foot = landmarks.filter((c) => c.tagName === 'FOOTER')
  return [...head, ...flat, ...foot]
}

/** The rules, in order: the first that holds picks the block. */
export const RULES: { block: string; rule: string; holds(f: SectionFacts, first: boolean): boolean }[] = [
  { block: 'newsletter', rule: 'a form with an email field', holds: (f) => f.emailForm },
  { block: 'faq-section', rule: 'three or more questions', holds: (f) => f.questions >= 3 },
  { block: 'gallery', rule: 'four or more images and few words', holds: (f) => f.images >= 4 && f.words < 20 * f.images },
  { block: 'latest-stories', rule: 'three or more repeated cards with links', holds: (f) => f.repeated >= 3 && f.links >= 3 },
  { block: 'hero-section', rule: 'the first section with a top heading', holds: (f, first) => first && f.headingLevel === 1 },
  { block: 'stats-section', rule: 'mostly numbers', holds: (f) => f.numbers >= 3 && f.words < 12 * f.numbers },
  { block: 'cta-section', rule: 'a short section with a button', holds: (f) => f.buttons >= 1 && f.words <= 40 },
  { block: 'content-section', rule: 'a heading and paragraphs', holds: (f) => f.heading !== null && f.paragraphs >= 1 },
  { block: 'paragraph', rule: 'text', holds: (f) => f.words > 0 },
]

const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page'

/** One page: its sections mapped to blocks; headers and footers kept apart. */
export function mapPage(path: string, html: string): { page: DesignPage; header: boolean; footer: boolean } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let header = false
  let footer = false
  const sections: MappedSection[] = []
  let first = true
  for (const el of sectionsOf(doc)) {
    const facts = factsOf(el)
    if (facts.tag === 'header' || facts.tag === 'nav') {
      header = true
      continue
    }
    if (facts.tag === 'footer') {
      footer = true
      continue
    }
    const r = RULES.find((x) => x.holds(facts, first))
    first = false
    if (r) sections.push({ facts, block: r.block, rule: r.rule })
  }
  const title = (doc.querySelector('title')?.textContent ?? '').trim() || path
  return { page: { path, title, sections }, header, footer }
}

/** `--name: value` declarations of `:root` rules in CSS text. */
export function tokensOf(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of m[1].matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);?/g)) out[d[1]] = d[2].trim()
  }
  return out
}

/** Pages and CSS as a proposed blueprint. `customBlocks`: the site's `x:` blocks. */
export function interpretDesign(files: { path: string; text: string }[], customBlocks: readonly string[] = []): DesignImport {
  const skipped: DesignImport['skipped'] = []
  const pages: DesignPage[] = []
  let anyHeader = false
  let anyFooter = false
  let tokens: Record<string, string> = {}
  const html = files.filter((f) => /\.html?$/i.test(f.path)).sort((a, b) => a.path.localeCompare(b.path))
  for (const f of files) {
    if (/\.css$/i.test(f.path)) tokens = { ...tokens, ...tokensOf(f.text) }
  }
  for (const f of html) {
    if (pages.length >= MAX_PAGES) {
      skipped.push({ path: f.path, why: `more than ${MAX_PAGES} pages` })
      continue
    }
    // Inline styles carry tokens too.
    for (const m of f.text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) tokens = { ...tokens, ...tokensOf(m[1]) }
    const { page, header, footer } = mapPage(f.path, f.text)
    anyHeader ||= header
    anyFooter ||= footer
    pages.push(page)
  }

  const globals: NonNullable<Blueprint['globals']> = {}
  if (anyHeader && customBlocks.includes('x:site-header')) globals.header = { block: 'x:site-header' }
  if (anyFooter && customBlocks.includes('x:site-footer')) globals.footer = { block: 'x:site-footer' }
  const uses = Object.keys(globals)

  const seen = new Set<string>()
  const page_types: BlueprintPageType[] = pages.map((p) => {
    const base = p.path.split('/').pop() ?? p.path
    let id = /^index\.html?$/i.test(base) ? 'home' : kebab(base)
    while (seen.has(id)) id = `${id}-2`
    seen.add(id)
    // Slots in section order; the same block twice in a row repeats; a block
    // seen again later gets the slot it already has (a block belongs to one slot).
    const slots: BlueprintSlot[] = []
    const slotOf = new Map<string, BlueprintSlot>()
    for (const s of p.sections) {
      const prev = slots[slots.length - 1]
      if (prev && prev.blocks[0] === s.block) {
        delete prev.max
        prev.min = 1
        continue
      }
      const again = slotOf.get(s.block)
      if (again) {
        delete again.max
        continue
      }
      const used = new Set(slots.map((x) => x.id))
      let sid = s.block.replace(/^x:/, '').replace(/-section$/, '')
      while (used.has(sid)) sid = `${sid}-2`
      const slot: BlueprintSlot = { id: sid, blocks: [s.block], min: 1, max: 1 }
      slots.push(slot)
      slotOf.set(s.block, slot)
    }
    return {
      id,
      label: { en: p.title.slice(0, 80) },
      route: id === 'home' ? '/{lang}' : `/{lang}/${id}`,
      source: { kind: 'page' },
      slots,
      ...(uses.length ? { uses } : {}),
    }
  })

  return {
    pages,
    blueprint: {
      format: 'swarmpress.blueprint.v1',
      ...(uses.length ? { globals } : {}),
      page_types,
      navigation: page_types.map((t) => ({ page_type: t.id })),
      intent: Object.keys(tokens).length ? { tokens: 'theme/tokens.json' } : {},
    },
    tokens,
    skipped,
  }
}

// --- ZIP --------------------------------------------------------------------

/** Raw DEFLATE, with the platform's `DecompressionStream`. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  void writer.write(data as unknown as BufferSource).then(() => writer.close())
  const chunks: Uint8Array[] = []
  const reader = ds.readable.getReader()
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
    if (total > MAX_FILE_BYTES) break
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * The text files of a ZIP (stored or deflated entries, read from the central
 * directory), without a library: `DecompressionStream('deflate-raw')`.
 * Directories, non-text files and files over {@link MAX_FILE_BYTES} are
 * skipped; paths are kept as they are, never resolved against anything.
 */
export async function unzipText(bytes: Uint8Array): Promise<{ files: { path: string; text: string }[]; skipped: { path: string; why: string }[] }> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // End of central directory: the last 0x06054b50 within the final 64 KiB.
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a ZIP file (no end of central directory)')
  const count = dv.getUint16(eocd + 10, true)
  let at = dv.getUint32(eocd + 16, true)
  const files: { path: string; text: string }[] = []
  const skipped: { path: string; why: string }[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(at, true) !== 0x02014b50) throw new Error('a broken ZIP central directory')
    const method = dv.getUint16(at + 10, true)
    const csize = dv.getUint32(at + 20, true)
    const usize = dv.getUint32(at + 24, true)
    const nameLen = dv.getUint16(at + 28, true)
    const extraLen = dv.getUint16(at + 30, true)
    const commentLen = dv.getUint16(at + 32, true)
    const local = dv.getUint32(at + 42, true)
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen))
    at += 46 + nameLen + extraLen + commentLen
    if (path.endsWith('/')) continue
    if (!/\.(html?|css)$/i.test(path)) {
      skipped.push({ path, why: 'not HTML or CSS' })
      continue
    }
    if (usize > MAX_FILE_BYTES || csize > MAX_FILE_BYTES) {
      skipped.push({ path, why: 'too large' })
      continue
    }
    const lNameLen = dv.getUint16(local + 26, true)
    const lExtraLen = dv.getUint16(local + 28, true)
    const start = local + 30 + lNameLen + lExtraLen
    const data = bytes.subarray(start, start + csize)
    let raw: Uint8Array
    if (method === 0) raw = data
    else if (method === 8) {
      raw = await inflateRaw(data)
      if (raw.length > MAX_FILE_BYTES) {
        skipped.push({ path, why: 'too large' })
        continue
      }
    } else {
      skipped.push({ path, why: `compression method ${method}` })
      continue
    }
    try {
      files.push({ path, text: decoder.decode(raw) })
    } catch {
      skipped.push({ path, why: 'not UTF-8 text' })
    }
  }
  return { files, skipped }
}

/**
 * An imported design merged into a blueprint (the concept's semantic
 * reconciliation): an imported page type replaces the one with its id (a
 * re-import of a changed export), any other is added; globals the import
 * found are added; new page types join the navigation. The result is the
 * canvas's draft: the CEO sees the diff and saves it, or not.
 */
export function mergeDesign(base: Blueprint, imported: Blueprint): Blueprint {
  const byId = new Map(imported.page_types.map((t) => [t.id, t]))
  const page_types = base.page_types.map((t) => byId.get(t.id) ?? t)
  for (const t of imported.page_types) if (!base.page_types.some((b) => b.id === t.id)) page_types.push(t)
  const known = new Set((base.navigation ?? []).map((n) => n.page_type).filter(Boolean))
  const navigation = [...(base.navigation ?? []), ...(imported.navigation ?? []).filter((n) => n.page_type && !known.has(n.page_type) && !base.page_types.some((b) => b.id === n.page_type))]
  const globals = { ...(imported.globals ?? {}), ...(base.globals ?? {}) }
  return {
    ...base,
    ...(Object.keys(globals).length ? { globals } : {}),
    page_types,
    ...(navigation.length ? { navigation } : {}),
  }
}

/** The pages of a dropped file: an HTML page, or a ZIP of pages. */
export async function filesOfUpload(name: string, bytes: Uint8Array): Promise<{ files: { path: string; text: string }[]; skipped: { path: string; why: string }[] }> {
  if (/\.zip$/i.test(name)) return unzipText(bytes)
  if (/\.html?$/i.test(name)) {
    if (bytes.length > MAX_FILE_BYTES) return { files: [], skipped: [{ path: name, why: 'too large' }] }
    return { files: [{ path: name, text: new TextDecoder().decode(bytes) }], skipped: [] }
  }
  return { files: [], skipped: [{ path: name, why: 'not HTML or a ZIP' }] }
}
