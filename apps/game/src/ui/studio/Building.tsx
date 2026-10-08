/**
 * The Building workbench (FEAT-100, ADR-0077; design brick-studio.md §2): one
 * page type in front elevation, the page builder. Storeys are its slots in
 * page order, each holding its blocks as bricks coloured by intent; the roof
 * and the foundation are the globals it uses; a glass (dashed) storey is
 * optional, pillars mark a repeating one. Pick a part from the tray and the
 * places it may go light up: green studs where the site's checker accepts
 * it, a red seam with the checker's reason where it does not. A drop on a
 * storey adds the block to it; a drop in a gap makes a new storey there.
 *
 * `Elevation` is also the booklet's model view (FEAT-101): read-only, with
 * the step's storeys outlined and the rest dimmed.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { blockColour, hexOf } from '../../blueprint/colours'
import { CORE_TYPES, removeSlot, repeated, streetOrder, toggleUse, updateSlot, type BuildingView, type Mark } from '../../blueprint/model'
import type { Blueprint, BlueprintChange, ModelIssue } from '../../blueprint/types'
import type { Selection } from '../blueprint/Canvas'
import { Inspector } from '../blueprint/Inspector'
import { Brick, snapClick, Tray } from './bricks'
import { judgeAll, targetKey, type DropTarget, type Verdict } from './snap'

const W = 440
const PAD = 14
const BRICK_W = 128
const BRICK_H = 24
const BRICK_GAP = 8
const PER_ROW = Math.floor((W - 2 * PAD - 70) / (BRICK_W + BRICK_GAP))
const ROW_H = BRICK_H + 12
const BAND_H = 14
const GAP_H = 10
const GAP_H_ARMED = 26
const HEAD_H = 34

const MARK_STROKE: Record<Exclude<Mark, null>, string> = { added: '#7fcf9a', removed: '#a9adb8', changed: '#f0c060' }
const ISSUE = '#ff5a4f'
const OK = '#7fcf9a'
const footer = (g: string) => g.includes('footer')

export interface ElevationProps {
  bp: Blueprint
  view: BuildingView
  /** The picked part's verdicts by target key (armed), or null. */
  verdicts?: Map<string, Verdict> | null
  selectedSlot?: string | null
  /** Slot ids to outline (the booklet's step); the rest are dimmed when set. */
  highlight?: Set<string> | null
  /** The storey that just took a brick (the settle animation). */
  settled?: string | null
  onTarget?: (t: DropTarget) => void
  onSelectSlot?: (slot: string) => void
  onRemoveBlock?: (slot: string, block: string) => void
}

