/**
 * The town of sections (ADR-0086 decision 4): the office is the Staff
 * building; the other sections (Plan, Building, Factory, Projects) are
 * houses of the kit's `town-house` design in a row on the side opposite
 * the entrance, their fronts to the office, a tiled path between. The town
 * is generic: the same houses and colours for every company, placed only
 * from the layout's bounds and entrance, never from the company's content.
 *
 * Pure geometry here (tested without a GPU); `office.ts` builds the bricks
 * and `signs` paints the section names on the houses' plaques.
 */
import type { BuildingLayout, Side } from '../../state/render-state'
import type { Turn } from './placements'

/** The houses' sections and their (generic) colours, in the row's order. */
export const TOWN_HOUSES = [
  { id: 'plan', label: 'Plan', wall: 'honey', roof: 'terracotta', door: 'navy', trim: 'white' },
  { id: 'building', label: 'Building', wall: 'white', roof: 'denim', door: 'red', trim: 'grey-light' },
  { id: 'factory', label: 'Factory', wall: 'grey-light', roof: 'grey-dark', door: 'orange', trim: 'white' },
  { id: 'projects', label: 'Projects', wall: 'sage', roof: 'forest', door: 'chocolate', trim: 'white' },
] as const

/** The house's footprint (the design's, studs → metres) and how far it stands from the lot. */
export const HOUSE_W = 5
export const HOUSE_D = 4
export const GAP = 2.5

export interface TownSpot {
  id: string
  label: string
  /** Footprint centre (world metres) and the quarter turn its front faces the office with. */
  x: number
  z: number
  turn: Turn
  /** The world rect it covers. */
  rect: { x: number; z: number; w: number; d: number }
  params: { wall: string; roof: string; door: string; trim: string }
}

const OPPOSITE: Record<Side, Side> = { north: 'south', south: 'north', east: 'west', west: 'east' }
/** The turn that points a design's front (+z at turn 0) towards the lot from a row on `side`. */
const FACING_LOT: Record<Side, Turn> = { north: 0, south: 2, west: 3, east: 1 }

/** Where the houses stand: a row on the side opposite the entrance, evenly spread along it. */
export function townSpots(layout: Pick<BuildingLayout, 'originX' | 'originZ' | 'width' | 'depth' | 'entrance'>): TownSpot[] {
  const side = OPPOSITE[layout.entrance.side]
  const { originX: ox, originZ: oz, width: W, depth: D } = layout
  const alongX = side === 'north' || side === 'south'
  const length = alongX ? W : D
  const n = TOWN_HOUSES.length
  const turn = FACING_LOT[side]
  // A house's extent along the row and away from it, by its turn.
  const along = turn % 2 === 0 ? HOUSE_W : HOUSE_D
  const across = turn % 2 === 0 ? HOUSE_D : HOUSE_W
  const step = Math.max(along + 1, length / n)
  const start = (alongX ? ox : oz) + (length - step * (n - 1) - along) / 2
  return TOWN_HOUSES.map((h, i) => {
    const a = start + i * step + along / 2
    const c =
      side === 'north' ? oz - GAP - across / 2 : side === 'south' ? oz + D + GAP + across / 2 : side === 'west' ? ox - GAP - across / 2 : ox + W + GAP + across / 2
    const x = alongX ? a : c
    const z = alongX ? c : a
    const w = alongX ? along : across
    const d = alongX ? across : along
    return { id: h.id, label: h.label, x, z, turn, rect: { x: x - w / 2, z: z - d / 2, w, d }, params: { wall: h.wall, roof: h.roof, door: h.door, trim: h.trim } }
  })
}

/** The tiled path between the row and the lot, whole metres. */
export function townPath(layout: Pick<BuildingLayout, 'originX' | 'originZ' | 'width' | 'depth' | 'entrance'>): { x: number; z: number; w: number; d: number } {
  const side = OPPOSITE[layout.entrance.side]
  const { originX: ox, originZ: oz, width: W, depth: D } = layout
  const g = Math.floor(GAP)
  if (side === 'north') return { x: ox - 2, z: oz - g, w: W + 4, d: g }
  if (side === 'south') return { x: ox - 2, z: oz + D, w: W + 4, d: g }
  if (side === 'west') return { x: ox - g, z: oz - 2, w: g, d: D + 4 }
  return { x: ox + W, z: oz - 2, w: g, d: D + 4 }
}

/** The rect a section frames: the office for Staff, a house, or the whole town. */
export function townFrame(layout: BuildingLayout, spots: readonly TownSpot[], section: string): { x: number; z: number; w: number; d: number; h: number } {
  const spot = spots.find((s) => s.id === section)
  // A house with its street around it: 3 m of margin.
  if (spot) return { x: spot.rect.x - 3, z: spot.rect.z - 3, w: spot.rect.w + 6, d: spot.rect.d + 6, h: 4 }
  const lot = { x: layout.originX, z: layout.originZ, w: layout.width, d: layout.depth, h: layout.wallHeight }
  if (section === 'staff') return lot
  let [x0, z0, x1, z1] = [lot.x, lot.z, lot.x + lot.w, lot.z + lot.d]
  for (const s of spots) {
    x0 = Math.min(x0, s.rect.x)
    z0 = Math.min(z0, s.rect.z)
    x1 = Math.max(x1, s.rect.x + s.rect.w)
    z1 = Math.max(z1, s.rect.z + s.rect.d)
  }
  return { x: x0, z: z0, w: x1 - x0, d: z1 - z0, h: 4 }
}
