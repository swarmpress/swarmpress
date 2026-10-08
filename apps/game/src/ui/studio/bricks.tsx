/**
 * The Studio's brick primitives (FEAT-100, ADR-0077): a brick with studs in
 * SVG, the tray of parts, and the feel of a drop (a short click and a settle;
 * sound off by default, motion off under `prefers-reduced-motion`). Colours
 * are palette ids (`kit/palette.json`) through `blueprint/colours`, so the
 * Studio, the canvas and the 3D town agree. Text is data: JSX text only.
 */
import { useState } from 'preact/hooks'
import { blockColour, CATALOGUE, CATEGORY_LABEL, hexOf, inkOn, type CatalogueBlock } from '../../blueprint/colours'

/** A brick seen from the front: a body with two to four studs on top. */
export function Brick({
  x,
  y,
  w,
  h,
  colour,
  label,
  studs = Math.max(2, Math.min(4, Math.round(w / 24))),
  dim = false,
  outline,
}: {
  x: number
  y: number
  w: number
  h: number
  /** A palette id. */
  colour: string
  label?: string
  studs?: number
  dim?: boolean
  outline?: string
}) {
  const fill = hexOf(colour)
  const gap = w / studs
  return (
    <g class="st-brick" opacity={dim ? 0.35 : 1}>
      {Array.from({ length: studs }, (_, k) => (
        <rect key={k} x={x + k * gap + gap / 2 - 5} y={y - 4} width={10} height={4} rx={1.5} fill={fill} class="st-stud" />
      ))}
      <rect x={x} y={y} width={w} height={h} rx={2.5} fill={fill} stroke={outline ?? 'rgba(0,0,0,0.35)'} stroke-width={outline ? 2.5 : 1} />
      <rect x={x + 2} y={y + 2} width={w - 4} height={3} rx={1.5} fill="rgba(255,255,255,0.22)" pointer-events="none" />
      {label && (
        <text x={x + w / 2} y={y + h / 2 + 4} text-anchor="middle" class="st-brick-text" fill={inkOn(fill)}>
          {label.length > 16 ? `${label.slice(0, 15)}…` : label}
        </text>
      )}
    </g>
  )
}

/** The tray's parts: the closed block catalogue by category, plus the site's own blocks. */
export function trayGroups(customBlocks: string[]): Array<{ id: string; label: string; parts: CatalogueBlock[] }> {
  const groups = new Map<string, CatalogueBlock[]>()
  for (const b of CATALOGUE) groups.set(b.category, [...(groups.get(b.category) ?? []), b])
  const out = [...groups.entries()].map(([id, parts]) => ({ id, label: CATEGORY_LABEL[id] ?? id, parts }))
  if (customBlocks.length) out.push({ id: 'custom', label: 'This site', parts: customBlocks.map((type) => ({ type, category: 'custom', intent: 'inform' as const, description: 'A block of this site' })) })
  return out
}

/**
 * The tray along the bottom: category tabs and the parts as bricks. A click
 * picks a part up (click a lit target to drop it, Esc to put it back); a
 * press-and-drag carries it to a target.
 */
export function Tray({
  customBlocks,
  picked,
  disabled,
  onPick,
  onDragStart,
}: {
  customBlocks: string[]
  picked: string | null
  disabled: boolean
  onPick: (block: string | null) => void
  onDragStart: (block: string, e: PointerEvent) => void
}) {
  const groups = trayGroups(customBlocks)
  const [cat, setCat] = useState(groups[0]?.id ?? 'core')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const parts = q ? groups.flatMap((g) => g.parts).filter((p) => p.type.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) : (groups.find((g) => g.id === cat)?.parts ?? [])
  return (
    <section class="st-tray" aria-label="Parts tray">
      <div class="st-tray-head">
        <div role="tablist" aria-label="Part categories" class="st-tray-tabs">
          {groups.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={!q && g.id === cat} class={`st-tray-tab${!q && g.id === cat ? ' is-active' : ''}`} onClick={() => (setCat(g.id), setQuery(''))}>
              {g.label} <span class="muted">{g.parts.length}</span>
            </button>
          ))}
        </div>
        <label class="st-tray-search">
          <span class="sr-only">Find a part</span>
          <input type="search" placeholder="Find a part (/)" value={query} data-tray-search onInput={(e) => setQuery(e.currentTarget.value)} />
        </label>
      </div>
      <ul class="st-tray-parts" role="list">
        {parts.map((p) => {
          const colour = p.category === 'custom' ? 'grey-light' : blockColour(p.type)
          const on = picked === p.type
          return (
            <li key={p.type}>
              <button
                type="button"
                class={`st-part${on ? ' is-picked' : ''}`}
                aria-pressed={on}
                disabled={disabled}
                title={`${p.description} (${p.category === 'custom' ? 'site' : p.intent})`}
                aria-label={`Pick up ${p.type}`}
                data-part={p.type}
                style={{ '--part': hexOf(colour), '--part-ink': inkOn(hexOf(colour)) } as Record<string, string>}
                onClick={() => onPick(on ? null : p.type)}
                onPointerDown={(e) => {
                  if (disabled || e.button !== 0) return
                  onDragStart(p.type, e)
                }}
              >
                <span class="st-part-studs" aria-hidden="true" />
                {p.type}
              </button>
            </li>
          )
        })}
        {!parts.length && <li class="small muted">No part matches.</li>}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------- feel

const SOUND_KEY = 'swarmpress.studio.sound'

/** Whether the click sound is on (a per-viewer setting; off by default and without storage). */
export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on'
  } catch {
    return false
  }
}

export function setSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    // no storage: the setting lasts this page only
  }
}

let audio: AudioContext | null = null

/** A short click when a brick snaps in (only with the sound on). */
export function snapClick() {
  if (!soundOn()) return
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(1800, t)
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.04)
    gain.gain.setValueAtTime(0.08, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + 0.07)
  } catch {
    // no audio: silence
  }
}
