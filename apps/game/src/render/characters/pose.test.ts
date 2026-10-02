import { describe, expect, it, vi } from 'vitest'
import type { BuildingLayout, RenderState, StaffRender } from '../../state/render-state'
import { POSES } from '../../state/render-state-shape'
import layoutJson from '../../state/fixtures/demo-layout.json'
import lunchJson from '../../state/fixtures/demo-lunch.json'
import standupJson from '../../state/fixtures/demo-standup.json'
import workingJson from '../../state/fixtures/demo-working.json'
import { emptyMotion, emptyPoseView, knownPose, layoutContext, phaseOf, poseMotion, poseView, type PoseContext } from './pose'

const layout = layoutJson as unknown as BuildingLayout
const standup = standupJson as unknown as RenderState
const working = workingJson as unknown as RenderState
const lunch = lunchJson as unknown as RenderState

function contextFor(state: RenderState): PoseContext {
  const people = new Map(state.staff.map((s) => [s.id, s]))
  return {
    ...layoutContext(layout),
    meeting: (id) => state.meetings.find((m) => m.id === id),
    person: (id) => people.get(id),
  }
}
const view = (s: StaffRender, state: RenderState) => poseView(s, contextFor(state), emptyPoseView())
const person = (state: RenderState, pred: (s: StaffRender) => boolean) => state.staff.find(pred)!

describe('pose selection from the render state', () => {
  it('sits at the desk facing it, and types there only with a work item', () => {
    const typist = person(working, (s) => s.pose === 'type')
    expect(typist.workItem).toBe('work-item-1')
    const v = view(typist, working)
    const desk = layout.rooms.flatMap((r) => r.desks).find((d) => d.id === typist.seatedAt)!
    expect(v).toMatchObject({ pose: 'type', stance: 'sit', seat: 'desk', arms: true, ring: false, faceX: desk.x, faceZ: desk.z })
    const sitter = person(working, (s) => s.pose === 'sit' && !!s.seatedAt)
    expect(view(sitter, working)).toMatchObject({ pose: 'sit', stance: 'sit', seat: 'desk', arms: false })
  })

  it('seats the meeting at its table: the speaker talks (ring), listeners look at the speaker', () => {
    const meeting = standup.meetings[0]
    const room = layout.rooms.find((r) => r.id === meeting.room)!
    const speaker = person(standup, (s) => s.pose === 'talk')
    expect(standup.bubbles[0].speaker).toBe(speaker.id)
    const sv = view(speaker, standup)
    expect(sv).toMatchObject({ pose: 'talk', stance: 'sit', seat: 'table', ring: true, arms: true, faceX: room.x + room.w / 2, faceZ: room.z + room.d / 2 })
    const listener = person(standup, (s) => s.pose === 'listen')
    const lv = view(listener, standup)
    expect(lv).toMatchObject({ pose: 'listen', stance: 'sit', seat: 'table', ring: false, lookX: speaker.x, lookZ: speaker.z })
  })

  it('seats lunch at the kitchen table (the sim says sit, with no desk)', () => {
    const kitchen = layout.rooms.find((r) => r.kind === 'kitchen')!
    const luncher = person(lunch, (s) => s.activity === 'lunch' && s.pose === 'sit' && !s.seatedAt)
    expect(view(luncher, lunch)).toMatchObject({ stance: 'sit', seat: 'table', faceX: kitchen.x + kitchen.w / 2, faceZ: kitchen.z + kitchen.d / 2 })
  })

  it('walks standing, with no face target (the path gives the heading)', () => {
    const walker = person(lunch, (s) => s.pose === 'walk')
    expect(view(walker, lunch)).toMatchObject({ pose: 'walk', stance: 'stand', seat: null, faceX: null, arms: false })
  })

  it('leans back when idle at the desk and stands when idle elsewhere', () => {
    const typist = person(working, (s) => !!s.seatedAt)
    expect(view({ ...typist, pose: 'idle' }, working)).toMatchObject({ stance: 'sit', seat: 'desk', lean: -0.1 })
    expect(view({ ...typist, pose: 'idle', seatedAt: null, x: 11, z: 7 }, working)).toMatchObject({ stance: 'stand', seat: null })
  })

  it('maps every pose of the contract, and fails loudly on an unknown one in dev', () => {
    for (const p of POSES) expect(knownPose(p, true)).toBe(p)
    expect(() => knownPose('celebrate', true)).toThrow(/unknown pose "celebrate"/)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(knownPose('celebrate', false)).toBe('idle')
    expect(knownPose('celebrate', false)).toBe('idle')
    expect(err).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})

describe('motion within a pose', () => {
  it('bobs a walker with the distance walked, so a held walker holds still', () => {
    const a = poseMotion('walk', 100, 0.65 / 2, 0.3, emptyMotion()).bob
    expect(poseMotion('walk', 999, 0.65 / 2, 0.9, emptyMotion()).bob).toBe(a)
    expect(poseMotion('walk', 100, 0, 0.3, emptyMotion()).bob).toBe(0)
  })

  it('moves a typist and a speaker with the display step, and nobody else', () => {
    const p = phaseOf('staff-3')
    const t1 = poseMotion('type', 100, 0, p, emptyMotion())
    const t2 = poseMotion('type', 100.4, 0, p, emptyMotion())
    expect(t1.reach).not.toBe(t2.reach)
    expect(poseMotion('type', 100, 0, p, emptyMotion())).toEqual(t1)
    const talk = poseMotion('talk', 100, 0, p, emptyMotion())
    expect(talk.lift).toBeGreaterThan(0)
    expect(poseMotion('sit', 100, 0, p, emptyMotion())).toEqual(emptyMotion())
    expect(poseMotion('listen', 100, 0, p, emptyMotion())).toEqual(emptyMotion())
  })

  it('gives each person a stable phase', () => {
    expect(phaseOf('staff-1')).toBe(phaseOf('staff-1'))
    expect(phaseOf('staff-1')).not.toBe(phaseOf('staff-2'))
    expect(phaseOf('staff-1')).toBeGreaterThanOrEqual(0)
    expect(phaseOf('staff-1')).toBeLessThan(1)
  })
})
