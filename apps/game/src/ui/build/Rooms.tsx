/**
 * The Rooms tab (ADR-0087 decision 1): the building's rooms (select one to frame it in the scene),
 * demolishing a room (`Demolish Room`, enabled only when the sim accepts it, with its reason when
 * not), and a new room from a template: pick two corners on the floor (snapped to the 1 m tiles of
 * geom.rs), or type the rectangle; choose the side of its door; the sim checks and prices the
 * `PlaceRoom` live before it is sent.
 */
import { useEffect, useLayoutEffect, useState } from 'preact/hooks'
import { useStore } from '../store'
import { panelKey, useBridge, useCanvas, type Pick } from './gesture'
import { asCommand, CommandButton, useVerdict, Verdict } from './parts'
import { build, ROOM_TEMPLATES, SIDES, type BuildLayout, type RoomTemplate, type SideVariant } from './types'

interface Rect {
  x: number
  z: number
  w: number
  d: number
}

const tileOf = (m: number) => Math.floor(m + 1e-6)

/** The rectangle spanned by two corner tiles (both included). */
export function rectOf(a: { x: number; z: number }, b: { x: number; z: number }): Rect {
  return { x: Math.min(a.x, b.x), z: Math.min(a.z, b.z), w: Math.abs(a.x - b.x) + 1, d: Math.abs(a.z - b.z) + 1 }
}

/** Length of a room side in tiles. */
const sideLen = (r: Rect, side: SideVariant) => (side === 'North' || side === 'South' ? r.w : r.d)

