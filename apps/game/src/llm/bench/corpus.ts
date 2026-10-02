/**
 * The text the qualification fixtures are built from (ADR-0057, FEAT-037):
 * villages, staff, house rules, topics and a deterministic generator. No
 * network, no clock, no `Math.random`: the same index gives the same prompt
 * on every machine, so two runs measure the same work.
 *
 * The runtime decodes greedily, so a repeated prompt gives a repeated answer.
 * Validity therefore has to be measured over prompts that differ, and the
 * templates below are combined so that each fixture gets at least 50 of them.
 */

/** mulberry32: a small deterministic generator. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a of a string, as a seed. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)]
}

export function int(next: () => number, min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1))
}

/** A deterministic shuffle (Fisher-Yates). */
export function shuffled<T>(next: () => number, items: readonly T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Tokens in a text, estimated: about four characters per token for English
 * prose in a BPE vocabulary. The harness records what the model's tokenizer
 * actually counted next to this estimate, so the error is visible in the report.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

export interface Village {
  id: string
  name: string
  position: string
  facts: string[]
}

export const VILLAGES: Village[] = [
  {
    id: 'riomaggiore',
    name: 'Riomaggiore',
    position: 'the southernmost village, first stop from La Spezia',
    facts: [
      'The main street, Via Colombo, runs over the covered stream the village is named after.',
      'The marina is a steep slipway where boats are hauled up by hand when the sea is rough.',
      'The castle above the station dates from 1260 and is used for exhibitions.',
      'The path toward the sanctuary of Montenero climbs about 340 metres in an hour.',
    ],
  },
  {
    id: 'manarola',
    name: 'Manarola',
    position: 'the second village from the south, on a dark rock spur',
    facts: [
      'The terraces above the village grow the grapes for Sciacchetrà, a sweet wine made from dried grapes.',
      'A single-rail monorail, the trenino, carries crates up the terraces during the harvest.',
      'The nativity scene on the hill of Tre Croci is lit from 8 December to late January.',
      'Swimmers enter the water from the rocks and a ladder below Punta Bonfiglio; there is no beach.',
    ],
  },
  {
    id: 'corniglia',
    name: 'Corniglia',
    position: 'the middle village, on a ridge about 100 metres above the sea',
    facts: [
      'It is the only village without a harbour; the station is at sea level below the ridge.',
      'The Lardarina stairway has 382 steps in 33 flights between the station and the village.',
      'A shuttle bus meets most trains and is included in the park card.',
      'The terrace of Santa Maria looks north to Monterosso and south to Manarola.',
    ],
  },
  {
    id: 'vernazza',
    name: 'Vernazza',
    position: 'the fourth village from the south, around a small natural harbour',
    facts: [
      'The harbour is the only natural landing place of the five villages.',
      'The Doria tower above the harbour was a lookout against raids from the sea.',
      'The church of Santa Margherita is entered from the apse, on the square by the water.',
      'The flood of 25 October 2011 filled the main street with mud to the first floor.',
    ],
  },
  {
    id: 'monterosso',
    name: 'Monterosso',
    position: 'the northernmost and largest village, in two parts joined by a tunnel',
    facts: [
      'Fegina, the newer part, has the only long sandy beach of the five villages.',
      'Salted anchovies from Monterosso are packed in layers in glass jars for at least 40 days.',
      'The Capuchin convent on San Cristoforo hill holds a Crucifixion attributed to Van Dyck.',
      'The lemon festival is held on the third Saturday of May.',
    ],
  },
]

export interface Staff {
  id: string
  name: string
  role: string
  title: string
  voice: string
}

/** The MVP team (`MVP_TEAM` in ../mvp-script.ts); ids match the moderator schema exported from Rust. */
export const STAFF: Staff[] = [
  { id: 'staff-4', name: 'Sophia', role: 'editor-in-chief', title: 'Editor in Chief', voice: 'decisive, brief, protective of the calendar' },
  { id: 'staff-5', name: 'Marco', role: 'editor', title: 'Editor', voice: 'exact, sceptical of superlatives, kind in person' },
  { id: 'staff-1', name: 'Giulia', role: 'writer', title: 'Writer', voice: 'warm, observant, walks everywhere before she writes about it' },
  { id: 'staff-2', name: 'Isabella', role: 'writer', title: 'Writer', voice: 'practical, good with timetables and prices' },
]

export const staffById = (id: string): Staff => {
  const s = STAFF.find((x) => x.id === id)
  if (!s) throw new Error(`unknown staff ${id}`)
  return s
}

export const BRAND = 'Cinque Terre Dispatch'

/** The house rules every staff prompt starts with: the stable prefix of a call. */
export const HOUSE_STYLE = [
  '## House style',
  `You work at ${BRAND}, a small newsroom that covers the five villages of the Cinque Terre for people who are about to visit them.`,
  'Write plain text. No Markdown, no emphasis markers, no links, no web addresses, no HTML.',
  'Write for a reader standing at the station with a bag: say what is there, how long it takes, what it costs and when it is closed.',
  'Prefer a number to an adjective. "382 steps" is better than "a long climb". Give times in the 24-hour clock and prices in euro.',
  'Never use these phrases: hidden gem, must-see, breathtaking, stunning, bucket list, tourist trap, picture-perfect, off the beaten path.',
  'Do not invent opening hours, prices or names. If the brief does not give a fact, leave it out.',
  'One idea per paragraph. Paragraphs of two to four sentences. No rhetorical questions, no exclamation marks.',
  'Spell village names as: Riomaggiore, Manarola, Corniglia, Vernazza, Monterosso. The wine is Sciacchetrà.',
  'Trails close after rain. Never tell a reader a trail is open; tell them where the park publishes the status.',
  'British spelling. Metric units. Dates as 14 September, never 9/14.',
].join('\n')

export function persona(s: Staff): string {
  return [
    `You are ${s.name}, ${s.title} at ${BRAND}.`,
    `Your manner: ${s.voice}.`,
    'You answer for your own work and you say so when you do not know something.',
  ].join('\n')
}

export const THEMES = [
  { id: 'ferries', label: 'ferries', noun: 'the ferry', category: 'Getting Around' },
  { id: 'hiking', label: 'hiking', noun: 'the coast path', category: 'Hiking' },
  { id: 'food', label: 'food', noun: 'the kitchen', category: 'Food & Drink' },
  { id: 'wine', label: 'wine', noun: 'the terraces', category: 'Food & Drink' },
  { id: 'swimming', label: 'swimming', noun: 'the water', category: 'Beaches' },
  { id: 'trains', label: 'trains', noun: 'the railway', category: 'Getting Around' },
  { id: 'festivals', label: 'festivals', noun: 'the feast day', category: 'Culture' },
  { id: 'churches', label: 'churches', noun: 'the parish church', category: 'Culture' },
  { id: 'lodging', label: 'lodging', noun: 'a room for the night', category: 'Seasonal' },
  { id: 'winter', label: 'winter', noun: 'the quiet months', category: 'Seasonal' },
] as const

export const SEASONS = ['early April', 'the second week of May', 'late June', 'the August holiday', 'harvest week in September', 'the first rains of October', 'a weekday in November', 'the week after Epiphany'] as const

export const ANGLES = [
  'what a first-time visitor gets wrong, and the simple fix',
  'how to do it before the day trippers arrive',
  'what it costs, to the euro, for two people',
  'what changes when the sea is rough',
  'the version for someone who cannot manage stairs',
  'what the people who live there do instead',
] as const

export interface Brief {
  id: string
  title: string
  slug: string
  village: Village
  theme: (typeof THEMES)[number]
  season: string
  angle: string
  keywords: string[]
  targetWords: number
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** A distinct brief per index: village, theme, season and angle cycle with co-prime strides. */
export function brief(index: number): Brief {
  const village = VILLAGES[index % VILLAGES.length]
  const theme = THEMES[(index * 3 + Math.floor(index / VILLAGES.length)) % THEMES.length]
  const season = SEASONS[(index * 5 + 1) % SEASONS.length]
  const angle = ANGLES[(index * 7 + 2) % ANGLES.length]
  const title = `${village.name}: ${theme.label} in ${season}`
  return {
    id: `brief-${String(index).padStart(3, '0')}`,
    title,
    slug: slugify(`${village.name} ${theme.label} ${season} ${index}`),
    village,
    theme,
    season,
    angle,
    keywords: [village.name, theme.label, season.split(' ').slice(-1)[0]],
    targetWords: 1200,
  }
}

export function briefText(b: Brief): string {
  return [
    `Brief ${b.id}`,
    `Title: ${b.title}`,
    `Angle: ${b.theme.noun} in ${b.village.name} during ${b.season}: ${b.angle}.`,
    `Keywords: ${b.keywords.join(', ')}`,
    `Village: ${b.village.name}, ${b.village.position}.`,
    'Known facts (use only these):',
    ...b.village.facts.map((f) => `- ${f}`),
  ].join('\n')
}

const SENTENCE_SUBJECTS = ['The first train', 'The afternoon boat', 'The path above the village', 'The square by the church', 'The bakery on the main street', 'The slipway', 'The terrace wall', 'The ticket office', 'The upper road', 'The last bus']
const SENTENCE_VERBS = ['is busiest', 'empties', 'fills with crates', 'is in shade', 'opens', 'gets the sun', 'is quiet', 'smells of woodsmoke', 'is closed to cars', 'is where people wait']
const SENTENCE_TAILS = [
  'before nine in the morning',
  'once the day boats have left',
  'when the wind comes from the south-west',
  'for about forty minutes after each train',
  'from the middle of the afternoon',
  'on the days the trail is closed',
  'while the harvest is on',
  'until the school bus has gone',
  'after the first rain of autumn',
  'on market day',
]

/** One plain sentence, different for each (seed, n). */
export function sentence(next: () => number): string {
  return `${pick(next, SENTENCE_SUBJECTS)} ${pick(next, SENTENCE_VERBS)} ${pick(next, SENTENCE_TAILS)}.`
}

/** Plain prose of about `words` words about `topic`, deterministic in `seed`. */
export function prose(seed: number, words: number, topic: string): string {
  const next = rng(seed)
  const out: string[] = [`In ${topic}, the day has an order that visitors rarely see.`]
  let n = wordCount(out[0])
  while (n < words) {
    const s = sentence(next)
    out.push(s)
    n += wordCount(s)
  }
  return out.join(' ')
}
