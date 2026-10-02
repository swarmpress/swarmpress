// The qualification fixtures (ADR-0057, FEAT-037): counts, distinct and
// deterministic prompts, prompt sizes by the estimator, budgets per the design
// table, and expected answers that the Rust validator and the fixture's own
// checks accept.
import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { validateJson } from 'orchestrator-wasm'
import { rustValidator } from '../../orchestrator/bridge'
import { validateJsonSchema } from '../structured'
import type { Validator } from '../types'
import { ARTICLE_SECTIONS, SCHEMAS, type Closing, type Outline, type SectionDraft } from './article'
import { estimateTokens } from './corpus'
import {
  ARTICLE_CALLS,
  FIXTURES,
  FIXTURE_IDS,
  FRAMES_COUNTS,
  STAGE_BUDGETS,
  buildSuite,
  caseKeyOf,
  estimateCaseTokens,
  parseFixtureList,
  sectionAnswerTokens,
  type BenchCase,
  type Suite,
} from './fixtures'

let rust: Validator

beforeAll(async () => {
  const url = new URL('../../../../../crates/orchestrator-wasm/pkg/orchestrator_wasm_bg.wasm', import.meta.url)
  await init({ module_or_path: await readFile(url) })
  rust = rustValidator(validateJson)
})

/** Every prompt of a suite, the staged article's stages included (built from the expected answers). */
function allCases(s: Suite): BenchCase[] {
  const out = s.cases.slice()
  for (const a of s.articles) {
    const e = a.expected
    out.push(a.outline())
    for (let n = 1; n <= e.outline.sections.length; n++) out.push(a.section(e.outline, n, e.sections.slice(0, n - 1)))
    out.push(a.closing(e.outline, e.sections), a.review(e.outline, e.sections, e.closing))
  }
  return out
}

const userText = (c: BenchCase) => c.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')

