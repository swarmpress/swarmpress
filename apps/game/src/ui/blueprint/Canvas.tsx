/**
 * The brick canvas (design §5.1): the blueprint drawn flat in SVG on a stud
 * grid. A page type is a building whose storeys are its slots in page order
 * (roof and foundation bands for the globals it uses), coloured by the first
 * block's intent; relationships are walkways, collections warehouses. Diff
 * marks: added outlined green, removed ghosted, changed yellow; a storey with
 * an issue is red. Text from the blueprint is data: JSX text only.
 *
 * The look (ADR-0086, the light Studio): a cream studded baseplate; each page
 * type a white brick house on its own grey lot, with a sign plaque (its name,
 * in its first storey's colour) and its route under the sign; walkways are
 * tiled paths; collections are stacks of cork bricks.
 */
import { useRef } from 'preact/hooks'
import { blockColour, hexOf } from '../../blueprint/colours'
import { repeated, type BuildingView, type Mark } from '../../blueprint/model'
import type { Blueprint } from '../../blueprint/types'
import { INK_DARK, inkFor, tint } from '../studio/bricks'

export const STUD = 8
export const BUILDING_W = 16 * STUD
const GAP = 5 * STUD
const LABEL_H = 6 * STUD
const BAND_H = STUD + 2
const STOREY_H = 3 * STUD + 2
const TOP = 2 * STUD

export interface Selection {
  type: string
  slot?: string
}

/** Where a building stands, in studs from the default spot (editor layout, not part of the blueprint). */
export type Layout = Record<string, { dx: number; dy: number }>

const MARK_STROKE: Record<Exclude<Mark, null>, string> = {
  added: '#157a3d',
  removed: '#8a8f99',
  changed: '#c98a00',
}
const ISSUE = '#c4281c'
/** The house walls and the lot it stands on. */
const WALL = '#fbfaf6'
const WALL_EDGE = '#bdb4a3'
const LOT = '#ddd5c5'
const LOT_EDGE = '#c4baa6'

const footer = (g: string) => g.includes('footer')

/** A sign's colour: the intent most of the type's blocks share (the first such on a tie), slate for a type without slots. */
function signColour(blocks: string[]): string {
  const count = new Map<string, number>()
  for (const b of blocks) count.set(blockColour(b), (count.get(blockColour(b)) ?? 0) + 1)
  let best = 'grey-dark'
  let n = 0
  for (const [c, k] of count) if (k > n) [best, n] = [c, k]
  return best
}

interface Placed {
  view: BuildingView
  x: number
  y: number
  h: number
  storeyY: number[]
}

function place(buildings: BuildingView[], layout: Layout): Placed[] {
  return buildings.map((view, i) => {
    const off = layout[view.type.id] ?? { dx: 0, dy: 0 }
    const x = GAP / 2 + i * (BUILDING_W + GAP) + off.dx * STUD
    const y = TOP + off.dy * STUD
    const uses = view.type.uses ?? []
    let at = y + LABEL_H + uses.filter((g) => !footer(g)).length * BAND_H
    const storeyY: number[] = []
    for (const s of view.storeys) {
      storeyY.push(at)
      at += repeated(s.slot) ? STOREY_H * 1.5 : STOREY_H
    }
    if (view.type.slots === undefined) at += STOREY_H
    at += uses.filter(footer).length * BAND_H
    return { view, x, y, h: at - y, storeyY }
  })
}

