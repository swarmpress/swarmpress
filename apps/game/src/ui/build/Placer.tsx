/**
 * Placing, moving, turning and removing things (ADR-0087 decision 1): the Furniture tab (equipment
 * in the rooms) and the Town tab (the town's pieces) share it. Pick a catalogue tile and a ghost
 * follows the pointer over the scene, green when the sim would accept the command it stands for
 * and red when not; R turns it, a click places it, Escape stops. Click a placed thing to select
 * it; then drag it (or Move, then click) to move it, Turn, or Remove. Every one of these is a sim
 * command validated by the sim before it is sent (`store.check`) and sent with `store.run`.
 *
 * Without a mouse: the tiles and the lists are buttons; while placing or moving, the arrow keys
 * nudge the ghost on the stud grid (a desk item steps from desk to desk), R turns, Enter places.
 */
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useState } from 'preact/hooks'
import type { BuildTarget } from '../../build-bridge'
import { hexOf } from '../../blueprint/colours'
import { PENDING, useStore } from '../store'
import { panelKey, useBridge, useCanvas, type Pick } from './gesture'
import { asCommand, BrickTile, CommandButton, useVerdict, Verdict } from './parts'
import { SNAP_MM, turn, type BuildCommand, type CatalogueItem, type Rot } from './types'

/** A placed thing, as the list and the commands need it. */
export interface Placed {
  id: string
  /** The sim variant (`Desk`, `Tree`). */
  kind: string
  name: string
  colour: string
  x: number
  z: number
  rot: Rot
  /** Stands on this desk (monitors, lamps). */
  on: string | null
  /** Houses move but stay. */
  removable: boolean
}

/** Where the ghost is: a floor point, and the desk under it (desk items). */
export interface Spot {
  x: number
  z: number
  desk: string | null
  /** Keep the position as it is (a turn in place), no snapping. */
  exact?: boolean
}

export interface PlacerConfig {
  family: 'equipment' | 'town'
  /** The picking target's kind for this family. */
  target: BuildTarget['kind']
  catalogue: readonly CatalogueItem[]
  items: readonly Placed[]
  /** The desks one may put a desk item on (equipment only), in order. */
  desks: ReadonlyArray<{ id: string; x: number; z: number }>
  /** Where a keyboard placement starts. */
  start: { x: number; z: number } | null
  /** Command for placing `kind` at `spot`; null when there is nothing to place on (no desk). */
  place(kind: CatalogueItem, spot: Spot, rot: Rot): BuildCommand | null
  /** Command for moving `item` to `spot`. */
  move(item: Placed, spot: Spot, rot: Rot): BuildCommand | null
  remove(item: Placed): BuildCommand | null
  /** The command a tile's price is asked with (the sim prices by kind). */
  priceProbe(kind: CatalogueItem): BuildCommand
  /** The id a pick's target resolves to in this family (a desk item resolves to itself). */
  resolve(p: Pick): string | null
  /** A heading over the placed list, or a control (the room filter). */
  listHead: ComponentChildren
  emptyText: string
  catalogueLabel: string
}

type Tool = { op: 'place'; item: CatalogueItem; rot: Rot } | { op: 'move'; id: string; rot: Rot } | null

const STEP_M = SNAP_MM / 1000