describe('the suite at scale 1', () => {
  const suite = buildSuite()
  const cases = allCases(suite)

  it('has every fixture, and at least 50 distinct prompts for each structured one', () => {
    expect(suite.fixtures.map((f) => f.id)).toEqual(FIXTURE_IDS)
    const count = (id: string) => cases.filter((c) => c.fixture === id).length
    expect(count('short-action')).toBe(50)
    expect(count('short-answer')).toBe(30)
    expect(count('context-inspection')).toBe(50)
    expect(count('section')).toBe(50)
    expect(count('meeting-turn')).toBe(20)
    expect(count('moderator-pick')).toBe(50)
    expect(suite.articles).toHaveLength(7)
    expect(count('staged-article')).toBe(7 * ARTICLE_CALLS)
    expect(ARTICLE_CALLS).toBe(ARTICLE_SECTIONS + 3)
    expect(ARTICLE_SECTIONS).toBe(5)
    for (const id of FIXTURE_IDS) {
      const structured = cases.filter((c) => c.fixture === id && c.kind === 'structured').length
      if (FIXTURES[id].kind !== 'generate') expect(structured, id).toBeGreaterThanOrEqual(50)
    }
  })

  it('never repeats a prompt: keys and user messages are unique across the suite', () => {
    const keys = cases.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    const texts = cases.map(userText)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('writes the case key into each prompt, so a backend and a reader can tell which prompt it is', () => {
    for (const c of cases) expect(caseKeyOf(c.messages)).toBe(c.key)
  })

  it('is the same on every build: no clock, no Math.random', () => {
    const again = allCases(buildSuite())
    const strip = (c: BenchCase) => JSON.stringify({ key: c.key, messages: c.messages, schema: c.schema, budget: c.budget, expected: c.expected })
    expect(again.map(strip)).toEqual(cases.map(strip))
  })

  it('sizes each prompt inside its fixture band, by the four-characters-per-token estimate', () => {
    const outside: string[] = []
    for (const c of cases) {
      const [lo, hi] = FIXTURES[c.fixture].inputTokens
      const n = estimateCaseTokens(c)
      if (n < lo || n > hi) outside.push(`${c.key}: ${n} not in [${lo}, ${hi}]`)
    }
    expect(outside).toEqual([])
    // The bands the task names: a is 1 to 2K, b about 2K, c about 8K.
    expect(FIXTURES['short-action'].inputTokens).toEqual([1000, 2000])
    const ctx = cases.filter((c) => c.fixture === 'context-inspection').map(estimateCaseTokens)
    expect(Math.min(...ctx)).toBeGreaterThan(7200)
    expect(Math.max(...ctx)).toBeLessThan(8800)
  })

  it('accepts every expected answer with the Rust validator, the subset validator and the fixture checks', () => {
    const problems: string[] = []
    for (const c of cases) {
      if (c.kind === 'structured') {
        const v = rust(c.expected, c.schema!)
        if (!v.ok) problems.push(`${c.key} (Rust): ${v.errors.join('; ')}`)
        const s = validateJsonSchema(c.expected, c.schema!)
        if (!s.ok) problems.push(`${c.key} (subset): ${s.errors.join('; ')}`)
      } else if (typeof c.expected !== 'string') problems.push(`${c.key}: a free-text case needs a text answer`)
      const errors = c.check(c.expected)
      if (errors.length) problems.push(`${c.key} (check): ${errors.join('; ')}`)
    }
    expect(problems).toEqual([])
  })

  it('uses the Rust stage schemas for the staged article and the moderator', () => {
    const a = suite.articles[0]
    const e = a.expected
    expect(a.outline().schema).toBe(SCHEMAS.outline)
    expect(a.section(e.outline, 1, []).schema).toBe(SCHEMAS.section)
    expect(a.closing(e.outline, e.sections).schema).toBe(SCHEMAS.closing)
    expect(a.review(e.outline, e.sections, e.closing).schema).toBe(SCHEMAS.review)
    expect(cases.find((c) => c.fixture === 'section')!.schema).toBe(SCHEMAS.section)
    expect(cases.find((c) => c.fixture === 'moderator-pick')!.schema).toBe(SCHEMAS.moderator)
  })

  it('declares reasoning and budgets per the design table', () => {
    const budget = (id: string) => cases.find((c) => c.fixture === id)!.budget
    // Moderator pick: 512, thinking off, answer prefix "{".
    expect(budget('moderator-pick')).toEqual({ thinking: 'off', maxTokens: 512, answerPrefix: '{', stopOnJsonEnd: true })
    // Meeting turn: 600, thinking off.
    expect(budget('meeting-turn')).toEqual({ thinking: 'off', maxTokens: 600 })
    // Short action: at most 128 out.
    expect(budget('short-action').maxTokens).toBeLessThanOrEqual(128)
    expect(budget('short-action').thinking).toBe('off')
    // Draft stages: medium, reasoning cap 1500.
    expect(budget('section')).toMatchObject({ thinking: 'medium', reasoningBudget: 1500, maxTokens: sectionAnswerTokens(300) })
    expect(sectionAnswerTokens(300)).toBe(540)
    expect(sectionAnswerTokens(1000)).toBe(1000)
    expect(STAGE_BUDGETS.outline).toMatchObject({ thinking: 'medium', reasoningBudget: 1500, maxTokens: 600 })
    // Review: 4096, medium, cap 2048.
    expect(STAGE_BUDGETS.review).toMatchObject({ thinking: 'medium', reasoningBudget: 2048, maxTokens: 4096 })
    const a = suite.articles[0]
    const e = a.expected
    expect(a.section(e.outline, 2, e.sections.slice(0, 1)).budget.maxTokens).toBe(sectionAnswerTokens(e.outline.sections[1].words))
    // Free-text fixtures have no schema; structured ones stop when the root value is complete.
    for (const c of cases) {
      if (c.kind === 'generate') expect(c.schema).toBeUndefined()
      else expect(c.budget.stopOnJsonEnd).toBe(true)
      // A forced answer prefix only applies with reasoning off.
      if (c.budget.answerPrefix) expect(c.budget.thinking).toBe('off')
    }
  })

  it('asks questions with exactly one right answer in the long contexts', () => {
    for (const c of cases.filter((x) => x.fixture === 'context-inspection')) {
      const e = c.expected as { slug: string; village: string; words: number }
      const q = /exactly one page about (\S+) in (\S+) has the status needs_review/.exec(userText(c))!
      const lines = userText(c)
        .split('\n')
        .filter((l) => l.includes(`village: ${q[2]} |`) && l.includes(`topic: ${q[1]} |`) && l.includes('status: needs_review'))
      expect(lines, c.key).toHaveLength(1)
      expect(lines[0]).toContain(`slug: ${e.slug} |`)
      expect(lines[0]).toContain(`words: ${e.words} |`)
      // Distractors: the subject without the flag, and the flag on other subjects.
      expect(userText(c).split('\n').filter((l) => l.includes(`village: ${q[2]} |`) && l.includes(`topic: ${q[1]} |`)).length, c.key).toBeGreaterThan(1)
      expect(userText(c).match(/status: needs_review/g)!.length, c.key).toBeGreaterThan(1)
    }
    for (const c of cases.filter((x) => x.fixture === 'short-answer')) {
      const time = /(\d\d:\d\d)\.$/.exec(c.expected as string)![1]
      const q = /when does the last boat leave (\S+) for (\S+)\?/.exec(userText(c))!
      const sunday = userText(c).split('Last departures on Sundays:')[1].split('Notices:')[0]
      expect(sunday, c.key).toContain(`- ${q[1]} to ${q[2]}: ${time}`)
      expect(sunday.split(time).length - 1, c.key).toBe(1)
    }
  })

  it('names only items that exist in the short action and gives the oldest one as the expected pick', () => {
    for (const c of cases.filter((x) => x.fixture === 'short-action')) {
      const e = c.expected as { target: string }
      expect(userText(c)).toContain(`- ${e.target} |`)
      expect(c.check({ ...e, target: 'item-999-nope' })).toHaveLength(1)
    }
  })

  it('writes sections of about the asked length, in the flat block shape', () => {
    for (const c of cases.filter((x) => x.fixture === 'section' || x.stage?.startsWith('section'))) {
      const d = c.expected as SectionDraft
      expect(d.blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'paragraph', 'tip'])
    }
  })
})

describe('suite options', () => {
  it('scales every fixture, keeping at least one prompt', () => {
    const s = buildSuite({ scale: 0.1 })
    expect(Object.fromEntries(s.fixtures.map((f) => [f.id, f.count]))).toEqual({
      'short-action': 5,
      'short-answer': 3,
      'context-inspection': 5,
      section: 5,
      'staged-article': 1,
      'meeting-turn': 2,
      'moderator-pick': 5,
    })
    expect(s.cases).toHaveLength(5 + 3 + 5 + 5 + 2 + 5)
    expect(s.articles).toHaveLength(1)
    // The prompts of a smaller run are the first prompts of the full run.
    const full = buildSuite()
    for (const c of s.cases) expect(full.cases.find((x) => x.key === c.key)!.messages).toEqual(c.messages)
    expect(() => buildSuite({ scale: 0 })).toThrow(/scale/)
    expect(() => buildSuite({ scale: 1.5 })).toThrow(/scale/)
  })

  it('runs only the named fixtures, by letter or id', () => {
    expect(parseFixtureList('a,c')).toEqual(['short-action', 'context-inspection'])
    expect(parseFixtureList('f')).toEqual(['meeting-turn', 'moderator-pick'])
    expect(parseFixtureList('section, e')).toEqual(['section', 'staged-article'])
    expect(parseFixtureList(null)).toBeUndefined()
    expect(() => parseFixtureList('z')).toThrow(/unknown fixture/)
    const s = buildSuite({ only: ['moderator-pick'] })
    expect(s.fixtures.map((f) => f.id)).toEqual(['moderator-pick'])
    expect(s.cases.every((c) => c.fixture === 'moderator-pick')).toBe(true)
  })

  it('has a short frame-time suite', () => {
    const s = buildSuite({ counts: FRAMES_COUNTS })
    expect(s.fixtures.map((f) => [f.id, f.count])).toEqual([
      ['short-action', 10],
      ['meeting-turn', 10],
    ])
  })

  it('forces one reasoning mode for the retune step of the fallback ladder', () => {
    const off = allCases(buildSuite({ scale: 0.1, thinking: 'off' }))
    for (const c of off) {
      expect(c.budget.thinking).toBe('off')
      expect(c.budget.reasoningBudget).toBeUndefined()
    }
    const medium = allCases(buildSuite({ scale: 0.1, thinking: 'medium' }))
    for (const c of medium) {
      expect(c.budget.thinking).toBe('medium')
      expect(c.budget.reasoningBudget).toBeGreaterThan(0)
      expect(c.budget.answerPrefix).toBeUndefined()
    }
  })
})

describe('the expected staged article', () => {
  it('fits its own outline: five sections, word budgets in the schema range, aliases from the shortlists', () => {
    for (const a of buildSuite().articles) {
      const o: Outline = a.expected.outline
      expect(o.sections).toHaveLength(ARTICLE_SECTIONS)
      expect(a.expected.sections).toHaveLength(ARTICLE_SECTIONS)
      const c: Closing = a.expected.closing
      expect(c.content.length).toBeGreaterThanOrEqual(40)
      expect(estimateTokens(c.content)).toBeGreaterThan(10)
    }
  })
})
