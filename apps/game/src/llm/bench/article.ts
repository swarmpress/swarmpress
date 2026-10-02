/**
 * The staged-article schemas and checks as the qualification harness sees
 * them (ADR-0057, ADR-0058).
 *
 * The schemas are the Rust ones (`crates/agents/src/article.rs`,
 * `crates/agents/src/meetings.rs`). orchestrator-wasm does not export them to
 * JavaScript, so `article-schemas.json` is written by a Rust test
 * (`crates/agents/tests/bench_schemas.rs`) that fails when the file and the
 * Rust functions disagree. Nothing here defines a schema of its own.
 *
 * `checkSection` mirrors the part of Rust's `check_section` that needs no
 * house style and no markup stripping: block shape, the 60 to 140 percent word
 * band, and URLs or angle brackets left in the text. Banned phrases,
 * near-duplicate paragraphs and the stripping of emphasis markers are not
 * mirrored. The Rust test exports vectors that article.test.ts replays, so the
 * mirrored part cannot drift either.
 */
import exported from './article-schemas.json'
import type { JsonSchema } from '../types'

export interface SectionBlock {
  type: 'paragraph' | 'list' | 'tip'
  text: string
  items: string[]
}

export interface SectionDraft {
  blocks: SectionBlock[]
}

export interface OutlineSection {
  heading: string
  points: string[]
  words: number
}

export interface Outline {
  title: string
  dek: string
  category: string
  hero: string
  sections: OutlineSection[]
  closing_title: string
  links: string[]
}

export interface Closing {
  content: string
}

export interface ReviewIssue {
  section: string
  problem: string
  fix: string
}

export interface Review {
  decision: 'approve' | 'needs_changes' | 'reject'
  score: number
  notes: string
  issues: ReviewIssue[]
  high_risk: string[]
}

export interface ModeratorDecision {
  next: string
  prompt: string
  done: boolean
}

export type SectionErrorKind = 'shape' | 'not_plain_text' | 'too_short' | 'too_long'

export interface SectionError {
  kind: SectionErrorKind
  message: string
}

interface Exported {
  hero_aliases: string[]
  link_aliases: string[]
  categories: string[]
  section_ids: string[]
  section_words: number
  moderator: { id: string; name: string }
  participants: { id: string; name: string; role: string }[]
  schemas: { outline: JsonSchema; section: JsonSchema; closing: JsonSchema; review: JsonSchema; moderator: JsonSchema }
  constants: { section_min_percent: number; section_max_percent: number; min_section_words: number }
  vectors: {
    word_count: { text: string; words: number }[]
    check_section: { name: string; section: string; budget_words: number; draft: SectionDraft; kinds: SectionErrorKind[] }[]
  }
}

export const RUST: Exported = exported as unknown as Exported

export const SCHEMAS = RUST.schemas
export const HERO_ALIASES = RUST.hero_aliases
export const LINK_ALIASES = RUST.link_aliases
export const CATEGORIES = RUST.categories
export const SECTION_IDS = RUST.section_ids
/** Word budget of the single-section fixture. */
export const SECTION_WORDS = RUST.section_words
/** Body sections of the benchmark article. */
export const ARTICLE_SECTIONS = RUST.section_ids.length

/**
 * Unicode White_Space code points: what Rust's `split_whitespace` splits on.
 * JavaScript's regex class differs (it also matches U+FEFF and misses U+0085).
 */
const WHITE_SPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028,
  0x2029, 0x202f, 0x205f, 0x3000,
])

function tokens(text: string): string[] {
  const out: string[] = []
  let word = ''
  for (const ch of text) {
    if (WHITE_SPACE.has(ch.codePointAt(0) ?? 0)) {
      if (word) out.push(word)
      word = ''
    } else word += ch
  }
  if (word) out.push(word)
  return out
}

/** Rust's `word_count`: whitespace-separated words. */
export function rustWordCount(text: string): number {
  return tokens(text).length
}

const blockName = (b: SectionBlock) => b.type