/** One page type drawn from the front (module docs). */
export function Elevation({ bp, view, verdicts = null, selectedSlot = null, highlight = null, settled = null, onTarget, onSelectSlot, onRemoveBlock }: ElevationProps) {
  const t = view.type
  const armed = !!verdicts
  const roofs = (t.uses ?? []).filter((g) => !footer(g))
  const floors = (t.uses ?? []).filter(footer)
  const label = t.label.en ?? Object.values(t.label)[0] ?? t.id
  const gapH = armed ? GAP_H_ARMED : GAP_H
  const storeyH = (n: number) => Math.max(1, Math.ceil(n / PER_ROW)) * ROW_H + 8
  let y = HEAD_H + roofs.length * BAND_H
  const rows: Array<{ kind: 'gap'; index: number; y: number } | { kind: 'storey'; s: (typeof view.storeys)[number]; y: number; h: number }> = []
  view.storeys.forEach((s, i) => {
    if (s.index != null) {
      rows.push({ kind: 'gap', index: s.index, y })
      y += gapH
    }
    const h = storeyH(s.slot.blocks.length)
    rows.push({ kind: 'storey', s, y, h })
    y += h
    void i
  })
  const live = view.storeys.filter((s) => s.index != null).length
  if (t.slots !== undefined) {
    rows.push({ kind: 'gap', index: live, y })
    y += gapH
  }
  if (t.slots === undefined) y += ROW_H + 8
  const floorTop = y
  const height = floorTop + floors.length * BAND_H + 18
  const globalFill = (g: string) => hexOf(blockColour(bp.globals?.[g]?.block))
  const verdictOf = (target: DropTarget) => verdicts?.get(targetKey(target))

  return (
    <svg class="st-elevation" width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="group" aria-label={`Building ${label} (${t.id}) from the front: ${live} storeys`} data-elevation={t.id}>
      <text x={PAD} y={18} class="st-title">
        {label}
      </text>
      <text x={PAD} y={30} class="bp-small">
        {t.route ?? (t.source.kind === 'collection-item' ? `item of ${t.source.collection}` : t.id)}
      </text>
      {roofs.map((g, k) => (
        <rect key={g} x={PAD} y={HEAD_H + k * BAND_H} width={W - 2 * PAD} height={BAND_H - 2} rx={2} fill={globalFill(g)} data-global={g}>
          <title>{`Roof (header): ${g}`}</title>
        </rect>
      ))}
      {t.slots === undefined && (
        <rect x={PAD} y={HEAD_H + roofs.length * BAND_H} width={W - 2 * PAD} height={ROW_H} fill={hexOf('grey-light')} opacity={0.6}>
          <title>Any blocks: this page type does not constrain its body</title>
        </rect>
      )}
      {rows.map((r) => {
        if (r.kind === 'gap') {
          const target: DropTarget = { kind: 'gap', type: t.id, index: r.index }
          const v = verdictOf(target)
          if (!armed) return <rect key={`gap-${r.index}`} x={PAD} y={r.y} width={W - 2 * PAD} height={gapH} fill="transparent" />
          return (
            <g
              key={`gap-${r.index}`}
              class={`st-target st-gap${v?.ok ? ' is-ok' : ' is-no'}`}
              role="button"
              tabIndex={0}
              data-drop={targetKey(target)}
              aria-label={v?.ok ? `Drop here as a new storey (position ${r.index + 1})` : `New storey at position ${r.index + 1}: not allowed. ${v?.reason ?? ''}`}
              aria-disabled={!v?.ok}
              onClick={() => v?.ok && onTarget?.(target)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && v?.ok) {
                  e.preventDefault()
                  onTarget?.(target)
                }
              }}
            >
              <title>{v?.ok ? 'A new storey here' : (v?.reason ?? 'Not here')}</title>
              <rect x={PAD} y={r.y + 3} width={W - 2 * PAD} height={gapH - 6} rx={3} fill={v?.ok ? 'rgba(127,207,154,0.18)' : 'transparent'} stroke={v?.ok ? OK : ISSUE} stroke-dasharray="5 4" stroke-width={1.5} opacity={v?.ok ? 1 : 0.45} />
              <text x={W / 2} y={r.y + gapH / 2 + 4} text-anchor="middle" class="bp-small">
                {v?.ok ? '+ new storey' : ''}
              </text>
            </g>
          )
        }
        const { s } = r
        const ghost = s.index == null
        const target: DropTarget = { kind: 'storey', type: t.id, slot: s.slot.id }
        const v = verdictOf(target)
        const optional = (s.slot.min ?? 0) === 0
        const sel = selectedSlot === s.slot.id
        const dim = (highlight && !highlight.has(s.slot.id)) || ghost
        const stroke = s.issues.length ? ISSUE : s.mark ? MARK_STROKE[s.mark] : highlight?.has(s.slot.id) ? '#e3b864' : sel ? '#e3b864' : armed ? (v?.ok ? OK : 'rgba(255,90,79,0.6)') : 'rgba(0,0,0,0.5)'
        const strokeW = s.issues.length || s.mark || sel || highlight?.has(s.slot.id) || (armed && v?.ok) ? 3 : 1
        const x0 = PAD + 60
        return (
          <g
            key={`storey-${s.slot.id}-${s.index ?? 'gone'}`}
            class={`st-storey${armed ? ` st-target${v?.ok ? ' is-ok' : ' is-no'}` : ''}${settled === s.slot.id ? ' is-settled' : ''}`}
            data-slot={`${t.id}/${s.slot.id}`}
            data-mark={s.mark ?? undefined}
            data-drop={armed ? targetKey(target) : undefined}
            role="button"
            tabIndex={ghost ? -1 : 0}
            aria-pressed={armed ? undefined : sel}
            aria-disabled={armed ? !v?.ok : undefined}
            aria-label={
              armed
                ? v?.ok
                  ? `Drop on storey ${s.slot.id}`
                  : `Storey ${s.slot.id}: not allowed. ${v?.reason ?? ''}`
                : `Storey ${s.slot.id}: ${s.slot.blocks.join(', ') || 'no blocks'}${optional ? ', optional' : ''}${s.mark ? `, ${s.mark}` : ''}${s.issues.length ? `, ${s.issues.length} issues` : ''}`
            }
            opacity={dim ? 0.35 : 1}
            onClick={() => {
              if (ghost) return
              if (armed) {
                if (v?.ok) onTarget?.(target)
              } else onSelectSlot?.(s.slot.id)
            }}
            onKeyDown={(e) => {
              if (ghost) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                if (armed) {
                  if (v?.ok) onTarget?.(target)
                } else onSelectSlot?.(s.slot.id)
              }
            }}
          >
            <title>{armed ? (v?.ok ? `Into ${s.slot.id}` : (v?.reason ?? 'Not here')) : `${s.slot.id}: ${s.slot.blocks.join(', ')}`}</title>
            <rect x={PAD} y={r.y} width={W - 2 * PAD} height={r.h} rx={3} fill="#2a2f3a" stroke={stroke} stroke-width={strokeW} stroke-dasharray={optional || ghost ? '6 4' : undefined} />
            {/* The storey's colour strip: its first block's intent. */}
            <rect x={PAD} y={r.y} width={8} height={r.h} rx={2} fill={hexOf(blockColour(s.slot.blocks[0]))} />
            <text x={PAD + 14} y={r.y + 16} class="st-storey-name">
              {s.slot.id}
            </text>
            <text x={PAD + 14} y={r.y + 30} class="bp-small">
              {`${s.slot.min ?? 0}–${s.slot.max ?? '∞'}`}
            </text>
            {repeated(s.slot) && (
              <g aria-hidden="true">
                {[0, 1, 2].map((k) => (
                  <rect key={k} x={W - PAD - 10 - k * 7} y={r.y + 4} width={3} height={r.h - 8} rx={1} fill="rgba(255,255,255,0.25)" />
                ))}
              </g>
            )}
            {s.slot.blocks.map((b, k) => {
              const bx = x0 + (k % PER_ROW) * (BRICK_W + BRICK_GAP)
              const by = r.y + 10 + Math.floor(k / PER_ROW) * ROW_H
              return (
                <g key={b} class="st-block" data-block={b}>
                  <Brick x={bx} y={by} w={BRICK_W} h={BRICK_H} colour={blockColour(b)} label={b} />
                  {sel && onRemoveBlock && !armed && (
                    <g
                      class="st-remove"
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${b} from storey ${s.slot.id}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveBlock(s.slot.id, b)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Delete' || e.key === 'Backspace') {
                          e.preventDefault()
                          e.stopPropagation()
                          onRemoveBlock(s.slot.id, b)
                        }
                      }}
                    >
                      <circle cx={bx + BRICK_W - 2} cy={by + 2} r={7} fill="#1b1f2a" stroke="#e8e6e3" />
                      <text x={bx + BRICK_W - 2} y={by + 6} text-anchor="middle" class="st-remove-x">
                        ×
                      </text>
                    </g>
                  )}
                </g>
              )
            })}
            {!s.slot.blocks.length && (
              <text x={x0} y={r.y + 24} class="bp-small">
                empty
              </text>
            )}
          </g>
        )
      })}
      {floors.map((g, k) => (
        <rect key={g} x={PAD} y={floorTop + k * BAND_H} width={W - 2 * PAD} height={BAND_H - 2} rx={2} fill={globalFill(g)} data-global={g}>
          <title>{`Foundation (footer): ${g}`}</title>
        </rect>
      ))}
      <rect x={4} y={height - 12} width={W - 8} height={8} rx={2} fill={hexOf('green')} opacity={0.8} />
    </svg>
  )
}

