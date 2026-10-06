/**
 * The contract between the simulation and the renderer (ADR-0007).
 *
 * The renderer never decides gameplay facts. It draws exactly what this
 * structure says: who sits where, who walks which path, which lights and
 * monitors are on, and the time of day. It is produced by sim-core via
 * client-wasm (`Sim.render_state_json()` / `Sim.layout_json()`, written by
 * `crates/client-wasm/src/json.rs`); `demoRenderState` is a hand-written
 * fixture for renderer unit tests only.
 *
 * Every field the sim writes is declared here. `render-state-shape.ts` lists
 * the same keys as data, and `render-state.wasm.test.ts` checks both against
 * the real JSON of the wasm sim, so a field added or removed in Rust fails a
 * test instead of being silently ignored.
 *
 * Units: metres (x grows east, z grows south), radians, sim steps (10 per
 * real second at speed 1), game minutes.
 */

export type RoomKind =
  | 'newsroom'
  | 'editor-office'
  | 'meeting-room'
  | 'archive'
  | 'photo-studio'
  | 'seo-lab'
  | 'translation-desk'
  | 'design-studio'
  | 'ceo-office'
  | 'kitchen'
  | 'server-room'
  | 'finance-office'
  | 'strategy-room'

export type Side = 'north' | 'south' | 'east' | 'west'

/** Equipment that is not a desk or a ceiling light (those have their own lists). */
export type PropKind =
  | 'monitor'
  | 'color-monitor'
  | 'desk-lamp'
  | 'whiteboard'
  | 'archive-shelf'
  | 'coffee-machine'
  | 'plant'
  | 'camera-rig'
  | 'mood-board-wall'

export type DeviceKind = PropKind | 'desk' | 'ceiling-light'

/** A point on the floor: `[x, z]` in metres. */
export type Point = [x: number, z: number]

/** An opening in a room side: `at` metres from the side's west or north end. */
export interface Opening {
  side: Side
  at: number
  width: number
}

export interface DeskLayout {
  id: string
  x: number
  z: number
  /** Radians, clockwise seen from above; 0 = the chair is south of the desk. */
  rot: number
  /** Where the person sits. */
  seat: Point
}

export interface PropLayout {
  id: string
  kind: PropKind
  x: number
  z: number
  rot: number
  /** The desk this item stands on, if any. */
  attachedTo: string | null
}

/** Axis-aligned room on the building grid, in metres. */
export interface RoomLayout {
  id: string
  kind: RoomKind
  label: string
  x: number
  z: number
  w: number
  d: number
  floor: number
  /** Upgrade level, from 1. */
  level: number
  capacity: number
  /** Window openings on exterior walls. */
  windows: Opening[]
  /** One-tile doors in the room's sides. */
  doors: Opening[]
  desks: DeskLayout[]
  ceilingLights: Array<{ id: string; x: number; z: number }>
  props: PropLayout[]
}

/** The street door: its centre on the lot boundary, and where people appear outside. */
export interface EntranceLayout {
  side: Side
  x: number
  z: number
  spawn: Point
}

export interface BuildingLayout {
  /** The lot's north-west corner. Everything in the lot that is not a room is hallway. */
  originX: number
  originZ: number
  width: number
  depth: number
  wallHeight: number
  floors: number
  entrance: EntranceLayout
  rooms: RoomLayout[]
}

export type Pose = 'walk' | 'sit' | 'type' | 'talk' | 'listen' | 'idle'

export type Activity =
  | 'off-site'
  | 'arriving'
  | 'working'
  | 'walking-to-meeting'
  | 'in-meeting'
  | 'walking-to-lunch'
  | 'lunch'
  | 'returning-to-desk'
  | 'leaving'

/**
 * A walk in progress. The position at sim step `s` is the point
 * `(s − startStep) × speed` metres along the waypoints, which are joined by
 * axis-aligned segments (`Path::sample` in sim-core). The renderer evaluates
 * it for fractional steps up to the sim's own step, never beyond.
 */
export interface PathRender {
  waypoints: Point[]
  startStep: number
  /** Metres per sim step. */
  speed: number
}

export interface StaffRender {
  id: string
  /** Persona slug (`isabella`). */
  persona: string
  name: string
  /** `#rrggbb`, the persona's colour. */
  color: string
  /** Role slug (`writer`). */
  role: string
  department: string
  /** The sim's position at `RenderState.step` (on `path` while walking). */
  x: number
  z: number
  pose: Pose
  activity: Activity
  /** Desk the person is seated at, if any (turns that monitor on). */
  seatedAt: string | null
  /** The meeting whose table the person has a seat at (walking there or seated). */
  meeting: string | null
  /**
   * The work item whose active phase this person works on (`work-item-1`),
   * or null. Seated at the desk with one is the `type` pose, without `sit`.
   */
  workItem: string | null
  /** Permille. */
  fatigue: number
  morale: number
  path: PathRender | null
}

export type LightLevel = 'off' | 'dim' | 'on'

