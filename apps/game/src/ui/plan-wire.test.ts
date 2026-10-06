import { describe, expect, it } from 'vitest'
import wire from './fixtures/plan-wire.json'
import { normalizePlanText, normalizePost, splitPlanJson, statusFromThread, toStorePost, withBoardText, withTextOnlyItems, type PlanTextWire } from './plan-wire'
import type { PlanJson, PlanText, WorkItemJson } from './plan-types'
import { latestBoard } from './plan-logic'

/**
 * The orchestrator's `Store::plan_json` shape (crates/orchestrator/src/store.rs,
 * post types minutes/artifact/handoff/review/status with `payload`) is what
 * the live `plan_json` will return; the overlay must render it unchanged.
 */
describe('plan_json wire shape (orchestrator)', () => {
  const text = normalizePlanText(wire as PlanTextWire)
  const posts = text.posts['work-item-21']

  it('keeps titles, briefs and post order', () => {
    expect(text.items['work-item-21'].title).toBe("Via dell'Amore reopening: what changed")
    expect(posts.map((p) => p.type)).toEqual(['minutes', 'artifact', 'handoff', 'review', 'artifact', 'status'])
    expect(posts.map((p) => p.id)).toEqual(['post-1', 'post-2', 'post-3', 'post-4', 'post-5', 'post-6'])
  })

  it('lifts payload fields into the UI post', () => {
    const [minutes, pr, handoff, review, merged] = posts
    expect(minutes.meeting).toBe("Standup · Via dell'Amore reopening: what changed")
    expect(minutes.attendees).toEqual(['staff-5', 'staff-1', 'staff-6'])
    // The pull request number and the merged sha are kept for the links (links.ts).
    expect(pr.artifact).toEqual({ label: 'draft/work-item-21', path: 'content/pages/en/via-dell-amore.json', pr: 12 })
    expect(handoff.to).toBe('staff-5')
    expect(review).toMatchObject({ verdict: 'approve', score: 8 })
    expect(merged.artifact).toEqual({ label: 'commit 4be81c2', pr: 12, commit: '4be81c2d9a01' })
    // No game time on orchestrator posts yet.
    expect(minutes.day).toBeUndefined()
  })

  it('passes UI-shaped posts through and synthesizes missing ids', () => {
    const t = normalizePlanText({ posts: { x: [{ type: 'comment', author: 'ceo', text: 'hi', day: 3, minute: 60 }] } })
    expect(t.posts.x[0]).toMatchObject({ id: 'x-post-1', type: 'comment', day: 3, minute: 60 })
    expect(normalizePlanText(null)).toEqual({ items: {}, todos: {}, workstreams: {}, goals: {}, posts: {} })
  })

  it('files a CEO comment under a store post type and reads it back as a comment', () => {
    const wire = toStorePost({ type: 'comment', author: 'ceo', day: 3, minute: 610, text: 'Add the festival dates' })
    // The CompanyStore's post API accepts the orchestrator's types only.
    expect(wire).toEqual({ type: 'status', author: 'ceo', day: 3, minute: 610, text: 'Add the festival dates', payload: { ui_type: 'comment' } })
    const back = normalizePost({ ...wire, id: 'post-9' }, 'work-item-1', 0)
    expect(back).toEqual({ id: 'post-9', type: 'comment', author: 'ceo', day: 3, minute: 610, text: 'Add the festival dates' })
    // A comment never moves an item's status, whatever it says.
    expect(statusFromThread([back, { ...back, text: 'published? blocked?' }])).toBe('planned')
    // A real status post, and a payload that names no UI post type, stay what they are.
    expect(normalizePost({ type: 'status', author: 'system', text: 'Deployed.', payload: {} }, 'x', 0).type).toBe('status')
    expect(normalizePost({ type: 'status', author: 'system', text: 's', payload: { ui_type: 'gossip' } }, 'x', 0).type).toBe('status')
  })

  it('tells the skeleton from the text document', () => {
    expect(splitPlanJson(wire).text?.items['work-item-22'].title).toBe('Monterosso lemon festival')
    expect(splitPlanJson(wire).skeleton).toBeNull()
    const sk = splitPlanJson({ items: [{ id: 'work-item-1' }] })
    expect(sk.skeleton?.items).toHaveLength(1)
    expect(sk.skeleton?.goals).toEqual([])
    expect(sk.text).toBeNull()
  })

  it('derives the status of text-only items from their thread', () => {
    expect(statusFromThread(posts)).toBe('published')
    expect(statusFromThread(posts.slice(0, 1))).toBe('in-progress')
    expect(statusFromThread(posts.slice(0, 3))).toBe('in-review')
    expect(statusFromThread(posts.slice(0, 4))).toBe('approved')
    expect(statusFromThread(text.posts['work-item-22'])).toBe('blocked')
  })

  it('joins text-only items onto the skeleton', () => {
    const plan = withTextOnlyItems({ goals: [], workstreams: [], items: [] }, text, 'project-1')
    expect(plan.items.map((i) => [i.id, i.status, i.owner, i.textOnly])).toEqual([
      ['work-item-21', 'published', 'staff-5', true],
      ['work-item-22', 'blocked', null, true],
    ])
  })
})

