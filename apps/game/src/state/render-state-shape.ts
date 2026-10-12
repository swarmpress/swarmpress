/**
 * The render-state contract as data: every key of every object the sim's
 * `render_state_json()` and `layout_json()` write, and every value of their
 * enumerations. Each list is checked against its TypeScript type at compile
 * time (a key missing here is a type error), and `checkLayout` /
 * `checkRenderState` check real JSON against the lists at run time, so the
 * wasm drift test fails on a field the sim adds, drops or renames.
 */
import type {
  Activity,
  BubbleRender,
  RemarkRender,
  BuildingLayout,
  DayPhase,
  DeskLayout,
  DeviceKind,
  DeviceRender,
  DeviceState,
  EntranceLayout,
  LightLevel,
  MeetingRender,
  ObjectCapabilities,
  ObjectDeskSlot,
  ObjectMount,
  ObjectOnDesk,
  ObjectSummary,
  Opening,
  PathRender,
  PlacedObjectLayout,
  Pose,
  PropKind,
  PropLayout,
  RenderState,
  RoomKind,
  RoomLayout,
  RoomRender,
  Side,
  StaffRender,
  TownItemKind,
  TownItemLayout,
  Weekday,
} from './render-state'

type Missing<T, K extends readonly PropertyKey[]> = Exclude<keyof T, K[number]>

/** All keys of `T`, as a list; leaving one out does not compile. */
export function keysOf<T>() {
  return <const K extends readonly (keyof T & string)[]>(...keys: K & ([Missing<T, K>] extends [never] ? unknown : { missing: Missing<T, K> })): readonly string[] =>
    keys
}

/** All members of the string union `T`, as a list; leaving one out does not compile. */
export function valuesOf<T extends string>() {
  return <const V extends readonly T[]>(...values: V & ([Exclude<T, V[number]>] extends [never] ? unknown : { missing: Exclude<T, V[number]> })): readonly string[] =>
    values
}

export const LAYOUT_KEYS = keysOf<BuildingLayout>()('originX', 'originZ', 'width', 'depth', 'wallHeight', 'floors', 'entrance', 'rooms', 'buildMode', 'town', 'objects')
/** Layout keys older layouts (and hand-written ones) may leave out; the sim always writes them. */
export const LAYOUT_OPTIONAL_KEYS: readonly string[] = ['buildMode', 'town', 'objects']
export const OBJECT_KEYS = keysOf<PlacedObjectLayout>()('id', 'design', 'room', 'x', 'z', 'rot', 'footprint', 'summary', 'seatAt', 'onDesk', 'places', 'assignedTo')
/** Object keys older layouts (and hand-written ones) may leave out; the sim always writes them (ADR-0088, ADR-0089). */
export const OBJECT_OPTIONAL_KEYS: readonly string[] = ['seatAt', 'onDesk', 'places', 'assignedTo']
export const OBJECT_SUMMARY_KEYS = keysOf<ObjectSummary>()('footprint', 'height', 'mount', 'seats', 'workstation', 'seat_at', 'lights', 'storage', 'screens', 'parts', 'cost')
/** Summary keys written before ADR-0088 may leave out. */
export const OBJECT_SUMMARY_OPTIONAL_KEYS: readonly string[] = ['seat_at']
export const OBJECT_ON_DESK_KEYS = keysOf<ObjectOnDesk>()('desk', 'slot')
export const OBJECT_DESK_SLOTS = valuesOf<ObjectDeskSlot>()('screen', 'lamp')
export const OBJECT_MOUNTS = valuesOf<ObjectMount>()('Floor', 'Surface', 'Ceiling')
export const OBJECT_CAPABILITY_KEYS = keysOf<ObjectCapabilities>()('seats', 'places', 'workstations', 'lights', 'storage', 'screens')
/** Capability keys written before ADR-0089 leave out. */
export const OBJECT_CAPABILITY_OPTIONAL_KEYS: readonly string[] = ['places']
export const TOWN_ITEM_KEYS = keysOf<TownItemLayout>()('id', 'kind', 'x', 'z', 'rot')
export const TOWN_KINDS = valuesOf<TownItemKind>()('PlanHouse', 'BuildingHouse', 'FactoryHouse', 'ProjectsHouse', 'Tree', 'StreetLamp', 'Bench')
export const BUILD_MODES = valuesOf<NonNullable<BuildingLayout['buildMode']>>()('sandbox', 'economic')
export const ENTRANCE_KEYS = keysOf<EntranceLayout>()('side', 'x', 'z', 'spawn')
export const ROOM_LAYOUT_KEYS = keysOf<RoomLayout>()(
  'id',
  'kind',
  'label',
  'x',
  'z',
  'w',
  'd',
  'floor',
  'level',
  'capacity',
  'windows',
  'doors',
  'desks',
  'ceilingLights',
  'props',
  'objectCapabilities',
)
/** Room keys older layouts (and hand-written ones) may leave out; the sim always writes them. */
export const ROOM_LAYOUT_OPTIONAL_KEYS: readonly string[] = ['objectCapabilities']
export const OPENING_KEYS = keysOf<Opening>()('side', 'at', 'width')
export const DESK_KEYS = keysOf<DeskLayout>()('id', 'x', 'z', 'rot', 'seat')
export const CEILING_LIGHT_KEYS = keysOf<RoomLayout['ceilingLights'][number]>()('id', 'x', 'z')
export const PROP_KEYS = keysOf<PropLayout>()('id', 'kind', 'x', 'z', 'rot', 'attachedTo')

