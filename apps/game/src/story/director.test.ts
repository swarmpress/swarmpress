import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMvpModel, mvpCallFromMessages } from '../llm/mvp-script'
import { bubblesOf, REMARK } from '../ui/bubbles/BubbleLayer'
import { storyContext } from './context'
import {
  CHAPTER_SECONDS,
  chapterPrompt,
  PREFETCH_AT_SECONDS,
  STORY_STATE_KEY,
  StoryDirector,
  storyLineKey,
  validateChapter,
  type Chapter,
  type DirectorDeps,
  type StoryContext,
} from './director'

const CTX: StoryContext = {
  time: 'Tuesday, day 2, 11:20',
  brand: 'Cinque Terre Dispatch',
  people: [
    { id: 'staff-1', name: 'Giulia Rossi', role: 'writer', activity: 'working' },
    { id: 'staff-2', name: 'Marco Bianchi', role: 'editor', activity: 'working' },
    { id: 'staff-3', name: 'Sofia Conti', role: 'strategist', activity: 'in a meeting' },
  ],
  events: ['«Harvest week» is in review'],
  continuity: [],
}

const chapter = (scenes: Chapter['scenes']) => ({ situation: 'A quiet morning.', scenes, continuity: ['the harbour'] })
const line = (speaker: string, to: string | null, text: string) => ({ speaker, to, text })

describe('validateChapter', () => {
  it('keeps scenes of known people, sorted by time', () => {
    const c = validateChapter(
      chapter([
        { id: 'b', at: 300, lines: [line('staff-2', null, 'Coffee, anyone?')] },
        { id: 'a', at: 20, lines: [line('staff-1', 'staff-2', 'Good morning, Marco.'), line('staff-2', 'staff-1', 'Morning!')] },
      ]),
      CTX,
    )
    expect(c.scenes.map((s) => s.id)).toEqual(['a', 'b'])
    expect(c.continuity).toEqual(['the harbour'])
  })

  it('drops scenes with strangers, self-talk, markup or unbacked claims', () => {
    const c = validateChapter(
      chapter([
        { id: 'stranger', at: 10, lines: [line('staff-9', null, 'Hello there.')] },
        { id: 'self', at: 20, lines: [line('staff-1', 'staff-1', 'Talking to myself.')] },
        { id: 'markup', at: 30, lines: [line('staff-1', null, '**Big** news.')] },
        { id: 'claim', at: 40, lines: [line('staff-2', null, 'Harvest week went live this morning!')] },
        { id: 'ok', at: 50, lines: [line('staff-2', null, 'Harvest week reads well so far.')] },
      ]),
      CTX,
    )
    expect(c.scenes.map((s) => s.id)).toEqual(['ok'])
  })

  it('allows production words when an event backs them, and throws when nothing is left', () => {
    const backed = { ...CTX, events: ['«Harvest week» was published'] }
    expect(validateChapter(chapter([{ id: 'x', at: 0, lines: [line('staff-1', null, 'Harvest week is published!')] }]), backed).scenes).toHaveLength(1)
    expect(() => validateChapter(chapter([{ id: 'x', at: 0, lines: [line('staff-7', null, 'Hi.')] }]), CTX)).toThrow(/no playable scene/)
  })
})

describe('the fake model', () => {
  it('answers the chapter prompt with a valid chapter between free people', () => {
    const reply = createMvpModel().answer(mvpCallFromMessages(chapterPrompt(CTX)))
    const c = validateChapter((reply as { json?: unknown }).json, CTX)
    expect(c.scenes.length).toBeGreaterThan(0)
    const speakers = c.scenes.flatMap((s) => s.lines.map((l) => l.speaker))
    expect(speakers).not.toContain('staff-3') // in a meeting
  })
})

describe('storyContext', () => {
  it('lists people on site with their work, and the newest items as events', () => {
    const staff = (id: string, activity: string, workItem: string | null) =>
      ({ id, name: id, role: 'writer', activity, workItem, morale: 700 }) as never
    const ctx = storyContext({
      render: { day: 1, minute: 680, weekday: 'tuesday', staff: [staff('staff-1', 'working', 'work-item-2'), staff('staff-2', 'off-site', null), staff('staff-3', 'in-meeting', null)] },
      plan: {
        items: [
          { id: 'work-item-1', status: 'published', briefRefText: '9' },
          { id: 'work-item-2', status: 'in-progress' },
        ],
      },
      text: { items: { 'work-item-2': { title: 'Trains' } }, briefs: { '9': { title: 'Harvest week' } } },
      brand: 'B',
    })
    expect(ctx.time).toBe('Tuesday, day 2, 11:20')
    expect(ctx.people.map((p) => [p.id, p.activity, p.working_on])).toEqual([
      ['staff-1', 'working', 'Trains'],
      ['staff-3', 'in a meeting', null],
    ])
    expect(ctx.events).toEqual(['«Harvest week» was published', '«Trains» is being worked on'])
  })
})

