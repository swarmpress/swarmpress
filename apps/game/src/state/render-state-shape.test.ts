import { describe, expect, it } from 'vitest'
import { checkLayout, checkRenderState, keysOf, valuesOf } from './render-state-shape'
import { DEMO_BUILDING, demoRenderState } from './render-state'
import standup from './fixtures/demo-standup.json'

describe('the render-state contract as data', () => {
  it('cannot leave a key or a value out (checked by tsc)', () => {
    keysOf<{ a: number; b: number }>()('a', 'b')
    // @ts-expect-error `b` is missing
    keysOf<{ a: number; b: number }>()('a')
    // @ts-expect-error `c` is not a key
    keysOf<{ a: number; b: number }>()('a', 'b', 'c')
    valuesOf<'x' | 'y'>()('x', 'y')
    // @ts-expect-error `y` is missing
    valuesOf<'x' | 'y'>()('x')
    expect(keysOf<{ a: number }>()('a')).toEqual(['a'])
  })

  it('accepts the hand-written fixture', () => {
    expect(checkLayout(DEMO_BUILDING).problems).toEqual([])
    expect(checkRenderState(demoRenderState(11 * 60, 0)).problems).toEqual([])
  })

  it('reports an unknown field, a missing field and an unknown value', () => {
    const s = structuredClone(standup) as Record<string, unknown> & { staff: Array<Record<string, unknown>> }
    s.staff[0].mood = 'happy'
    delete s.staff[1].workItem
    s.staff[2].pose = 'celebrate'
    delete s.bubbles
    expect(checkRenderState(s).problems).toEqual([
      'state.bubbles: missing field',
      'state.staff[0].mood: unknown field (not in render-state.ts)',
      'state.staff[1].workItem: missing field',
      'state.staff[1].workItem: expected string or null, got undefined',
      'state.staff[2].pose: unknown value "celebrate"',
      'state.bubbles: expected an array',
    ])
  })
})
