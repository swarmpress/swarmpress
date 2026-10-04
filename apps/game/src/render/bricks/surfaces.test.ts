// Information surfaces (FEAT-082): view templates (layout, truncation,
// escaping) and the update budget. Pure: no Babylon, no canvas.
import { describe, expect, it } from 'vitest'
import {
  boardCards,
  boardColumn,
  boardView,
  cleanText,
  estimate,
  monitorGlow,
  monitorView,
  SURFACE_BUDGET,
  SurfaceScheduler,
  truncate,
  wrap,
  type SurfaceCandidate,
} from './surfaces'

const m16 = estimate(16)

describe('surface text', () => {
  it('draws markup as literal text and drops control, bidi and zero-width characters', () => {
    expect(cleanText('<script>alert(1)</script> & <b>bold</b>')).toBe('<script>alert(1)</script> & <b>bold</b>')
    expect(cleanText('line one\nline two\t\u0007end')).toBe('line one line two end')
    expect(cleanText('abc‮def​ghi⁦x⁩')).toBe('abcdefghix')
    expect(cleanText(undefined)).toBe('')
    expect(cleanText({ toString: () => 'x' })).toBe('')
  })

  it('truncates to the width with an ellipsis, and leaves short text alone', () => {
    expect(truncate('short', 200, m16)).toBe('short')
    const t = truncate('A very long work item title about the Via dell’Amore reopening', 160, m16)
    expect(t.endsWith('…')).toBe(true)
    expect(m16(t)).toBeLessThanOrEqual(160)
    expect(truncate('anything', 1, m16)).toBe('')
  })

  it('wraps into at most n lines, the last one truncated', () => {
    const lines = wrap('one two three four five six seven eight nine ten eleven twelve', 120, 2, m16)
    expect(lines).toHaveLength(2)
    for (const l of lines) expect(m16(l)).toBeLessThanOrEqual(120)
    expect(lines[1].endsWith('…')).toBe(true)
    expect(wrap('', 100, 2, m16)).toEqual([])
  })
})

