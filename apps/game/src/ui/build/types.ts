/**
 * Build mode's data (ADR-0087): the layout the sim writes (`Sim.layout_json()`, with the town and
 * the company's build mode), the catalogue of what can be placed, and the build commands as the
 * JSON the sim reads. The sim is the only judge (rule 3): nothing here decides whether a placement
 * is allowed or what it costs; it only builds the command the sim validates and prices.
 *
 * Wire shapes (serde external tagging, crates/sim-core/src/commands.rs and geom.rs): positions in
 * millimetres (`PosMm`), rotations in quarter turns, rooms as `TileRect`s of 1 m tiles. The layout
 * speaks metres and radians.
 */
import designs from './kit-designs'
import mapping from '../../../../../kit/mapping.json'
import type { BuildingLayout } from '../../state/render-state'
import type { PlacedObjectLayout, ObjectSummary } from '../../render/bricks/objects'
import type { KitSummary } from './design-kit'
import { pascal } from '../commands'

/** A piece of the town (ADR-0087 decision 4), as the layout writes it: metres, radians. */
export interface TownItemLayout {
  id: string
  kind: string
  x: number
  z: number
  rot: number
}

export type BuildMode = 'sandbox' | 'economic'

export type { PlacedObjectLayout, ObjectSummary }

/** `BuildingLayout` plus what ADR-0087 adds: the town and the company's build mode; and the placed objects (K-4). */
export type BuildLayout = BuildingLayout & { town?: TownItemLayout[]; buildMode?: BuildMode; objects?: PlacedObjectLayout[] }

export type Rot = 0 | 1 | 2 | 3
export interface PosMm {
  x: number
  z: number
}
export type Placement = { Floor: { pos: PosMm; rot: Rot } } | { OnDesk: string }
export type SideVariant = 'North' | 'East' | 'South' | 'West'

/** The build commands (the sim agent adds them to commands.ts `Command`; until then they are cast there). */
export type BuildCommand =
  | {
      PlaceRoom: {
        kind: string
        rect: { x: number; z: number; w: number; d: number }
        floor: number
        doors: Array<{ side: SideVariant; at: number }>
        windows: Array<{ side: SideVariant; at_mm: number; width_mm: number }>
      }
    }
  | { Demolish: { Room: string } | { Equipment: string } }
  | { PlaceEquipment: { kind: string; placement: Placement } }
  | { MoveEquipment: { equipment: string; placement: Placement } }
  | { PlaceTownItem: { kind: string; pos: PosMm; rot: Rot } }
  | { MoveTownItem: { item: string; pos: PosMm; rot: Rot } }
  | { RemoveTownItem: { item: string } }
  /** A design of the player's own (ADR-0065 §4, K-4): by its hash, with the kit's summary of it (rule 2). */
  | { PlaceObject: { design: string; pos: PosMm; rot: Rot; summary: ObjectSummary } }
  | { MoveObject: { object: string; pos: PosMm; rot: Rot } }
  | { RemoveObject: { object: string } }

/** Metres to the sim's millimetres. */
export const mm = (m: number) => Math.round(m * 1000)
/** Radians (the layout) to quarter turns (the commands). */
export const quarter = (rad: number): Rot => (Math.round(rad / (Math.PI / 2)) & 3) as Rot
export const turn = (r: Rot, by = 1): Rot => ((((r + by) % 4) + 4) % 4) as Rot

/** Positions snap to two studs of the kit (`STUD` = 62.5 mm): the ghost moves on the stud grid. */
export const SNAP_MM = 125
export const snapMm = (m: number) => Math.round(mm(m) / SNAP_MM) * SNAP_MM
/** The sim's tile (geom.rs `TILE_MM`). */
export const TILE_M = 1

// ---------------------------------------------------------------------------------------------
// The catalogue

export interface CatalogueItem {
  /** The sim's variant (`DeskLamp`): what the command carries. */
  kind: string
  /** The layout's slug (`desk-lamp`): what the layout and the kit call it. */
  slug: string
  name: string
  /** A palette id of `kit/palette.json`: the icon's colour, the kit design's own main colour. */
  colour: string
  /** Monitors and lamps go on a desk (`Placement::OnDesk`). */
  onDesk: boolean
  /** A design of the player's own (K-4): its hash, its JSON (the ghost), its compiled summary (the command), its parts. */
  hash?: string
  design?: string
  summary?: ObjectSummary
  parts?: number
}

