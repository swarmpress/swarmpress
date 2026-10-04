/**
 * Information surfaces of the brick office spike (FEAT-082, ADR-0063,
 * docs/design/brick-office.md section 6): a desk monitor and the whiteboard.
 *
 * - **Far:** a glow colour from the render state only (the monitor's state,
 *   the person's pose and work item), so the renderer still decides nothing
 *   (rule 8).
 * - **Close:** a view drawn on a 2D canvas from a template. Its text comes
 *   from the browser store through the lookups `main.ts` hands in, never
 *   from the sim (rule 2). Model output is untrusted: it is drawn as text
 *   only (`fillText`), never parsed as markup, and cleaned of control
 *   characters first.
 * - **Budget:** only visible surfaces at the close level redraw, when their
 *   content or level changed, round-robin, at most `SURFACE_BUDGET` a frame.
 *
 * Pure apart from `paint*`, which take a 2D context (absent under NullEngine).
 */
import type { Pose } from '../../state/render-state'

export const SURFACE_BUDGET = 4
/** A surface is drawn close when it spans at least this many device pixels on screen. */
export const CLOSE_PX = 72

export type SurfaceLevel = 'off' | 'far' | 'close'

// ---------------------------------------------------------------- text

/** Text from the store or a model, made safe to draw: no control or format characters, one line, trimmed. */
export function cleanText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // C0/C1 controls, bidi overrides and isolates, zero-width marks: all drawn as nothing or a space.
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cuts `text` to fit `maxWidth` by `measure`, ending in an ellipsis when cut. */
export function truncate(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text
  const chars = Array.from(text)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(chars.slice(0, mid).join('').trimEnd() + '…') <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? '' : chars.slice(0, lo).join('').trimEnd() + '…'
}

/** Breaks `text` into at most `maxLines` lines of `maxWidth`, the last one truncated. */
export function wrap(text: string, maxWidth: number, maxLines: number, measure: (s: string) => number): string[] {
  const words = text.split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (measure(next) <= maxWidth || !line) {
      line = next
      continue
    }
    if (lines.length === maxLines - 1) {
      line = `${line} ${words.slice(i).join(' ')}`
      break
    }
    lines.push(line)
    line = words[i]
  }
  if (line) lines.push(line)
  return lines.slice(0, maxLines).map((l) => truncate(l, maxWidth, measure))
}

/** Width estimate for tests and pages without a canvas (as the label atlas does). */
export const estimate = (px: number) => (s: string) => Math.ceil(Array.from(s).length * px * 0.56)

// ---------------------------------------------------------------- the monitor

export interface MonitorFacts {
  /** From the render state. */
  on: boolean
  pose: Pose | null
  workItem: string | null
  staff: string | null
}

export interface MonitorText {
  name: string
  job: string
  stage: string
}

/** Far level: the glow colour (linear RGB) from render-state facts only. */
export function monitorGlow(f: MonitorFacts): [number, number, number] {
  if (!f.on) return [0, 0, 0]
  if (f.pose === 'type' && f.workItem) return [0.62, 0.82, 1.0]
  if (f.workItem) return [0.42, 0.6, 0.85]
  return [0.18, 0.28, 0.42]
}

export interface MonitorView {
  w: number
  h: number
  lines: Array<{ text: string; px: number; y: number; bold?: boolean; dim?: boolean }>
  busy: boolean
}

/** The close view of a monitor: name, job and stage, laid out for a `w × h` canvas. */
export function monitorView(text: MonitorText, f: MonitorFacts, w: number, h: number, measure: (px: number) => (s: string) => number = estimate): MonitorView {
  const pad = Math.round(w * 0.06)
  const inner = w - 2 * pad
  const big = Math.round(h * 0.17)
  const small = Math.round(h * 0.12)
  const name = truncate(cleanText(text.name) || 'Free desk', inner, measure(big))
  const busy = !!f.workItem
  const job = busy ? wrap(cleanText(text.job) || 'Untitled work item', inner, 2, measure(small)) : [f.on ? 'No work item' : 'Off']
  const stage = busy ? truncate(cleanText(text.stage), inner, measure(small)) : ''
  const lines: MonitorView['lines'] = [{ text: name, px: big, y: pad + big, bold: true }]
  let y = pad + big + Math.round(small * 1.6)
  for (const l of job) {
    lines.push({ text: l, px: small, y })
    y += Math.round(small * 1.3)
  }
  if (stage) lines.push({ text: stage, px: small, y: h - pad, dim: true })
  return { w, h, lines, busy }
}

// ---------------------------------------------------------------- the whiteboard

export const BOARD_COLUMNS = ['brief', 'draft', 'review', 'approval', 'published'] as const
export type BoardColumn = (typeof BOARD_COLUMNS)[number]
export const BOARD_TITLES: Record<BoardColumn, string> = { brief: 'Brief', draft: 'Draft', review: 'Review', approval: 'Approval', published: 'Published' }

/** The parts of a plan item the board reads (structurally the overlay's `WorkItemJson`). */
export interface PlanItemLike {
  id: string
  status: string
  phases: ReadonlyArray<{ kind: string; state: string }>
}

/** The column of a plan item, or null when it is not on the board (cancelled). */
export function boardColumn(item: PlanItemLike): BoardColumn | null {
  switch (item.status) {
    case 'cancelled':
      return null
    case 'published':
      return 'published'
    case 'approved':
    case 'scheduled':
      return 'approval'
    case 'in-review':
      return 'review'
    case 'backlog':
    case 'planned':
      return 'brief'
  }
  // In progress or blocked: by the phase being worked on.
  const active = item.phases.find((p) => p.state === 'working' || p.state === 'blocked') ?? item.phases.find((p) => p.state !== 'done')
  switch (active?.kind) {
    case undefined:
    case 'research':
    case 'outline':
      return 'brief'
    case 'review':
      return 'review'
    case 'publish':
      return 'approval'
    default:
      return 'draft'
  }
}

