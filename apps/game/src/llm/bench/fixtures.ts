/**
 * The qualification fixtures (ADR-0057, FEAT-037; docs/design/mvp-runtime.md
 * section 7): the work the game asks of its resident model, as prompts with a
 * declared reasoning mode and budget.
 *
 * | | Fixture | Call |
 * |---|---|---|
 * | a | short-action | structured, 1 to 2K tokens in, at most 128 out |
 * | b | short-answer | free text, about 2K in, a short answer |
 * | c | context-inspection | structured, about 8K in, one fact to find |
 * | d | section | structured, one article section of about 300 words |
 * | e | staged-article | outline, five sections, closing, review |
 * | f | meeting-turn, moderator-pick | free text up to 600; structured pick |
 * | g | device-loss | not a prompt: see runner.ts |
 *
 * Every prompt is generated from templates, with no network and no clock, and
 * differs from every other: the runtime decodes greedily, so a repeated prompt
 * would repeat its answer and say nothing more about validity. Each case
 * carries the answer a correct model could give (`expected`), which is what
 * the scripted backend replies with and what the unit tests validate.
 */
import {
  ARTICLE_SECTIONS,
  CATEGORIES,
  HERO_ALIASES,
  LINK_ALIASES,
  RUST,
  SCHEMAS,
  SECTION_WORDS,
  checkSection,
  readingText,
  sectionDigest,
  type Closing,
  type ModeratorDecision,
  type Outline,
  type Review,
  type SectionDraft,
} from './article'
import { BRAND, HOUSE_STYLE, STAFF, VILLAGES, brief, briefText, estimateTokens, int, persona, pick, prose, rng, seedOf, sentence, shuffled, staffById, wordCount, type Brief } from './corpus'
import { schemaInstruction } from '../structured'
import type { ChatMessage, JsonSchema, ThinkingMode } from '../types'

export type FixtureId = 'short-action' | 'short-answer' | 'context-inspection' | 'section' | 'staged-article' | 'meeting-turn' | 'moderator-pick'

export const FIXTURE_IDS: FixtureId[] = ['short-action', 'short-answer', 'context-inspection', 'section', 'staged-article', 'meeting-turn', 'moderator-pick']

/** How one call uses the model: the same options the orchestrator bridge passes (`CallPolicy`). */
export interface CallBudget {
  thinking: ThinkingMode
  /** Answer tokens. */
  maxTokens: number
  /** Cap on reasoning tokens, on top of `maxTokens`. */
  reasoningBudget?: number
  answerPrefix?: string
  stopOnJsonEnd?: boolean
}

export interface FixtureSpec {
  id: FixtureId
  /** The letter in the task list above. */
  letter: 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
  label: string
  kind: 'generate' | 'structured' | 'staged'
  /** Prompts at scale 1 (articles for the staged fixture). */
  count: number
  budget: CallBudget
  /** The band the estimated prompt size must fall in, tokens (system, user and schema instruction). */
  inputTokens: [number, number]
}

/** Reasoning and budgets follow the table in docs/design/mvp-runtime.md section 5. */
export const FIXTURES: Record<FixtureId, FixtureSpec> = {
  'short-action': {
    id: 'short-action',
    letter: 'a',
    label: 'Short structured action',
    kind: 'structured',
    count: 50,
    budget: { thinking: 'off', maxTokens: 128, answerPrefix: '{', stopOnJsonEnd: true },
    inputTokens: [1000, 2000],
  },
  'short-answer': {
    id: 'short-answer',
    letter: 'b',
    label: '2K prompt, short answer',
    kind: 'generate',
    count: 30,
    budget: { thinking: 'off', maxTokens: 96 },
    inputTokens: [1800, 2400],
  },
  'context-inspection': {
    id: 'context-inspection',
    letter: 'c',
    label: '8K context inspection',
    kind: 'structured',
    count: 50,
    budget: { thinking: 'medium', reasoningBudget: 512, maxTokens: 256, stopOnJsonEnd: true },
    inputTokens: [7600, 8800],
  },
  section: {
    id: 'section',
    letter: 'd',
    label: 'One section, about 300 words',
    kind: 'structured',
    count: 50,
    // Draft row of the design table: medium reasoning capped at 1500; answer 1.3 x words + 150.
    budget: { thinking: 'medium', reasoningBudget: 1500, maxTokens: sectionAnswerTokens(SECTION_WORDS), stopOnJsonEnd: true },
    inputTokens: [700, 1500],
  },
  'staged-article': {
    id: 'staged-article',
    letter: 'e',
    label: 'Staged article',
    kind: 'staged',
    // Seven articles of eight calls: 56 structured prompts.
    count: 7,
    budget: { thinking: 'medium', reasoningBudget: 1500, maxTokens: 600, stopOnJsonEnd: true },
    inputTokens: [500, 3500],
  },
  'meeting-turn': {
    id: 'meeting-turn',
    letter: 'f',
    label: 'Meeting turn',
    kind: 'generate',
    count: 20,
    budget: { thinking: 'off', maxTokens: 600 },
    inputTokens: [350, 1000],
  },
  'moderator-pick': {
    id: 'moderator-pick',
    letter: 'f',
    label: 'Moderator pick',
    kind: 'structured',
    count: 50,
    budget: { thinking: 'off', maxTokens: 512, answerPrefix: '{', stopOnJsonEnd: true },
    inputTokens: [450, 1000],
  },
}