const deskPorts = (mapping as { desk_ports: Record<string, string> }).desk_ports
const equipmentDesigns = (mapping as { equipment: Record<string, string> }).equipment

/** The equipment kinds, in the kit mapping's order (the sim's `EquipmentKind::ALL`). */
export const EQUIPMENT: readonly CatalogueItem[] = Object.entries(equipmentDesigns).map(([slug, design]) => {
  const d = designs[design]
  return { kind: pascal(slug), slug, name: d?.name ?? slug, colour: d?.colour ?? 'grey-light', onDesk: slug in deskPorts }
})

export const equipmentBySlug = (slug: string) => EQUIPMENT.find((e) => e.slug === slug)

/** The town's pieces (ADR-0087 decision 4): the ones the player places and removes. */
export const TOWN_PIECES: readonly CatalogueItem[] = [
  { kind: 'Tree', slug: 'town-tree' },
  { kind: 'StreetLamp', slug: 'street-lamp' },
  { kind: 'Bench', slug: 'town-bench' },
].map(({ kind, slug }) => ({ kind, slug, name: designs[slug]?.name ?? kind, colour: designs[slug]?.colour ?? 'grey-light', onDesk: false }))

/** The sections' houses: they move, but are neither placed nor removed. */
export const HOUSES: Readonly<Record<string, string>> = {
  PlanHouse: 'Plan house',
  BuildingHouse: 'Building house',
  FactoryHouse: 'Factory house',
  ProjectsHouse: 'Projects house',
}

/** A town kind as the commands spell it, whether the layout writes `street-lamp` or `StreetLamp`. */
export const townVariant = (kind: string) => (/^[A-Z]/.test(kind) ? kind : pascal(kind))
export const isHouse = (kind: string) => townVariant(kind) in HOUSES
export function townName(kind: string): string {
  const v = townVariant(kind)
  return HOUSES[v] ?? TOWN_PIECES.find((p) => p.kind === v)?.name ?? v
}
export function townColour(kind: string): string {
  const v = townVariant(kind)
  if (v in HOUSES) return designs['town-house']?.colour ?? 'sand'
  return TOWN_PIECES.find((p) => p.kind === v)?.colour ?? 'grey-light'
}

/** Rooms the player can build. The minimum size mirrors `RoomKind::min_size` (building.rs); the sim checks it. */
export interface RoomTemplate {
  kind: string
  slug: string
  label: string
  min: [w: number, d: number]
}
export const ROOM_TEMPLATES: readonly RoomTemplate[] = (
  [
    ['meeting-room', 'Meeting room'],
    ['archive', 'Archive'],
    ['kitchen', 'Kitchen'],
    ['editor-office', "Editor's office"],
    ['newsroom', 'Newsroom'],
    ['photo-studio', 'Photo studio'],
    ['seo-lab', 'SEO lab'],
    ['translation-desk', 'Translation desk'],
    ['design-studio', 'Design studio'],
    ['strategy-room', 'Strategy room'],
    ['finance-office', 'Finance office'],
    ['ceo-office', 'CEO office'],
    ['server-room', 'Server room'],
  ] as const
).map(([slug, label]) => ({
  kind: pascal(slug),
  slug,
  label,
  min: slug === 'newsroom' ? [4, 4] : slug === 'server-room' ? [2, 2] : [3, 3],
}))

export const SIDES: readonly SideVariant[] = ['North', 'East', 'South', 'West']

// ---------------------------------------------------------------------------------------------
// The things in the building, by id

export interface PlacedItem {
  id: string
  slug: string
  room: string
  x: number
  z: number
  rot: Rot
  /** The desk it stands on. */
  on: string | null
}