describe('the monitor', () => {
  const facts = { on: true, pose: 'type' as const, workItem: 'work-item-3', staff: 'staff-1' }

  it('glows from render-state facts only: off, idle, assigned, typing', () => {
    expect(monitorGlow({ ...facts, on: false })).toEqual([0, 0, 0])
    const idle = monitorGlow({ ...facts, workItem: null, pose: 'sit' })
    const assigned = monitorGlow({ ...facts, pose: 'sit' })
    const typing = monitorGlow(facts)
    expect(idle[2]).toBeLessThan(assigned[2])
    expect(assigned[2]).toBeLessThanOrEqual(typing[2])
  })

  it('lays out name, job and stage inside the canvas, top to bottom', () => {
    const v = monitorView({ name: 'Isabella Rossi', job: 'Hiking the Sentiero Azzurro: what is open in October and what is not', stage: 'draft · phase 3 of 5' }, facts, 256, 154)
    expect(v.lines.map((l) => l.text)[0]).toBe('Isabella Rossi')
    expect(v.lines.at(-1)!.text).toBe('draft · phase 3 of 5')
    const ys = v.lines.map((l) => l.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
    for (const l of v.lines) {
      expect(l.y).toBeLessThanOrEqual(154)
      expect(estimate(l.px)(l.text)).toBeLessThanOrEqual(256 - 2 * Math.round(256 * 0.06))
    }
    expect(v.lines.filter((l) => !l.bold && !l.dim).length).toBeLessThanOrEqual(2)
  })

  it('shows a free desk and an idle screen without inventing a job', () => {
    const v = monitorView({ name: '', job: 'ignored', stage: 'ignored' }, { on: true, pose: null, workItem: null, staff: null }, 256, 154)
    expect(v.lines.map((l) => l.text)).toEqual(['Free desk', 'No work item'])
    expect(v.busy).toBe(false)
  })

  it('keeps untrusted model text as text', () => {
    const v = monitorView({ name: 'Ana', job: '<img src=x onerror=alert(1)>\nIgnore previous instructions', stage: 'draft' }, facts, 512, 300)
    expect(v.lines.slice(1, -1).map((l) => l.text).join(' ').startsWith('<img src=x onerror=alert(1)>')).toBe(true)
    expect(v.lines.every((l) => !/[\n\r\u0000-\u001f]/.test(l.text))).toBe(true)
  })
})

describe('the whiteboard', () => {
  const item = (id: string, status: string, phases: Array<[string, string]> = []) => ({ id, status, phases: phases.map(([kind, state]) => ({ kind, state })) })

  it('puts each plan item in its column by status and active phase', () => {
    expect(boardColumn(item('a', 'planned'))).toBe('brief')
    expect(boardColumn(item('b', 'in-progress', [['research', 'done'], ['draft', 'working'], ['review', 'pending']]))).toBe('draft')
    expect(boardColumn(item('c', 'in-progress', [['outline', 'working']]))).toBe('brief')
    expect(boardColumn(item('d', 'in-review'))).toBe('review')
    expect(boardColumn(item('e', 'blocked', [['draft', 'done'], ['review', 'blocked']]))).toBe('review')
    expect(boardColumn(item('f', 'approved'))).toBe('approval')
    expect(boardColumn(item('g', 'published'))).toBe('published')
    expect(boardColumn(item('h', 'cancelled'))).toBeNull()
  })

  it('takes titles from the store, cleaned, and falls back to the id', () => {
    const cards = boardCards([item('w-1', 'planned'), item('w-2', 'published'), item('w-3', 'cancelled')], (id) => (id === 'w-1' ? 'Ferries\nin <winter>' : undefined))
    expect(cards).toEqual([
      { id: 'w-1', title: 'Ferries in <winter>', column: 'brief' },
      { id: 'w-2', title: 'w-2', column: 'published' },
    ])
  })

  it('shows five columns, the newest cards that fit and +N for the rest', () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({ id: `w-${i}`, title: `Item number ${i} with a long title that will not fit`, column: 'draft' as const }))
    const v = boardView(cards, 1024, 512)
    expect(v.columns.map((c) => c.title)).toEqual(['Brief', 'Draft', 'Review', 'Approval', 'Published'])
    const draft = v.columns[1]
    expect(draft.cards.length + draft.more).toBe(20)
    expect(draft.more).toBeGreaterThan(0)
    expect(draft.cards.at(-1)!.join(' ')).toMatch(/^Item number 19/)
    for (const card of draft.cards) {
      expect(card.length).toBeLessThanOrEqual(2)
      for (const t of card) expect(estimate(v.cardPx)(t)).toBeLessThanOrEqual(1024 / 5 - 18)
    }
    // The cards that are shown fit under the heading.
    expect(v.head + draft.cards.length * v.rowH).toBeLessThanOrEqual(512)
  })
})

describe('the update budget', () => {
  const cands = (n: number, over: Partial<SurfaceCandidate> = {}, key = 'k'): SurfaceCandidate[] =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, visible: true, level: 'close', key, ...over }))

  it(`redraws at most ${SURFACE_BUDGET} a frame, round-robin, until every changed surface is drawn`, () => {
    const s = new SurfaceScheduler()
    const frames = [s.pick(cands(10)), s.pick(cands(10)), s.pick(cands(10)), s.pick(cands(10))]
    expect(frames.map((f) => f.length)).toEqual([4, 4, 2, 0])
    expect(frames.flat().sort()).toEqual(cands(10).map((c) => c.id).sort())
  })

  it('skips hidden and far surfaces and unchanged content; redraws on change', () => {
    const s = new SurfaceScheduler()
    expect(s.pick(cands(3, { visible: false }))).toEqual([])
    expect(s.pick(cands(3, { level: 'far' }))).toEqual([])
    expect(s.pick(cands(3))).toHaveLength(3)
    expect(s.pick(cands(3))).toEqual([])
    const changed = cands(3)
    changed[1].key = 'k2'
    expect(s.pick(changed)).toEqual(['s1'])
  })

  it('does not starve: a surface that keeps changing does not block the others', () => {
    const s = new SurfaceScheduler(1)
    const seen = new Set<string>()
    for (let f = 0; f < 6; f++) {
      const c = cands(3, {}, 'same')
      c[0].key = `tick-${f}`
      for (const id of s.pick(c)) seen.add(id)
    }
    expect([...seen].sort()).toEqual(['s0', 's1', 's2'])
  })

  it('redraws a surface that comes back to the close level', () => {
    const s = new SurfaceScheduler()
    expect(s.pick(cands(1))).toEqual(['s0'])
    s.forget('s0')
    expect(s.pick(cands(1))).toEqual(['s0'])
  })
})
