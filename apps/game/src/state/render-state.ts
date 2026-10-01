/**
 * The contract between the simulation and the renderer (ADR-0007).
 *
 * The renderer never decides gameplay facts. It draws exactly what this
 * structure says: who sits where, which lights and monitors are on, and the
 * time of day. From M1 onward it is produced by sim-core via client-wasm;
 * until then `demoRenderState` provides a hand-written stand-in.
 */

export type RoomKind = 'newsroom' | 'editor-office' | 'meeting-room' | 'seo-lab' | 'media-studio' | 'ceo-office'

/** Axis-aligned room on the building grid, in metres. x grows east, z grows south. */
export interface RoomLayout {
  id: string
  kind: RoomKind
  label: string
  x: number
  z: number
  w: number
  d: number
  /** Window openings on exterior walls: side and offset/width along it. */
  windows: Array<{ side: 'north' | 'west' | 'east' | 'south'; at: number; width: number }>
  desks: Array<{ id: string; x: number; z: number; rot: number }>
  ceilingLights: Array<{ id: string; x: number; z: number }>
}

export interface BuildingLayout {
  width: number
  depth: number
  wallHeight: number
  rooms: RoomLayout[]
}

export interface StaffRender {
  id: string
  name: string
  color: string
  x: number
  z: number
  /** Desk the person is seated at, if any (turns that monitor on). */
  seatedAt?: string
}

export interface RenderState {
  minute: number
  day: number
  /** Room id → ceiling lights on. */
  roomLights: Record<string, boolean>
  /** Desk id → monitor on. */
  monitors: Record<string, boolean>
  /** Desk id → desk lamp on. */
  deskLamps: Record<string, boolean>
  staff: StaffRender[]
}

export const DEMO_BUILDING: BuildingLayout = {
  width: 16,
  depth: 10,
  wallHeight: 3,
  rooms: [
    {
      id: 'newsroom',
      kind: 'newsroom',
      label: 'Newsroom',
      x: 0,
      z: 0,
      w: 10,
      d: 10,
      windows: [
        { side: 'north', at: 1.5, width: 2.5 },
        { side: 'north', at: 6, width: 2.5 },
        { side: 'west', at: 2, width: 2.5 },
        { side: 'west', at: 6, width: 2.5 },
      ],
      desks: [
        { id: 'desk-1', x: 2.5, z: 3, rot: 0 },
        { id: 'desk-2', x: 5, z: 3, rot: 0 },
        { id: 'desk-3', x: 2.5, z: 6.5, rot: 0 },
        { id: 'desk-4', x: 5, z: 6.5, rot: 0 },
      ],
      ceilingLights: [
        { id: 'nl-1', x: 3, z: 3 },
        { id: 'nl-2', x: 7, z: 3 },
        { id: 'nl-3', x: 3, z: 7 },
        { id: 'nl-4', x: 7, z: 7 },
      ],
    },
    {
      id: 'editor',
      kind: 'editor-office',
      label: "Editor's office",
      x: 10,
      z: 0,
      w: 6,
      d: 5,
      windows: [{ side: 'north', at: 1.5, width: 3 }],
      desks: [{ id: 'desk-ed', x: 13, z: 2.5, rot: Math.PI }],
      ceilingLights: [{ id: 'el-1', x: 13, z: 2.5 }],
    },
    {
      id: 'meeting',
      kind: 'meeting-room',
      label: 'Meeting room',
      x: 10,
      z: 5,
      w: 6,
      d: 5,
      windows: [],
      desks: [],
      ceilingLights: [{ id: 'ml-1', x: 13, z: 7.5 }],
    },
  ],
}

const STAFF = [
  { id: 'isabella', name: 'Isabella', color: '#c0504d', desk: 'desk-1', arrive: 8 * 60 + 10, leave: 18 * 60 },
  { id: 'lorenzo', name: 'Lorenzo', color: '#4f81bd', desk: 'desk-2', arrive: 8 * 60 + 40, leave: 17 * 60 + 30 },
  { id: 'sophia', name: 'Sophia', color: '#9bbb59', desk: 'desk-3', arrive: 9 * 60, leave: 22 * 60 + 45 },
  { id: 'giulia', name: 'Giulia', color: '#8064a2', desk: 'desk-4', arrive: 9 * 60 + 15, leave: 18 * 60 + 30 },
  { id: 'marco', name: 'Marco', color: '#f79646', desk: 'desk-ed', arrive: 8 * 60, leave: 23 * 60 + 15 },
]

/**
 * Stand-in for sim-core's render state (replaced in M1). Encodes the story
 * from ADR-0006: office fills in the morning, empties at 18:00, and the
 * deadline crew keeps editorial lit late at night.
 */
export function demoRenderState(minute: number, day: number): RenderState {
  const staff: StaffRender[] = []
  const monitors: Record<string, boolean> = {}
  const deskLamps: Record<string, boolean> = {}
  const occupied = new Set<string>()

  for (const s of STAFF) {
    const present = minute >= s.arrive && minute < s.leave
    const room = DEMO_BUILDING.rooms.find((r) => r.desks.some((d) => d.id === s.desk))!
    const desk = room.desks.find((d) => d.id === s.desk)!
    monitors[desk.id] = present
    deskLamps[desk.id] = present && minute >= 17 * 60
    if (!present) continue
    occupied.add(room.id)
    staff.push({ id: s.id, name: s.name, color: s.color, x: desk.x, z: desk.z + 0.75, seatedAt: desk.id })
  }

  const dark = minute < 7 * 60 + 30 || minute >= 16 * 60 + 30
  const roomLights: Record<string, boolean> = {}
  for (const room of DEMO_BUILDING.rooms) {
    // Lights follow occupancy; in daylight only the deep (window-less) rooms need them.
    roomLights[room.id] = occupied.has(room.id) && (dark || room.windows.length === 0)
  }
  return { minute, day, roomLights, monitors, deskLamps, staff }
}
