/**
 * The design editor (ADR-0065 §6, ADR-0087 decision 7, K-5): a construction-kit
 * design edited brick by brick. Start from a shipped design or an empty
 * footprint; place, remove, paint, turn, box fill, mirror, copy and stamp on
 * one plate layer at a time, with local undo and redo. Every edit is compiled
 * live by the kit (`crates/kit-wasm`): its splitter merges the cells into
 * bricks, its checks report issues (a floating brick), and its summary says
 * what the design provides. Finished designs go to the design library: the
 * company's (K-4, kept with its records, keyed by the kit's hash) when the
 * source keeps designs, else this browser's; from the company's, the Build
 * panel's Furniture tab places them (`PlaceObject`).
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { hexOf, PALETTE } from '../../blueprint/colours'
import { SIM_COMMANDS } from '../commands'
import { StoreContext } from '../store'
import { BrickIcon } from '../studio/bricks'
import { commit, historyOf, redo, undo, type History } from '../studio/history'
import { brickAt, compileDesign, compileShipped, getDesignKit, importCompiled, partSize, shippedDesigns, type EditorKit, type KitIssue } from './design-kit'
import { companyLibrary, localStorageLibrary, type DesignLibrary, type SavedDesign } from './design-library'
import {
  boxFill,
  brushById,
  brushRegion,
  BRUSHES,
  copyRegion,
  dominantColour,
  emptyDesign,
  flip,
  freshId,
  fromDesignJson,
  mergeBoxes,
  paint,
  partAt,
  partRegion,
  place,
  remove,
  rename,
  resize,
  stamp,
  toDesignJson,
  turnDesign,
  type BoxOp,
  type Clip,
  type EditorDesign,
  type Material,
  type Region,
} from './design-model'
import { BrushGlyph, cellSize, IsoPreview, LayerView } from './design-views'

/** The player recorded in a design's provenance until accounts reach the editor. */
export const PLAYER = 'local'

type Tool = 'place' | 'remove' | 'paint' | 'fill' | 'copy' | 'stamp'

const TOOLS: Array<{ id: Tool; label: string; key: string; hint: string }> = [
  { id: 'place', label: 'Place', key: 'p', hint: 'Place the part at the cursor' },
  { id: 'remove', label: 'Remove', key: 'e', hint: 'Remove the brick under the cursor' },
  { id: 'paint', label: 'Paint', key: 'b', hint: 'Paint the brick under the cursor' },
  { id: 'fill', label: 'Box fill', key: 'f', hint: 'Drag a rectangle to fill it, the part tall' },
  { id: 'copy', label: 'Copy', key: 'c', hint: 'Drag a rectangle to copy its columns from this layer up' },
  { id: 'stamp', label: 'Stamp', key: 's', hint: 'Stamp the copy at the cursor' },
]

const MATERIALS: Array<{ id: Material; label: string }> = [
  { id: 'brick', label: 'Bricks' },
  { id: 'plate', label: 'Plates' },
  { id: 'tile', label: 'Tiles' },
]

/** Colours a standard part comes in (`kit/parts/standard.json`: solid, metal, transparent). */
const COLOURS = PALETTE.filter((c) => c.class === 'solid' || c.class === 'metal' || c.class === 'transparent')

const NO_MIRROR = { x: false, z: false }

const money = (cents: number) => `${(cents / 100).toFixed(2)} €`

/** The regions of the ops an issue points at (op paths index the design JSON's ops). */
function problemRegions(issues: readonly KitIssue[], ops: ReturnType<typeof toDesignJson>['ops'], parts: EditorDesign['parts']): Region[] {
  const out: Region[] = []
  const boxes = ops.filter((o): o is BoxOp => o.op === 'box').length
  for (const i of issues) {
    const op = ops[i.op[0] ?? -1]
    if (!op) continue
    if (op.op === 'box') out.push({ at: op.at, size: op.size })
    else {
      const p = parts[(i.op[0] ?? 0) - boxes]
      if (p) out.push(partRegion(p))
    }
  }
  return out
}

