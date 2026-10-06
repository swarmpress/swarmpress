// The model table's placement (ADR-0072, FEAT-090): pure positions.
import { describe, expect, it } from 'vitest'
import type { RoomLayout } from '../../state/render-state'
import { MODEL_ROOMS, MODEL_SCALE, modelPlacement, modelRoom } from './model'
import { PLATE, STUD } from './placements'

const room = (kind: RoomLayout['kind'], x = 10, z = 4, w = 6, d = 5) => ({ id: `r-${kind}`, kind, x, z, w, d }) as unknown as RoomLayout

describe('model table', () => {
  it('prefers the strategy room, then the design studio, the editor’s office, the newsroom', () => {
    expect(MODEL_ROOMS[0]).toBe('strategy-room')
    expect(modelRoom([room('newsroom'), room('editor-office')])?.kind).toBe('editor-office')
    expect(modelRoom([room('newsroom'), room('design-studio'), room('strategy-room')])?.kind).toBe('strategy-room')
    expect(modelRoom([room('kitchen')])).toBeNull()
  })

  it('stands in the room’s south-east corner and centres the town on its top', () => {
    const r = room('editor-office')
    const table = { bounds: [32, 16, 30] as [number, number, number] }
    const mp = modelPlacement(r, table, { bounds: [76, 34, 20] })
    const tw = 32 * STUD
    const td = 16 * STUD
    expect(mp.table.x + tw / 2).toBeLessThan(r.x + r.w)
    expect(mp.table.z + td / 2).toBeLessThan(r.z + r.d)
    expect(mp.table.design).toBe('meeting-table')
    expect(mp.origin[1]).toBeCloseTo(30 * PLATE)
    // Fits the top with a margin, never above 1/8.
    expect(mp.scale).toBeLessThanOrEqual(MODEL_SCALE)
    expect(76 * STUD * mp.scale).toBeLessThanOrEqual(0.9 * tw + 1e-9)
    expect(34 * STUD * mp.scale).toBeLessThanOrEqual(0.9 * td + 1e-9)
    // Centred.
    expect(mp.origin[0] + (76 * STUD * mp.scale) / 2).toBeCloseTo(mp.table.x)
    expect(mp.origin[2] + (34 * STUD * mp.scale) / 2).toBeCloseTo(mp.table.z)
    // A small town keeps the 1/8 scale.
    expect(modelPlacement(r, table, { bounds: [8, 8, 8] }).scale).toBe(MODEL_SCALE)
  })
})
