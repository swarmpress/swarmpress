/**
 * The scripted fake model of `?llm=fake` (docs/mvp.md), now brief-driven
 * (ADR-0058): it answers every call of the game's jobs by reading the call,
 * so it can run any number of standups and write any article from any brief,
 * deterministically. It is the TypeScript twin of
 * `crates/agents/src/fake_writer.rs`: the staged prompts are built in Rust
 * (`agents::article_prompts`) and start with `## Task: <stage>`; for the same
 * prompt both fakes give the same answer.
 *
 * - **Standup:** the moderator gives the floor to the first writer, the
 *   writer pitches, the moderator closes, and the outcome commissions one
 *   brief: the next of `MVP_TOPICS` (the first is "Harvest week in
 *   Manarola", the MVP article).
 * - **Draft:** outline, intro, sections and closing from the brief, about
 *   the asked length, plain text that passes the per-part checks; fixes and
 *   revisions of a named part (a revision starts with `MVP_REVISION_LINE`).
 * - **Review:** revision 0 scores 6 and names section 2 (`MVP_REVIEW_NOTE`),
 *   every later revision scores 8: review 6 → revision → review 8.
 */

export type MvpReply = { text: string } | { json: unknown }

/** One call as the fake reads it: the system prompt, the first user turn, and the schema (null for free text). */
export interface MvpCall {
  system: string
  prompt: string
  schema: Record<string, unknown> | null
}

/** The editor's note on the first draft (it names section 2). */
export const MVP_REVIEW_NOTE = 'Tell us who the pickers are.'
/** The fix the editor asks for with `MVP_REVIEW_NOTE`. */
export const MVP_REVIEW_FIX = 'Name the people who do the work and say what each of them does.'
/** The sentence a revised part starts with (what the shipped article shows of the revision). */
export const MVP_REVISION_LINE = 'The people who do the work are named here, each with the task they carry out.'
/** The editor's note on an approved revision. */
export const MVP_APPROVE_NOTE = 'Now it has people in it.'

/** The plan thread the loop produces for its work item, oldest first. */
export const MVP_POST_TYPES = ['minutes', 'artifact', 'handoff', 'review', 'artifact', 'handoff', 'review', 'artifact', 'status'] as const

/** The MVP team, as the sim staffs it (StaffRef JSON). */
export const MVP_TEAM = [
  { id: 'staff-4', persona: 'sophia', role: 'editor-in-chief' },
  { id: 'staff-5', persona: 'marco', role: 'editor' },
  { id: 'staff-1', persona: 'giulia', role: 'writer' },
  { id: 'staff-2', persona: 'isabella', role: 'writer' },
]

export interface MvpTopic {
  title: string
  angle: string
  keywords: string[]
  target_words: number
  pitch: string
}

/** What the fake standups commission, in order (then from the start again). */
export const MVP_TOPICS: MvpTopic[] = [
  {
    title: 'Harvest week in Manarola',
    angle: 'A day on the terraces with the pickers',
    keywords: ['sciacchetrà', 'manarola harvest'],
    target_words: 600,
    pitch: 'The Sciacchetrà harvest starts Monday; I want to be on the Manarola terraces.',
  },
  {
    title: 'Vernazza harbour at first light',
    angle: 'What the harbour looks like before the first train arrives, and where to stand',
    keywords: ['vernazza', 'harbour', 'morning'],
    target_words: 700,
    pitch: 'Nobody writes about Vernazza before eight; the harbour is a different place then.',
  },
  {
    title: 'The ferry from Monterosso',
    angle: 'Seeing the five villages from the water, and when the boats do not run',
    keywords: ['monterosso', 'ferry', 'boats'],
    target_words: 600,
    pitch: 'Readers keep asking about the boats; I can ride the whole line on Thursday.',
  },
  {
    title: 'Corniglia and its long stair',
    angle: 'The one village above the sea, and how to arrive without losing your breath',
    keywords: ['corniglia', 'steps', 'trains'],
    target_words: 600,
    pitch: 'Corniglia gets skipped because of the stairs; I want to make the case for it.',
  },
  {
    title: 'Riomaggiore after dark',
    angle: 'The village once the day visitors have left, from dinner to the last train',
    keywords: ['riomaggiore', 'evening', 'dinner'],
    target_words: 800,
    pitch: 'The evening in Riomaggiore belongs to the people who stay; that is our story.',
  },
]

// ---------------------------------------------------------------- prompt reading