export const STATE_KEYS = keysOf<RenderState>()(
  'step',
  'day',
  'minute',
  'weekday',
  'phase',
  'daylight',
  'cashCents',
  'roomLights',
  'monitors',
  'deskLamps',
  'rooms',
  'devices',
  'staff',
  'meetings',
  'bubbles',
  'remarks',
  'nextRemark',
  'siteModel',
  'layoutRev',
)
export const ROOM_KEYS = keysOf<RoomRender>()('id', 'kind', 'light', 'occupancy', 'capacity')
export const DEVICE_KEYS = keysOf<DeviceRender>()('id', 'room', 'kind', 'state', 'user', 'attachedTo')
export const STAFF_KEYS = keysOf<StaffRender>()(
  'id',
  'persona',
  'name',
  'color',
  'role',
  'department',
  'x',
  'z',
  'pose',
  'activity',
  'seatedAt',
  'seatedOn',
  'meeting',
  'workItem',
  'fatigue',
  'morale',
  'path',
)
/** Staff keys render states written before ADR-0089 leave out; the sim always writes them. */
export const STAFF_OPTIONAL_KEYS: readonly string[] = ['seatedOn']
export const PATH_KEYS = keysOf<PathRender>()('waypoints', 'startStep', 'speed')
export const MEETING_KEYS = keysOf<MeetingRender>()('id', 'kind', 'project', 'room', 'day', 'start', 'end', 'active', 'attendees', 'speaker', 'job')
export const BUBBLE_KEYS = keysOf<BubbleRender>()('meeting', 'seq', 'speaker', 'startedStep', 'untilStep', 'chars')
export const REMARK_KEYS = keysOf<RemarkRender>()('seq', 'speaker', 'listener', 'startedStep', 'untilStep', 'chars')

export const ROOM_KINDS = valuesOf<RoomKind>()(
  'newsroom',
  'editor-office',
  'meeting-room',
  'archive',
  'photo-studio',
  'seo-lab',
  'translation-desk',
  'design-studio',
  'ceo-office',
  'kitchen',
  'server-room',
  'finance-office',
  'strategy-room',
)
export const SIDES = valuesOf<Side>()('north', 'south', 'east', 'west')
export const PROP_KINDS = valuesOf<PropKind>()(
  'monitor',
  'color-monitor',
  'desk-lamp',
  'whiteboard',
  'archive-shelf',
  'coffee-machine',
  'plant',
  'camera-rig',
  'mood-board-wall',
)
export const DEVICE_KINDS = valuesOf<DeviceKind>()(...(PROP_KINDS as PropKind[]), 'desk', 'ceiling-light')
export const POSES = valuesOf<Pose>()('walk', 'sit', 'type', 'talk', 'listen', 'idle')
export const ACTIVITIES = valuesOf<Activity>()(
  'off-site',
  'arriving',
  'working',
  'walking-to-meeting',
  'in-meeting',
  'walking-to-lunch',
  'lunch',
  'returning-to-desk',
  'leaving',
)
export const LIGHT_LEVELS = valuesOf<LightLevel>()('off', 'dim', 'on')
export const DEVICE_STATES = valuesOf<DeviceState>()('off', 'on', 'in-use')
export const DAY_PHASES = valuesOf<DayPhase>()('night', 'arrival', 'standup', 'work', 'lunch', 'evening')
export const WEEKDAYS = valuesOf<Weekday>()('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')

// ----------------------------------------------------------------------------
// Run-time check
// ----------------------------------------------------------------------------

type Json = Record<string, unknown>