export function DesignEditor() {
  const store = useContext(StoreContext)
  const scope = store?.site.repo ?? undefined
  const [kit, setKit] = useState<EditorKit | null>(null)
  // The company's library when the source keeps designs (K-4), else this browser's.
  const kept = store?.designsKept ?? null
  const library = useMemo<DesignLibrary>(
    () =>
      store && kept
        ? companyLibrary(store, (d) => {
            if (!kit) return null
            const c = compileDesign(kit, d)
            return c.summary?.parts ?? c.bricks.length
          })
        : localStorageLibrary(scope),
    [store, kept, scope, kit],
  )
  const [kitError, setKitError] = useState<string | null>(null)
  const [hist, setHist] = useState<History<EditorDesign> | null>(null)
  const [tool, setTool] = useState<Tool>('place')
  const [brushId, setBrushId] = useState('brick-2x2')
  const [turn, setTurn] = useState(0)
  const [colour, setColour] = useState('red')
  const [mirror, setMirror] = useState(NO_MIRROR)
  const [layer, setLayer] = useState(0)
  const [cursor, setCursor] = useState<[number, number]>([0, 0])
  const [anchor, setAnchor] = useState<[number, number] | null>(null)
  const [clip, setClip] = useState<Clip | null>(null)
  const [showMerged, setShowMerged] = useState(true)
  const [status, setStatus] = useState('')
  const [libRev, setLibRev] = useState(0)

  useEffect(() => {
    let live = true
    getDesignKit()
      .then((k) => live && setKit(k))
      .catch((e: unknown) => live && setKitError(String(e)))
    return () => {
      live = false
    }
  }, [])

  const design = hist?.present ?? null
  const brush = brushById(brushId)
  const json = useMemo(() => (design ? toDesignJson(design, PLAYER) : null), [design])
  const compiled = useMemo(() => (kit && json ? compileDesign(kit, json) : null), [kit, json])
  const drawnBoxes = useMemo(() => (json ? json.ops.flatMap((o) => (o.op === 'box' ? [{ at: o.at, size: o.size, colour: o.colour, template: 'box', part: '', kind: o.part, turn: 0, seq: 0 }] : [])) : []), [json])
  const designRev = store?.designRev.value ?? 0
  const saved = useMemo(() => library.list(), [library, libRev, designRev])

  const edit = (next: EditorDesign, what: string) => {
    if (!hist || next === hist.present) {
      setStatus(`${what}: nothing changed`)
      return
    }
    setHist(commit(hist, next))
    setStatus(what)
  }

  const start = (d: EditorDesign, what: string) => {
    setHist(historyOf(d))
    setLayer(0)
    setCursor([0, 0])
    setAnchor(null)
    setStatus(what)
  }

  /** The region a click tool touches at a cell: a special part, the kit's merged brick, or the brush. */
  const targetAt = (x: number, z: number): Region | null => {
    if (!design) return null
    if (tool === 'place') return brushRegion(brush, turn, x, z, layer)
    if (tool === 'remove' || tool === 'paint') {
      const p = partAt(design, x, z, layer)
      if (p >= 0) return partRegion(design.parts[p])
      // The kit's merged brick; while the kit refuses the design, the box as drawn.
      const b = compiled?.ok ? brickAt(compiled.bricks, x, z, layer) : brickAt(drawnBoxes, x, z, layer)
      if (b) return { at: b.at, size: b.size }
      return { at: [x, z, layer], size: [1, 1, 1] }
    }
    if (tool === 'stamp' && clip) return { at: [x, z, layer], size: clip.size }
    if ((tool === 'fill' || tool === 'copy') && anchor) {
      return { at: [Math.min(anchor[0], x), Math.min(anchor[1], z), layer], size: [Math.abs(anchor[0] - x) + 1, Math.abs(anchor[1] - z) + 1, tool === 'fill' ? brush.h : 1] }
    }
    return { at: [x, z, layer], size: [1, 1, 1] }
  }

  /** Apply the tool at a cell (for fill and copy: the first call sets the corner, the second acts). */
  const act = (x: number, z: number) => {
    if (!design) return
    const where = `at ${x}, ${z}, layer ${layer}`
    switch (tool) {
      case 'place':
        return edit(place(design, brush, turn, [x, z, layer], colour, mirror), `Placed ${brush.id} ${where}`)
      case 'remove':
        return edit(remove(design, targetAt(x, z)!, mirror), `Removed ${where}`)
      case 'paint':
        return edit(paint(design, targetAt(x, z)!, colour, mirror), `Painted ${where}`)
      case 'stamp':
        if (!clip) return setStatus('Copy a rectangle first')
        return edit(stamp(design, clip, [x, z, layer]), `Stamped ${where}`)
      case 'fill':
      case 'copy':
        if (!anchor) {
          setAnchor([x, z])
          return setStatus(`Corner set ${where}; pick the opposite corner`)
        }
        setAnchor(null)
        if (tool === 'fill') return edit(boxFill(design, anchor, [x, z], layer, brush, colour, mirror), `Filled from ${anchor.join(', ')} to ${x}, ${z}`)
        {
          const c = copyRegion(design, anchor, [x, z], layer)
          setClip(c)
          setTool('stamp')
          return setStatus(`Copied ${c.cells.length} cells; stamp them with Enter`)
        }
    }
  }

  const doUndo = () => {
    if (!hist?.past.length) return
    setHist(undo(hist))
    setStatus('Undone')
  }
  const doRedo = () => {
    if (!hist?.future.length) return
    setHist(redo(hist))
    setStatus('Redone')
  }

  const onRootKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) doRedo()
      else doUndo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      doRedo()
    }
  }

  const onGridKey = (e: KeyboardEvent) => {
    if (!design || e.ctrlKey || e.metaKey || e.altKey) return
    const [W, D] = design.footprint
    const move = (dx: number, dz: number) => setCursor(([x, z]) => [Math.max(0, Math.min(W - 1, x + dx)), Math.max(0, Math.min(D - 1, z + dz))])
    const k = e.key
    const t = TOOLS.find((x) => x.key === k.toLowerCase())
    if (k === 'ArrowLeft') move(-1, 0)
    else if (k === 'ArrowRight') move(1, 0)
    else if (k === 'ArrowUp') move(0, -1)
    else if (k === 'ArrowDown') move(0, 1)
    else if (k === 'Enter' || k === ' ') act(cursor[0], cursor[1])
    else if (k === 'PageUp' || k === ']') setLayer((l) => Math.min(design.height - 1, l + 1))
    else if (k === 'PageDown' || k === '[') setLayer((l) => Math.max(0, l - 1))
    else if (k.toLowerCase() === 'r') setTurn((v) => (v + 1) % 4)
    else if (k === 'Escape' && anchor) setAnchor(null)
    else if (t) setTool(t.id)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  // Pointer: a cell from the layer view's own box.
  const gridRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const cellOf = (e: PointerEvent): [number, number] | null => {
    if (!design) return null
    const svg = gridRef.current?.querySelector('svg')
    const r = svg?.getBoundingClientRect()
    if (!r || !r.width) return null
    const cs = cellSize(design)
    const sx = r.width / (design.footprint[0] * cs + 2)
    const x = Math.floor((e.clientX - r.left - sx) / (cs * sx))
    const z = Math.floor((e.clientY - r.top - sx) / (cs * sx))
    if (x < 0 || z < 0 || x >= design.footprint[0] || z >= design.footprint[1]) return null
    return [x, z]
  }

  if (kitError) return <section class="de" aria-label="Design editor"><p class="de-note is-bad">The construction kit did not load: {kitError}</p></section>
  if (!kit) return <section class="de" aria-label="Design editor"><p class="de-note">Loading the construction kit…</p></section>

  const shipped = shippedDesigns(kit)
  const target = design ? targetAt(cursor[0], cursor[1]) : null
  const ok = !!compiled?.ok && !!design && (design.cells.size > 0 || design.parts.length > 0)
  const previewBoxes = compiled?.ok ? compiled.bricks : [...drawnBoxes, ...(design?.parts ?? []).map((p) => ({ ...partRegion(p), colour: p.colour }))]

  const openShipped = (id: string) => {
    const s = shipped.find((d) => d.id === id)
    if (!s) return
    const d = importCompiled(kit, compileShipped(kit, id), { id: freshId(id), name: `${s.name} (mine)`, tags: s.tags })
    if (d) start(d, `Opened a copy of ${s.name}`)
    else setStatus(`${s.name} could not be opened`)
  }

  const openSaved = (s: SavedDesign) => {
    const d = fromDesignJson(s.design, (p) => partSize(kit, p)) ?? importCompiled(kit, compileDesign(kit, s.design), { id: s.id, name: s.name, tags: s.design.tags })
    if (d) start(d, `Opened ${s.name}`)
  }

  const save = async () => {
    if (!design || !json || !compiled || !ok) return
    try {
      await library.save({ id: design.id, name: design.name, hash: compiled.hash, parts: compiled.summary?.parts ?? compiled.bricks.length, colour: dominantColour(design) ?? 'grey-light', design: json }, compiled)
    } catch (e) {
      setStatus(`${design.name} was not saved: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    setLibRev((r) => r + 1)
    setStatus(library.where === 'company' ? `Saved ${design.name} with the company's designs` : `Saved ${design.name} to the library`)
  }

  return (
    <section class="de" aria-label="Design editor" onKeyDown={onRootKey}>
      <div class="de-start">
        <StartFrom shipped={shipped} onShipped={openShipped} onEmpty={(w, d, h) => start(emptyDesign({ id: freshId('design'), name: 'My design', footprint: [w, d], height: h }), `Started an empty design, ${w} × ${d} studs, ${h} plates high`)} />
      </div>

      {design && json && (
        <div class="de-work">
          <aside class="de-palette" aria-label="Parts and colours">
            <fieldset class="de-group">
              <legend>Part</legend>
              <div class="de-seg" role="group" aria-label="Kind">
                {MATERIALS.map((m) => (
                  <button key={m.id} type="button" class="de-seg-btn" aria-pressed={brush.material === m.id} onClick={() => setBrushId(`${m.id}-${brush.w}x${brush.d}`)}>
                    {m.label}
                  </button>
                ))}
              </div>
              <ul class="de-brushes" role="list">
                {BRUSHES.filter((b) => b.material === brush.material).map((b) => (
                  <li key={b.id}>
                    <button type="button" class="de-brush" aria-pressed={b.id === brushId} aria-label={`${b.material} ${b.w} by ${b.d}`} onClick={() => (setBrushId(b.id), setTool(tool === 'fill' ? 'fill' : 'place'))}>
                      <BrushGlyph w={b.w} d={b.d} colour={colour} tile={b.material === 'tile'} />
                      <span>
                        {b.w}×{b.d}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" class="de-btn" onClick={() => setTurn((t) => (t + 1) % 4)} aria-keyshortcuts="R">
                Turn part <span class="de-muted">({turn * 90}°)</span>
              </button>
            </fieldset>
            <fieldset class="de-group">
              <legend>Colour</legend>
              <ul class="de-swatches" role="list">
                {COLOURS.map((c) => (
                  <li key={c.id}>
                    <button type="button" class="de-swatch" aria-pressed={c.id === colour} aria-label={c.name} title={c.name} style={{ background: c.hex }} onClick={() => setColour(c.id)} />
                  </li>
                ))}
              </ul>
              <p class="de-small">{COLOURS.find((c) => c.id === colour)?.name}</p>
            </fieldset>
          </aside>

          <div class="de-main">
            <div class="de-toolbar" role="toolbar" aria-label="Tools">
              {TOOLS.map((t) => (
                <button key={t.id} type="button" class="de-tool" aria-pressed={tool === t.id} title={t.hint} aria-keyshortcuts={t.key.toUpperCase()} disabled={t.id === 'stamp' && !clip} onClick={() => (setTool(t.id), setAnchor(null))}>
                  {t.label} <kbd>{t.key.toUpperCase()}</kbd>
                </button>
              ))}
              <span class="de-sep" aria-hidden="true" />
              <button type="button" class="de-tool" aria-pressed={mirror.x} title="Mirror every edit across the middle, east to west" onClick={() => setMirror((m) => ({ ...m, x: !m.x }))}>
                Mirror x
              </button>
              <button type="button" class="de-tool" aria-pressed={mirror.z} title="Mirror every edit across the middle, north to south" onClick={() => setMirror((m) => ({ ...m, z: !m.z }))}>
                Mirror z
              </button>
              <span class="de-sep" aria-hidden="true" />
              <button type="button" class="de-tool" disabled={!hist?.past.length} onClick={doUndo} aria-keyshortcuts="Control+Z">
                Undo
              </button>
              <button type="button" class="de-tool" disabled={!hist?.future.length} onClick={doRedo} aria-keyshortcuts="Control+Shift+Z">
                Redo
              </button>
            </div>

            <div class="de-layerbar">
              <label class="de-layer-label">
                <span>
                  Layer <strong>{layer}</strong> of {design.height - 1} <span class="de-muted">({(layer * 2.5).toFixed(1)} cm)</span>
                </span>
                <input type="range" min={0} max={design.height - 1} value={layer} aria-valuetext={`Layer ${layer}, ${(layer * 2.5).toFixed(1)} centimetres up`} onInput={(e) => setLayer(Number(e.currentTarget.value))} />
              </label>
              <label class="de-check">
                <input type="checkbox" checked={showMerged} onChange={(e) => setShowMerged(e.currentTarget.checked)} /> Merged bricks
              </label>
            </div>

            <div
              ref={gridRef}
              class="de-grid"
              tabIndex={0}
              role="application"
              aria-roledescription="stud grid"
              aria-label={`Layer ${layer} of ${design.name}, ${design.footprint[0]} by ${design.footprint[1]} studs. Arrows move, Enter applies ${tool}, Page Up and Page Down change the layer, R turns the part.`}
              aria-describedby="de-status"
              onKeyDown={onGridKey}
              onPointerDown={(e) => {
                const c = cellOf(e)
                if (!c || e.button !== 0) return
                setCursor(c)
                if (tool === 'fill' || tool === 'copy') {
                  setAnchor(c)
                  dragging.current = true
                  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                } else act(c[0], c[1])
              }}
              onPointerMove={(e) => {
                const c = cellOf(e)
                if (c && (c[0] !== cursor[0] || c[1] !== cursor[1])) setCursor(c)
              }}
              onPointerUp={(e) => {
                if (!dragging.current) return
                dragging.current = false
                const c = cellOf(e) ?? cursor
                act(c[0], c[1])
              }}
            >
              <LayerView
                design={design}
                layer={layer}
                bricks={compiled?.ok ? compiled.bricks : []}
                marks={{
                  target,
                  targetKind: tool === 'place' || tool === 'stamp' ? 'place' : tool === 'remove' ? 'remove' : tool === 'paint' ? 'paint' : 'select',
                  targetColour: colour,
                  problems: compiled ? problemRegions(compiled.issues, json.ops, design.parts) : [],
                  mirror,
                  showMerged,
                }}
              />
            </div>
            <p id="de-status" class="de-status" role="status" aria-live="polite">
              {status || `Cursor ${cursor[0]}, ${cursor[1]}`}
              {anchor ? ` · corner ${anchor[0]}, ${anchor[1]}` : ''}
            </p>

            <details class="de-more">
              <summary>Design: name, bounds, turn and flip</summary>
              <DesignProps design={design} onChange={edit} />
            </details>
          </div>

          <aside class="de-side" aria-label="The compiled design">
            <IsoPreview design={design} boxes={previewBoxes} label={`${design.name}, ${compiled?.ok ? 'as the kit builds it' : 'as drawn (the kit does not accept it yet)'}`} />
            <CompiledFacts compiled={compiled} merged={mergeBoxes(design.cells).length} />
            <button type="button" class="de-btn is-primary" disabled={!ok} onClick={() => void save()}>
              Save to library
            </button>
            {!ok && <p class="de-small">Only a design the kit accepts can be saved.</p>}
          </aside>
        </div>
      )}

      <LibraryList
        saved={saved}
        library={library}
        kept={kept}
        kit={kit}
        currentId={design?.id ?? null}
        onOpen={openSaved}
        onChanged={(what) => (setLibRev((r) => r + 1), setStatus(what))}
      />
    </section>
  )
}

function StartFrom({ shipped, onShipped, onEmpty }: { shipped: Array<{ id: string; name: string }>; onShipped: (id: string) => void; onEmpty: (w: number, d: number, h: number) => void }) {
  const [pick, setPick] = useState(shipped[0]?.id ?? '')
  const [w, setW] = useState(8)
  const [d, setD] = useState(8)
  const [h, setH] = useState(12)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)))
  return (
    <>
      <form class="de-start-form" onSubmit={(e) => (e.preventDefault(), onShipped(pick))}>
        <label>
          <span>Start from a kit design</span>
          <select value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
            {shipped.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" class="de-btn">
          Open a copy
        </button>
      </form>
      <form class="de-start-form" onSubmit={(e) => (e.preventDefault(), onEmpty(clamp(w, 1, 64), clamp(d, 1, 64), clamp(h, 1, 240)))}>
        <span class="de-start-or">or empty:</span>
        <label>
          <span>Width (studs)</span>
          <input type="number" min={1} max={64} value={w} onInput={(e) => setW(Number(e.currentTarget.value))} />
        </label>
        <label>
          <span>Depth (studs)</span>
          <input type="number" min={1} max={64} value={d} onInput={(e) => setD(Number(e.currentTarget.value))} />
        </label>
        <label>
          <span>Height (plates)</span>
          <input type="number" min={1} max={240} value={h} onInput={(e) => setH(Number(e.currentTarget.value))} />
        </label>
        <button type="submit" class="de-btn">
          Start empty
        </button>
      </form>
    </>
  )
}

function DesignProps({ design, onChange }: { design: EditorDesign; onChange: (d: EditorDesign, what: string) => void }) {
  const num = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)))
  return (
    <div class="de-props">
      <label>
        <span>Name</span>
        <input type="text" value={design.name} maxLength={80} onChange={(e) => onChange(rename(design, e.currentTarget.value.trim() || design.name), 'Renamed')} />
      </label>
      <label>
        <span>Width</span>
        <input type="number" min={1} max={64} value={design.footprint[0]} onChange={(e) => onChange(resize(design, [num(e.currentTarget.value, 1, 64), design.footprint[1]], design.height), 'Resized')} />
      </label>
      <label>
        <span>Depth</span>
        <input type="number" min={1} max={64} value={design.footprint[1]} onChange={(e) => onChange(resize(design, [design.footprint[0], num(e.currentTarget.value, 1, 64)], design.height), 'Resized')} />
      </label>
      <label>
        <span>Height</span>
        <input type="number" min={1} max={240} value={design.height} onChange={(e) => onChange(resize(design, design.footprint, num(e.currentTarget.value, 1, 240)), 'Resized')} />
      </label>
      <div class="de-props-actions">
        <button type="button" class="de-btn" onClick={() => onChange(turnDesign(design), 'Turned the design a quarter turn')}>
          Turn design
        </button>
        <button type="button" class="de-btn" onClick={() => onChange(flip(design, 'x'), 'Flipped east to west')}>
          Flip x
        </button>
        <button type="button" class="de-btn" onClick={() => onChange(flip(design, 'z'), 'Flipped north to south')}>
          Flip z
        </button>
      </div>
    </div>
  )
}