/** Budgets of the staged article's calls (design table: Draft and Review rows; pipeline design section 1). */
export const STAGE_BUDGETS = {
  outline: { thinking: 'medium', reasoningBudget: 1500, maxTokens: 600, stopOnJsonEnd: true },
  closing: { thinking: 'off', maxTokens: 250, answerPrefix: '{', stopOnJsonEnd: true },
  review: { thinking: 'medium', reasoningBudget: 2048, maxTokens: 4096, stopOnJsonEnd: true },
} as const satisfies Record<string, CallBudget>

/** Answer budget of a section: about 1.3 tokens per word plus the JSON around it, at most 1000. */
export function sectionAnswerTokens(words: number): number {
  return Math.min(1000, Math.round(1.3 * words + 150))
}

export const sectionBudget = (words: number): CallBudget => ({ thinking: 'medium', reasoningBudget: 1500, maxTokens: sectionAnswerTokens(words), stopOnJsonEnd: true })

export type Stage = 'outline' | `section-${number}` | 'closing' | 'review'

export interface BenchCase {
  /** `<fixture>/<index>` or `<fixture>/<index>/<stage>`: the identity of the prompt, also written into it. */
  key: string
  fixture: FixtureId
  index: number
  stage?: Stage
  kind: 'generate' | 'structured'
  messages: ChatMessage[]
  schema?: JsonSchema
  budget: CallBudget
  /** An answer a correct model could give: text for `generate`, a value for `structured`. */
  expected: unknown
  /** Deterministic checks on an answer that parsed and validated; empty when it passes. */
  check(answer: unknown): string[]
}

const ref = (key: string) => `Reference: bench/${key}`

/** The case key written into a prompt, if any. */
export function caseKeyOf(messages: ChatMessage[]): string | null {
  for (const m of messages) {
    if (m.role !== 'user') continue
    const hit = /^Reference: bench\/(\S+)$/m.exec(m.content)
    if (hit) return hit[1]
  }
  return null
}

/** Estimated prompt size of a case, tokens: the messages plus the schema instruction the repair loop adds. */
export function estimateCaseTokens(c: Pick<BenchCase, 'messages' | 'schema'>): number {
  const text = c.messages.map((m) => m.content).join('\n')
  return estimateTokens(text) + (c.schema ? estimateTokens(schemaInstruction(c.schema)) : 0)
}

const withThinking = (b: CallBudget, override: ThinkingMode | undefined): CallBudget => {
  if (!override || override === b.thinking) return b
  if (override === 'off') return { thinking: 'off', maxTokens: b.maxTokens, stopOnJsonEnd: b.stopOnJsonEnd, ...(b.answerPrefix ? { answerPrefix: b.answerPrefix } : {}) }
  return { ...b, thinking: override, reasoningBudget: b.reasoningBudget ?? 1024, answerPrefix: undefined }
}

// ---------------------------------------------------------------- a: short structured action

const ACTIONS: [string, string][] = [
  ['assign_writer', 'Give an approved pitch to a writer. Use it when a pitch has no owner and the calendar has room this week.'],
  ['request_revision', 'Send a draft back to its writer with one concrete instruction. Use it when a review found problems the writer can fix alone.'],
  ['approve_for_review', 'Move a finished draft to the editor. Use it only when the writer says the draft is complete and the word count is inside the brief.'],
  ['schedule_publish', 'Put an approved article on the calendar. Use it when the editor approved it and the CEO has answered the publish question.'],
  ['escalate_to_ceo', 'Open a question ticket for the CEO. Use it for money, legal risk, a named person, or anything the desk rules do not cover.'],
  ['ask_fact_check', 'Ask the fact checker to verify one claim. Use it when a draft states a price, an opening time or a date without a source.'],
  ['request_photo', 'Ask the photo editor for a hero image. Use it when an article is approved and has no image from the shortlist.'],
  ['defer', 'Leave the item for tomorrow. Use it when the item is blocked on someone outside the desk and nothing else can move it.'],
  ['merge_duplicates', 'Fold one item into another that covers the same subject. Use it when two pitches name the same village and theme.'],
  ['close_stale', 'Close an item nobody has touched. Use it when a pitch is older than 21 days and has no owner.'],
  ['book_interview', 'Ask the secretary to arrange a call with a source. Use it when a writer names a source and has no appointment.'],
  ['update_brief', 'Change the angle or the word target of a brief. Use it when the writer and the editor agree the brief was wrong.'],
]

const ACTION_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'target', 'reason'],
  properties: {
    action: { type: 'string', enum: ACTIONS.map(([id]) => id) },
    target: { type: 'string', minLength: 1, maxLength: 40 },
    reason: { type: 'string', minLength: 1, maxLength: 240 },
  },
}

