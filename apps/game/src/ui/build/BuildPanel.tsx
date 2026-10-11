/**
 * Build mode (FEAT-026, ADR-0087): the Build section's inspector. Rooms (build from templates,
 * demolish), Furniture (the kit's equipment as 2 × 2 bricks: place, move, turn, remove), the Town
 * (move the sections' houses; place, move and remove trees, lamps and benches) and Designs (the
 * design editor). The company's build mode is the badge in the header: Sandbox builds cost
 * nothing, Economic builds cost their price (decision 3).
 *
 * The sim is the only judge (rule 3): every action is a sim command, checked by the sim before it
 * is sent, and shown with the sim's price and, when refused, the sim's reason (rule 11: nothing
 * here pretends to have built anything).
 */
import type { ComponentType } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { Badge, Panel, TabPanel, Tabs } from '../components/common'
import { useStore } from '../store'
import { useBridge } from './gesture'
import { Placer, type Placed, type PlacerConfig } from './Placer'
import { Rooms } from './Rooms'
import {
  build,
  EQUIPMENT,
  equipmentBySlug,
  isHouse,
  itemsOf,
  quarter,
  TOWN_PIECES,
  townColour,
  townName,
  townVariant,
  type BuildLayout,
} from './types'

type BuildTab = 'rooms' | 'furniture' | 'town' | 'designs'

const TABS: Array<{ id: BuildTab; label: string }> = [
  { id: 'rooms', label: 'Rooms' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'town', label: 'Town' },
  { id: 'designs', label: 'Designs' },
]

/** The tab the panel opens on (kept while the page lives). */
let lastTab: BuildTab = 'furniture'

function Furniture({ layout }: { layout: BuildLayout }) {
  const bridge = useBridge()
  const [room, setRoom] = useState<string>(layout.rooms[0]?.id ?? '')
  const current = layout.rooms.find((r) => r.id === room) ?? layout.rooms[0]
  useEffect(() => {
    if (bridge && current) bridge.focus({ room: current.id })
  }, [bridge, current?.id])
  const all = useMemo(() => itemsOf(layout), [layout])
  const cfg: PlacerConfig = {
    family: 'equipment',
    target: 'equipment',
    catalogue: EQUIPMENT,
    items: [...all.values()]
      .filter((i) => i.room === current?.id)
      .map((i): Placed => {
        const c = equipmentBySlug(i.slug)
        return { id: i.id, kind: c?.kind ?? i.slug, name: c?.name ?? i.slug, colour: c?.colour ?? 'grey-light', x: i.x, z: i.z, rot: i.rot, on: i.on, removable: true }
      }),
    desks: (current?.desks ?? []).map((d) => ({ id: d.id, x: d.x, z: d.z })),
    start: current ? { x: current.x + current.w / 2, z: current.z + current.d / 2 } : null,
    place: (kind, spot, rot) => (kind.onDesk ? (spot.desk ? build.placeEquipment(kind.kind, build.onDesk(spot.desk)) : null) : build.placeEquipment(kind.kind, build.floor(spot.x, spot.z, rot))),
    move: (item, spot, rot) => (item.on ? (spot.desk ? build.moveEquipment(item.id, build.onDesk(spot.desk)) : null) : build.moveEquipment(item.id, build.floor(spot.x, spot.z, rot, spot.exact))),
    remove: (item) => build.demolishEquipment(item.id),
    // The sim prices equipment by its kind (`EquipmentKind::cost`), wherever it goes.
    priceProbe: (kind) => build.placeEquipment(kind.kind, build.floor(0, 0, 0)),
    resolve: (p) => (p.target?.kind === 'equipment' ? p.target.id : null),
    listHead: (
      <label class="build-field build-room-pick" for="build-furniture-room">
        <span>In the room</span>
        <select id="build-furniture-room" value={current?.id ?? ''} onChange={(e) => setRoom((e.currentTarget as HTMLSelectElement).value)}>
          {layout.rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label} ({r.id})
            </option>
          ))}
        </select>
      </label>
    ),
    emptyText: 'Nothing placed in this room yet.',
    catalogueLabel: 'Furniture catalogue',
  }
  return <Placer key={current?.id} cfg={cfg} />
}

