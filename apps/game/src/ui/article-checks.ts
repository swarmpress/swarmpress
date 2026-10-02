/**
 * Measured checks of an article (increment U1, ADR-0059): facts counted from
 * the page JSON, the same every time for the same page. They are shown apart
 * from the editor's review, which is an opinion
 * (docs/reference/browser-agent-studio.md §20). Nothing here calls a model.
 */
import { bodyBlocks, decodeEntities, HERO_TYPES, httpsImageUrl, PREVIEW_BLOCKS } from './article-preview'

/**
 * How far the body may be from the brief's target and still pass: ±25%, the
 * bar docs/mvp.md (track E) proposes for a publishable article.
 */
export const WORD_TOLERANCE = 0.25

export interface BannedHit {
  phrase: string
  /** Occurrences in the page's strings. */
  count: number
}

export interface ArticleChecks {
  /** Words of body text (see `bodyWords`). */
  words: number
  /** The brief's `target_words`; null when the brief is not in the store. */
  targetWords: number | null
  /** `words / targetWords`; null without a target. */
  ratio: number | null
  /** Within `WORD_TOLERANCE` of the target; null without a target. */
  withinTarget: boolean | null
  blocks: number
  /** Blocks that carry the page title (`editorial-hero`, `hero`). An article has exactly one, first. */
  heroes: number
  heroFirst: boolean
  closingNotes: number
  closingLast: boolean
  /** `href` values in the body (the closing note's actions). */
  links: number
  /** Image addresses in the body (`image`, `src`, `backgroundImage`). */
  media: number
  /** Of those, the ones that are not absolute `https:` URLs (the preview does not load them). */
  mediaNotHttps: number
  /** Block types the preview shows as a placeholder, in page order, once each. */
  unknownBlocks: string[]
  /** Banned-phrase hits; null when the source has no banned list (the check is then not shown). */
  banned: BannedHit[] | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length

/**
 * Words of body text, as `agents::ArticleParts::words` counts an article:
 * paragraphs, list items, callouts and the closing note (plus quotes and FAQ
 * of the older page shape). The title, the dek, headings, captions, badges
 * and addresses are not counted.
 */
export function bodyWords(page: unknown): number {
  let n = 0
  for (const b of bodyBlocks(page)) {
    if (!isObj(b)) continue
    switch (b.type) {
      case 'paragraph':
        n += countWords(str(b.markdown ?? b.text))
        break
      case 'list':
        for (const i of Array.isArray(b.items) ? b.items : []) n += countWords(isObj(i) ? str(i.text) : str(i))
        break
      case 'callout':
        n += countWords(str(b.content ?? b.text))
        break
      case 'quote':
        n += countWords(str(b.text ?? b.quote))
        break
      case 'faq':
        for (const i of Array.isArray(b.items) ? b.items : []) if (isObj(i)) n += countWords(str(i.question ?? i.q)) + countWords(str(i.answer ?? i.a))
        break
      case 'closing-note':
        n += countWords(decodeEntities(str(b.content)))
        break
    }
  }
  return n
}

/** Every string value under `v`, with the key it sits under (`''` for array items of a keyless array). */
function walkStrings(v: unknown, key: string, visit: (key: string, value: string) => void) {
  if (typeof v === 'string') visit(key, v)
  else if (Array.isArray(v)) for (const x of v) walkStrings(x, key, visit)
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) walkStrings(x, k, visit)
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/**
 * How often `phrase` occurs in `text` as whole words, case-insensitive:
 * the rule of `agents::house_style::contains_phrase`.
 */
export function phraseCount(text: string, phrase: string): number {
  const hay = text.toLowerCase()
  const needle = phrase.toLowerCase()
  if (!needle) return 0
  let n = 0
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    // The code point on either side (two UTF-16 units cover a surrogate pair).
    const before = [...hay.slice(Math.max(0, at - 2), at)].pop()
    const after = [...hay.slice(at + needle.length, at + needle.length + 2)][0]
    if (!isWordChar(before) && !isWordChar(after)) n++
  }
  return n
}

/**
 * Banned phrases in the string values of the page, as the house-style
 * validator looks for them (`StyleGuide::banned_phrase_errors` walks the whole
 * page document).
 */
export function bannedHits(page: unknown, phrases: readonly string[]): BannedHit[] {
  const counts = new Map<string, number>()
  walkStrings(page, '', (_key, value) => {
    for (const p of phrases) {
      const n = phraseCount(value, p)
      if (n) counts.set(p, (counts.get(p) ?? 0) + n)
    }
  })
  return phrases.filter((p) => counts.has(p)).map((phrase) => ({ phrase, count: counts.get(phrase)! }))
}

const MEDIA_KEYS = new Set(['image', 'src', 'backgroundImage'])

export interface CheckOptions {
  targetWords?: number | null
  bannedPhrases?: readonly string[] | null
}

export function measureArticle(page: unknown, opts: CheckOptions = {}): ArticleChecks {
  const blocks = bodyBlocks(page)
  const types = blocks.map((b) => (isObj(b) && typeof b.type === 'string' ? b.type : ''))
  const words = bodyWords(page)
  const target = typeof opts.targetWords === 'number' && opts.targetWords > 0 ? opts.targetWords : null
  const ratio = target ? words / target : null
  let links = 0
  let media = 0
  let mediaNotHttps = 0
  walkStrings(blocks, '', (key, value) => {
    if (!value.trim()) return
    if (key === 'href') links++
    else if (MEDIA_KEYS.has(key)) {
      media++
      if (!httpsImageUrl(value)) mediaNotHttps++
    }
  })
  const closings = types.filter((t) => t === 'closing-note').length
  return {
    words,
    targetWords: target,
    ratio,
    withinTarget: ratio == null ? null : Math.abs(ratio - 1) <= WORD_TOLERANCE,
    blocks: blocks.length,
    heroes: types.filter((t) => HERO_TYPES.has(t)).length,
    heroFirst: HERO_TYPES.has(types[0] ?? ''),
    closingNotes: closings,
    closingLast: closings > 0 && types[types.length - 1] === 'closing-note',
    links,
    media,
    mediaNotHttps,
    unknownBlocks: [...new Set(types.filter((t) => !PREVIEW_BLOCKS.has(t)).map((t) => t || '(no type)'))],
    banned: opts.bannedPhrases ? bannedHits(page, opts.bannedPhrases) : null,
  }
}
