/**
 * The speech-bubble layer (FEAT-025, ADR-0062 decision 8, ADR-0018): a
 * Preact layer over the canvas that shows what the current speaker of a
 * meeting says.
 *
 * - Who speaks comes from the render state (`bubbles`, while the meeting is
 *   in session); the words come from the store's transcript by (job, seq),
 *   never from the sim (CLAUDE.md rule 2).
 * - The bubble hangs above the speaker's name label, by the labels' own
 *   projection (`GameScene.speechAnchor`), and never covers a label or the
 *   HUD (`layout.ts`); it is typed out over the turn and goes when the turn
 *   or the meeting ends.
 * - The words are model output: they are rendered as text, never as markup.
 *
 * Mounted on live session pages only: frozen `?t=` pages have none.
 */
import { render } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { RenderState } from '../../state/render-state'
import { placeBubble, typed, type Rect, type SpeechAnchor } from './layout'
import './bubbles.css'

/** One speech bubble to show: a meeting's utterance `seq` (the sim's), by `speaker`. */
export interface BubbleView {
  meeting: string
  seq: number
  speaker: string
  /** The meeting's standup job, whose transcript holds the words. */
  job: number | null
  chars: number
}

export interface BubbleSource {
  /** The bubbles of meetings in session now. */
  current(): BubbleView[]
  /** The words of a bubble (from the store), or null when there are none. */
  text(b: BubbleView): Promise<string | null>
  /** The speaker's name, for screen readers and the label row. */
  name?(staffId: string): string | undefined
  anchor(staffId: string): SpeechAnchor | null
  /** What a bubble must not cover: labels, the HUD, panels. */
  obstacles(): readonly Rect[]
  view(): { w: number; h: number }
  /** How long the turn lasts (wall ms): the typing takes most of it. */
  durationMs(chars: number): number
  now?(): number
  /** The element's size (tests give one; the browser measures). */
  measure?(el: HTMLElement): { w: number; h: number }
  /** Schedules the next frame; returns a cancel function. Default `requestAnimationFrame`. */
  schedule?(frame: () => void): () => void
}

const keyOf = (b: BubbleView) => `${b.meeting}:${b.seq}`

/** The bubbles of a render state: a turn in progress in a meeting still in session, with the meeting's job. */
/** The meeting name of a remark's bubble (ADR-0074): its words are found by `seq` alone. */
export const REMARK = 'remark'

export function bubblesOf(state: (Pick<RenderState, 'bubbles' | 'meetings'> & Partial<Pick<RenderState, 'remarks'>>) | null): BubbleView[] {
  if (!state) return []
  const out: BubbleView[] = []
  for (const b of state.bubbles ?? []) {
    const m = state.meetings?.find((x) => x.id === b.meeting)
    if (!m?.active) continue
    out.push({ meeting: b.meeting, seq: b.seq, speaker: b.speaker, job: m.job, chars: b.chars })
  }
  for (const r of state.remarks ?? []) out.push({ meeting: REMARK, seq: r.seq, speaker: r.speaker, job: null, chars: r.chars })
  return out
}

interface Known {
  text: string | null
  /** When the words were first shown (ms). */
  since: number | null
}

export function BubbleLayer({ source }: { source: BubbleSource }) {
  const now = () => (source.now ?? (() => performance.now()))()
  const [, setTick] = useState(0)
  const known = useRef(new Map<string, Known>())
  const els = useRef(new Map<string, HTMLDivElement>())
  const shown = useRef('')

  // One frame: re-render while a bubble is up (typing, following the speaker).
  useLayoutEffect(() => {
    let cancel = () => undefined as void
    const schedule = source.schedule ?? ((f) => {
      const id = requestAnimationFrame(f)
      return () => cancelAnimationFrame(id)
    })
    const frame = () => {
      const list = source.current()
      const sig = list.map(keyOf).join(',')
      if (list.length || sig !== shown.current) setTick((n) => n + 1)
      shown.current = sig
      cancel = schedule(frame)
    }
    cancel = schedule(frame)
    return () => cancel()
  }, [source])

  const list = source.current()
  const live = new Set(list.map(keyOf))
  for (const k of known.current.keys()) if (!live.has(k)) known.current.delete(k)
  for (const b of list) {
    const k = keyOf(b)
    if (known.current.has(k)) continue
    const entry: Known = { text: null, since: null }
    known.current.set(k, entry)
    void source
      .text(b)
      .then((t) => {
        entry.text = t
      })
      .catch(() => undefined)
  }

  // Placement after the bubbles are in the DOM, with their real size.
  useLayoutEffect(() => {
    const obstacles = source.obstacles()
    const view = source.view()
    const placed: Rect[] = []
    for (const b of list) {
      const el = els.current.get(keyOf(b))
      if (!el) continue
      const anchor = source.anchor(b.speaker)
      const size = source.measure ? source.measure(el) : { w: el.offsetWidth, h: el.offsetHeight }
      const r = anchor ? placeBubble(anchor, size, [...obstacles, ...placed], view) : null
      if (!r) {
        el.style.visibility = 'hidden'
        continue
      }
      placed.push(r)
      el.style.visibility = 'visible'
      el.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`
    }
  })

  const t = now()
  return (
    <div class="speech-bubbles" aria-live="polite" aria-label="Meeting speech">
      {list.map((b) => {
        const k = keyOf(b)
        const entry = known.current.get(k)
        if (!entry?.text) return null
        if (entry.since == null) entry.since = t
        const name = source.name?.(b.speaker)
        return (
          <div
            key={k}
            ref={(el) => {
              if (el) els.current.set(k, el)
              else els.current.delete(k)
            }}
            class="speech-bubble"
            data-speaker={b.speaker}
            data-meeting={b.meeting}
            data-seq={String(b.seq)}
            style={{ visibility: 'hidden' }}
          >
            {name ? <span class="speech-bubble-name">{name}</span> : null}
            <span class="speech-bubble-typed" aria-hidden="true">
              {typed(entry.text, t - entry.since, source.durationMs(b.chars))}
            </span>
            <span class="speech-bubble-full">{entry.text}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Mounts the layer into `root` (the HUD layer); returns an unmount. */
export function mountBubbles(root: HTMLElement, source: BubbleSource): () => void {
  const host = document.createElement('div')
  host.className = 'speech-bubbles-host'
  root.append(host)
  render(<BubbleLayer source={source} />, host)
  return () => {
    render(null, host)
    host.remove()
  }
}