const DESK_RULES = [
  '## Desk rules',
  'You decide one thing at a time. Each morning you look at the open items of the desk and choose the single next action.',
  'Take the oldest item that can move today. An item that waits on the CEO cannot move; an item that waits on a writer can.',
  'Never publish, merge or close something the CEO was asked about and has not answered.',
  'Name the item you act on by its id, exactly as it is written in the list. Do not act on an item that is not in the list.',
  'Give your reason in one sentence, for the activity log.',
].join('\n')

const ITEM_KINDS: [string, string, string][] = [
  ['pitch', 'no owner', 'assign_writer'],
  ['draft', 'review found two unsourced prices', 'ask_fact_check'],
  ['draft', 'writer reports it complete', 'approve_for_review'],
  ['article', 'approved, no hero image', 'request_photo'],
  ['pitch', 'same village and theme as another pitch', 'merge_duplicates'],
  ['draft', 'editor asked for a shorter intro', 'request_revision'],
  ['pitch', 'untouched for 30 days, no owner', 'close_stale'],
  ['draft', 'names a source, no appointment', 'book_interview'],
]

function shortAction(index: number): BenchCase {
  const key = `short-action/${index}`
  const next = rng(seedOf(key))
  const actor = STAFF[index % 2] // the editor in chief or the editor
  const count = int(next, 7, 9)
  const kinds = shuffled(next, ITEM_KINDS)
  const items = Array.from({ length: count }, (_, i) => {
    const [kind, state, action] = kinds[i % kinds.length]
    const b = brief(index * 11 + i)
    return { id: `item-${String(100 + ((index * 17 + i * 7) % 900)).padStart(3, '0')}-${i}`, kind, state, action, age: int(next, 1, 40), title: b.title, note: sentence(next) }
  })
  const system = [persona(actor), HOUSE_STYLE, DESK_RULES, '## Actions', ...ACTIONS.map(([id, text]) => `- ${id}: ${text}`)].join('\n\n')
  const user = [
    ref(key),
    `Open items of the desk, ${int(next, 1, 28)} ${pick(next, ['March', 'May', 'September', 'October'])}:`,
    ...items.map((it) => `- ${it.id} | ${it.kind} | "${it.title}" | ${it.state} | ${it.age} days old | note: ${it.note}`),
    '',
    'Choose the next action for exactly one of these items.',
  ].join('\n')
  const ids = new Set(items.map((it) => it.id))
  const oldest = items.reduce((a, b) => (b.age > a.age ? b : a))
  return {
    key,
    fixture: 'short-action',
    index,
    kind: 'structured',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: ACTION_SCHEMA,
    budget: FIXTURES['short-action'].budget,
    expected: { action: oldest.action, target: oldest.id, reason: `It is the oldest item that can move today (${oldest.age} days).` },
    check: (answer) => {
      const a = answer as { target?: unknown }
      return typeof a.target === 'string' && ids.has(a.target) ? [] : [`target ${JSON.stringify(a.target)} is not an item in the list`]
    },
  }
}

// ---------------------------------------------------------------- b: 2K prompt, short answer

const NOTICES = [
  'The lift at the station is out of service until further notice; staff will help with luggage on request.',
  'Park cards bought on the train cost five euro more than at the ticket office.',
  'The shuttle bus does not run between 13:00 and 14:30.',
  'Boats do not land when the swell is above one metre; the decision is posted at 08:00.',
  'The upper path is closed for wall repairs on weekdays until 16:00.',
  'Drinking water fountains are switched off overnight from November to March.',
  'The ticket office accepts cards; the kiosk on the pier takes cash only.',
  'Dogs travel free on the boats and must be on a lead on the pier.',
  'The left-luggage room closes thirty minutes before the last train.',
  'Swimming is forbidden inside the harbour mouth while boats are landing.',
  'The market is on Wednesday morning in the upper square, weather permitting.',
  'Night trains run only on Fridays and Saturdays in the summer timetable.',
]

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function shortAnswer(index: number): BenchCase {
  const key = `short-answer/${index}`
  const next = rng(seedOf(key))
  const pairs: { from: string; to: string; last: string; first: string; every: number }[] = []
  let slot = 0
  for (const a of VILLAGES) {
    for (const b of VILLAGES) {
      if (a.id === b.id) continue
      // Distinct last departures: every pair gets its own minute, so the question has one answer.
      const last = 17 * 60 + ((slot * 7 + index * 3) % 20) * 7 + (slot % 7)
      pairs.push({ from: a.name, to: b.name, last: clock(last), first: clock(8 * 60 + int(next, 0, 11) * 5), every: pick(next, [40, 50, 60, 75]) })
      slot++
    }
  }
  const asked = pairs[(index * 7 + 3) % pairs.length]
  const lines: string[] = [`${BRAND} service bulletin, edition ${200 + index}`, '', 'Boats, weekdays:']
  for (const p of pairs) lines.push(`- ${p.from} to ${p.to}: first boat ${p.first}, then about every ${p.every} minutes.`)
  lines.push('', 'Last departures on Sundays:')
  for (const p of shuffled(next, pairs)) lines.push(`- ${p.from} to ${p.to}: ${p.last}`)
  lines.push('', 'Notices:')
  for (let i = 0; i < 30; i++) lines.push(`- ${VILLAGES[(i + index) % VILLAGES.length].name}: ${NOTICES[(i * 5 + index) % NOTICES.length]} ${sentence(next)}`)
  lines.push('', 'Trails:')
  for (const v of VILLAGES) lines.push(`- From ${v.name}: status is published by the park each morning at 07:30. ${sentence(next)} ${sentence(next)}`)
  const system = [persona(staffById('staff-2')), 'Answer from the bulletin only, in one short sentence. If the bulletin does not say, say so.'].join('\n\n')
  const user = [ref(key), ...lines, '', `Question: on a Sunday, when does the last boat leave ${asked.from} for ${asked.to}?`].join('\n')
  return {
    key,
    fixture: 'short-answer',
    index,
    kind: 'generate',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    budget: FIXTURES['short-answer'].budget,
    expected: `The last boat from ${asked.from} to ${asked.to} on a Sunday leaves at ${asked.last}.`,
    check: (answer) => (typeof answer === 'string' && answer.includes(asked.last) ? [] : [`the answer does not give ${asked.last}`]),
  }
}

