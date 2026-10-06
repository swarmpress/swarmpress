/**
 * The model table (ADR-0072, FEAT-090, design §4.1): the site's brick town
 * as a miniature on a table in the office. The town is a design the central
 * server generates from the blueprint (`GET /api/site/blueprint`); the
 * renderer only places it: on a meeting table in the first brick room that
 * plans the site, scaled down to fit the table top (at most 1/8).
 *
 * Pure: positions only. `office.ts` builds the meshes.
 */
import type { RoomKind, RoomLayout } from '../../state/render-state'
import { PLATE, STUD, type DesignInfo, type Placement } from './placements'

/** Rooms the table may stand in, in order of preference. */
export const MODEL_ROOMS: readonly RoomKind[] = ['strategy-room', 'design-studio', 'editor-office', 'newsroom']
/** The town's largest scale on the table. */
export const MODEL_SCALE = 1 / 8
/** The table design (shipped). */
export const MODEL_TABLE = 'meeting-table'
/** Clearance from the room's walls, metres. */
const CLEAR = 0.5

export interface ModelPlacement {
  room: string
  table: Placement
  /** World position of the town's min corner on the table top. */
  origin: [number, number, number]
  scale: number
}

/** The first room of `rooms` a model table may stand in. */
export function modelRoom<R extends Pick<RoomLayout, 'kind'>>(rooms: readonly R[]): R | null {
  for (const k of MODEL_ROOMS) {
    const r = rooms.find((x) => x.kind === k)
    if (r) return r
  }
  return null
}

/**
 * The table in the room's south-east corner, and the town centred on its
 * top, scaled to fit with a margin (never above {@link MODEL_SCALE}).
 */
export function modelPlacement(room: RoomLayout, table: Pick<DesignInfo, 'bounds'>, town: Pick<DesignInfo, 'bounds'>): ModelPlacement {
  const tw = table.bounds[0] * STUD
  const td = table.bounds[1] * STUD
  const top = table.bounds[2] * PLATE
  const x = room.x + room.w - tw / 2 - CLEAR
  const z = room.z + room.d - td / 2 - CLEAR
  const mw = Math.max(1, town.bounds[0]) * STUD
  const md = Math.max(1, town.bounds[1]) * STUD
  const scale = Math.min(MODEL_SCALE, (0.9 * tw) / mw, (0.9 * td) / md)
  return {
    room: room.id,
    table: { id: `${room.id}/model-table`, role: 'prop', design: MODEL_TABLE, params: '{}', x, y: 0, z, turn: 0, standIn: true },
    origin: [x - (mw * scale) / 2, top, z - (md * scale) / 2],
    scale,
  }
}