export interface RoomRender {
  id: string
  kind: RoomKind
  light: LightLevel
  occupancy: number
  capacity: number
}

export type DeviceState = 'off' | 'on' | 'in-use'

export interface DeviceRender {
  id: string
  room: string
  kind: DeviceKind
  state: DeviceState
  /** Staff id while `state` is `in-use`. */
  user: string | null
  attachedTo: string | null
}

export interface MeetingRender {
  id: string
  /** `standup`, … */
  kind: string
  project: string | null
  room: string
  day: number
  /** Game minutes of the day. */
  start: number
  end: number
  active: boolean
  attendees: string[]
  /** Who has the turn, if anyone. */
  speaker: string | null
  /** The job whose transcript holds the words. */
  job: number | null
}

/**
 * A speech bubble: who is talking in a meeting, and for how long. The words
 * are not in the sim (CLAUDE.md rule 2): fetch them from the transcript by
 * the meeting (its job) and `seq`.
 */
export interface BubbleRender {
  meeting: string
  /** The turn's number within the meeting, from 0. */
  seq: number
  speaker: string
  startedStep: number
  /** The bubble is up until this step. */
  untilStep: number
  chars: number
}

/**
 * A remark outside meetings (ADR-0074): a line of the story director's
 * chapter. The words are kept by `seq` in the company store (rule 2).
 */
export interface RemarkRender {
  seq: number
  speaker: string
  /** Who is spoken to; null for the room. */
  listener: string | null
  startedStep: number
  untilStep: number
  chars: number
}

export type DayPhase = 'night' | 'arrival' | 'standup' | 'work' | 'lunch' | 'evening'
export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

export interface RenderState {
  step: number
  day: number
  /** Minute of the day, 0..1440. */
  minute: number
  weekday: Weekday
  phase: DayPhase
  daylight: boolean
  cashCents: number
  /** Room id → ceiling lights on (`light` is not `off`). */
  roomLights: Record<string, boolean>
  /** Desk id → monitor on. */
  monitors: Record<string, boolean>
  /** Desk id → desk lamp on. */
  deskLamps: Record<string, boolean>
  rooms: RoomRender[]
  devices: DeviceRender[]
  /** People on site only. */
  staff: StaffRender[]
  meetings: MeetingRender[]
  /** One per meeting with a turn in progress. */
  bubbles: BubbleRender[]
  /** Remarks in progress (ADR-0074). */
  remarks: RemarkRender[]
  /** The seq the next remark must carry. */
  nextRemark: number
}

// ----------------------------------------------------------------------------
// Hand-written fixture (renderer unit tests only)
// ----------------------------------------------------------------------------

const SEAT_OFFSET = 0.75

/** The chair of a desk at (x, z) turned by `rot` (sim-core `equipment::seat_pos`). */
export function seatOf(x: number, z: number, rot: number): Point {
  const r = Math.round(rot / (Math.PI / 2)) & 3
  const [dx, dz] = r === 0 ? [0, SEAT_OFFSET] : r === 1 ? [-SEAT_OFFSET, 0] : r === 2 ? [0, -SEAT_OFFSET] : [SEAT_OFFSET, 0]
  return [x + dx, z + dz]
}

const desk = (id: string, x: number, z: number, rot = 0): DeskLayout => ({ id, x, z, rot, seat: seatOf(x, z, rot) })

export const DEMO_BUILDING: BuildingLayout = {
  originX: 0,
  originZ: 0,
  width: 16,
  depth: 10,
  wallHeight: 3,
  floors: 1,
  entrance: { side: 'south', x: 4.5, z: 10, spawn: [4.5, 12.5] },
  rooms: [
    {
      id: 'newsroom',
      kind: 'newsroom',
      label: 'Newsroom',
      x: 0,
      z: 0,
      w: 10,
      d: 10,
      floor: 0,
      level: 1,
      capacity: 16,
      windows: [
        { side: 'north', at: 1.5, width: 2.5 },
        { side: 'north', at: 6, width: 2.5 },
        { side: 'west', at: 2, width: 2.5 },
        { side: 'west', at: 6, width: 2.5 },
      ],
      doors: [
        { side: 'east', at: 2, width: 1 },
        { side: 'east', at: 7, width: 1 },
      ],
      desks: [desk('desk-1', 2.5, 3), desk('desk-2', 5, 3), desk('desk-3', 2.5, 6.5), desk('desk-4', 5, 6.5)],
      // Two wide fixtures: with four desk lamps plus sun and sky this is the
      // 8-light WebGPU budget for the newsroom floor (ADR-0006).
      ceilingLights: [
        { id: 'nl-1', x: 4, z: 3 },
        { id: 'nl-2', x: 4, z: 7 },
      ],
      props: [{ id: 'plant-1', kind: 'plant', x: 9.4, z: 0.6, rot: 0, attachedTo: null }],
    },
    {
      id: 'editor',
      kind: 'editor-office',
      label: "Editor's office",
      x: 10,
      z: 0,
      w: 6,
      d: 5,
      floor: 0,
      level: 1,
      capacity: 3,
      windows: [{ side: 'north', at: 1.5, width: 3 }],
      doors: [],
      desks: [desk('desk-ed', 13, 2.5, Math.PI)],
      ceilingLights: [{ id: 'el-1', x: 13, z: 2.5 }],
      props: [],
    },
    {
      id: 'meeting',
      kind: 'meeting-room',
      label: 'Meeting room',
      x: 10,
      z: 5,
      w: 6,
      d: 5,
      floor: 0,
      level: 1,
      capacity: 10,
      windows: [],
      doors: [],
      desks: [],
      ceilingLights: [{ id: 'ml-1', x: 13, z: 7.5 }],
      props: [{ id: 'wb-1', kind: 'whiteboard', x: 13, z: 9.6, rot: 0, attachedTo: null }],
    },
  ],
}