// ---------------------------------------------------------------- c: 8K context inspection

const STATUSES = ['published', 'draft', 'scheduled', 'archived'] as const
const TOPICS = ['ferries', 'hiking', 'food', 'wine', 'swimming', 'trains', 'festivals', 'churches', 'lodging', 'winter'] as const
const INVENTORY_SIZE = 104

const INSPECTION_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'village', 'words'],
  properties: {
    slug: { type: 'string', minLength: 3, maxLength: 80 },
    village: { type: 'string', enum: VILLAGES.map((v) => v.name) },
    words: { type: 'integer', minimum: 1, maximum: 5000 },
  },
}

interface InventoryEntry {
  slug: string
  title: string
  angle: string
  village: string
  topic: string
  status: string
  updated: string
  words: number
  summary: string
}

function contextInspection(index: number): BenchCase {
  const key = `context-inspection/${index}`
  const next = rng(seedOf(key))
  const targetVillage = VILLAGES[index % VILLAGES.length].name
  const targetTopic = TOPICS[(index * 3 + 1) % TOPICS.length]
  const entries: InventoryEntry[] = Array.from({ length: INVENTORY_SIZE }, (_, i) => {
    const village = VILLAGES[(i + index) % VILLAGES.length].name
    const topic = TOPICS[(i * 7 + index) % TOPICS.length]
    const words = 400 + ((i * 53 + index * 29) % 1400)
    return {
      slug: '',
      title: '',
      angle: pick(next, ['a morning', 'what it costs', 'the short version', 'after the rain', 'out of season', 'with children']),
      village,
      topic,
      status: pick(next, STATUSES) as string,
      updated: `202${int(next, 3, 6)}-${String(int(next, 1, 12)).padStart(2, '0')}-${String(int(next, 1, 28)).padStart(2, '0')}`,
      words,
      summary: `${sentence(next)} ${sentence(next)}`,
    }
  })
  // The one page the question is about, at a position that moves through the context with the index.
  const at = (index * 37 + 5) % INVENTORY_SIZE
  entries[at].village = targetVillage
  entries[at].topic = targetTopic
  entries[at].status = 'needs_review'
  // Distractors: the same flag on other subjects, and the same subject without the flag.
  let flagged = 0
  let twins = 0
  for (let i = 0; i < entries.length; i++) {
    if (i === at) continue
    const e = entries[i]
    const same = e.village === targetVillage && e.topic === targetTopic
    if (!same && flagged < 6 && i % 13 === 4) {
      e.status = 'needs_review'
      flagged++
    }
    if (same) twins++
  }
  for (let i = 0; twins < 2 && i < entries.length; i++) {
    if (i === at || entries[i].status === 'needs_review') continue
    entries[i].village = targetVillage
    entries[i].topic = targetTopic
    twins++
  }
  // Slugs and titles follow the final subject, so the page asked for looks like any other.
  entries.forEach((e, i) => {
    e.slug = `${e.village.toLowerCase()}-${e.topic}-${String(1000 + i * 9 + index).padStart(4, '0')}`
    e.title = `${e.village}, ${e.topic}: ${e.angle}`
  })
  const target = entries[at]
  const system = [persona(staffById('staff-5')), 'You answer questions about the site inventory. Read the whole inventory before you answer. Copy slugs and numbers exactly.'].join('\n\n')
  const user = [
    ref(key),
    `Site inventory of ${BRAND} (${entries.length} pages):`,
    ...entries.map((e) => `- slug: ${e.slug} | title: ${e.title} | village: ${e.village} | topic: ${e.topic} | status: ${e.status} | updated: ${e.updated} | words: ${e.words} | summary: ${e.summary}`),
    '',
    `Question: exactly one page about ${targetTopic} in ${targetVillage} has the status needs_review. Give its slug, its village and its word count.`,
  ].join('\n')
  return {
    key,
    fixture: 'context-inspection',
    index,
    kind: 'structured',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: INSPECTION_SCHEMA,
    budget: FIXTURES['context-inspection'].budget,
    expected: { slug: target.slug, village: target.village, words: target.words },
    check: (answer) => {
      const a = answer as { slug?: unknown; village?: unknown; words?: unknown }
      const out: string[] = []
      if (a.slug !== target.slug) out.push(`slug is ${JSON.stringify(a.slug)}, the page is ${target.slug}`)
      if (a.village !== target.village) out.push(`village is ${JSON.stringify(a.village)}, the page is in ${target.village}`)
      if (a.words !== target.words) out.push(`words is ${JSON.stringify(a.words)}, the page has ${target.words}`)
      return out
    },
  }
}

