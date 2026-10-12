/**
 * What a room's placed objects provide (ADR-0065 §4, ADR-0088), from the totals the sim writes
 * (`RoomLayout.objectCapabilities`) and, for the free workstations, who calls each workstation
 * object home (`assignedTo`, when the layout says). Nothing here is counted from designs: the
 * sim's totals are shown as they are.
 */
import type { RoomLayout } from '../../state/render-state'
import { assignedOf, type PlacedObjectLayout } from '../../render/bricks/objects'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The room's totals as short phrases, workstations first ("2 workstations (1 free)"); empty when it has none. */
export function roomProvides(room: Pick<RoomLayout, 'id' | 'objectCapabilities'>, objects: readonly PlacedObjectLayout[]): string[] {
  const c = room.objectCapabilities
  if (!c) return []
  const out: string[] = []
  if (c.workstations > 0) {
    const mine = objects.filter((o) => o.room === room.id && o.summary?.workstation)
    const said = mine.some((o) => assignedOf(o) !== undefined)
    const taken = mine.filter((o) => typeof assignedOf(o) === 'string').length
    out.push(`${plural(c.workstations, 'workstation')}${said ? ` (${Math.max(0, c.workstations - taken)} free)` : ''}`)
  }
  if (c.seats > 0) out.push(plural(c.seats, 'seat'))
  if (c.screens > 0) out.push(plural(c.screens, 'screen'))
  if (c.lights > 0) out.push(plural(c.lights, 'light'))
  if (c.storage > 0) out.push(`shelves of ${c.storage} stud²`)
  return out
}

export function RoomProvides({ room, objects }: { room: Pick<RoomLayout, 'id' | 'objectCapabilities'>; objects: readonly PlacedObjectLayout[] }) {
  const facts = roomProvides(room, objects)
  if (!facts.length) return null
  return (
    <p class="build-hint" data-testid="room-provides">
      Your designs here provide: {facts.join(' · ')}
    </p>
  )
}

// ---------------------------------------------------------------------------------------------
// What a design provides, under the accepted summary rules (ADR-0088 decision 1, construction-kit.md §12.4)

/** The kit's bounds (`crates/kit` summary.rs): a work surface's top at desk height and its smallest area. */
export const DESK_TOP_CM = [70, 80] as const
export const MIN_WORK_SURFACE = 64
const STUD_MM = 62.5

/** What the facts need of a compiled design: its summary and its evaluated ports. */
export interface FactsInput {
  summary: {
    mount: string
    workstation: boolean
    work_surface: number
    screens: number
    seats: number
    seat_at?: [number, number] | null
  }
  ports: ReadonlyArray<{ id: string; at: [number, number, number]; accepts: string[] }>
  /** `[w, d, h]` studs, studs, plates. */
  bounds: readonly number[] | null
}

export type WorkstationFacts =
  | { workstation: true; seat: [number, number] | null; text: string }
  | { workstation: false; why: string[]; text: string }

const metres = (mm: number) => `${(mm / 1000).toFixed(2)} m`

/**
 * Whether staff can work at a design, and why not: the kit's verdict (`summary.workstation`) with
 * the seat (the summary's `seat_at`, else the first port that accepts a seat), or the rules it
 * misses that the summary shows. The kit does not report paper parts, so a missing screen is named
 * only when it is the one rule left.
 */
export function workstationFacts(c: FactsInput): WorkstationFacts {
  const s = c.summary
  const seatPort = c.ports.find((p) => p.accepts.includes('seat'))
  if (s.workstation) {
    let seat: [number, number] | null = Array.isArray(s.seat_at) ? [s.seat_at[0], s.seat_at[1]] : null
    if (!seat && seatPort && c.bounds) seat = [(seatPort.at[0] - c.bounds[0] / 2) * STUD_MM, (seatPort.at[1] - c.bounds[1] / 2) * STUD_MM]
    const where = seat ? ` (seat at x ${metres(seat[0])}, z ${metres(seat[1])} from its centre)` : ''
    return { workstation: true, seat, text: `A workstation: staff can work here${where}.` }
  }
  const why: string[] = []
  if (!seatPort) why.push('no port that accepts a seat')
  if (s.work_surface === 0) why.push(`no flat top at desk height (${DESK_TOP_CM[0]}–${DESK_TOP_CM[1]} cm)`)
  else if (s.work_surface < MIN_WORK_SURFACE) why.push(`its desk-height top is too small (${s.work_surface} of ${MIN_WORK_SURFACE} stud², 0.25 m²)`)
  if (!why.length && s.screens === 0) why.push('no screen or paper part')
  return { workstation: false, why, text: why.length ? `Not a workstation: ${why.join('; ')}.` : 'Not a workstation.' }
}

/** Where a design goes in the office, by its mount (ADR-0087 decision 7, ADR-0088 decision 3). */
export function mountFact(s: Pick<FactsInput['summary'], 'mount' | 'screens'>): string {
  const m = s.mount.toLowerCase()
  if (m === 'surface') return `Goes on a desk: its ${s.screens > 0 ? 'screen' : 'lamp'} slot.`
  if (m === 'ceiling') return 'Hangs from the ceiling: not placeable yet.'
  return 'Stands on the floor.'
}