export interface BoardCard {
  id: string
  title: string
  column: BoardColumn
}

/** The board's cards from the store's plan and its text (titles), in plan order. */
export function boardCards(items: readonly PlanItemLike[], titleOf: (id: string) => string | undefined): BoardCard[] {
  const out: BoardCard[] = []
  for (const it of items) {
    const column = boardColumn(it)
    if (column) out.push({ id: it.id, title: cleanText(titleOf(it.id)) || it.id, column })
  }
  return out
}

export interface BoardView {
  w: number
  h: number
  /** Card text size and card height, px. */
  cardPx: number
  rowH: number
  head: number
  columns: Array<{ column: BoardColumn; title: string; x: number; cards: string[][]; more: number }>
}

/** The close view of the whiteboard: five columns, the newest cards that fit (two lines each), "+N" for the rest. */
export function boardView(cards: readonly BoardCard[], w: number, h: number, measure: (px: number) => (s: string) => number = estimate): BoardView {
  const colW = w / BOARD_COLUMNS.length
  const cardPx = Math.max(10, Math.round(colW / 11))
  const head = Math.round(cardPx * 2.2)
  const rowH = Math.round(cardPx * 2.9)
  const fits = Math.max(1, Math.floor((h - head - rowH * 0.6) / rowH))
  return {
    w,
    h,
    cardPx,
    rowH,
    head,
    columns: BOARD_COLUMNS.map((column, i) => {
      const all = cards.filter((c) => c.column === column)
      const shown = all.slice(-fits)
      return {
        column,
        title: BOARD_TITLES[column],
        x: Math.round(i * colW),
        cards: shown.map((c) => wrap(c.title, colW - 18, 2, measure(cardPx))),
        more: all.length - shown.length,
      }
    }),
  }
}

/** A key of what a view shows: a surface redraws only when it changes. */
export const viewKey = (v: unknown) => JSON.stringify(v)

// ---------------------------------------------------------------- painting

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

export function paintMonitor(ctx: CanvasRenderingContext2D, v: MonitorView): void {
  ctx.fillStyle = v.busy ? '#16324a' : '#101a24'
  ctx.fillRect(0, 0, v.w, v.h)
  ctx.textBaseline = 'alphabetic'
  for (const l of v.lines) {
    ctx.font = `${l.bold ? 600 : 400} ${l.px}px ${FONT}`
    ctx.fillStyle = l.dim ? '#9cc3e6' : '#eef6ff'
    ctx.fillText(l.text, Math.round(v.w * 0.06), l.y)
  }
}

const NOTE: Record<BoardColumn, string> = { brief: '#f5e27a', draft: '#9fd3f5', review: '#f5b97a', approval: '#e4a6e8', published: '#a8e0a0' }

export function paintBoard(ctx: CanvasRenderingContext2D, v: BoardView): void {
  ctx.fillStyle = '#f4f5f2'
  ctx.fillRect(0, 0, v.w, v.h)
  const { head, cardPx, rowH } = v
  const colW = v.w / BOARD_COLUMNS.length
  ctx.textBaseline = 'middle'
  for (const c of v.columns) {
    ctx.fillStyle = '#2b3138'
    ctx.font = `600 ${Math.round(cardPx * 1.25)}px ${FONT}`
    ctx.fillText(c.title, c.x + 8, head / 2)
    ctx.fillRect(c.x + 4, head - 4, colW - 8, 2)
    ctx.font = `400 ${cardPx}px ${FONT}`
    c.cards.forEach((lines, i) => {
      const y = head + 6 + i * rowH
      ctx.fillStyle = NOTE[c.column]
      ctx.fillRect(c.x + 4, y, colW - 8, rowH - 6)
      ctx.fillStyle = '#20252b'
      lines.forEach((t, k) => ctx.fillText(t, c.x + 9, y + (rowH - 6) / 2 + (k - (lines.length - 1) / 2) * cardPx * 1.15))
    })
    if (c.more > 0) {
      ctx.fillStyle = '#5a636c'
      ctx.fillText(`+${c.more}`, c.x + 8, head + 6 + c.cards.length * rowH + rowH / 2)
    }
  }
}

// ---------------------------------------------------------------- the update budget

export interface SurfaceCandidate {
  id: string
  visible: boolean
  level: SurfaceLevel
  /** What the surface would show now (`viewKey`). */
  key: string
}

/**
 * Which surfaces redraw this frame: visible, at the close level, whose key
 * differs from what they last drew; at most `budget`, round-robin from
 * where the last frame stopped, so no surface starves.
 */
export class SurfaceScheduler {
  private readonly drawn = new Map<string, string>()
  private cursor = 0

  constructor(readonly budget = SURFACE_BUDGET) {}

  pick(candidates: readonly SurfaceCandidate[]): string[] {
    const due = candidates.filter((c) => c.visible && c.level === 'close' && this.drawn.get(c.id) !== c.key)
    if (due.length === 0) return []
    const ids = candidates.map((c) => c.id)
    const n = ids.length
    const start = this.cursor % n
    const order = due.slice().sort((a, b) => ((ids.indexOf(a.id) - start + n) % n) - ((ids.indexOf(b.id) - start + n) % n))
    const picked = order.slice(0, this.budget)
    for (const c of picked) this.drawn.set(c.id, c.key)
    this.cursor = (ids.indexOf(picked[picked.length - 1].id) + 1) % n
    return picked.map((c) => c.id)
  }

  /** Forget what a surface drew (it left the close level), so it redraws when it comes back. */
  forget(id: string): void {
    this.drawn.delete(id)
  }
}
