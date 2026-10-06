/**
 * The story director (ADR-0074; the GPT-6-Luna migration document, sections
 * 5 and 9 to 12): a rolling chapter of studio life for every ten minutes of
 * active play, written by the hosted model from the studio's state and its
 * recent events, played as remarks (speech bubbles outside meetings).
 *
 * - **Authority:** none. A chapter changes nothing but bubbles: each line is a
 *   logged `ServerCommand::Remark{speaker, listener, seq, chars}` (the sim
 *   checks the speaker is on site and not in a meeting); the words are kept
 *   by `seq` in the company store, never in the sim (rule 2).
 * - **Validation:** speakers and listeners must be people of the context;
 *   lines are short plain text; a line that claims production progress the
 *   events do not show (published, approved, merged) drops its scene.
 * - **Timing:** only running clock time counts. The next chapter is
 *   requested ahead of the boundary; a late chapter leaves the office quiet
 *   (no fake news). Played scenes are remembered across reloads.
 */
import type { ChatMessage, JsonSchema } from '../llm/types'

/** Seconds of running clock one chapter covers. */
export const CHAPTER_SECONDS = 600
/** The next chapter is requested this far into the current one. */
export const PREFETCH_AT_SECONDS = 420
/** The longest line, characters. */
export const MAX_LINE_CHARS = 240
/** Pause after a line before the next (ms), on top of its reading time. */
export const LINE_GAP_MS = 600
/** Running seconds between saves of the director's state. */
export const SAVE_EVERY_SECONDS = 15
/** Lines whose words stay in the kv (older bubbles are long gone). */
export const KEPT_LINES = 200
/** kv key of the director's state. */
export const STORY_STATE_KEY = 'story.state'
/** kv key of a remark's words, by its sim seq. */
export const storyLineKey = (seq: number) => `story.line.${seq}`

export interface StoryPerson {
  id: string
  name: string
  role: string
  /** What they are doing: working, in a meeting, at lunch, walking… */
  activity: string
  /** The title of the work item in their hands, if any. */
  working_on?: string | null
  /** 0..1000 */
  morale?: number
}

export interface StoryContext {
  /** "Day 3, 11:20". */
  time: string
  brand: string
  people: StoryPerson[]
  /** Studio events since the last chapter, newest last: "«Harvest week» was published". */
  events: string[]
  /** What the last chapter left open. */
  continuity: string[]
}

export interface ChapterLine {
  speaker: string
  to: string | null
  text: string
}

export interface Scene {
  id: string
  /** Seconds of running clock into the chapter. */
  at: number
  lines: ChapterLine[]
}

export interface Chapter {
  situation: string
  scenes: Scene[]
  continuity: string[]
}

export const CHAPTER_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['situation', 'scenes', 'continuity'],
  properties: {
    situation: { type: 'string', minLength: 10, maxLength: 400 },
    scenes: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'at', 'lines'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 20 },
          at: { type: 'integer', minimum: 0, maximum: CHAPTER_SECONDS - 30 },
          lines: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['speaker', 'to', 'text'],
              properties: {
                speaker: { type: 'string', minLength: 1, maxLength: 20 },
                to: { type: ['string', 'null'], maxLength: 20 },
                text: { type: 'string', minLength: 2, maxLength: MAX_LINE_CHARS },
              },
            },
          },
        },
      },
    },
    continuity: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 200 } },
  },
}

/** The director's request: stable rules first (cacheable), the changing state last. */
export function chapterPrompt(ctx: StoryContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are the story director of ${ctx.brand}, a small publishing house shown as a living office. You write the next ten minutes of studio life: three to five short scenes of conversation between the people listed, in their roles and moods. Rules:
- Use only the people listed, by their ids; a speaker talks to one listener or to nobody in particular (\`to\`: null).
- People who are in a meeting or away are not in a scene; people who are working may stop for a line or two.
- Talk is about their work, the site, the region, the week, each other: opinions, humour, small tension, kindness.
- Facts about the company come only from the events and the state given. Never claim that an article was published, approved, merged or rejected unless an event says so; never invent numbers.
- Lines are short spoken sentences, plain text, at most ${MAX_LINE_CHARS} characters; no markdown, no stage directions.
- Spread the scenes over the ten minutes (\`at\`: seconds from the chapter's start). End with \`continuity\`: what stays open for the next chapter.
Answer with JSON only.`,
    },
    {
      role: 'user',
      content: `## Task: story chapter\n\n## Now\n${JSON.stringify({ time: ctx.time, people: ctx.people, events: ctx.events, continuity: ctx.continuity }, null, 1)}`,
    },
  ]
}

const CLAIM = /\b(published|went live|is live|approved|merged|rejected)\b/i

/**
 * A chapter as the director may play it: scenes with unknown speakers or
 * listeners, empty or over-long lines, markup, or production claims the
 * events do not support are dropped; scenes are sorted by time. Throws when
 * nothing playable is left.
 */
