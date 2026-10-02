import { describe, expect, it } from 'vitest'
import {
  createLabelSlots,
  fallbackWorkLabel,
  LABEL,
  LABEL_FADE_FROM,
  LABEL_FADE_TO,
  labelAlpha,
  labelAt,
  labelSize,
  labelText,
  onWorkLine,
  stackLabels,
  truncate,
} from './label-layout'

const isabella = { id: 'staff-2', name: 'Isabella', role: 'writer', workItem: null as string | null }

describe('label text', () => {
  it('comes from the lookups the scene is given', () => {
    const t = labelText(
      { ...isabella, workItem: 'work-item-3' },
      { staff: (id) => (id === 'staff-2' ? { name: 'Isabella Ferraro', role: 'senior-writer' } : undefined), workItem: (id) => (id === 'work-item-3' ? 'Harvest week in Manarola' : undefined) },
    )
    expect(t).toEqual({ name: 'Isabella Ferraro', role: 'senior writer', work: 'Harvest week in Manarola' })
  })

  it("falls back to the sim's name and role, and to the work item's id", () => {
    expect(labelText(isabella, undefined)).toEqual({ name: 'Isabella', role: 'writer', work: null })
    expect(labelText({ ...isabella, workItem: 'work-item-3' }, { workItem: () => undefined })).toEqual({ name: 'Isabella', role: 'writer', work: 'Work item 3' })
    expect(labelText({ ...isabella, workItem: 'work-item-3' }, { workItem: () => '   ' }).work).toBe('Work item 3')
    expect(fallbackWorkLabel('work-item-12')).toBe('Work item 12')
  })

  it('has no work line without a work item, whatever the lookup says', () => {
    expect(labelText(isabella, { workItem: () => 'Something' }).work).toBeNull()
  })

  it('leaves the role out when asked (zoomed out)', () => {
    expect(labelText(isabella, undefined, false).role).toBe('')
  })

  it('shortens long texts at a word', () => {
    expect(truncate('Harvest week in Manarola: the grape pickers of the terraces', 30)).toBe('Harvest week in Manarola:…')
    expect(truncate('Supercalifragilisticexpialidocious', 10)).toBe('Supercali…')
    expect(truncate('  short  text ', 30)).toBe('short text')
  })
})

describe('label fade', () => {
  it('depends on the zoom only: full near, gone far', () => {
    expect(labelAlpha(5)).toBe(1)
    expect(labelAlpha(LABEL_FADE_FROM)).toBe(1)
    expect(labelAlpha((LABEL_FADE_FROM + LABEL_FADE_TO) / 2)).toBeCloseTo(0.5)
    expect(labelAlpha(LABEL_FADE_TO)).toBe(0)
    expect(labelAlpha(40)).toBe(0)
  })
})

describe('label placement', () => {
  const slots = (labels: Array<[x: number, y: number, w: number, h: number]>) => {
    const s = createLabelSlots(labels.length + 2)
    labels.forEach(([x, y, w, h], i) => {
      s.ax[i] = x
      s.ay[i] = y
      s.w[i] = w
      s.h[i] = h
      s.visible[i] = 1
    })
    return s
  }
  const overlap = (s: ReturnType<typeof slots>, i: number, j: number) =>
    Math.abs(s.ax[i] - s.ax[j]) < (s.w[i] + s.w[j]) / 2 && s.y[i] < s.y[j] + s.h[j] && s.y[j] < s.y[i] + s.h[i]

  it('keeps separate labels where they are', () => {
    const s = slots([
      [0, 0, 80, 16],
      [200, 0, 80, 16],
    ])
    stackLabels(s)
    expect([s.y[0], s.y[1]]).toEqual([0, 0])
  })

  it('stacks overlapping labels upwards so none overlap, the lower one keeping its place', () => {
    const s = slots([
      [0, 10, 80, 16],
      [20, 0, 80, 28],
      [-30, 5, 90, 16],
      [400, 0, 60, 16],
    ])
    stackLabels(s)
    expect(s.y[1]).toBe(0)
    expect(s.y[3]).toBe(0)
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(overlap(s, i, j), `${i}/${j}`).toBe(false)
  })

  it('is deterministic for the same input', () => {
    const input: Array<[number, number, number, number]> = Array.from({ length: 12 }, (_, i) => [((i * 37) % 90) - 45, (i * 13) % 20, 70 + (i % 3) * 10, i % 2 ? 28 : 16])
    const a = slots(input)
    const b = slots(input)
    stackLabels(a)
    stackLabels(b)
    expect(Array.from(a.y)).toEqual(Array.from(b.y))
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) expect(overlap(a, i, j)).toBe(false)
  })

  it('finds the label under a point, and tells the work line from the name line', () => {
    const s = slots([[100, 50, 80, 28]])
    stackLabels(s)
    expect(labelAt(s, 100, 60)).toBe(0)
    expect(labelAt(s, 100, 90)).toBe(-1)
    expect(labelAt(s, 150, 60)).toBe(-1)
    const t = { name: 'Isabella', role: '', work: 'Harvest week' }
    expect(onWorkLine(t, 4)).toBe(true)
    expect(onWorkLine(t, 20)).toBe(false)
    expect(onWorkLine({ ...t, work: null }, 4)).toBe(false)
  })

  it('sizes a label in even whole pixels, taller with a work line', () => {
    const a = labelSize(51.3, 0, null)
    expect(a.w % 2).toBe(0)
    expect(a.h).toBe(LABEL.line)
    const b = labelSize(40, 30, 140)
    expect(b.h).toBe(LABEL.line + LABEL.workLine)
    expect(b.w).toBeGreaterThanOrEqual(140)
    expect(labelSize(400, 0, null).w).toBeLessThanOrEqual(LABEL.maxWidth + 1)
  })
})
