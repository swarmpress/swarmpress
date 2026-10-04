/**
 * Speech bubbles (FEAT-025, ADR-0062 decision 8): where a bubble goes and how
 * much of its text is typed. Pure; `BubbleLayer.tsx` draws them.
 *
 * A bubble hangs above its speaker's name label (or head), centred on them,
 * and never covers a label, the HUD or a panel: it rises over whatever is in
 * the way, else goes below the speaker, else is not shown. Positions are CSS
 * pixels from the canvas' top-left (the labels' projection, render/characters).
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** The top of the speaker's head, and their label when it is drawn. */
export interface SpeechAnchor {
  x: number
  y: number
  label: Rect | null
}

/** Clear space around a bubble, CSS pixels. */
export const BUBBLE_GAP = 6
/** Clear space to the edge of the view. */
export const BUBBLE_MARGIN = 8
/** The share of a turn's time the typing takes; the rest shows the whole line. */
export const TYPING_SHARE = 0.75

/** Whether two rectangles come closer than `gap`. */
export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap
}

/**
 * The bubble's rectangle for a `size` bubble at `anchor` among `obstacles`
 * (labels, the speaker's own included, and the HUD) in a `view`; null when
 * no place is free.
 */
export function placeBubble(anchor: SpeechAnchor, size: { w: number; h: number }, obstacles: readonly Rect[], view: { w: number; h: number }): Rect | null {
  const { w, h } = size
  if (w + 2 * BUBBLE_MARGIN > view.w) return null
  const left = Math.min(Math.max(anchor.x - w / 2, BUBBLE_MARGIN), view.w - BUBBLE_MARGIN - w)
  const at = (top: number): Rect => ({ left, top, right: left + w, bottom: top + h })
  // Above the label (or the head), rising over what is in the way.
  let bottom = (anchor.label ? anchor.label.top : anchor.y) - BUBBLE_GAP
  for (let pass = 0; pass <= obstacles.length && bottom - h >= BUBBLE_MARGIN; pass++) {
    const r = at(bottom - h)
    const hit = obstacles.find((o) => overlaps(r, o, BUBBLE_GAP))
    if (!hit) return r
    bottom = Math.min(bottom, hit.top - BUBBLE_GAP)
  }
  // Below the label (or the head), sinking under what is in the way.
  let top = (anchor.label ? anchor.label.bottom : anchor.y) + BUBBLE_GAP
  for (let pass = 0; pass <= obstacles.length && top + h <= view.h - BUBBLE_MARGIN; pass++) {
    const r = at(top)
    const hit = obstacles.find((o) => overlaps(r, o, BUBBLE_GAP))
    if (!hit) return r
    top = Math.max(top, hit.bottom + BUBBLE_GAP)
  }
  return null
}

/** Characters (code points) of a `chars`-long line typed after `elapsedMs` of a `durationMs` turn. */
export function typedLength(chars: number, elapsedMs: number, durationMs: number): number {
  if (chars <= 0) return 0
  const typing = Math.max(1, durationMs * TYPING_SHARE)
  return Math.min(chars, Math.max(1, Math.ceil((chars * Math.max(0, elapsedMs)) / typing)))
}

/** The typed part of `text`. */
export function typed(text: string, elapsedMs: number, durationMs: number): string {
  const points = [...text]
  return points.slice(0, typedLength(points.length, elapsedMs, durationMs)).join('')
}
