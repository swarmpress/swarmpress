import { describe, expect, it } from 'vitest'
import { expectedSeq, localDate, minutesPerArticle, notSeatedYet, standupContext, turnOf, utteranceMs } from './speech'

describe('meeting speech (ADR-0062, FEAT-025)', () => {
  it('a turn holds the floor for clamp(chars / 15, 3, 12) seconds, divided by the clock speed', () => {
    expect(utteranceMs(15)).toBe(3000)
    expect(utteranceMs(90)).toBe(6000)
    expect(utteranceMs(1000)).toBe(12_000)
    expect(utteranceMs(90, 10)).toBe(600)
    expect(utteranceMs(90, 0)).toBe(6000)
  })

  it('reads turn events and the sim’s rejections', () => {
    const ev = { job_id: 4, stage: 'turn', detail: { seq: 2, speaker: 'staff-1', chars: 77, meeting: 'meeting-3' } }
    expect(turnOf(ev, null)).toEqual({ job: 4, meeting: 'meeting-3', seq: 2, speaker: 'staff-1', chars: 77 })
    expect(turnOf({ ...ev, detail: { ...ev.detail, meeting: null } }, 'meeting-9')?.meeting).toBe('meeting-9')
    expect(turnOf({ ...ev, stage: 'pitch' }, 'm')).toBeNull()
    expect(turnOf({ ...ev, detail: { ...ev.detail, chars: 0 } }, 'm')).toBeNull()
    expect(expectedSeq('out of order: expected seq 3, got 1')).toBe(3)
    expect(expectedSeq('speaker is not seated in the meeting')).toBeNull()
    expect(notSeatedYet('invalid: speaker is not seated in the meeting')).toBe(true)
  })

  it('builds a standup’s context from the plan view, the titles and the activity record', () => {
    const plan = JSON.stringify({
      items: [
        { id: 'work-item-1', project: 'project-1', status: 'in-review' },
        { id: 'work-item-2', project: 'project-1', status: 'published' },
        { id: 'work-item-3', project: 'project-2', status: 'in-progress' },
      ],
      wip: [{ project: 'project-1', limit: 3, open: 1, room: 2, awaitingApproval: 0, freeWriters: ['staff-2'] }],
    })
    const rows = [
      { stage: 'job', kind: 'draft', result: 'done', wall_ms: 6 * 60_000 },
      { stage: 'job', kind: 'draft', result: 'done', wall_ms: 8 * 60_000 },
      { stage: 'job', kind: 'review', result: 'done', wall_ms: 60_000 },
      { stage: 'section', kind: 'draft', result: 'done', wall_ms: 999_999 },
    ]
    expect(minutesPerArticle(rows)).toBe(8)
    expect(minutesPerArticle([])).toBeNull()
    const ctx = standupContext(plan, 'project-1', { now: new Date(2026, 9, 3, 9), titles: { 'work-item-1': 'Harvest week in Manarola' }, minutesPerArticle: 8 })
    expect(ctx).toEqual({
      today: '2026-10-03',
      wip: { limit: 3, open: 1, room: 2, awaiting_approval: 0, free_writers: ['staff-2'] },
      in_flight: [{ id: 'work-item-1', status: 'in-review', title: 'Harvest week in Manarola' }],
      minutes_per_article: 8,
    })
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