// ---------------------------------------------------------------- d: one section

const SECTION_RULES = [
  '## Section format',
  'You write one section of an article and nothing else: no heading, no title, no closing.',
  'Answer with blocks. A block of type "paragraph" or "tip" has its words in "text" and an empty "items" list.',
  'A block of type "list" has its entries in "items" and an empty "text". Use at most one list and at most one tip.',
  'Stay close to the word count you are given. Do not repeat what an earlier section already said.',
].join('\n')

const HEADINGS = ['Getting there', 'What you see first', 'When to go', 'What it costs', 'Where to stand', 'What to leave out', 'If the weather turns', 'Before you leave']

function headingsFor(b: Brief): string[] {
  const next = rng(seedOf(`${b.id}/headings`))
  return shuffled(next, HEADINGS).slice(0, ARTICLE_SECTIONS)
}

function pointsFor(b: Brief, heading: string): string[] {
  const next = rng(seedOf(`${b.id}/${heading}`))
  const facts = shuffled(next, b.village.facts)
  return [facts[0].replace(/\.$/, ''), `${b.theme.noun} during ${b.season}`, `${heading.toLowerCase()}: ${b.angle}`]
}

/** A section a correct model could write: plain paragraphs, one short list, one tip, about `words` words. */
export function expectedSection(seed: string, words: number, topic: string): SectionDraft {
  const next = rng(seedOf(seed))
  const items = [sentence(next), sentence(next), sentence(next)].map((s) => s.replace(/\.$/, ''))
  const tip = `Ask at the ticket office the evening before. ${sentence(next)}`
  const fixed = items.reduce((a, s) => a + wordCount(s), 0) + wordCount(tip)
  const rest = Math.max(30, words - fixed)
  const first = Math.ceil(rest * 0.55)
  return {
    blocks: [
      { type: 'paragraph', text: prose(seedOf(`${seed}/1`), first, topic), items: [] },
      { type: 'list', text: '', items },
      { type: 'paragraph', text: prose(seedOf(`${seed}/2`), rest - first, `${topic}, later in the day`), items: [] },
      { type: 'tip', text: tip, items: [] },
    ],
  }
}