/** Every placed item of the layout (desks, ceiling lights, props), by id. */
export function itemsOf(layout: BuildLayout | null): Map<string, PlacedItem> {
  const out = new Map<string, PlacedItem>()
  for (const r of layout?.rooms ?? []) {
    for (const d of r.desks) out.set(d.id, { id: d.id, slug: 'desk', room: r.id, x: d.x, z: d.z, rot: quarter(d.rot), on: null })
    for (const l of r.ceilingLights) out.set(l.id, { id: l.id, slug: 'ceiling-light', room: r.id, x: l.x, z: l.z, rot: 0, on: null })
    for (const p of r.props) out.set(p.id, { id: p.id, slug: p.kind, room: r.id, x: p.x, z: p.z, rot: quarter(p.rot), on: p.attachedTo })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Command constructors

const posOf = (x: number, z: number, exact: boolean): PosMm => (exact ? { x: mm(x), z: mm(z) } : { x: snapMm(x), z: snapMm(z) })

export const build = {
  placeRoom: (kind: string, rect: { x: number; z: number; w: number; d: number }, floor: number, door: { side: SideVariant; at: number } | null): BuildCommand => ({
    PlaceRoom: { kind, rect, floor, doors: door ? [door] : [], windows: [] },
  }),
  demolishRoom: (room: string): BuildCommand => ({ Demolish: { Room: room } }),
  demolishEquipment: (id: string): BuildCommand => ({ Demolish: { Equipment: id } }),
  /** On the floor at (x, z) metres, snapped to the stud grid unless `exact` (a turn in place keeps the position). */
  floor: (x: number, z: number, rot: Rot, exact = false): Placement => ({ Floor: { pos: posOf(x, z, exact), rot } }),
  onDesk: (desk: string): Placement => ({ OnDesk: desk }),
  placeEquipment: (kind: string, placement: Placement): BuildCommand => ({ PlaceEquipment: { kind, placement } }),
  moveEquipment: (equipment: string, placement: Placement): BuildCommand => ({ MoveEquipment: { equipment, placement } }),
  placeTown: (kind: string, x: number, z: number, rot: Rot): BuildCommand => ({ PlaceTownItem: { kind, pos: posOf(x, z, false), rot } }),
  moveTown: (item: string, x: number, z: number, rot: Rot, exact = false): BuildCommand => ({ MoveTownItem: { item, pos: posOf(x, z, exact), rot } }),
  removeTown: (item: string): BuildCommand => ({ RemoveTownItem: { item } }),
  placeObject: (design: string, summary: ObjectSummary, x: number, z: number, rot: Rot): BuildCommand => ({ PlaceObject: { design, pos: posOf(x, z, false), rot, summary } }),
  moveObject: (object: string, x: number, z: number, rot: Rot, exact = false): BuildCommand => ({ MoveObject: { object, pos: posOf(x, z, exact), rot } }),
  removeObject: (object: string): BuildCommand => ({ RemoveObject: { object } }),
}

/** The sim's mount variant for the kit's (`floor` → `Floor`). */
const mountVariant = (m: string) => (m ? m[0].toUpperCase() + m.slice(1) : 'Floor') as ObjectSummary['mount']

/**
 * What `PlaceObject` carries about a design: the numbers of the kit's compiled summary
 * (`KitBuild.summaryJson()`), never its text (rule 2). The sim validates and prices by them.
 */
export function objectSummary(s: KitSummary): ObjectSummary {
  return {
    footprint: [s.footprint[0], s.footprint[1]],
    height: s.height,
    mount: mountVariant(s.mount),
    seats: s.seats,
    workstation: s.workstation,
    lights: s.lights,
    storage: s.storage,
    screens: s.screens,
    parts: s.parts,
    cost: s.cost,
  }
}

/** Only floor-mounted designs can be placed (the sim's `PlaceObject` takes `Floor`). */
export const placeable = (s: Pick<KitSummary, 'mount'> | null | undefined) => !!s && s.mount.toLowerCase() === 'floor'

/** Cents as the shell shows money; zero is free (the sandbox, ADR-0087 decision 3). */
export function priceText(cents: number | null | undefined): string | null {
  if (cents === undefined) return 'Pricing…'
  if (cents === null) return null
  if (cents === 0) return 'Free'
  return `€${(cents / 100).toLocaleString('en', { maximumFractionDigits: cents % 100 ? 2 : 0 })}`
}