/** Problems found in a JSON value, as `path: what` lines; empty when it matches the contract. */
export class ShapeReport {
  readonly problems: string[] = []

  keys(value: unknown, keys: readonly string[], path: string, optional: readonly string[] = []): value is Json {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.problems.push(`${path}: expected an object, got ${JSON.stringify(value)}`)
      return false
    }
    const have = Object.keys(value)
    for (const k of have) if (!keys.includes(k)) this.problems.push(`${path}.${k}: unknown field (not in render-state.ts)`)
    for (const k of keys) if (!have.includes(k) && !optional.includes(k)) this.problems.push(`${path}.${k}: missing field`)
    return true
  }

  oneOf(value: unknown, values: readonly string[], path: string): void {
    if (typeof value !== 'string' || !values.includes(value)) this.problems.push(`${path}: unknown value ${JSON.stringify(value)}`)
  }

  type(value: unknown, type: 'number' | 'string' | 'boolean', path: string, nullable = false): void {
    if (nullable && value === null) return
    if (typeof value !== type) this.problems.push(`${path}: expected ${type}${nullable ? ' or null' : ''}, got ${JSON.stringify(value)}`)
  }

  point(value: unknown, path: string): void {
    if (!Array.isArray(value) || value.length !== 2 || value.some((v) => typeof v !== 'number')) this.problems.push(`${path}: expected [x, z], got ${JSON.stringify(value)}`)
  }

  list(value: unknown, path: string, each: (v: unknown, path: string) => void): void {
    if (!Array.isArray(value)) {
      this.problems.push(`${path}: expected an array`)
      return
    }
    value.forEach((v, i) => each(v, `${path}[${i}]`))
  }
}

export function checkLayout(layout: unknown, r = new ShapeReport()): ShapeReport {
  if (!r.keys(layout, LAYOUT_KEYS, 'layout', LAYOUT_OPTIONAL_KEYS)) return r
  for (const k of ['originX', 'originZ', 'width', 'depth', 'wallHeight', 'floors']) r.type(layout[k], 'number', `layout.${k}`)
  if (r.keys(layout.entrance, ENTRANCE_KEYS, 'layout.entrance')) {
    r.oneOf(layout.entrance.side, SIDES, 'layout.entrance.side')
    r.point(layout.entrance.spawn, 'layout.entrance.spawn')
  }
  if ('buildMode' in layout) r.oneOf(layout.buildMode, BUILD_MODES, 'layout.buildMode')
  if ('town' in layout) r.list(layout.town, 'layout.town', (t, p) => {
    if (!r.keys(t, TOWN_ITEM_KEYS, p)) return
    r.oneOf(t.kind, TOWN_KINDS, `${p}.kind`)
    r.type(t.id, 'string', `${p}.id`)
    for (const k of ['x', 'z', 'rot']) r.type(t[k], 'number', `${p}.${k}`)
  })
  if ('objects' in layout) r.list(layout.objects, 'layout.objects', (o, p) => {
    if (!r.keys(o, OBJECT_KEYS, p, OBJECT_OPTIONAL_KEYS)) return
    for (const k of ['id', 'design', 'room']) r.type(o[k], 'string', `${p}.${k}`)
    for (const k of ['x', 'z', 'rot']) r.type(o[k], 'number', `${p}.${k}`)
    r.point(o.footprint, `${p}.footprint`)
    if ('seatAt' in o && o.seatAt !== null) r.point(o.seatAt, `${p}.seatAt`)
    if ('onDesk' in o && o.onDesk !== null && r.keys(o.onDesk, OBJECT_ON_DESK_KEYS, `${p}.onDesk`)) {
      r.type(o.onDesk.desk, 'string', `${p}.onDesk.desk`)
      r.oneOf(o.onDesk.slot, OBJECT_DESK_SLOTS, `${p}.onDesk.slot`)
    }
    if ('places' in o) r.list(o.places, `${p}.places`, (q, at) => r.point(q, at))
    if ('assignedTo' in o) r.type(o.assignedTo, 'string', `${p}.assignedTo`, true)
    if (!r.keys(o.summary, OBJECT_SUMMARY_KEYS, `${p}.summary`, OBJECT_SUMMARY_OPTIONAL_KEYS)) return
    r.point(o.summary.footprint, `${p}.summary.footprint`)
    if ('seat_at' in o.summary && o.summary.seat_at !== null) r.point(o.summary.seat_at, `${p}.summary.seat_at`)
    r.oneOf(o.summary.mount, OBJECT_MOUNTS, `${p}.summary.mount`)
    r.type(o.summary.workstation, 'boolean', `${p}.summary.workstation`)
    for (const k of ['height', 'seats', 'lights', 'storage', 'screens', 'parts', 'cost']) r.type(o.summary[k], 'number', `${p}.summary.${k}`)
  })
  r.list(layout.rooms, 'layout.rooms', (room, p) => {
    if (!r.keys(room, ROOM_LAYOUT_KEYS, p, ROOM_LAYOUT_OPTIONAL_KEYS)) return
    if ('objectCapabilities' in room && r.keys(room.objectCapabilities, OBJECT_CAPABILITY_KEYS, `${p}.objectCapabilities`, OBJECT_CAPABILITY_OPTIONAL_KEYS))
      for (const k of OBJECT_CAPABILITY_KEYS) if (k in room.objectCapabilities) r.type(room.objectCapabilities[k], 'number', `${p}.objectCapabilities.${k}`)
    r.oneOf(room.kind, ROOM_KINDS, `${p}.kind`)
    r.type(room.label, 'string', `${p}.label`)
    for (const list of ['windows', 'doors'])
      r.list(room[list], `${p}.${list}`, (o, q) => {
        if (r.keys(o, OPENING_KEYS, q)) r.oneOf(o.side, SIDES, `${q}.side`)
      })
    r.list(room.desks, `${p}.desks`, (d, q) => {
      if (r.keys(d, DESK_KEYS, q)) r.point(d.seat, `${q}.seat`)
    })
    r.list(room.ceilingLights, `${p}.ceilingLights`, (l, q) => void r.keys(l, CEILING_LIGHT_KEYS, q))
    r.list(room.props, `${p}.props`, (o, q) => {
      if (!r.keys(o, PROP_KEYS, q)) return
      r.oneOf(o.kind, PROP_KINDS, `${q}.kind`)
      r.type(o.attachedTo, 'string', `${q}.attachedTo`, true)
    })
  })
  return r
}

