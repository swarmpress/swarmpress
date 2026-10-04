/**
 * Name and work labels: what they say and where they go (FEAT-024). Pure;
 * `labels.ts` draws them.
 *
 * The text comes from two lookups the scene is given (the renderer reads no
 * store): who a person is, and what a work item is called. The sim's own
 * `name` and `role` are the fallback, so a scene without lookups still labels
 * its people.
 */
import type { StaffRender } from '../../state/render-state'

export interface PersonInfo {
  name: string
  /** Role slug or display text. */
  role: string
}

export interface SceneLookups {
  /** Name and role of a person; undefined falls back to the render state's own. */
  staff?(staffId: string): PersonInfo | undefined
  /** Title of a work item; undefined falls back to a label made from the id. */
  workItem?(workItemId: string): string | undefined
}

export interface LabelText {
  name: string
  role: string
  /** What the person is working on, or null when the sim has them on no work item. */
  work: string | null
}

export const MAX_NAME_CHARS = 22
export const MAX_ROLE_CHARS = 20
export const MAX_WORK_CHARS = 30

/** Cut at a word boundary where one is near, with an ellipsis. */
export function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** `photo-editor` → `photo editor`. */
export const humanRole = (role: string) => role.replace(/[_-]+/g, ' ').trim()

/** `work-item-3` → `Work item 3`: what a label says before the title is known. */
export function fallbackWorkLabel(workItemId: string): string {
  const t = workItemId.replace(/[_-]+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : 'Work item'
}

/** The role is shown next to the name only from this zoom (half-height of the view, metres) inwards. */
export const ROLE_ZOOM = 9

export function labelText(s: Pick<StaffRender, 'id' | 'name' | 'role' | 'workItem'>, lookups: SceneLookups | undefined, withRole = true): LabelText {
  const who = lookups?.staff?.(s.id)
  const title = s.workItem ? lookups?.workItem?.(s.workItem)?.trim() : undefined
  return {
    name: truncate(who?.name || s.name || s.id, MAX_NAME_CHARS),
    role: withRole ? truncate(humanRole(who?.role ?? s.role ?? ''), MAX_ROLE_CHARS) : '',
    work: s.workItem ? truncate(title || fallbackWorkLabel(s.workItem), MAX_WORK_CHARS) : null,
  }
}

export const sameText = (a: LabelText | undefined, b: LabelText) => !!a && a.name === b.name && a.role === b.role && a.work === b.work

// ----------------------------------------------------------------------------
// Fade
// ----------------------------------------------------------------------------

/** Labels keep their size on screen; from this zoom (half-height of the view, metres) outwards they fade … */
export const LABEL_FADE_FROM = 15
/** … and at this zoom they are gone: a person is then about as tall as a label. */
export const LABEL_FADE_TO = 21

/** Opacity of the labels at a zoom. A function of the zoom only: a still camera gives a still image. */
export function labelAlpha(zoom: number): number {
  if (zoom <= LABEL_FADE_FROM) return 1
  if (zoom >= LABEL_FADE_TO) return 0
  return (LABEL_FADE_TO - zoom) / (LABEL_FADE_TO - LABEL_FADE_FROM)
}

// ----------------------------------------------------------------------------
// Placement
// ----------------------------------------------------------------------------

/**
 * The orthographic view as the labels see it: the camera's right and up
 * vectors, its target, pixels per metre and the render size.
 */
export interface ViewBasis {
  rx: number
  ry: number
  rz: number
  ux: number
  uy: number
  uz: number
  tx: number
  ty: number
  tz: number
  /** Render pixels per metre. */
  ppm: number
  viewW: number
  viewH: number
}

/**
 * The screen projection labels and speech bubbles share: a world point →
 * render pixels from the view's centre (x right, y up), snapped to whole
 * pixels, plus `liftPx` upwards. Writes into `out` (nothing allocated per frame).
 */
export function projectOffset(b: ViewBasis, x: number, y: number, z: number, liftPx: number, out: { ax: number; ay: number }): void {
  const dx = x - b.tx
  const dy = y - b.ty
  const dz = z - b.tz
  out.ax = Math.round(b.viewW / 2 + (dx * b.rx + dy * b.ry + dz * b.rz) * b.ppm) - b.viewW / 2
  out.ay = Math.round(b.viewH / 2 + (dx * b.ux + dy * b.uy + dz * b.uz) * b.ppm + liftPx) - b.viewH / 2
}

/** A centred offset (render pixels, y up) as CSS pixels from the canvas' top-left. */
export function offsetToCss(b: Pick<ViewBasis, 'viewW' | 'viewH'>, ax: number, ay: number, px: number): { x: number; y: number } {
  return { x: (b.viewW / 2 + ax) / px, y: (b.viewH / 2 - ay) / px }
}

/**
 * Label slots in screen pixels (x right, y up). A label is `w × h`, centred on
 * `ax`, with its bottom edge at `ay` unless another label is in the way; then
 * it is raised to the first free height (`y` is the result). Reused arrays:
 * nothing is allocated per frame.
 */
export interface LabelSlots {
  capacity: number
  ax: Float64Array
  ay: Float64Array
  w: Float64Array
  h: Float64Array
  y: Float64Array
  visible: Uint8Array
  order: Int32Array
}

export function createLabelSlots(capacity: number): LabelSlots {
  return {
    capacity,
    ax: new Float64Array(capacity),
    ay: new Float64Array(capacity),
    w: new Float64Array(capacity),
    h: new Float64Array(capacity),
    y: new Float64Array(capacity),
    visible: new Uint8Array(capacity),
    order: new Int32Array(capacity),
  }
}

export const LABEL_GAP = 2

/**
 * Stack overlapping labels upwards. Lower labels (people nearer the camera)
 * keep their place and the ones behind go above them, so a group reads as a
 * list in the order the people stand. Deterministic: ties go to the lower slot.
 */
export function stackLabels(s: LabelSlots, gap = LABEL_GAP): void {
  let n = 0
  for (let i = 0; i < s.capacity; i++) if (s.visible[i]) s.order[n++] = i
  // Insertion sort by the natural bottom edge, then by slot.
  for (let a = 1; a < n; a++) {
    const i = s.order[a]
    let b = a - 1
    while (b >= 0 && (s.ay[s.order[b]] > s.ay[i] || (s.ay[s.order[b]] === s.ay[i] && s.order[b] > i))) {
      s.order[b + 1] = s.order[b]
      b--
    }
    s.order[b + 1] = i
  }
  for (let a = 0; a < n; a++) {
    const i = s.order[a]
    let y = s.ay[i]
    // Each pass lifts the label over one blocker; at most one pass per placed label.
    for (let pass = 0; pass < a; pass++) {
      let lifted = false
      for (let b = 0; b < a; b++) {
        const j = s.order[b]
        if (Math.abs(s.ax[i] - s.ax[j]) >= (s.w[i] + s.w[j]) / 2 + gap) continue
        if (y >= s.y[j] + s.h[j] + gap || y + s.h[i] + gap <= s.y[j]) continue
        y = s.y[j] + s.h[j] + gap
        lifted = true
      }
      if (!lifted) break
    }
    s.y[i] = y
  }
}

/** The slot whose label covers the point, topmost drawn first; -1 for none. */
export function labelAt(s: LabelSlots, x: number, y: number): number {
  for (let i = 0; i < s.capacity; i++) {
    if (!s.visible[i]) continue
    if (Math.abs(x - s.ax[i]) <= s.w[i] / 2 && y >= s.y[i] && y <= s.y[i] + s.h[i]) return i
  }
  return -1
}

// ----------------------------------------------------------------------------
// Metrics (CSS pixels)
// ----------------------------------------------------------------------------

/** One fixed family on every platform that has it; metric-compatible fallbacks after it. */
export const LABEL_FONT = '"Liberation Sans", Arial, "Helvetica Neue", Helvetica, sans-serif'

export const LABEL = {
  padX: 6,
  chip: 6,
  chipGap: 4,
  roleGap: 5,
  nameFont: 11,
  roleFont: 10,
  workFont: 10,
  /** Height of the name line, and of the label without a work line. */
  line: 16,
  /** Height the work line adds. */
  workLine: 12,
  nameBaseline: 12,
  workBaseline: 25,
  radius: 5,
  maxWidth: 184,
} as const

/** Label size from its text widths, both dimensions even so the label can sit on whole pixels. */
export function labelSize(nameWidth: number, roleWidth: number, workWidth: number | null): { w: number; h: number } {
  const first = LABEL.chip + LABEL.chipGap + nameWidth + (roleWidth > 0 ? LABEL.roleGap + roleWidth : 0)
  const inner = Math.max(first, workWidth ?? 0)
  const w = Math.min(LABEL.maxWidth, Math.ceil(inner + LABEL.padX * 2))
  return { w: w + (w % 2), h: LABEL.line + (workWidth === null ? 0 : LABEL.workLine) }
}

/** Whether a point `dy` pixels above a label's bottom edge is on its work line. */
export function onWorkLine(text: LabelText, dy: number): boolean {
  return text.work !== null && dy <= LABEL.workLine
}