function Town({ layout }: { layout: BuildLayout }) {
  const bridge = useBridge()
  useEffect(() => {
    bridge?.focus({ town: true })
  }, [bridge])
  const town = layout.town ?? []
  // The houses first, then the pieces, each in the sim's order.
  const items = [...town.filter((t) => isHouse(t.kind)), ...town.filter((t) => !isHouse(t.kind))].map(
    (t): Placed => ({ id: t.id, kind: townVariant(t.kind), name: townName(t.kind), colour: townColour(t.kind), x: t.x, z: t.z, rot: quarter(t.rot), on: null, removable: !isHouse(t.kind) }),
  )
  const cfg: PlacerConfig = {
    family: 'town',
    target: 'town',
    catalogue: TOWN_PIECES,
    items,
    desks: [],
    // Beside the lot, off the street (the entrance's spawn is on it, where nothing may stand).
    start: { x: layout.originX - 4, z: layout.originZ + layout.depth * 0.375 },
    place: (kind, spot, rot) => build.placeTown(kind.kind, spot.x, spot.z, rot),
    move: (item, spot, rot) => build.moveTown(item.id, spot.x, spot.z, rot, spot.exact),
    remove: (item) => (item.removable ? build.removeTown(item.id) : null),
    priceProbe: (kind) => build.placeTown(kind.kind, layout.entrance.spawn[0], layout.entrance.spawn[1], 0),
    resolve: (p) => (p.target?.kind === 'town' ? p.target.id : null),
    listHead: (
      <h3 class="build-h">
        In the town <span class="muted">{items.length}</span>
      </h3>
    ),
    emptyText: layout.town ? 'The town is empty.' : 'The sim does not lay out the town yet.',
    catalogueLabel: 'Town pieces',
  }
  return <Placer cfg={cfg} />
}

/** The design editor (FEAT-026 K-5) lives in its own module; loaded when the tab opens. */
const editors = import.meta.glob<{ DesignEditor: ComponentType }>('./DesignEditor.tsx')

function Designs() {
  const [Editor, setEditor] = useState<ComponentType | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    const load = editors['./DesignEditor.tsx']
    if (!load) {
      setMissing(true)
      return
    }
    let live = true
    load().then(
      (m) => live && setEditor(() => m.DesignEditor),
      () => live && setMissing(true),
    )
    return () => {
      live = false
    }
  }, [])
  if (Editor) return <Editor />
  return (
    <p class="muted" role="status">
      {missing ? 'The design editor is not part of this build yet.' : 'Loading the design editor…'}
    </p>
  )
}

export function BuildPanel() {
  const store = useStore()
  const layout = store.layout.value
  const [tab, setTab] = useState<BuildTab>(lastTab)
  const pick = (t: BuildTab) => {
    lastTab = t
    setTab(t)
  }
  const mode = layout?.buildMode
  const badge = mode ? (
    <span class="build-mode" title={mode === 'sandbox' ? 'Sandbox: builds cost nothing' : 'Economic: builds cost their price'}>
      <Badge tone={mode === 'sandbox' ? 'info' : 'warn'}>{mode === 'sandbox' ? 'Sandbox' : 'Economic'}</Badge>
      <span class="sr-only">{mode === 'sandbox' ? ' mode: builds cost nothing' : ' mode: builds cost their price'}</span>
    </span>
  ) : null
  return (
    <Panel id="build" title="Build" actions={badge} wide={tab === 'designs'}>
      {!layout ? (
        <p class="muted" role="status">
          The sim has no building to build in.
        </p>
      ) : (
        <div class="build">
          <Tabs label="Build" idPrefix="build" tabs={TABS} value={tab} onChange={pick} />
          <TabPanel idPrefix="build" value={tab}>
            {tab === 'rooms' && <Rooms layout={layout} />}
            {tab === 'furniture' && <Furniture layout={layout} />}
            {tab === 'town' && <Town layout={layout} />}
            {tab === 'designs' && <Designs />}
          </TabPanel>
        </div>
      )}
    </Panel>
  )
}