export function checkRenderState(state: unknown, r = new ShapeReport()): ShapeReport {
  if (!r.keys(state, STATE_KEYS, 'state')) return r
  r.oneOf(state.weekday, WEEKDAYS, 'state.weekday')
  r.oneOf(state.phase, DAY_PHASES, 'state.phase')
  r.type(state.daylight, 'boolean', 'state.daylight')
  for (const k of ['step', 'day', 'minute', 'cashCents', 'layoutRev']) r.type(state[k], 'number', `state.${k}`)
  r.list(state.rooms, 'state.rooms', (room, p) => {
    if (!r.keys(room, ROOM_KEYS, p)) return
    r.oneOf(room.kind, ROOM_KINDS, `${p}.kind`)
    r.oneOf(room.light, LIGHT_LEVELS, `${p}.light`)
  })
  r.list(state.devices, 'state.devices', (d, p) => {
    if (!r.keys(d, DEVICE_KEYS, p)) return
    r.oneOf(d.kind, DEVICE_KINDS, `${p}.kind`)
    r.oneOf(d.state, DEVICE_STATES, `${p}.state`)
  })
  r.list(state.staff, 'state.staff', (s, p) => {
    if (!r.keys(s, STAFF_KEYS, p, STAFF_OPTIONAL_KEYS)) return
    r.oneOf(s.pose, POSES, `${p}.pose`)
    r.oneOf(s.activity, ACTIVITIES, `${p}.activity`)
    for (const k of ['seatedAt', 'meeting', 'workItem']) r.type(s[k], 'string', `${p}.${k}`, true)
    if ('seatedOn' in s) r.type(s.seatedOn, 'string', `${p}.seatedOn`, true)
    for (const k of ['x', 'z', 'fatigue', 'morale']) r.type(s[k], 'number', `${p}.${k}`)
    if (s.path !== null && r.keys(s.path, PATH_KEYS, `${p}.path`)) {
      r.type(s.path.startStep, 'number', `${p}.path.startStep`)
      r.type(s.path.speed, 'number', `${p}.path.speed`)
      r.list(s.path.waypoints, `${p}.path.waypoints`, (w, q) => r.point(w, q))
    }
  })
  r.list(state.meetings, 'state.meetings', (m, p) => {
    if (!r.keys(m, MEETING_KEYS, p)) return
    r.type(m.speaker, 'string', `${p}.speaker`, true)
    r.type(m.active, 'boolean', `${p}.active`)
  })
  r.list(state.bubbles, 'state.bubbles', (b, p) => void r.keys(b, BUBBLE_KEYS, p))
  r.list(state.remarks, 'state.remarks', (b, p) => void r.keys(b, REMARK_KEYS, p))
  return r
}
