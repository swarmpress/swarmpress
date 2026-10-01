import { describe, expect, it } from 'vitest'
import { demoRenderState } from './render-state'

describe('demoRenderState', () => {
  it('is empty and dark before opening', () => {
    const s = demoRenderState(6 * 60, 0)
    expect(s.staff).toHaveLength(0)
    expect(Object.values(s.roomLights).some(Boolean)).toBe(false)
  })

  it('has a busy newsroom mid-morning', () => {
    const s = demoRenderState(11 * 60, 0)
    expect(s.staff.length).toBe(5)
    expect(s.monitors['desk-1']).toBe(true)
  })

  it('keeps only editorial lit for the late deadline', () => {
    const s = demoRenderState(23 * 60, 0)
    expect(s.staff.map((p) => p.id)).toEqual(['marco'])
    expect(s.roomLights.editor).toBe(true)
    expect(s.roomLights.newsroom).toBe(false)
    expect(s.deskLamps['desk-ed']).toBe(true)
  })
})