describe('bubblesOf', () => {
  it('shows remarks as bubbles keyed by their seq', () => {
    const b = bubblesOf({ bubbles: [], meetings: [], remarks: [{ seq: 4, speaker: 'staff-1', listener: null, startedStep: 1, untilStep: 9, chars: 12 }] })
    expect(b).toEqual([{ meeting: REMARK, seq: 4, speaker: 'staff-1', job: null, chars: 12 }])
  })
})

describe('StoryDirector', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function deps(over: Partial<DirectorDeps> = {}) {
    const kv = new Map<string, string>()
    const applied: string[] = []
    let seq = 0
    let asks = 0
    const d: DirectorDeps = {
      ask: async () => {
        asks++
        return chapter([
          { id: `c${asks}a`, at: 0, lines: [line('staff-1', 'staff-2', `Chapter ${asks}, first words.`), line('staff-2', 'staff-1', 'Indeed.')] },
          { id: `c${asks}b`, at: 200, lines: [line('staff-2', null, 'Back to work.')] },
        ])
      },
      context: () => CTX,
      apply: (json) => {
        applied.push(json)
        seq++
        return { ok: true }
      },
      nextRemark: () => seq,
      getKv: async (k) => kv.get(k) ?? null,
      setKv: async (k, v) => void kv.set(k, v),
      running: () => true,
      durationMs: () => 1000,
      ...over,
    }
    return { d, kv, applied, asks: () => asks }
  }

  const advance = async (director: StoryDirector, seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      await director.tick(1)
      await vi.advanceTimersByTimeAsync(1000)
    }
  }

  it('plays a chapter as remarks, with the words in the kv by seq', async () => {
    const { d, kv, applied } = deps()
    const director = new StoryDirector(d)
    await advance(director, 10)
    expect(applied.map((j) => JSON.parse(j))).toEqual([
      { Remark: { speaker: 'staff-1', listener: 'staff-2', seq: 0, chars: 'Chapter 1, first words.'.length } },
      { Remark: { speaker: 'staff-2', listener: 'staff-1', seq: 1, chars: 7 } },
    ])
    expect(kv.get(storyLineKey(0))).toBe('Chapter 1, first words.')
    await advance(director, 200)
    expect(applied).toHaveLength(3)
  })

  it('counts only running time, prefetches, and rolls over to the next chapter', async () => {
    let running = true
    const { d, kv, asks } = deps({ running: () => running })
    const director = new StoryDirector(d)
    await advance(director, PREFETCH_AT_SECONDS - 5)
    expect(asks()).toBe(1)
    running = false
    await advance(director, 1000)
    expect(asks()).toBe(1)
    running = true
    await advance(director, 10)
    expect(asks()).toBe(2)
    await advance(director, CHAPTER_SECONDS - PREFETCH_AT_SECONDS)
    expect([...kv.values()]).toContain('Chapter 2, first words.')
  })

  it('stays quiet when the model fails, and ends a scene the sim refuses', async () => {
    const quiet = deps({ ask: async () => Promise.reject(new Error('down')) })
    await advance(new StoryDirector(quiet.d), 30)
    expect(quiet.applied).toEqual([])

    const refused = deps({ apply: () => ({ ok: false, reason: 'in a meeting' }) })
    const director = new StoryDirector(refused.d)
    await advance(director, 10)
    expect(refused.kv.has(storyLineKey(1))).toBe(false)
  })

  it('remembers played scenes across a reload', async () => {
    const first = deps()
    await advance(new StoryDirector(first.d), 20)
    const saved = first.kv.get(STORY_STATE_KEY)
    expect(saved).toBeTruthy()
    const second = deps({ getKv: async (k) => first.kv.get(k) ?? null })
    await advance(new StoryDirector(second.d), 20)
    expect(second.applied).toEqual([]) // scene a played before the reload, b is due at 200 s
    expect(second.asks()).toBe(0)
  })
})