/** Where a pointer drag of a part is, for the ghost. */
interface Drag {
  block: string
  x: number
  y: number
  /** Moved far enough from the press to be a drag (a plain click picks the part up instead). */
  moving: boolean
  sx: number
  sy: number
}

/** Pointer travel (px) before a press on a part becomes a drag. */
const DRAG_START = 5

/** The drop target under a screen point (`data-drop`), if any. */
function dropUnder(x: number, y: number): string | null {
  const el = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
  return el?.closest('[data-drop]')?.getAttribute('data-drop') ?? null
}

export function BuildingWorkbench({
  draft,
  base,
  buildings,
  changes,
  check,
  customBlocks,
  editing,
  selection,
  onSelect,
  onEdit,
}: {
  draft: Blueprint
  base: Blueprint
  buildings: BuildingView[]
  changes: BlueprintChange[]
  /** The site's checker on a candidate draft (null: not loaded, nothing can be judged). */
  check: ((bp: Blueprint) => ModelIssue[]) | null
  customBlocks: string[]
  editing: boolean
  selection: Selection | null
  onSelect: (s: Selection | null) => void
  onEdit: (next: Blueprint) => void
}) {
  void base
  const street = streetOrder(draft)
  const typeId = selection?.type && draft.page_types.some((t) => t.id === selection.type) ? selection.type : street[0]?.id
  const view = buildings.find((b) => b.type.id === typeId && b.index != null)
  const [picked, setPicked] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [settled, setSettled] = useState<string | null>(null)
  // The part in hand: the one being dragged, else the one picked up.
  const holding = drag?.moving ? drag.block : picked
  // A platform building's storeys are fixed: nothing to place, nothing to light.
  const core = !!typeId && CORE_TYPES.has(typeId)
  const verdicts = useMemo(() => (holding && check && typeId && !core ? judgeAll(check, draft, typeId, holding) : null), [holding, check, draft, typeId, core])
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag

  const drop = (target: DropTarget) => {
    const v = verdicts?.get(targetKey(target))
    if (!v?.ok || !v.next) return
    onEdit(v.next)
    snapClick()
    const slot = target.kind === 'storey' ? target.slot : (v.next.page_types.find((t) => t.id === target.type)?.slots?.[target.index]?.id ?? null)
    setSettled(slot)
    if (slot) onSelect({ type: target.type, slot })
    setPicked(null)
  }

  // Esc puts the part back; `/` finds a part.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
      if (e.key === 'Escape' && picked) {
        e.stopPropagation()
        setPicked(null)
        setDrag(null)
      } else if (e.key === '/' && !typing && editing) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('[data-tray-search]')?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [picked, editing])

  // A pointer drag: the ghost follows, the release drops on the lit target under it.
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) =>
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, moving: d.moving || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_START } : d))
    const up = (e: PointerEvent) => {
      const was = dragRef.current
      setDrag(null)
      if (!was?.moving) return // a click: the button's own handler picks the part up
      const key = dropUnder(e.clientX, e.clientY)
      const v = key ? verdicts?.get(key) : undefined
      if (v?.ok) drop(v.target)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  useEffect(() => {
    if (!settled) return
    const t = setTimeout(() => setSettled(null), 450)
    return () => clearTimeout(t)
  }, [settled])

  if (!view || !typeId) return <p class="muted">The site has no page types yet: add a building on the Town.</p>
  const globals = Object.keys(draft.globals ?? {})
  const uses = new Set(view.type.uses ?? [])
  const hovered = drag?.moving ? dropUnder(drag.x, drag.y) : null
  const hoverVerdict = hovered ? verdicts?.get(hovered) : undefined
  return (
    <div class={`st-building${holding ? ' is-armed' : ''}`}>
      <nav class="st-street" aria-label="Buildings">
        {street.map((t) => {
          const b = buildings.find((x) => x.type.id === t.id)
          const on = t.id === typeId
          return (
            <button key={t.id} type="button" class={`st-street-item${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => onSelect({ type: t.id })}>
              <span class="st-mini" aria-hidden="true">
                {(t.slots ?? []).slice(0, 6).map((s) => (
                  <span key={s.id} style={{ background: hexOf(blockColour(s.blocks[0])) }} />
                ))}
              </span>
              <span>
                {t.label.en ?? t.id}
                {CORE_TYPES.has(t.id) && <span title="A platform building: its storeys are fixed"> 🔒</span>}
                {b?.mark && <span class={`st-mark is-${b.mark}`}> {b.mark}</span>}
                {(b?.issues.length ?? 0) + (b?.storeys.reduce((n, s) => n + s.issues.length, 0) ?? 0) > 0 && <span class="bad-text"> !</span>}
              </span>
            </button>
          )
        })}
      </nav>
      <div class="st-stage">
        {globals.length > 0 && (
          <div class="st-globals" role="group" aria-label="Roof and foundation">
            {globals.map((g) => (
              <label key={g} class="st-chip">
                <input type="checkbox" checked={uses.has(g)} disabled={!editing} onChange={() => onEdit(toggleUse(draft, typeId, g))} />
                {footer(g) ? 'Foundation' : 'Roof'}: {g}
              </label>
            ))}
          </div>
        )}
        <p class="small muted st-hint" role="status">
          {core
            ? 'A platform building: its storeys are the platform’s and stay as they are. Pick one of your own buildings, or add one on the Town.'
            : !editing
            ? 'Read only.'
            : holding
              ? hoverVerdict
                ? hoverVerdict.ok
                  ? 'Release to place it.'
                  : `Not here: ${hoverVerdict.reason}`
                : `Holding ${holding}: drop it on a lit storey, or in a gap for a new storey. Esc puts it back.`
              : check
                ? 'Pick a part from the tray below, or select a storey to change it.'
                : 'The checker is loading: parts can be placed once it is ready.'}
        </p>
        <div class="st-scroll">
          <Elevation
            bp={draft}
            view={view}
            verdicts={verdicts}
            selectedSlot={selection?.type === typeId ? (selection.slot ?? null) : null}
            settled={settled}
            onTarget={drop}
            onSelectSlot={(slot) => onSelect({ type: typeId, slot })}
            onRemoveBlock={
              editing
                ? (slot, block) => {
                    const s = draft.page_types.find((t) => t.id === typeId)?.slots?.find((x) => x.id === slot)
                    if (!s) return
                    onEdit(s.blocks.length === 1 ? removeSlot(draft, typeId, slot) : updateSlot(draft, typeId, slot, { blocks: s.blocks.filter((b) => b !== block) }))
                  }
                : undefined
            }
          />
        </div>
      </div>
      {selection?.type === typeId && (
        <Inspector draft={draft} selection={selection} building={view} changes={changes} editing={editing} onChange={onEdit} onSelect={(s) => onSelect(s)} onClose={() => onSelect({ type: typeId })} />
      )}
      {editing && (
        <Tray
          customBlocks={customBlocks}
          picked={picked}
          disabled={!check || core}
          onPick={setPicked}
          onDragStart={(block, e) => setDrag({ block, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moving: false })}
        />
      )}
      {drag?.moving && (
        <div class={`st-ghost${hoverVerdict ? (hoverVerdict.ok ? ' is-ok' : ' is-no') : ''}`} style={{ left: `${drag.x}px`, top: `${drag.y}px` }} aria-hidden="true">
          {drag.block}
        </div>
      )}
    </div>
  )
}
