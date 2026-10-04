/**
 * The eval harness's inputs (FEAT-036; docs/design/mvp-pipeline.md §9): the
 * site pack document of `cargo xtask site-pack <site> --articles`, the briefs
 * it takes from the site's content calendar, and the existing articles.
 *
 * Pure: runs in the page and under vitest.
 */

/** A routed page of the pack (`knowledge::PageEntry`). */
export interface PackPage {
  id: string
  path: string
  page_type?: string
  routes: Record<string, string>
  titles?: Record<string, string>
  status?: string | null
}

/** The knowledge pack (`knowledge::pack::Pack`). */
export interface Pack {
  commit: string
  files: Record<string, string>
  manifest: unknown
  pages: PackPage[]
}

/** What the harness loads: the pack, its JSON text for the orchestrator, and the site's articles. */
export interface EvalSite {
  pack: Pack
  /** The pack alone, as JSON text: the site binding's `knowledge_pack`. */
  packJson: string
  /** Repo path → page JSON text (`--articles`); empty for a plain pack. */
  articles: Record<string, string>
}

export const CALENDAR_PATH = 'content/config/content-calendar.json'
export const BLOG_DIR = 'content/pages/blog/'

/** Parses a site-pack document (with or without `articles`). */
export function parseSitePack(text: string): EvalSite {
  const doc = JSON.parse(text) as Record<string, unknown>
  if (!doc || typeof doc !== 'object' || typeof doc.commit !== 'string' || !doc.files || !Array.isArray(doc.pages)) {
    throw new Error('not a site pack: expected {commit, files, manifest, pages} (cargo xtask site-pack <site> --articles --out <file>)')
  }
  const { articles, ...pack } = doc
  return {
    pack: pack as unknown as Pack,
    packJson: JSON.stringify(pack),
    articles: (articles ?? {}) as Record<string, string>,
  }
}

/** One topic of the calendar (`content-calendar.json`, seasonal and evergreen). */
export interface CalendarTopic {
  id: string
  title: string
  slug: string
  priority?: string
  content_type?: string
  brief?: string
  target_length?: string
  keywords?: string[]
  /** `spring`…`winter`, or `evergreen`. */
  group: string
}

/** `agents::Brief`. */
export interface Brief {
  content_id: string
  title: string
  slug: string
  angle: string
  keywords: string[]
  target_words: number
  language: string
  notes: string
}

/** Target lengths are clamped here: 16 of the 19 existing articles are 245–500 words (§9 "Inputs"). */
export const MIN_TARGET_WORDS = 600
export const MAX_TARGET_WORDS = 1200

const PRIORITY = ['critical', 'high', 'medium', 'low']

/** Every topic of a calendar, seasonal first (in file order), then evergreen. */
export function calendarTopics(calendar: unknown): CalendarTopic[] {
  const c = (calendar ?? {}) as { seasonal_content?: Record<string, { topics?: unknown[] }>; evergreen_content?: { topics?: unknown[] } }
  const out: CalendarTopic[] = []
  const add = (group: string, topics: unknown[] | undefined) => {
    for (const t of topics ?? []) {
      const x = t as Partial<CalendarTopic>
      if (typeof x?.id === 'string' && typeof x.title === 'string' && typeof x.slug === 'string') out.push({ ...(x as CalendarTopic), group })
    }
  }
  for (const [season, v] of Object.entries(c.seasonal_content ?? {})) add(season, v?.topics)
  add('evergreen', c.evergreen_content?.topics)
  return out
}

/** URL-safe slug, as `orchestrator::slugify` makes it (lowercase ASCII, dashes, at most 80). */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

/** The slugs the site has: every page's file stem and every route's last segment. */
export function publishedSlugs(pack: Pack): Set<string> {
  const out = new Set<string>()
  for (const p of pack.pages) {
    const stem = p.path.split('/').pop()?.replace(/\.json$/, '')
    if (stem) out.add(stem)
    for (const r of Object.values(p.routes ?? {})) {
      const last = r.split('/').filter(Boolean).pop()
      if (last) out.add(last)
    }
  }
  return out
}

/** `"1800-2200 words"` → the middle (2000), clamped to the MVP's 600–1,200. */
export function targetWords(length: string | undefined): number {
  const nums = (length ?? '').match(/\d+/g)?.map(Number) ?? []
  const mid = nums.length >= 2 ? Math.round((nums[0] + nums[1]) / 2) : (nums[0] ?? 800)
  return Math.min(MAX_TARGET_WORDS, Math.max(MIN_TARGET_WORDS, mid))
}

export function briefOf(t: CalendarTopic): Brief {
  return {
    content_id: `eval-${slugify(t.id)}`,
    title: t.title,
    slug: slugify(t.slug),
    angle: t.brief ?? t.title,
    keywords: t.keywords ?? [],
    target_words: targetWords(t.target_length),
    language: 'en',
    notes: '',
  }
}

export interface PickedBriefs {
  briefs: Brief[]
  /** Unpublished topics in the calendar. */
  available: number
  /** Topics left out because the site has their slug. */
  published: string[]
}

/**
 * The first `n` unpublished calendar topics as briefs. Deterministic: by
 * priority (critical, high, medium, low, then none), then calendar order
 * (seasons as the file lists them, then evergreen).
 */
export function pickBriefs(pack: Pack, n: number): PickedBriefs {
  const text = pack.files[CALENDAR_PATH]
  if (!text) throw new Error(`the pack has no ${CALENDAR_PATH}: the briefs come from the site's content calendar`)
  const have = publishedSlugs(pack)
  const all = calendarTopics(JSON.parse(text))
  const published = all.filter((t) => have.has(slugify(t.slug))).map((t) => t.slug)
  const rank = (t: CalendarTopic) => {
    const i = PRIORITY.indexOf(t.priority ?? '')
    return i < 0 ? PRIORITY.length : i
  }
  const open = all
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !have.has(slugify(t.slug)))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map(({ t }) => t)
  const seen = new Set<string>()
  const briefs: Brief[] = []
  for (const t of open) {
    const b = briefOf(t)
    if (seen.has(b.slug)) continue
    seen.add(b.slug)
    briefs.push(b)
    if (briefs.length >= n) break
  }
  return { briefs, available: open.length, published }
}

/** The site's articles, in path order: `[path, page JSON text]`. */
export function articleEntries(site: EvalSite): [string, string][] {
  return Object.entries(site.articles)
    .filter(([p]) => p.startsWith(BLOG_DIR) && !p.slice(BLOG_DIR.length).includes('/'))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}