describe('the editorial board’s plan text (ADR-0069, FEAT-087)', () => {
  const item = (id: string, briefRefText: string | null, extra: Partial<WorkItemJson> = {}): WorkItemJson => ({
    id,
    project: 'project-1',
    workstream: 'workstream-1',
    kind: 'article',
    status: 'planned',
    priority: 'normal',
    owner: 'staff-5',
    phases: [],
    todos: [],
    dependsOn: [],
    dueDay: 5,
    publishDay: 6,
    tickets: [],
    briefRefText,
    unstarted: true,
    ...extra,
  })
  const plan: PlanJson = {
    goals: [{ id: 'goal-project-1', metric: 'monthly-readers', target: 1000, current: 120 }],
    workstreams: [{ id: 'workstream-1', project: 'project-1', status: 'active', textRef: '8361854316634078731' }],
    items: [item('work-item-4', '5861808041880732776'), item('work-item-5', '7', { unstarted: false, status: 'in-progress' })],
  }
  const text: PlanText = {
    items: {
      'brief:5861808041880732776': { title: 'The Grape Harvest in Manarola', brief: 'A seasonal guide.' },
      'brief:7': { title: 'Vernazza harbour at first light', brief: '…' },
      'work-item-5': { title: 'Vernazza at dawn (as drafted)', brief: '…' },
      'workstream:8361854316634078731': { title: 'Fall', brief: '' },
    },
    todos: {},
    workstreams: {},
    goals: {},
    posts: {},
  }

  it('names an item by its brief until it has text of its own, a workstream and the goal by theirs', () => {
    const joined = withBoardText(plan, text)
    expect(joined.items['work-item-4'].title).toBe('The Grape Harvest in Manarola')
    expect(joined.items['work-item-5'].title).toBe('Vernazza at dawn (as drafted)')
    expect(joined.workstreams['workstream-1'].title).toBe('Fall')
    expect(joined.goals['goal-project-1'].title).toBe('Monthly readers')
    // nothing to join: the same object
    const bare: PlanJson = { goals: [], workstreams: [], items: [] }
    expect(withBoardText(bare, text)).toBe(text)
  })

  it('reads the newest board’s theme and big bets from its minutes', () => {
    expect(latestBoard(text)).toBeNull()
    const minutes = (day: number, theme: string, bets: string[]) => ({
      id: `post-${day}`,
      item: 'meeting-7',
      type: 'minutes' as const,
      author: 'staff-9',
      text: `Theme of the week: ${theme}`,
      day,
      minute: 600,
      payload: { week_theme: theme, big_bets: bets },
    })
    const withBoards: PlanText = { ...text, posts: { 'meeting-7': [minutes(0, 'Harvest first', ['A wine series']) as never], 'meeting-9': [minutes(7, 'Storm season', []) as never] } }
    expect(latestBoard(withBoards)).toEqual({ theme: 'Storm season', bigBets: [], item: 'meeting-9' })
    withBoards.posts['meeting-9'] = []
    expect(latestBoard(withBoards)).toEqual({ theme: 'Harvest first', bigBets: ['A wine series'], item: 'meeting-7' })
  })

  it('never shows the board’s brief and workstream keys as items of their own', () => {
    const joined = withTextOnlyItems({ goals: [], workstreams: [], items: [] }, text, 'project-1')
    expect(joined.items.map((i) => i.id)).toEqual(['work-item-5'])
  })
})