export function validateChapter(raw: unknown, ctx: StoryContext): Chapter {
  const c = raw as Partial<Chapter>
  const ids = new Set(ctx.people.map((p) => p.id))
  const claimsBacked = ctx.events.some((e) => CLAIM.test(e))
  const scenes: Scene[] = []
  for (const s of Array.isArray(c.scenes) ? c.scenes : []) {
    const lines = Array.isArray(s?.lines) ? s.lines : []
    const ok =
      lines.length > 0 &&
      lines.every(
        (l) =>
          typeof l?.text === 'string' &&
          l.text.trim().length > 1 &&
          l.text.length <= MAX_LINE_CHARS &&
          !/[*#<>`]/.test(l.text) &&
          ids.has(l.speaker) &&
          (l.to == null || (ids.has(l.to) && l.to !== l.speaker)) &&
          (claimsBacked || !CLAIM.test(l.text)),
      )
    if (!ok) continue
    const at = Math.max(0, Math.min(CHAPTER_SECONDS - 30, Math.round(Number(s.at) || 0)))
    scenes.push({ id: String(s.id || `s${scenes.length + 1}`), at, lines: lines.map((l) => ({ speaker: l.speaker, to: l.to ?? null, text: l.text.trim() })) })
  }
  if (!scenes.length) throw new Error('the chapter has no playable scene')
  scenes.sort((a, b) => a.at - b.at)
  return {
    situation: typeof c.situation === 'string' ? c.situation : '',
    scenes,
    continuity: (Array.isArray(c.continuity) ? c.continuity : []).filter((x): x is string => typeof x === 'string').slice(0, 5),
  }
}

/** What survives a reload. */
interface StoryState {
  /** Chapters requested so far. */
  chapters: number
  current: Chapter | null
  /** Running seconds into the current chapter. */
  elapsed: number
  played: string[]
  next: Chapter | null
}

export interface DirectorDeps {
  /** One structured call to the hosted model. */
  ask(messages: ChatMessage[], schema: JsonSchema): Promise<unknown>
  context(): StoryContext | Promise<StoryContext>
  /** Logs a command (the loop's `apply`). */
  apply(json: string): { ok: boolean; reason?: string }
  /** The sim's next remark seq. */
  nextRemark(): number
  getKv(key: string): Promise<string | null>
  setKv(key: string, value: string): Promise<void>
  deleteKv?(key: string): Promise<void>
  /** Whether the clock is running (not paused, not held). */
  running(): boolean
  /** How long a line stays up (wall ms). */
  durationMs(chars: number): number
  log?(line: string): void
}

/**
 * Drives chapters (module docs). `tick(seconds)` is called with the wall
 * seconds since the last tick; only running seconds count.
 */
export class StoryDirector {
  private state: StoryState = { chapters: 0, current: null, elapsed: 0, played: [], next: null }
  private requesting: Promise<void> | null = null
  private playing: Promise<void> | null = null
  private loading: Promise<void> | null = null
  private savedAt = 0

  constructor(private readonly d: DirectorDeps) {}

  private load(): Promise<void> {
    this.loading ??= this.d.getKv(STORY_STATE_KEY).then((raw) => {
      if (!raw) return
      try {
        this.state = { ...this.state, ...(JSON.parse(raw) as StoryState) }
      } catch {
        // a broken record starts the story over
      }
    })
    return this.loading
  }

  private save() {
    return this.d.setKv(STORY_STATE_KEY, JSON.stringify(this.state))
  }

  /** The chapter in play, for tests and the HUD. */
  get chapter(): Chapter | null {
    return this.state.current
  }

  private request(): Promise<void> {
    if (this.requesting) return this.requesting
    let ctx: StoryContext
    this.requesting = Promise.resolve(this.d.context())
      .then((c) => {
        ctx = { ...c, continuity: this.state.current?.continuity ?? c.continuity }
        return this.d.ask(chapterPrompt(ctx), CHAPTER_SCHEMA)
      })
      .then((raw) => {
        this.state.next = validateChapter(raw, ctx)
        this.state.chapters++
        this.d.log?.(`story: chapter ${this.state.chapters} ready (${this.state.next.scenes.length} scenes)`)
        return this.save()
      })
      .catch((e) => this.d.log?.(`story: no chapter (${String(e)}); the office stays quiet`))
      .finally(() => {
        this.requesting = null
      })
    return this.requesting
  }

  async tick(seconds: number): Promise<void> {
    await this.load()
    if (!this.d.running()) return
    if (!this.state.current) {
      // the first chapter: ask, and start it when it arrives
      if (this.state.next) this.startNext()
      else await this.request()
      if (this.state.next && !this.state.current) this.startNext()
      return
    }
    this.state.elapsed += seconds
    if (this.state.elapsed >= PREFETCH_AT_SECONDS && !this.state.next) void this.request()
    if (this.state.elapsed >= CHAPTER_SECONDS) {
      if (this.state.next) this.startNext()
      else this.state.elapsed = CHAPTER_SECONDS // waiting for the next chapter: quiet
    }
    const due = this.state.current?.scenes.find((s) => s.at <= this.state.elapsed && !this.state.played.includes(s.id))
    let changed = false
    if (due && !this.playing) {
      this.state.played.push(due.id)
      changed = true
      this.playing = this.play(due).finally(() => {
        this.playing = null
      })
    }
    if (changed || Math.abs(this.state.elapsed - this.savedAt) >= SAVE_EVERY_SECONDS) {
      this.savedAt = this.state.elapsed
      await this.save()
    }
  }

  private startNext() {
    this.state.current = this.state.next
    this.state.next = null
    this.state.elapsed = 0
    this.state.played = []
    this.savedAt = -SAVE_EVERY_SECONDS // saved at the next tick
  }

  /** Plays a scene line by line; a line the sim refuses (someone left, a meeting began) ends it. */
  private async play(scene: Scene): Promise<void> {
    for (const line of scene.lines) {
      const seq = this.d.nextRemark()
      const cmd = JSON.stringify({ Remark: { speaker: line.speaker, listener: line.to, seq, chars: [...line.text].length } })
      await this.d.setKv(storyLineKey(seq), line.text)
      if (seq >= KEPT_LINES) void this.d.deleteKv?.(storyLineKey(seq - KEPT_LINES)).catch(() => undefined)
      const r = this.d.apply(cmd)
      if (!r.ok) {
        this.d.log?.(`story: scene ${scene.id} ends (${r.reason})`)
        return
      }
      await new Promise((res) => setTimeout(res, this.d.durationMs([...line.text].length) + LINE_GAP_MS))
    }
  }
}