/** URLs and angle brackets left in a text, as Rust's `sanitize_plain` reports them. */
function plainTextErrors(what: string, text: string): SectionError[] {
  const out: SectionError[] = []
  for (const token of tokens(text)) {
    const lower = token.toLowerCase()
    const bare = lower.replace(/^[^\p{L}\p{N}]+/u, '')
    if (lower.includes('http://') || lower.includes('https://') || bare.startsWith('www.')) {
      out.push({ kind: 'not_plain_text', message: `${what} contains the URL ${token}; write plain text without links or addresses` })
    }
  }
  if (/[<>]/.test(text)) out.push({ kind: 'not_plain_text', message: `${what} contains < or >; write plain text without HTML or comparison signs` })
  return out
}

/**
 * The mirrored part of Rust's `check_section`. `budgetWords` 0 skips the
 * length check. Errors come in the order Rust reports them.
 */
export function checkSection(draft: SectionDraft, o: { section: string; budgetWords: number }): SectionError[] {
  const out: SectionError[] = []
  const shape = (message: string): SectionError => ({ kind: 'shape', message })
  if (draft.blocks.length === 0) return [shape('has no blocks; write at least one paragraph')]
  let words = 0
  draft.blocks.forEach((block, i) => {
    const what = `block ${i + 1} (${blockName(block)})`
    const text = tokens(block.text).join(' ')
    out.push(...plainTextErrors(what, block.text))
    const items = block.items.map((item) => {
      out.push(...plainTextErrors(what, item))
      return tokens(item).join(' ')
    })
    const kept = items.filter((item) => item.length > 0)
    words += rustWordCount(text) + kept.reduce((a, item) => a + rustWordCount(item), 0)
    if (block.type === 'list') {
      if (kept.length === 0) out.push(shape(`${what} needs at least one item`))
      if (text) out.push(shape(`${what} must leave "text" empty; put the words in "items"`))
    } else {
      if (!text) out.push(shape(`${what} needs text`))
      if (kept.length > 0) out.push(shape(`${what} must leave "items" empty; use a list block for items`))
    }
    if (o.section === 'intro' && block.type !== 'paragraph') out.push(shape(`${what} is not allowed in the intro; write paragraphs only`))
  })
  if (o.budgetWords > 0) {
    const lo = Math.floor((o.budgetWords * RUST.constants.section_min_percent) / 100)
    const hi = Math.floor((o.budgetWords * RUST.constants.section_max_percent) / 100)
    const message = `has ${words} words; about ${o.budgetWords} were asked for (${lo} to ${hi} is accepted)`
    if (words < lo) out.push({ kind: 'too_short', message })
    else if (words > hi) out.push({ kind: 'too_long', message })
  }
  return out
}

/** Words of a section as the length check counts them. */
export function sectionWords(draft: SectionDraft): number {
  return draft.blocks.reduce((a, b) => a + rustWordCount(b.text) + b.items.reduce((x, item) => x + rustWordCount(item), 0), 0)
}

/** What a later stage is told about an earlier section: heading, first and last sentence. */
export function sectionDigest(heading: string, draft: SectionDraft): string {
  const text = draft.blocks
    .filter((b) => b.type !== 'list')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join(' ')
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? (text ? [text] : [])
  const first = sentences[0] ?? ''
  const last = sentences.length > 1 ? sentences[sentences.length - 1] : ''
  return `${heading}: ${first}${last ? ` … ${last}` : ''}`
}

/** The article as the editor reads it: plain text, no page JSON. */
export function readingText(outline: Outline, sections: SectionDraft[], closing: Closing): string {
  const lines: string[] = [`# ${outline.title}`, outline.dek, '']
  outline.sections.forEach((s, i) => {
    lines.push(`## [s${i + 1}] ${s.heading}`)
    for (const b of sections[i]?.blocks ?? []) {
      if (b.type === 'list') lines.push(...b.items.map((item) => `- ${item}`))
      else lines.push(b.type === 'tip' ? `Tip: ${b.text}` : b.text)
    }
    lines.push('')
  })
  lines.push(`## [closing] ${outline.closing_title}`, closing.content)
  return lines.join('\n')
}