export function Placer({ cfg }: { cfg: PlacerConfig }) {
  const store = useStore()
  const bridge = useBridge()
  const [tool, setTool] = useState<Tool>(null)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const sel = selected ? (cfg.items.find((i) => i.id === selected) ?? null) : null
  const moving = tool?.op === 'move' ? (cfg.items.find((i) => i.id === tool.id) ?? null) : null
  const toolItem: CatalogueItem | null =
    tool?.op === 'place' ? tool.item : moving ? (cfg.catalogue.find((c) => c.kind === moving.kind) ?? { kind: moving.kind, slug: '', name: moving.name, colour: moving.colour, onDesk: !!moving.on }) : null

  // The command the gesture stands for, and the sim's verdict on it.
  const pending: BuildCommand | null = !tool || !spot ? null : tool.op === 'place' ? cfg.place(tool.item, spot, tool.rot) : moving ? cfg.move(moving, spot, tool.rot) : null
  const { r, price } = useVerdict(pending)

  // A selection the layout no longer has (removed) is dropped.
  useEffect(() => {
    if (selected && !sel) setSelected(null)
  }, [selected, sel])

  // The highlight follows the selection.
  useEffect(() => {
    bridge?.highlight(selected ? ({ kind: cfg.target, id: selected } as BuildTarget) : null)
  }, [bridge, selected, cfg.target])

  // The ghost follows the gesture, coloured by the sim's verdict (right after the render: it tracks the pointer).
  const ghostX = spot ? spot.x : null
  const ghostZ = spot ? spot.z : null
  useLayoutEffect(() => {
    if (!bridge) return
    if (!tool || !toolItem || ghostX === null || ghostZ === null) {
      bridge.ghost(null)
      return
    }
    bridge.ghost({ kind: toolItem.kind, family: cfg.family, x: ghostX, z: ghostZ, rot: tool.rot, ok: r.ok })
  }, [bridge, tool, toolItem?.kind, ghostX, ghostZ, r.ok, cfg.family])

  const spotOf = (p: Pick): Spot => {
    const id = p.target ? cfg.resolve(p) : null
    const desk = id ? (cfg.desks.find((d) => d.id === id) ?? cfg.desks.find((d) => d.id === cfg.items.find((i) => i.id === id)?.on)) : undefined
    return desk ? { x: desk.x, z: desk.z, desk: desk.id } : { x: p.x, z: p.z, desk: null }
  }

  const cancel = () => {
    setTool(null)
    setSpot(null)
  }

  const commandAt = (at: Spot | null): BuildCommand | null =>
    !tool || !at ? null : tool.op === 'place' ? cfg.place(tool.item, at, tool.rot) : moving ? cfg.move(moving, at, tool.rot) : null

  /**
   * Send the gesture's command (at `at`, a click's spot, else the ghost's). A verdict the sim has
   * already given is respected; one still being checked is left to the sim's apply, which
   * validates again and reports its reason.
   */
  const commit = async (at: Spot | null = spot) => {
    const c = commandAt(at)
    if (!c) return store.say(toolItem?.onDesk ? 'Point at a desk' : 'Point at the floor', 'error')
    const v = store.check(asCommand(c))
    if (!v.ok && v !== PENDING) return store.say(v.reason ?? 'Refused', 'error')
    const out = await store.run(asCommand(c), tool?.op === 'move' ? 'Moved' : 'Placed')
    if (out.ok && tool?.op === 'move') cancel()
  }

  const startPlace = (item: CatalogueItem) => {
    if (tool?.op === 'place' && tool.item.kind === item.kind) return cancel()
    setSelected(null)
    setTool({ op: 'place', item, rot: 0 })
    const d = item.onDesk ? cfg.desks[0] : null
    setSpot(d ? { x: d.x, z: d.z, desk: d.id } : cfg.start ? { ...cfg.start, desk: null } : null)
  }

  const startMove = (item: Placed) => {
    setTool({ op: 'move', id: item.id, rot: item.rot })
    setSpot({ x: item.x, z: item.z, desk: item.on })
  }

  const nudge = (dx: number, dz: number) => {
    if (!spot || !toolItem) return
    if (toolItem.onDesk) {
      const i = cfg.desks.findIndex((d) => d.id === spot.desk)
      const d = cfg.desks[(i + (dx + dz > 0 ? 1 : -1) + cfg.desks.length) % cfg.desks.length]
      if (d) setSpot({ x: d.x, z: d.z, desk: d.id })
      return
    }
    setSpot({ x: spot.x + dx * STEP_M, z: spot.z + dz * STEP_M, desk: null })
  }

  const onKey = (e: KeyboardEvent): boolean => {
    const k = e.key
    if (k === 'Escape') {
      if (tool) return cancel(), true
      if (selected) return setSelected(null), true
      return false
    }
    if (tool) {
      if (k === 'r' || k === 'R') return setTool({ ...tool, rot: turn(tool.rot, e.shiftKey ? -1 : 1) }), true
      if (k === 'Enter') return void commit(), true
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      if (arrows[k]) return nudge(...arrows[k]), true
      return false
    }
    if (sel) {
      if (k === 'r' || k === 'R') {
        const c = sel.on ? null : cfg.move(sel, { x: sel.x, z: sel.z, desk: null, exact: true }, turn(sel.rot))
        if (c && store.check(asCommand(c)).ok) void store.run(asCommand(c), 'Turned')
        return true
      }
      if (k === 'Delete' || k === 'Backspace') {
        const c = cfg.remove(sel)
        if (c && store.check(asCommand(c)).ok) void store.run(asCommand(c), 'Removed')
        else if (c) store.say(store.check(asCommand(c)).reason ?? 'Refused', 'error')
        return true
      }
    }
    return false
  }

  useCanvas(bridge, {
    active: !!tool,
    onHover: (p) => (p ? setSpot(spotOf(p)) : undefined),
    onClick: (p) => {
      if (tool) {
        const at = spotOf(p)
        setSpot(at)
        void commit(at)
        return
      }
      setSelected(cfg.resolve(p))
    },
    onPress: (p) => {
      // A press on the selected thing drags it.
      if (tool || !sel || cfg.resolve(p) !== sel.id) return false
      startMove(sel)
      return true
    },
    onDragEnd: (p) => void commit(p ? spotOf(p) : spot),
    onKey,
  })

  const toolLabel = tool ? (tool.op === 'place' ? `Place ${tool.item.name.toLowerCase()}` : `Move ${moving?.name.toLowerCase() ?? ''}`) : ''
  return (
    <div class="build-placer" onKeyDown={(e) => panelKey(e, onKey)}>
      <section aria-label={cfg.catalogueLabel}>
        <h3 class="build-h">{cfg.catalogueLabel}</h3>
        <div class="build-tiles">
          {cfg.catalogue.map((c) => (
            <BrickTile
              key={c.kind}
              colour={c.colour}
              name={c.name}
              price={store.price(asCommand(cfg.priceProbe(c)))}
              pressed={tool?.op === 'place' && tool.item.kind === c.kind}
              onClick={() => startPlace(c)}
              note={c.onDesk ? 'On a desk' : undefined}
            />
          ))}
        </div>
      </section>

      {tool && (
        <section class="build-gesture" aria-label="Pending action">
          <div class="build-gesture-head">
            <strong>{toolLabel}</strong>
            <span class="muted">{spot ? (toolItem?.onDesk ? (spot.desk ? `on ${spot.desk}` : 'point at a desk') : `${spot.x.toFixed(2)} m, ${spot.z.toFixed(2)} m`) : 'point at the floor'}</span>
          </div>
          <Verdict r={r} price={price} what={toolLabel} />
          <div class="build-row">
            {!toolItem?.onDesk && (
              <button type="button" class="btn" onClick={() => setTool({ ...tool, rot: turn(tool.rot) })} aria-keyshortcuts="R">
                Turn <kbd>R</kbd>
              </button>
            )}
            <button type="button" class="btn btn-primary" disabled={!r.ok} onClick={() => void commit()} aria-keyshortcuts="Enter">
              {tool.op === 'place' ? 'Place here' : 'Move here'}
            </button>
            <button type="button" class="btn btn-quiet" onClick={cancel} aria-keyshortcuts="Escape">
              Cancel <kbd>Esc</kbd>
            </button>
          </div>
          <p class="build-hint muted">
            {bridge ? 'Point in the scene and click, or use the arrow keys and Enter.' : 'The scene is not up: use the arrow keys and Enter.'}
          </p>
        </section>
      )}

      <section aria-label="Placed">
        {cfg.listHead}
        {cfg.items.length === 0 ? (
          <p class="muted">{cfg.emptyText}</p>
        ) : (
          <ul class="build-list">
            {cfg.items.map((i) => (
              <li key={i.id}>
                <button type="button" class={`build-item${selected === i.id ? ' is-active' : ''}`} aria-pressed={selected === i.id} onClick={() => setSelected(selected === i.id ? null : i.id)}>
                  <span class="build-swatch" style={{ background: hexOf(i.colour) }} aria-hidden="true" />
                  <span class="build-item-name">{i.name}</span>{' '}
                  <span class="build-item-id muted">{i.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sel && !tool && (
        <section class="build-selected" aria-label={`Selected: ${sel.name}`}>
          <h3 class="build-h">
            {sel.name} <span class="muted">{sel.id}</span>
          </h3>
          <div class="build-actions">
            <div class="build-action">
              <button type="button" class="btn" onClick={() => startMove(sel)}>
                Move
              </button>
              <span class="build-action-note">{bridge ? 'then click, or drag it in the scene' : 'then arrow keys and Enter'}</span>
            </div>
            {!sel.on && cfg.move(sel, { x: sel.x, z: sel.z, desk: null, exact: true }, turn(sel.rot)) && (
              <CommandButton idBase={`turn-${sel.id}`} cmd={cfg.move(sel, { x: sel.x, z: sel.z, desk: null, exact: true }, turn(sel.rot))!} label="Turn" success="Turned" />
            )}
            {sel.removable && cfg.remove(sel) && <CommandButton idBase={`remove-${sel.id}`} cmd={cfg.remove(sel)!} label="Remove" success="Removed" tone="danger" onDone={() => setSelected(null)} />}
          </div>
        </section>
      )}
    </div>
  )
}