function CompiledFacts({ compiled, merged }: { compiled: ReturnType<typeof compileDesign> | null; merged: number }) {
  if (!compiled) return null
  const s = compiled.summary
  const caps = s ? [...s.capabilities, ...(s.surfaces.length ? s.surfaces.map((x) => `surface ${x}`) : [])] : []
  return (
    <div class="de-facts">
      <p class={`de-verdict ${compiled.ok ? 'is-ok' : 'is-bad'}`}>{compiled.ok ? 'The kit builds it' : `The kit refuses it (${compiled.issues.length} ${compiled.issues.length === 1 ? 'issue' : 'issues'})`}</p>
      <dl class="de-dl">
        <dt>Parts</dt>
        <dd data-testid="de-parts">{s ? s.parts : '—'}</dd>
        <dt>Boxes drawn</dt>
        <dd>{merged}</dd>
        <dt>Cost</dt>
        <dd>{s ? money(s.cost) : '—'}</dd>
        <dt>Hash</dt>
        <dd class="de-hash" title={compiled.hash}>
          {compiled.hash ? `${compiled.hash.slice(0, 12)}…` : '—'}
        </dd>
      </dl>
      {s && (
        <p class="de-small">
          Provides: {caps.length ? caps.join(', ') : 'nothing the office counts (decor)'}
          {s.seats ? ` · ${s.seats} ${s.seats === 1 ? 'seat' : 'seats'}` : ''}
          {s.work_surface ? ` · work surface ${s.work_surface} stud²` : ''}
        </p>
      )}
      {compiled.issues.length > 0 && (
        <ul class="de-issues" role="list" aria-label="Issues">
          {compiled.issues.slice(0, 8).map((i, k) => (
            <li key={k}>
              <strong>{i.code}</strong> {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Whether the sim places designs of the player's own (`PlaceObject`, K-4). */
const SIM_PLACES_OBJECTS = (SIM_COMMANDS as readonly string[]).includes('PlaceObject')

/** What the library says about where its designs live and whether they can be placed. */
function libraryNote(kept: 'company' | 'browser' | null): string {
  const where =
    kept === 'company'
      ? 'Kept with the company: they travel with its records to every device that runs it.'
      : kept === 'browser'
        ? 'Kept in this browser: the offline demo has no company store to keep them in.'
        : 'Kept in this browser only: this company cannot keep designs, so they cannot be placed.'
  if (!kept) return where
  return SIM_PLACES_OBJECTS
    ? `${where} Place them from Build, Furniture, My designs.`
    : `${where} Placing a design of your own in the office waits for the sim to take placed designs (PlaceObject, K-4).`
}

function LibraryList({
  saved,
  library,
  kept,
  kit,
  currentId,
  onOpen,
  onChanged,
}: {
  saved: SavedDesign[] | undefined
  library: DesignLibrary
  kept: 'company' | 'browser' | null
  kit: EditorKit
  currentId: string | null
  onOpen: (s: SavedDesign) => void
  onChanged: (what: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const act = async (what: () => void | Promise<void>, done: string) => {
    try {
      await what()
      onChanged(done)
    } catch (e) {
      onChanged(`Not done: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return (
    <section class="de-library" aria-labelledby="de-library-title">
      <h3 id="de-library-title">Your designs</h3>
      <p class="de-note" data-testid="de-library-note">
        {libraryNote(kept)}
      </p>
      {!saved && (
        <p class="de-small" role="status">
          Reading the company's designs…
        </p>
      )}
      {saved && !saved.length && <p class="de-small">No designs yet. Save one the kit accepts.</p>}
      <ul class="de-lib-list" role="list">
        {(saved ?? []).map((s) => (
          <li key={s.id} class={`de-lib-item${s.design.id === currentId ? ' is-current' : ''}`}>
            <BrickIcon colour={hexOf(s.colour)} size={40} />
            <div class="de-lib-text">
              {renaming === s.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const v = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value
                    setRenaming(null)
                    void act(() => library.rename(s.id, v, (j) => kit.hashDesign(JSON.stringify(j))), `Renamed to ${v.trim()}`)
                  }}
                >
                  <label class="sr-only" for={`de-rn-${s.id}`}>
                    New name for {s.name}
                  </label>
                  <input id={`de-rn-${s.id}`} name="name" type="text" maxLength={80} defaultValue={s.name} />
                  <button type="submit" class="de-btn">
                    OK
                  </button>
                </form>
              ) : (
                <span class="de-lib-name">{s.name}</span>
              )}
              <span class="de-small">
                {s.parts} parts · {s.design.footprint.join(' × ')} studs
              </span>
            </div>
            <div class="de-lib-actions">
              {confirm === s.id ? (
                <>
                  <button type="button" class="de-btn is-danger" onClick={() => (setConfirm(null), void act(() => library.delete(s.id), `Deleted ${s.name}`))}>
                    Delete {s.name}
                  </button>
                  <button type="button" class="de-btn" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button type="button" class="de-btn" onClick={() => onOpen(s)} aria-label={`Open ${s.name}`}>
                    Open
                  </button>
                  <button type="button" class="de-btn" onClick={() => setRenaming(renaming === s.id ? null : s.id)} aria-label={`Rename ${s.name}`}>
                    Rename
                  </button>
                  <button type="button" class="de-btn" onClick={() => setConfirm(s.id)} aria-label={`Delete ${s.name}`}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
