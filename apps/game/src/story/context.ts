/**
 * The story director's view of the studio (ADR-0074): who is on site and
 * what they do (the render state), and what the plan shows (the sim's plan
 * view plus the store's titles). Facts only; the director may not go beyond
 * them.
 */
import type { RenderState } from '../state/render-state'
import type { StoryContext, StoryPerson } from './director'

const WEEKDAY = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

const ACTIVITY: Record<string, string> = {
  arriving: 'arriving',
  working: 'working',
  'walking-to-meeting': 'in a meeting',
  'in-meeting': 'in a meeting',
  'walking-to-lunch': 'at lunch',
  lunch: 'at lunch',
  'returning-to-desk': 'back from lunch',
  leaving: 'leaving for the day',
}

const STATUS: Record<string, string> = {
  backlog: 'is in the backlog',
  planned: 'is planned',
  'in-progress': 'is being worked on',
  'in-review': 'is in review',
  approved: 'waits for the CEO',
  scheduled: 'is scheduled',
  published: 'was published',
  blocked: 'is blocked',
  cancelled: 'was dropped',
}

interface PlanView {
  items?: { id: string; status: string; briefRefText?: string | null; owner?: string | null }[]
}

interface PlanText {
  items?: Record<string, { title?: string }>
  briefs?: Record<string, { title?: string }>
}

/** The newest plan items the events list names. */
export const STORY_EVENTS = 8

export function storyContext(input: {
  render: Pick<RenderState, 'day' | 'minute' | 'weekday' | 'staff'>
  plan: PlanView
  text: PlanText
  brand: string
}): StoryContext {
  const { render, plan, text } = input
  const title = (it: { id: string; briefRefText?: string | null }) =>
    text.items?.[it.id]?.title || (it.briefRefText ? text.briefs?.[it.briefRefText]?.title : '') || ''
  const items = [...(plan.items ?? [])].sort((a, b) => Number(b.id.replace(/\D/g, '')) - Number(a.id.replace(/\D/g, '')))
  const people: StoryPerson[] = render.staff
    .filter((s) => s.activity !== 'off-site')
    .map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      activity: ACTIVITY[s.activity] ?? s.activity,
      working_on: s.workItem ? title(items.find((i) => i.id === s.workItem) ?? { id: s.workItem }) || null : null,
      morale: s.morale,
    }))
  const events = items
    .slice(0, STORY_EVENTS)
    .map((it) => {
      const t = title(it)
      return t ? `«${t}» ${STATUS[it.status] ?? `is ${it.status}`}` : ''
    })
    .filter(Boolean)
    .reverse()
  const hh = String(Math.floor(render.minute / 60)).padStart(2, '0')
  const mm = String(render.minute % 60).padStart(2, '0')
  return { time: `${WEEKDAY(render.weekday)}, day ${render.day + 1}, ${hh}:${mm}`, brand: input.brand, people, events, continuity: [] }
}