const STAFF = [
  { id: 'isabella', name: 'Isabella', role: 'writer', color: '#c0504d', desk: 'desk-1', arrive: 8 * 60 + 10, leave: 18 * 60 },
  { id: 'lorenzo', name: 'Lorenzo', role: 'writer', color: '#4f81bd', desk: 'desk-2', arrive: 8 * 60 + 40, leave: 17 * 60 + 30 },
  { id: 'sophia', name: 'Sophia', role: 'editor', color: '#9bbb59', desk: 'desk-3', arrive: 9 * 60, leave: 22 * 60 + 45 },
  { id: 'giulia', name: 'Giulia', role: 'photo-editor', color: '#8064a2', desk: 'desk-4', arrive: 9 * 60 + 15, leave: 18 * 60 + 30 },
  { id: 'marco', name: 'Marco', role: 'editor-in-chief', color: '#f79646', desk: 'desk-ed', arrive: 8 * 60, leave: 23 * 60 + 15 },
]

const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

function demoPhase(minute: number): DayPhase {
  if (minute < 6 * 60 || minute >= 22 * 60) return 'night'
  if (minute < 9 * 60) return 'arrival'
  if (minute < 9 * 60 + 20) return 'standup'
  if (minute >= 12 * 60 + 30 && minute < 13 * 60 + 30) return 'lunch'
  return minute < 18 * 60 ? 'work' : 'evening'
}

/**
 * Stand-in for sim-core's render state, for renderer unit tests. Encodes the
 * story from ADR-0006: office fills in the morning, empties at 18:00, and the
 * deadline crew keeps editorial lit late at night. Everyone sits at their
 * desk; tests that need a walk or a meeting add it.
 */
export function demoRenderState(minute: number, day: number): RenderState {
  const staff: StaffRender[] = []
  const monitors: Record<string, boolean> = {}
  const deskLamps: Record<string, boolean> = {}
  const devices: DeviceRender[] = []
  const occupancy = new Map<string, number>()

  for (const s of STAFF) {
    const present = minute >= s.arrive && minute < s.leave
    const room = DEMO_BUILDING.rooms.find((r) => r.desks.some((d) => d.id === s.desk))!
    const d = room.desks.find((x) => x.id === s.desk)!
    monitors[d.id] = present
    deskLamps[d.id] = present && minute >= 17 * 60
    devices.push({ id: d.id, room: room.id, kind: 'desk', state: present ? 'in-use' : 'off', user: present ? s.id : null, attachedTo: null })
    if (!present) continue
    occupancy.set(room.id, (occupancy.get(room.id) ?? 0) + 1)
    staff.push({
      id: s.id,
      persona: s.id,
      name: s.name,
      color: s.color,
      role: s.role,
      department: 'editorial',
      x: d.seat[0],
      z: d.seat[1],
      pose: 'sit',
      activity: 'working',
      seatedAt: d.id,
      meeting: null,
      workItem: null,
      fatigue: 0,
      morale: 700,
      path: null,
    })
  }

  const dark = minute < 7 * 60 + 30 || minute >= 16 * 60 + 30
  const roomLights: Record<string, boolean> = {}
  const rooms: RoomRender[] = []
  for (const room of DEMO_BUILDING.rooms) {
    const people = occupancy.get(room.id) ?? 0
    // Lights follow occupancy; in daylight only the deep (window-less) rooms need them.
    const on = people > 0 && (dark || room.windows.length === 0)
    roomLights[room.id] = on
    rooms.push({ id: room.id, kind: room.kind, light: on ? 'on' : 'off', occupancy: people, capacity: room.capacity })
  }
  return {
    step: (day * 1440 + minute) * 10,
    day,
    minute,
    weekday: WEEKDAYS[day % 7],
    phase: demoPhase(minute),
    daylight: !dark,
    cashCents: 20_000_000,
    roomLights,
    monitors,
    deskLamps,
    rooms,
    devices,
    staff,
    meetings: [],
    bubbles: [],
    remarks: [],
    nextRemark: 0,
  }
}