function sectionPrompt(o: { key: string; b: Brief; headings: string[]; n: number; points: string[]; words: number; digests: string[] }): ChatMessage[] {
  const writer = staffById(seedOf(o.b.id) % 2 ? 'staff-2' : 'staff-1')
  const system = [persona(writer), HOUSE_STYLE, SECTION_RULES].join('\n\n')
  const user = [
    ref(o.key),
    briefText(o.b),
    '',
    'Outline:',
    ...o.headings.map((h, i) => `${i + 1}. ${h}`),
    '',
    o.digests.length ? 'Already written:' : 'Nothing is written yet.',
    ...o.digests.map((d) => `- ${d}`),
    '',
    `Write section ${o.n}, "${o.headings[o.n - 1]}", in about ${o.words} words.`,
    'It must cover:',
    ...o.points.map((p) => `- ${p}`),
  ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

const sectionCheck = (id: string, words: number) => (answer: unknown) => checkSection(answer as SectionDraft, { section: id, budgetWords: words }).map((e) => `${e.kind}: ${e.message}`)

function section(index: number): BenchCase {
  const key = `section/${index}`
  const b = brief(100 + index)
  const headings = headingsFor(b)
  const n = 1 + (index % ARTICLE_SECTIONS)
  const digests = headings.slice(0, n - 1).map((h, i) => sectionDigest(h, expectedSection(`${key}/earlier/${i}`, 120, b.village.name)))
  return {
    key,
    fixture: 'section',
    index,
    kind: 'structured',
    messages: sectionPrompt({ key, b, headings, n, points: pointsFor(b, headings[n - 1]), words: SECTION_WORDS, digests }),
    schema: SCHEMAS.section,
    budget: FIXTURES.section.budget,
    expected: expectedSection(key, SECTION_WORDS, b.village.name),
    check: sectionCheck(`s${n}`, SECTION_WORDS),
  }
}

// ---------------------------------------------------------------- e: staged article

const OUTLINE_RULES = [
  '## Outline format',
  `Plan an article of exactly ${ARTICLE_SECTIONS} sections. Give each a heading, two to four points it must cover, and a word count between 180 and 300.`,
  'Choose the hero image and at most two links by their aliases from the lists you are given. Choose the category from the list.',
  'The title is at most 70 characters. The dek is one sentence of 40 to 160 characters.',
].join('\n')

const REVIEW_RULES = [
  '## Review format',
  'You review a draft against the brief and the house style. Decide approve, needs_changes or reject, and score it from 1 to 10.',
  'Name each problem by the section it is in (title, intro, s1 and so on, closing, or whole) and say what would fix it.',
  'List under high_risk anything that names a living person, a price, a legal claim or a safety instruction.',
].join('\n')

const HERO_ABOUT = ['the village from the sea at dusk', 'terraced vineyards above the houses', 'the harbour with boats hauled up', 'the coast path in morning light', 'the station platform by the water', 'the church square in winter']
const LINK_TITLES = ['Riomaggiore', 'Manarola', 'Corniglia', 'Vernazza', 'Monterosso', 'Food and Wine', 'Hiking', 'Getting Around']

export interface ArticlePlan {
  index: number
  brief: Brief
  /** What a correct model could answer at each stage; the scripted backend replies with these. */
  expected: { outline: Outline; sections: SectionDraft[]; closing: Closing; review: Review }
  outline(): BenchCase
  /** `n` is 1-based; `earlier` are the sections already accepted. */
  section(outline: Outline, n: number, earlier: SectionDraft[]): BenchCase
  closing(outline: Outline, sections: SectionDraft[]): BenchCase
  review(outline: Outline, sections: SectionDraft[], closing: Closing): BenchCase
}

function articlePlan(index: number): ArticlePlan {
  const base = `staged-article/${index}`
  const b = brief(200 + index * 3)
  const headings = headingsFor(b)
  const writer = staffById(index % 2 ? 'staff-2' : 'staff-1')
  const outline: Outline = {
    title: `${b.village.name} in ${b.season}: ${b.theme.label}`.slice(0, 70),
    dek: `What ${b.theme.noun} in ${b.village.name} is like during ${b.season}, and ${b.angle}.`.slice(0, 160),
    category: b.theme.category,
    hero: HERO_ALIASES[index % HERO_ALIASES.length],
    sections: headings.map((heading, i) => ({ heading, points: pointsFor(b, heading), words: 200 + ((index + i) % 4) * 20 })),
    closing_title: 'Before you go',
    links: [LINK_ALIASES[index % LINK_ALIASES.length], LINK_ALIASES[(index + 3) % LINK_ALIASES.length]],
  }
  const sections = outline.sections.map((s, i) => expectedSection(`${base}/section-${i + 1}`, s.words, b.village.name))
  const closing: Closing = { content: prose(seedOf(`${base}/closing`), 60, `${b.village.name} on the way out`) }
  const review: Review = {
    decision: 'approve',
    score: 8,
    notes: 'Clear, concrete and inside the brief. One section leans on a number that needs a source.',
    issues: [{ section: 's2', problem: 'The second paragraph gives a duration without saying where it comes from.', fix: 'Name the timetable or remove the figure.' }],
    high_risk: [],
  }
  return {
    index,
    brief: b,
    expected: { outline, sections, closing, review },
    outline: () => ({
      key: `${base}/outline`,
      fixture: 'staged-article',
      index,
      stage: 'outline',
      kind: 'structured',
      messages: [
        { role: 'system', content: [persona(writer), HOUSE_STYLE, OUTLINE_RULES].join('\n\n') },
        {
          role: 'user',
          content: [
            ref(`${base}/outline`),
            briefText(b),
            '',
            'Hero images:',
            ...HERO_ALIASES.map((a, i) => `- ${a}: ${HERO_ABOUT[i % HERO_ABOUT.length]}`),
            '',
            'Links:',
            ...LINK_ALIASES.map((a, i) => `- ${a}: ${LINK_TITLES[i % LINK_TITLES.length]}`),
            '',
            `Categories: ${CATEGORIES.join(', ')}`,
            '',
            `Plan the article: about ${b.targetWords} words in ${ARTICLE_SECTIONS} sections.`,
          ].join('\n'),
        },
      ],
      schema: SCHEMAS.outline,
      budget: STAGE_BUDGETS.outline,
      expected: outline,
      check: (answer) => {
        const n = (answer as Outline).sections?.length
        return n === ARTICLE_SECTIONS ? [] : [`the outline has ${n} sections; ${ARTICLE_SECTIONS} were asked for`]
      },
    }),
    section: (o, n, earlier) => {
      const key = `${base}/section-${n}`
      const s = o.sections[n - 1]
      return {
        key,
        fixture: 'staged-article',
        index,
        stage: `section-${n}`,
        kind: 'structured',
        messages: sectionPrompt({
          key,
          b,
          headings: o.sections.map((x) => x.heading),
          n,
          points: s.points,
          words: s.words,
          digests: earlier.map((d, i) => sectionDigest(o.sections[i].heading, d)),
        }),
        schema: SCHEMAS.section,
        budget: sectionBudget(s.words),
        expected: sections[n - 1] ?? expectedSection(key, s.words, b.village.name),
        check: sectionCheck(`s${n}`, s.words),
      }
    },
    closing: (o, written) => ({
      key: `${base}/closing`,
      fixture: 'staged-article',
      index,
      stage: 'closing',
      kind: 'structured',
      messages: [
        { role: 'system', content: [persona(writer), HOUSE_STYLE, 'You write the closing note of an article: two or three plain sentences a reader can act on. No heading.'].join('\n\n') },
        {
          role: 'user',
          content: [
            ref(`${base}/closing`),
            `Article: ${o.title}`,
            `Closing note title: ${o.closing_title}`,
            '',
            'The sections:',
            ...written.map((d, i) => `- ${sectionDigest(o.sections[i].heading, d)}`),
            '',
            'Write the closing note in about 60 words.',
          ].join('\n'),
        },
      ],
      schema: SCHEMAS.closing,
      budget: STAGE_BUDGETS.closing,
      expected: closing,
      check: (answer) => {
        const text = (answer as Closing).content ?? ''
        const out: string[] = []
        if (/https?:\/\/|\bwww\./i.test(text)) out.push('not_plain_text: the closing contains a URL')
        if (/[<>]/.test(text)) out.push('not_plain_text: the closing contains < or >')
        return out
      },
    }),
    review: (o, written, c) => ({
      key: `${base}/review`,
      fixture: 'staged-article',
      index,
      stage: 'review',
      kind: 'structured',
      messages: [
        { role: 'system', content: [persona(staffById('staff-5')), HOUSE_STYLE, REVIEW_RULES].join('\n\n') },
        { role: 'user', content: [ref(`${base}/review`), briefText(b), '', 'The draft:', '', readingText(o, written, c), '', 'Review the draft.'].join('\n') },
      ],
      schema: SCHEMAS.review,
      budget: STAGE_BUDGETS.review,
      expected: review,
      check: () => [],
    }),
  }
}

// ---------------------------------------------------------------- f: meeting turn and moderator pick

const AGENDA = ['what each writer has in hand', 'what is late and why', 'one pitch for next week', 'what the desk needs from the CEO']
const QUESTIONS = [
  'where is your draft, and what is still missing?',
  'what would you cut if the piece had to be half as long?',
  'what do you need from the photo desk?',
  'which claim in your piece would you least like to be asked about?',
  'what is your pitch for next week, in one sentence?',
]

const moderator = staffById(RUST.moderator.id)
const participants = RUST.participants.map((p) => staffById(p.id))

function transcript(key: string, turns: number, b: Brief): { text: string; spoken: string[] } {
  if (turns === 0) return { text: '(nobody has spoken yet)', spoken: [] }
  const next = rng(seedOf(`${key}/transcript`))
  const spoken: string[] = []
  const lines = Array.from({ length: turns }, (_, i) => {
    const p = participants[(i + turns) % participants.length]
    spoken.push(p.id)
    return `[${i + 1}] ${p.name} (${p.id}): My piece on ${b.theme.label} in ${b.village.name} is ${pick(next, ['half written', 'with the editor', 'waiting on one fact', 'ready to file'])}. ${sentence(next)} ${sentence(next)}`
  })
  return { text: lines.join('\n'), spoken }
}

const MEETING_RULES = ['## Standup', 'Speak as you would in the room: two to four sentences, plain speech, no lists.', 'Say what you have, what you need and when it will be done.'].join('\n')

function meetingTurn(index: number): BenchCase {
  const key = `meeting-turn/${index}`
  const b = brief(300 + index)
  const speaker = participants[index % participants.length]
  const t = transcript(key, index % 5, b)
  const question = QUESTIONS[index % QUESTIONS.length]
  const user = [ref(key), 'Meeting: Daily standup', '', 'Transcript so far:', t.text, '', `${moderator.name} asks you: ${speaker.name}, ${question}`].join('\n')
  const next = rng(seedOf(`${key}/answer`))
  return {
    key,
    fixture: 'meeting-turn',
    index,
    kind: 'generate',
    messages: [
      { role: 'system', content: [persona(speaker), HOUSE_STYLE, MEETING_RULES, `Today you are working on: ${b.title}.`].join('\n\n') },
      { role: 'user', content: user },
    ],
    budget: FIXTURES['meeting-turn'].budget,
    expected: `The piece on ${b.theme.label} in ${b.village.name} is nearly there. ${sentence(next)} I will file it tomorrow before noon.`,
    check: (answer) => (typeof answer === 'string' && answer.trim().length > 0 ? [] : ['the turn is empty']),
  }
}

function moderatorPick(index: number): BenchCase {
  const key = `moderator-pick/${index}`
  const b = brief(400 + index)
  const turns = index % 4
  const t = transcript(key, turns, b)
  const left = 4 - turns
  const roster = participants.map((p) => `- ${p.id} (${p.name}, ${p.title})`).join('\n')
  const system = [
    persona(moderator),
    HOUSE_STYLE,
    ['## Standup', 'You chair the daily standup. You speak last and briefly.', 'Participants:', roster, `Agenda: ${AGENDA[index % AGENDA.length]}; ${AGENDA[(index + 1) % AGENDA.length]}.`, `At most 4 speaking turns. Ask people who have not spoken yet first.`].join('\n'),
  ].join('\n\n')
  const user = [
    ref(key),
    `Meeting: Daily standup (${b.title})`,
    '',
    'Transcript so far:',
    t.text,
    '',
    `${left} speaking turn(s) left. Decide who speaks next and what you ask them, or set done=true if the agenda is covered.`,
  ].join('\n')
  const nextUp = participants.find((p) => !t.spoken.includes(p.id)) ?? participants[index % participants.length]
  const expected: ModeratorDecision = { next: nextUp.id, prompt: `${nextUp.name}, ${QUESTIONS[index % QUESTIONS.length]}`, done: false }
  return {
    key,
    fixture: 'moderator-pick',
    index,
    kind: 'structured',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: SCHEMAS.moderator,
    budget: FIXTURES['moderator-pick'].budget,
    expected,
    check: (answer) => {
      const a = answer as ModeratorDecision
      return !a.done && a.next === '' ? ['done is false and no next speaker is named'] : []
    },
  }
}

// ---------------------------------------------------------------- the suite

const BUILDERS: Record<Exclude<FixtureId, 'staged-article'>, (index: number) => BenchCase> = {
  'short-action': shortAction,
  'short-answer': shortAnswer,
  'context-inspection': contextInspection,
  section,
  'meeting-turn': meetingTurn,
  'moderator-pick': moderatorPick,
}

export interface SuiteOptions {
  /** Share of each fixture's prompts to run, 0 to 1. Validity thresholds need scale 1 (50 prompts). Default 1. */
  scale?: number
  /** Only these fixtures. Default all. */
  only?: FixtureId[]
  /** Force one reasoning mode on every call (the fallback ladder's "thinking off"). */
  thinking?: ThinkingMode
  /** Exact prompt counts per fixture; win over `scale` (capped at the fixture's count). */
  counts?: Partial<Record<FixtureId, number>>
}

/** The frame-time suite: enough generation under the scene for frame and rate samples, about ten minutes on the target. */
export const FRAMES_COUNTS: Partial<Record<FixtureId, number>> = { 'short-action': 10, 'meeting-turn': 10 }

export interface Suite {
  /** Fixtures in the suite with their counts after scaling. */
  fixtures: (FixtureSpec & { count: number })[]
  /** Every prompt of the flat fixtures, in run order. */
  cases: BenchCase[]
  articles: ArticlePlan[]
  /** The answer a correct model could give to the prompt with this key. */
  expected(key: string): unknown
}

/** Prompts of a fixture at a scale: at least one, at most its full count. */
export function scaledCount(spec: FixtureSpec, scale: number): number {
  return Math.max(1, Math.min(spec.count, Math.round(spec.count * scale)))
}

/** Calls of one staged article: outline, the sections, closing, review. */
export const ARTICLE_CALLS = ARTICLE_SECTIONS + 3

export function buildSuite(o: SuiteOptions = {}): Suite {
  const scale = o.scale ?? 1
  if (!(scale > 0 && scale <= 1)) throw new Error(`scale must be in (0, 1], got ${scale}`)
  const counts = o.counts ?? {}
  const only = o.only?.length ? o.only : o.counts ? (Object.keys(counts) as FixtureId[]) : null
  const ids = only ? FIXTURE_IDS.filter((id) => only.includes(id)) : FIXTURE_IDS
  const fixtures = ids.map((id) => {
    const spec = FIXTURES[id]
    const fixed = counts[id]
    return { ...spec, count: fixed !== undefined ? Math.max(1, Math.min(spec.count, Math.floor(fixed))) : scaledCount(spec, scale) }
  })
  const retune = (c: BenchCase): BenchCase => ({ ...c, budget: withThinking(c.budget, o.thinking) })
  const cases: BenchCase[] = []
  const articles: ArticlePlan[] = []
  const expected = new Map<string, unknown>()
  for (const f of fixtures) {
    if (f.id === 'staged-article') {
      for (let i = 0; i < f.count; i++) {
        const plan = articlePlan(i)
        const e = plan.expected
        expected.set(`staged-article/${i}/outline`, e.outline)
        e.sections.forEach((s, n) => expected.set(`staged-article/${i}/section-${n + 1}`, s))
        expected.set(`staged-article/${i}/closing`, e.closing)
        expected.set(`staged-article/${i}/review`, e.review)
        articles.push({
          ...plan,
          outline: () => retune(plan.outline()),
          section: (ol, n, earlier) => retune(plan.section(ol, n, earlier)),
          closing: (ol, s) => retune(plan.closing(ol, s)),
          review: (ol, s, c) => retune(plan.review(ol, s, c)),
        })
      }
      continue
    }
    for (let i = 0; i < f.count; i++) {
      const c = retune(BUILDERS[f.id](i))
      expected.set(c.key, c.expected)
      cases.push(c)
    }
  }
  return { fixtures, cases, articles, expected: (key) => expected.get(key) }
}

/** `a,b` or fixture ids, as written in `?fixtures=`. */
export function parseFixtureList(text: string | null): FixtureId[] | undefined {
  if (!text) return undefined
  const out = new Set<FixtureId>()
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const byLetter = FIXTURE_IDS.filter((id) => FIXTURES[id].letter === part)
    if (byLetter.length) byLetter.forEach((id) => out.add(id))
    else if ((FIXTURE_IDS as string[]).includes(part)) out.add(part as FixtureId)
    else throw new Error(`?fixtures=${part}: unknown fixture (use a to f, or ${FIXTURE_IDS.join(', ')})`)
  }
  return [...out]
}