function NumberField({ id, label, value, min, onChange }: { id: string; label: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <label class="build-field" for={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        value={value}
        onInput={(e) => {
          const v = Math.round(Number((e.currentTarget as HTMLInputElement).value))
          if (Number.isFinite(v)) onChange(v)
        }}
      />
    </label>
  )
}

export function Rooms({ layout }: { layout: BuildLayout }) {
  const store = useStore()
  const bridge = useBridge()
  const [selected, setSelected] = useState<string | null>(null)
  const [template, setTemplate] = useState<RoomTemplate | null>(null)
  const [rect, setRect] = useState<Rect>({ x: 0, z: 0, w: 3, d: 3 })
  const [side, setSide] = useState<SideVariant>('South')
  const [doorAt, setDoorAt] = useState(1)
  const [floor, setFloor] = useState(0)
  /** Picking corners: the first corner once clicked. */
  const [picking, setPicking] = useState<{ a: { x: number; z: number } | null } | null>(null)

  const room = selected ? layout.rooms.find((r) => r.id === selected) : undefined

  useEffect(() => {
    if (selected && !room) setSelected(null)
  }, [selected, room])

  useEffect(() => {
    if (!bridge) return
    bridge.highlight(selected ? { kind: 'room', id: selected } : null)
    if (selected) bridge.focus({ room: selected })
  }, [bridge, selected])

  const len = sideLen(rect, side)
  const at = Math.max(0, Math.min(len - 1, doorAt))
  const cmd = template ? build.placeRoom(template.kind, rect, floor, { side, at }) : null
  const { r, price } = useVerdict(cmd)

  // The new room's slab in the scene, green or red by the sim's verdict on the PlaceRoom it stands
  // for: from the first corner on (following the pointer), and for a typed size; gone without a template.
  const showRect = !!template && !(picking && !picking.a)
  useLayoutEffect(() => {
    if (!bridge) return
    bridge.ghostRect(showRect ? { x: rect.x, z: rect.z, w: rect.w, d: rect.d, ok: r.ok } : null)
  }, [bridge, showRect, rect.x, rect.z, rect.w, rect.d, r.ok])
  useEffect(() => () => bridge?.ghostRect(null), [bridge])

  const choose = (t: RoomTemplate) => {
    if (template?.kind === t.kind) {
      setTemplate(null)
      setPicking(null)
      return
    }
    setTemplate(t)
    setSelected(null)
    // Start at the lot's corner with the template's smallest size; the sim says where it fits.
    const x = tileOf(layout.originX)
    const z = tileOf(layout.originZ)
    const next = { x, z, w: Math.max(t.min[0], rect.w), d: Math.max(t.min[1], rect.d) }
    setRect(next)
    setDoorAt(Math.floor(sideLen(next, side) / 2))
  }

  const cornerOf = (p: Pick) => ({ x: tileOf(p.x), z: tileOf(p.z) })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (picking) return (setPicking(null), true)
      if (template) return (setTemplate(null), true)
      if (selected) return (setSelected(null), true)
    }
    return false
  }

  useCanvas(bridge, {
    active: !!picking,
    onHover: (p) => {
      if (!p || !picking?.a) return
      setRect(rectOf(picking.a, cornerOf(p)))
    },
    onClick: (p) => {
      if (picking) {
        const c = cornerOf(p)
        if (!picking.a) {
          setPicking({ a: c })
          setRect({ x: c.x, z: c.z, w: 1, d: 1 })
        } else {
          const next = rectOf(picking.a, c)
          setRect(next)
          setDoorAt(Math.floor(sideLen(next, side) / 2))
          setPicking(null)
        }
        return
      }
      if (!template) setSelected(p.room)
    },
    onKey,
  })

  return (
    <div class="build-rooms" onKeyDown={(e) => panelKey(e, onKey)}>
      <section aria-labelledby="build-rooms-h">
        <h3 id="build-rooms-h" class="build-h">
          Rooms <span class="muted">{layout.rooms.length}</span>
        </h3>
        <ul class="build-list">
          {layout.rooms.map((rm) => (
            <li key={rm.id}>
              <button type="button" class={`build-item${selected === rm.id ? ' is-active' : ''}`} aria-pressed={selected === rm.id} onClick={() => setSelected(selected === rm.id ? null : rm.id)}>
                <span class="build-item-name">{rm.label}</span>{' '}
                <span class="build-item-id muted">
                  {rm.w} × {rm.d} m{layout.floors > 1 ? ` · floor ${rm.floor}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {room && (
          <div class="build-selected" aria-label={`Selected: ${room.label}`} role="group">
            <p>
              <strong>{room.label}</strong> <span class="muted">{room.id}</span> · {room.desks.length} desks · seats {room.capacity}
            </p>
            <CommandButton idBase={`demolish-${room.id}`} cmd={build.demolishRoom(room.id)} label="Demolish" success="Room demolished" tone="danger" onDone={() => setSelected(null)} />
          </div>
        )}
      </section>

      <section aria-labelledby="build-new-h">
        <h3 id="build-new-h" class="build-h">New room</h3>
        <div class="build-templates">
          {ROOM_TEMPLATES.map((t) => (
            <button key={t.kind} type="button" class={`build-template${template?.kind === t.kind ? ' is-active' : ''}`} aria-pressed={template?.kind === t.kind} onClick={() => choose(t)}>
              <span class="build-template-name">{t.label}</span>{' '}
              <span class="build-template-min muted">
                at least {t.min[0]} × {t.min[1]} m
              </span>
            </button>
          ))}
        </div>

        {template && cmd && (
          <div class="build-gesture" role="group" aria-label={`New ${template.label.toLowerCase()}`}>
            <div class="build-row">
              <button type="button" class={`btn${picking ? ' is-proposed' : ''}`} aria-pressed={!!picking} disabled={!bridge} onClick={() => setPicking(picking ? null : { a: null })}>
                {picking ? (picking.a ? 'Click the opposite corner…' : 'Click the first corner…') : 'Pick corners on the floor'}
              </button>
              {!bridge && <span class="muted">The scene is not up: type the size.</span>}
            </div>
            <div class="build-fields">
              <NumberField id="build-room-x" label="X (tile)" value={rect.x} onChange={(x) => setRect({ ...rect, x })} />
              <NumberField id="build-room-z" label="Z (tile)" value={rect.z} onChange={(z) => setRect({ ...rect, z })} />
              <NumberField id="build-room-w" label="Width (m)" value={rect.w} min={1} onChange={(w) => setRect({ ...rect, w })} />
              <NumberField id="build-room-d" label="Depth (m)" value={rect.d} min={1} onChange={(d) => setRect({ ...rect, d })} />
            </div>
            <div class="build-fields">
              <label class="build-field" for="build-room-side">
                <span>Door side</span>
                <select id="build-room-side" value={side} onChange={(e) => setSide((e.currentTarget as HTMLSelectElement).value as SideVariant)}>
                  {SIDES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField id="build-room-door" label="Door at (tile)" value={at} min={0} onChange={setDoorAt} />
              {layout.floors > 1 && (
                <label class="build-field" for="build-room-floor">
                  <span>Floor</span>
                  <select id="build-room-floor" value={floor} onChange={(e) => setFloor(Number((e.currentTarget as HTMLSelectElement).value))}>
                    {Array.from({ length: layout.floors }, (_, i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <Verdict r={r} price={price} what={`${template.label}, ${rect.w} × ${rect.d} m`} />
            <div class="build-row">
              <button
                type="button"
                class="btn btn-primary"
                disabled={!r.ok}
                onClick={async () => {
                  if (!r.ok) return
                  const out = await store.run(asCommand(cmd), `${template.label} built`)
                  if (out.ok) setTemplate(null)
                }}
              >
                Build room
              </button>
              <button type="button" class="btn btn-quiet" onClick={() => (setTemplate(null), setPicking(null))}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