/** The prompt text, read by its labelled lines (as `Prompt` in fake_writer.rs). */
class Prompt {
  constructor(readonly text: string) {}
  field(label: string): string {
    for (const l of this.text.split('\n')) if (l.startsWith(label)) return l.slice(label.length).trim()
    return ''
  }
  number(label: string): number {
    return leadingNumber(this.field(label))
  }
  list(label: string, sep: string): string[] {
    return this.field(label)
      .split(sep)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
}

const chars = (s: string) => [...s].length

function leadingNumber(s: string): number {
  const m = /^\d+/.exec(s)
  return m ? Number(m[0]) : 0
}

/** `intro` → 0, `s3` → 3, `closing` → 99. */
function sectionIndex(id: string): number {
  const t = id.trim()
  if (t === 'intro') return 0
  if (t === 'closing') return 99
  return leadingNumber(t.replace(/^s+/, ''))
}

function enumOf(schema: Record<string, unknown> | null, path: string[]): string[] {
  let v: unknown = schema
  for (const k of path) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function cap(s: string, max: number): string {
  if (chars(s) <= max) return s
  let out = ''
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if (chars(out) + chars(word) + 1 > max) break
    out = out ? `${out} ${word}` : word
  }
  return out
}

function titleAndDek(p: Prompt): [string, string] {
  let title = p.field('Title: ')
  if (chars(title) < 10) title = `${title}: a field guide`
  let dek = p.field('Angle: ')
  if (!dek.endsWith('.')) dek += '.'
  if (chars(dek) < 40) dek = `${dek} A practical guide for a slow visit.`
  return [cap(title, 70), cap(dek, 160)]
}

function keywords(p: Prompt): string[] {
  const k = p.list('Keywords: ', ',')
  if (k.length === 0) k.push(p.field('Title: ').toLowerCase())
  return k
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length

// ---------------------------------------------------------------- the article

const HEADINGS = ['Where {k} begins', 'How to see {k}', 'What {k} asks of a visitor', 'When to go for {k}', 'The people behind {k}', 'Making the most of {k}']

function outline(p: Prompt, schema: Record<string, unknown> | null) {
  const [title, dek] = titleAndDek(p)
  const target = Math.max(300, p.number('Target length: about '))
  const n = target <= 700 ? 3 : target <= 1100 ? 4 : 5
  const kws = keywords(p)
  const sections = Array.from({ length: n }, (_, i) => {
    const k = kws[i % kws.length]
    const k2 = kws[(i + 1) % kws.length]
    return {
      heading: cap(HEADINGS[i % HEADINGS.length].replace('{k}', k), 70),
      points: [`${k} at first light`, `what ${k2} means here`, 'practical timing'],
      words: 150,
    }
  })
  const categories = enumOf(schema, ['properties', 'category', 'enum'])
  const joined = kws.join(' ').toLowerCase()
  const category =
    categories.find((c) =>
      c
        .toLowerCase()
        .split(/[^\p{L}\p{N}]/u)
        .some((w) => w.length > 3 && joined.includes(w)),
    ) ??
    categories[0] ??
    'Guides'
  const heroes = enumOf(schema, ['properties', 'hero', 'enum'])
  const links = enumOf(schema, ['properties', 'links', 'items', 'enum']).slice(0, 2)
  return { title, dek, category, hero: heroes[0] ?? 'M1', sections, closing_title: 'Before you go', links }
}

/** Pools of coprime sizes (11, 13, 12), each picked with its own stride: no two paragraphs repeat. */
const OPENERS = [
  'Early in the day,',
  'On a quiet weekday,',
  'After the first train,',
  'In the late afternoon,',
  'When the light turns warm,',
  'Before the paths fill,',
  'On a wet morning,',
  'Between two trains,',
  'Once the boats are in,',
  'On the walk down,',
  'After a slow lunch,',
]
const MIDDLES = [
  'is easiest to understand',
  'rewards a little patience',
  'shows how the village works',
  'makes more sense with a local at your side',
  'feels close and unhurried',
  'asks for good shoes and water',
  'changes with the season',
  'is part of ordinary life here',
  'is worth a second look',
  'says more than any sign',
  'keeps its own slow rhythm',
  'is best seen on foot',
  'tells you where you are',
]
const CLOSERS = [
  'and nobody minds a question.',
  'so give it time.',
  'even for people who have seen it before.',
  'if you keep to the path.',
  'and the rest of the day can wait.',
  'before the crowds arrive.',
  'which is why people come back.',
  'so check the timetable first.',
  'and it costs nothing to look.',
  'while the village goes about its work.',
  'long after the photographs are taken.',
  'as long as you respect the people working there.',
]
const CLOSING = [
  'Plan the day around the light and the trains, and leave room for a slow lunch.',
  'Check timetables and the weather on the morning you go, since both change quickly.',
  'Walk early, rest in the heat of the afternoon and come back out for the evening.',
  'Carry water, wear shoes with grip and keep a little cash for smaller places.',
  'Be patient on the paths and kind to the people who live and work here.',
  'Come back in another season and the same places will show you something new.',
]

function paragraphs(start: number, words: number, subjects: string[], lead: string | null): string[] {
  const goal = Math.max(20, words)
  const out: string[] = []
  let total = 0
  let current: string[] = []
  if (lead) {
    total += countWords(lead)
    current.push(lead)
  }
  const n = Math.max(1, subjects.length)
  let p = 0
  let k = 0
  while (total < Math.max(0, goal - 4)) {
    const g = start + p
    const subject = subjects[(g + k) % n] ?? 'the village'
    const sentence = `${OPENERS[(g * 5 + k) % OPENERS.length]} ${subject} ${MIDDLES[(g * 7 + k * 5) % MIDDLES.length]} ${CLOSERS[(g * 11 + k * 7) % CLOSERS.length]}`
    total += countWords(sentence)
    current.push(sentence)
    k++
    if (k === 4) {
      out.push(current.join(' '))
      current = []
      k = 0
      p++
    }
  }
  if (current.length) out.push(current.join(' '))
  return out
}

function section(p: Prompt, index: number, variant: number, asked: number, revised: boolean) {
  const words = asked === 0 ? 120 : asked
  const kws = keywords(p)
  const points = p.list('Points: ', ';')
  const subjects = (index === 0 ? [p.field('Title: ').toLowerCase()] : points.length ? [...points] : [p.field('Heading: ')]).concat(kws).map((x) => x.toLowerCase())
  const b = subjects[1] ?? ''
  const tip = index === 2
  const body = tip ? Math.max(0, words - 20) : words
  const blocks: { type: string; text: string; items: string[] }[] = paragraphs(index * 9 + variant * 100, body, subjects, revised ? MVP_REVISION_LINE : null).map((text) => ({
    type: 'paragraph',
    text,
    items: [],
  }))
  if (tip) blocks.push({ type: 'tip', text: `Check the timetable on the day and travel early, because ${b} is easiest to enjoy before noon.`, items: [] })
  return { blocks }
}

/** `closing_words` of agents::article: target / 12, between 40 and 100. */
const closingWords = (target: number) => Math.min(100, Math.max(40, Math.floor(target / 12)))

function closingText(p: Prompt, words: number): string {
  const title = p.field('Title: ').toLowerCase()
  const out = [`That is ${title} as we found it, and it is best seen slowly.`]
  let total = countWords(out[0])
  for (const s of CLOSING) {
    if (total >= words) break
    total += countWords(s)
    out.push(s)
  }
  return out.join(' ')
}

function review(p: Prompt, schema: Record<string, unknown> | null) {
  const revision = p.number('Revision: ')
  const ids = enumOf(schema, ['properties', 'issues', 'items', 'properties', 'section', 'enum'])
  const target = ['s2', 's1', 'intro'].find((id) => ids.includes(id)) ?? 'whole'
  if (revision === 0) {
    return { decision: 'needs_changes', score: 6, notes: MVP_REVIEW_NOTE, issues: [{ section: target, problem: MVP_REVIEW_NOTE, fix: MVP_REVIEW_FIX }], high_risk: [] }
  }
  return { decision: 'approve', score: 8, notes: MVP_APPROVE_NOTE, issues: [], high_risk: [] }
}

function sectionReview(p: Prompt, rest: string) {
  const id = rest.split(/\s+/)[0] ?? ''
  if (p.number('Revision: ') === 0 && id === 's2') return { score: 6, notes: MVP_REVIEW_NOTE, issues: [{ problem: MVP_REVIEW_NOTE, fix: MVP_REVIEW_FIX }] }
  return { score: 8, notes: 'Clear and useful.', issues: [] }
}

/** The answer to one call of the staged article (`agents::fake_writer::answer`); null when the call is not one. */
export function articleAnswer(prompt: string, schema: Record<string, unknown> | null): unknown | null {
  const first = prompt.split('\n')[0] ?? ''
  if (!first.startsWith('## Task: ')) return null
  const task = first.slice('## Task: '.length).trim()
  const p = new Prompt(prompt)
  const words = p.number('Words: about ')
  const partAt = task.indexOf(' part ')
  const shift = partAt >= 0 ? Math.max(0, leadingNumber(task.slice(partAt + 6)) - 1) * 2 : 0
  const target = p.number('Target length: about ')
  if (task === 'outline') return outline(p, schema)
  if (task === 'intro' || task.startsWith('intro part')) return section(p, 0, shift, words, false)
  if (task.startsWith('section s')) return section(p, leadingNumber(task.slice('section s'.length)), shift, words, false)
  if (task === 'closing') return { content: closingText(p, closingWords(target)) }
  if (task.startsWith('fix ')) return section(p, sectionIndex(task.slice(4)), 0, words, false)
  if (task === 'revise closing') return { content: `${MVP_REVISION_LINE} ${closingText(p, closingWords(target))}` }
  if (task.startsWith('revise ')) return section(p, sectionIndex(task.slice(7)), 0, words, true)
  if (task === 'retitle') {
    const [title, dek] = titleAndDek(p)
    return { title, dek }
  }
  if (task === 'review' || task === 'review summary') return review(p, schema)
  if (task.startsWith('review section ')) return sectionReview(p, task.slice('review section '.length))
  return null
}

// ---------------------------------------------------------------- the standup

/** `staff-N` ids of the writers named in a moderator's system prompt (`staff-1 (giulia, writer)`). */
function writersIn(system: string): string[] {
  return [...system.matchAll(/(staff-\d+) \([^,()]+, writer\)/g)].map((m) => m[1])
}

/**
 * A fake model: standups (moderator, pitch, outcome) and every stage of the
 * Draft and Review jobs. Standups commission `MVP_TOPICS` in turn; nothing
 * else keeps state.
 */
export function createMvpModel(topics: MvpTopic[] = MVP_TOPICS) {
  let commissioned = 0
  return {
    /** How many briefs the standups commissioned so far. */
    get commissioned() {
      return commissioned
    },
    answer(call: MvpCall): MvpReply {
      const article = articleAnswer(call.prompt, call.schema)
      if (article !== null) return { json: article }
      const props = (call.schema?.properties ?? null) as Record<string, unknown> | null
      const writers = writersIn(call.system)
      const ids = enumOf(call.schema, ['properties', 'next', 'enum']).filter((x) => x)
      const writer = writers.find((w) => ids.includes(w)) ?? writers[0] ?? ids[0] ?? 'staff-1'
      const topic = topics[commissioned % topics.length]
      if (props && 'next' in props) {
        // The moderator: the floor to the first writer, then done.
        const spoken = !call.prompt.includes('(nobody has spoken yet)')
        return spoken ? { json: { next: writer, prompt: '', done: true } } : { json: { next: writer, prompt: 'Your pitch?', done: false } }
      }
      if (props && 'briefs' in props) {
        const assignee = enumOf(call.schema, ['properties', 'briefs', 'items', 'properties', 'assignee', 'enum']).find((x) => writers.includes(x)) ?? writer
        commissioned++
        return {
          json: {
            briefs: [{ title: topic.title, angle: topic.angle, assignee, keywords: topic.keywords, target_words: topic.target_words }],
            decisions: [`${topic.title} is commissioned`],
            escalations: [],
          },
        }
      }
      // A meeting turn (free text): the writer's pitch.
      return { text: topic.pitch }
    },
  }
}

/** The pre-staged page shape (one structured call), kept for the UI's tests of older articles. */
export function legacyMvpPage(paragraph = 'Maria and her sons have picked these terraces for thirty years; we joined them at seven.') {
  return {
    id: 'ignored-by-orchestrator',
    slug: { en: '/en/blog/x' },
    title: { en: 'Harvest week in Manarola' },
    page_type: 'blog-article',
    seo: { title: 'Harvest week in Manarola', description: 'Picking Sciacchetrà grapes on the terraces.' },
    body: [
      { type: 'heading', level: 2, text: 'On the terraces' },
      { type: 'paragraph', markdown: paragraph },
      { type: 'callout', style: 'info', content: 'The harvest moves with the weather; check before you go.' },
    ],
  }
}

/** Splits a LocalLlm conversation into the fake's view: the schema is the one `withSchemaPrompt` appended to the system message. */
export function mvpCallFromMessages(messages: { role: string; content: string }[]): MvpCall {
  let system = messages[0]?.role === 'system' ? messages[0].content : ''
  let schema: Record<string, unknown> | null = null
  const at = system.lastIndexOf('JSON Schema:\n')
  if (at >= 0) {
    try {
      schema = JSON.parse(system.slice(at + 'JSON Schema:\n'.length)) as Record<string, unknown>
      system = system.slice(0, at)
    } catch {
      schema = null
    }
  }
  const prompt = messages.find((m) => m.role === 'user')?.content ?? ''
  return { system, prompt, schema }
}