export function BrickCanvas({
  bp,
  buildings,
  selected,
  onSelect,
  layout,
  onMove,
  onDropBlock,
}: {
  bp: Blueprint
  buildings: BuildingView[]
  selected: Selection | null
  onSelect: (s: Selection) => void
  layout: Layout
  /** Moves a building on the canvas by studs (editor layout; null: positions are fixed). */
  onMove: ((type: string, dx: number, dy: number) => void) | null
  /** A block dragged from the parts bin onto a storey (null: not editing). */
  onDropBlock: ((type: string, slot: string, block: string) => void) | null
}) {
  const placed = place(buildings, layout)
  const byId = new Map(placed.map((p) => [p.view.type.id, p]))
  const rels = bp.relationships ?? []
  const bottom = Math.max(TOP + LABEL_H + STOREY_H, ...placed.map((p) => p.y + p.h))
  const laneTop = bottom + 5 * STUD
  const collections = bp.collections ?? []
  const wareTop = laneTop + rels.length * 2 * STUD + 3 * STUD
  const width = Math.max(placed.reduce((m, p) => Math.max(m, p.x + BUILDING_W + GAP / 2), 0), collections.length * 12 * STUD + GAP, 60 * STUD)
  const height = wareTop + (collections.length ? 13 * STUD : 0) + 2 * STUD
  const drag = useRef<{ type: string; x: number; y: number; moved: boolean } | null>(null)

  const nudge = (e: KeyboardEvent, id: string) => {
    if (!onMove) return false
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (!d || !e.shiftKey) return false
    e.preventDefault()
    e.stopPropagation()
    onMove(id, d[0], d[1])
    return true
  }

  return (
    <svg
      class="bp-canvas"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={`Blueprint: ${buildings.filter((b) => b.index != null).length} page types, ${rels.length} relationships, ${collections.length} collections`}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || !onMove) return
        const dx = Math.round((e.clientX - d.x) / STUD)
        const dy = Math.round((e.clientY - d.y) / STUD)
        if (dx || dy) {
          onMove(d.type, dx, dy)
          d.x += dx * STUD
          d.y += dy * STUD
          d.moved = true
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
    >
      <defs>
        <pattern id="bp-studs" width={2 * STUD} height={2 * STUD} patternUnits="userSpaceOnUse">
          {/* A stud on the baseplate: its shadow, then its lit top. */}
          <circle cx={STUD + 0.6} cy={STUD + 0.9} r={2.6} class="bp-stud-shade" />
          <circle cx={STUD} cy={STUD} r={2.4} class="bp-stud" />
        </pattern>
        <pattern id="bp-stripes" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={3} height={6} fill="rgba(38,35,31,0.22)" />
        </pattern>
      </defs>
      <rect class="bp-plate" x={0} y={0} width={width} height={height} />
      <rect x={0} y={0} width={width} height={height} fill="url(#bp-studs)" />

      {/* Walkways: one per relationship, from building to building under the street. */}
      {rels.map((r, k) => {
        const a = byId.get(r.from)
        const b = byId.get(r.to)
        if (!a || !b) return null
        const y = laneTop + k * 2 * STUD
        const ax = a.x + BUILDING_W / 2 - 6
        const bx = b.x + BUILDING_W / 2 + 6
        const double = r.cardinality === 'many-to-many'
        return (
          <g key={`rel-${k}`} class="bp-walkway" data-relationship={`${r.from}>${r.to}:${r.kind}`}>
            {/* A tiled path: a grey edge, light tiles with seams. */}
            <path d={`M${ax} ${a.y + a.h + 22} V${y} H${bx} V${b.y + b.h + 22}`} fill="none" stroke="#b3aa97" stroke-width={double ? 14 : 10} stroke-linejoin="round" />
            <path d={`M${ax} ${a.y + a.h + 22} V${y} H${bx} V${b.y + b.h + 22}`} fill="none" stroke="#ece6d8" stroke-width={double ? 10 : 6} stroke-dasharray="10 2" stroke-linejoin="round" />
            <text x={(ax + bx) / 2} y={y - 9} class="bp-small bp-path-text" text-anchor="middle">
              {r.kind}
              {r.via ? ` · via ${r.via}` : ''}
            </text>
          </g>
        )
      })}

      {placed.map((p) => (
        <Building
          key={p.view.type.id}
          p={p}
          bp={bp}
          selected={selected}
          onSelect={onSelect}
          onDropBlock={onDropBlock}
          onKey={nudge}
          onGrab={
            onMove
              ? (e) => {
                  drag.current = { type: p.view.type.id, x: e.clientX, y: e.clientY, moved: false }
                }
              : null
          }
        />
      ))}

      {/* Warehouses: one per collection; the stack grows with the item count (log scale, capped). */}
      {collections.map((c, k) => {
        const x = GAP / 2 + k * 12 * STUD
        const tiles = Math.min(6, Math.max(1, Math.ceil(Math.log2((c.items ?? 0) + 1))))
        return (
          <g key={c.id} class="bp-warehouse" data-collection={c.id}>
            <title>{`Collection ${c.id}: ${c.items ?? '?'} items of ${c.type}, from ${c.from}`}</title>
            <rect x={x - 2} y={wareTop - 8} width={8 * STUD + 12} height={6 * 8 + 16} rx={4} fill={LOT} stroke={LOT_EDGE} />
            {Array.from({ length: tiles }, (_, t) => (
              <g key={t}>
                {t === tiles - 1 &&
                  Array.from({ length: 4 }, (_, k) => <rect key={k} x={x + 10 + k * 2 * STUD} y={wareTop + (5 - t) * 8 - 3} width={STUD - 2} height={3} rx={1} fill={hexOf('cork')} />)}
                <rect x={x + 4} y={wareTop + (5 - t) * 8} width={8 * STUD} height={7} rx={1.5} fill={hexOf('cork')} stroke="#6e624a" stroke-width={0.75} />
              </g>
            ))}
            <text x={x + 4} y={wareTop + 6 * 8 + 24} class="bp-label">
              {c.id}
            </text>
            <text x={x + 4} y={wareTop + 6 * 8 + 37} class="bp-small">
              {c.items ?? '?'} × {c.type}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Building({
  p,
  bp,
  selected,
  onSelect,
  onDropBlock,
  onKey,
  onGrab,
}: {
  p: Placed
  bp: Blueprint
  selected: Selection | null
  onSelect: (s: Selection) => void
  onDropBlock: ((type: string, slot: string, block: string) => void) | null
  onKey: (e: KeyboardEvent, id: string) => boolean
  onGrab: ((e: PointerEvent) => void) | null
}) {
  const { view, x, y } = p
  const t = view.type
  const ghost = view.mark === 'removed'
  const isSel = selected?.type === t.id && !selected.slot
  const label = t.label.en ?? Object.values(t.label)[0] ?? t.id
  const uses = t.uses ?? []
  const roofs = uses.filter((g) => !footer(g))
  const floors = uses.filter(footer)
  const bodyTop = y + LABEL_H
  const bodyH = p.h - LABEL_H
  const outline = view.issues.length ? ISSUE : view.mark ? MARK_STROKE[view.mark] : isSel ? INK_DARK : WALL_EDGE
  const globalColour = (g: string) => hexOf(blockColour(bp.globals?.[g]?.block))
  // The sign plaque: the first storey's colour, the name in whichever ink reads on it.
  const plaque = hexOf(signColour(t.slots?.flatMap((s) => s.blocks) ?? []))
  const sign = `${label.length > 17 ? `${label.slice(0, 16)}…` : label}${view.nav ? ' ★' : ''}`
  const signW = Math.min(BUILDING_W + 8, Math.max(56, sign.length * 7 + 18))
  const route = t.route ?? (t.source.kind === 'collection-item' ? `item of ${t.source.collection}` : t.id)
  const activate = (e: Event, s: Selection) => {
    e.stopPropagation()
    onSelect(s)
  }
  return (
    <g
      class={`bp-building${ghost ? ' is-ghost' : ''}`}
      data-building={t.id}
      data-mark={view.mark ?? undefined}
      opacity={ghost ? 0.35 : 1}
    >
      <g
        role="button"
        tabIndex={ghost ? -1 : 0}
        aria-pressed={isSel}
        aria-label={`Page type ${label} (${t.id})${view.mark ? `, ${view.mark}` : ''}${view.issues.length ? `, ${view.issues.length} issues` : ''}`}
        class="bp-hit"
        onClick={(e) => !ghost && activate(e, { type: t.id })}
        onKeyDown={(e) => {
          if (ghost || onKey(e, t.id)) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            activate(e, { type: t.id })
          }
        }}
        onPointerDown={(e) => !ghost && onGrab?.(e)}
      >
        {/* The lot: a grey plate the house stands on, a shade of depth below it. */}
        <rect x={x - 6} y={bodyTop - 10} width={BUILDING_W + 12} height={bodyH + 32} rx={4} fill={isSel ? '#b98a1c' : LOT_EDGE} />
        <rect x={x - 6} y={bodyTop - 10} width={BUILDING_W + 12} height={bodyH + 29} rx={4} fill={isSel ? '#f6d77e' : LOT} stroke={isSel ? INK_DARK : 'none'} stroke-width={1.5} />
        {t.pages != null && (
          <text x={x + BUILDING_W / 2} y={y + p.h + 15} text-anchor="middle" class="bp-small bp-pages">
            {t.pages} pages
          </text>
        )}
        {/* The sign: a plaque on two posts, the route on the lot's edge below it. */}
        <rect x={x + BUILDING_W / 2 - 14} y={y + 18} width={3} height={bodyTop - y - 18} fill="#8f8574" />
        <rect x={x + BUILDING_W / 2 + 11} y={y + 18} width={3} height={bodyTop - y - 18} fill="#8f8574" />
        <rect x={x + BUILDING_W / 2 - signW / 2} y={y + 1} width={signW} height={20} rx={4} fill={plaque} stroke="rgba(38,35,31,0.35)" class="bp-sign" />
        <text x={x + BUILDING_W / 2} y={y + 15} text-anchor="middle" class="bp-label bp-sign-text" fill={inkFor(plaque)}>
          {sign}
        </text>
        <text x={x + BUILDING_W / 2} y={y + 33} text-anchor="middle" class="bp-small bp-route">
          {route.length > 28 ? `${route.slice(0, 27)}…` : route}
        </text>
        {/* The studded top edge. */}
        {Array.from({ length: BUILDING_W / (2 * STUD) }, (_, k) => (
          <rect key={k} x={x + k * 2 * STUD + STUD / 2 + 1} y={bodyTop - 4} width={STUD - 2} height={4} rx={1} fill={roofs[0] ? globalColour(roofs[0]) : '#e7e3da'} stroke="rgba(38,35,31,0.25)" stroke-width={0.5} />
        ))}
        <rect x={x} y={bodyTop} width={BUILDING_W} height={bodyH} rx={2} fill={WALL} stroke={outline} stroke-width={view.mark || isSel || view.issues.length ? 3 : 1} stroke-dasharray={ghost ? '4 3' : undefined} />
      </g>
      {roofs.map((g, k) => (
        <rect key={g} class="bp-band" data-global={g} x={x} y={bodyTop + k * BAND_H} width={BUILDING_W} height={BAND_H - 1} fill={globalColour(g)}>
          <title>{`Header: ${g}`}</title>
        </rect>
      ))}
      {t.slots === undefined && (
        <rect x={x + 3} y={bodyTop + roofs.length * BAND_H + 1} width={BUILDING_W - 6} height={STOREY_H - 3} rx={1.5} fill={hexOf('grey-light')}>
          <title>Any blocks: the type does not constrain its body</title>
        </rect>
      )}
      {view.storeys.map((s, j) => {
        const sy = p.storeyY[j] + 1
        const h = (repeated(s.slot) ? STOREY_H * 1.5 : STOREY_H) - 3
        const first = s.slot.blocks[0]
        const optional = (s.slot.min ?? 0) === 0
        // An optional storey is a paler brick (and striped at its end), its ink read on that pale colour.
        const fill = optional ? tint(hexOf(blockColour(first)), 0.45) : hexOf(blockColour(first))
        const isS = selected?.type === t.id && selected.slot === s.slot.id
        const sGhost = s.mark === 'removed' || ghost
        const stroke = s.issues.length ? ISSUE : s.mark ? MARK_STROKE[s.mark] : isS ? INK_DARK : 'rgba(38,35,31,0.3)'
        const strong = !!(s.issues.length || s.mark || isS)
        return (
          <g
            key={`${s.slot.id}-${j}`}
            class="bp-storey"
            role="button"
            tabIndex={sGhost ? -1 : 0}
            aria-pressed={isS}
            aria-label={`Storey ${s.slot.id} of ${t.id}: ${s.slot.blocks.join(', ') || 'no blocks'}${optional ? ', optional' : ''}${s.mark ? `, ${s.mark}` : ''}${s.issues.length ? `, ${s.issues.length} issues` : ''}`}
            data-slot={`${t.id}/${s.slot.id}`}
            data-colour={blockColour(first)}
            data-mark={s.mark ?? undefined}
            data-issue={s.issues.length ? 'true' : undefined}
            opacity={s.mark === 'removed' ? 0.35 : 1}
            onClick={(e) => !sGhost && activate(e, { type: t.id, slot: s.slot.id })}
            onKeyDown={(e) => {
              if (sGhost) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activate(e, { type: t.id, slot: s.slot.id })
              }
            }}
            onDragOver={(e) => {
              if (onDropBlock && !sGhost) e.preventDefault()
            }}
            onDrop={(e) => {
              const block = e.dataTransfer?.getData('application/x-swarmpress-block')
              if (onDropBlock && block && !sGhost) {
                e.preventDefault()
                onDropBlock(t.id, s.slot.id, block)
              }
            }}
          >
            <rect x={x + 3} y={sy} width={BUILDING_W - 6} height={h} rx={1.5} fill={fill} stroke={stroke} stroke-width={strong ? 2.5 : 0.75} stroke-dasharray={s.mark === 'removed' || (optional && !strong) ? '4 3' : undefined} />
            {/* The brick's lit top edge. */}
            <rect x={x + 5} y={sy + 2} width={BUILDING_W - 10} height={2} rx={1} fill="rgba(255,255,255,0.35)" pointer-events="none" />
            {optional && <rect x={x + BUILDING_W - 20} y={sy + 1} width={16} height={h - 2} fill="url(#bp-stripes)" pointer-events="none" />}
            <text x={x + 8} y={sy + 15} class="bp-storey-text" fill={inkFor(fill)}>
              {s.slot.id}
              {s.slot.blocks.length > 1 ? ` · ${s.slot.blocks.length} blocks` : first ? ` · ${first}` : ''}
            </text>
            {s.slot.source && (
              // The pipe a tool feeds the storey through.
              <g class="bp-pipe" data-pipe={s.slot.source.tool}>
                <title>{`Filled by the tool ${s.slot.source.tool}`}</title>
                <rect x={x + BUILDING_W - 16} y={sy + 4} width={10} height={6} rx={1} fill="#5f625d" />
                <rect x={x + BUILDING_W - 8} y={sy - 2} width={6} height={10} rx={1} fill="#5f625d" />
              </g>
            )}
            {s.issues.length > 0 && <rect x={x + BUILDING_W - 11} y={sy + h - 9} width={7} height={7} rx={1} fill={ISSUE} stroke="#fff" />}
          </g>
        )
      })}
      {floors.map((g, k) => (
        <rect key={g} class="bp-band" data-global={g} x={x} y={y + p.h - (floors.length - k) * BAND_H} width={BUILDING_W} height={BAND_H - 1} fill={globalColour(g)}>
          <title>{`Footer: ${g}`}</title>
        </rect>
      ))}
    </g>
  )
}
