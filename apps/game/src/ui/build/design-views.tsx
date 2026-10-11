/**
 * The design editor's views, in SVG (no Babylon): the layer view (one plate
 * layer seen from above on its stud grid, the layers below ghosted, the
 * kit's merged bricks outlined) and a small isometric preview of the
 * compiled bricks. Colours are palette ids through `blueprint/colours`.
 */
import { hexOf } from '../../blueprint/colours'
import type { BrickBox } from './design-kit'
import { key, partRegion, unkey, type Cell, type EditorDesign, type Region } from './design-model'

/** `#rrggbb` shaded by `k` (below 1 darker). */
export function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`
}

export const cellSize = (d: EditorDesign) => Math.max(10, Math.min(30, Math.floor(540 / Math.max(d.footprint[0], d.footprint[1]))))

export interface LayerMarks {
  /** The region the tool would touch at the cursor. */
  target: Region | null
  targetKind: 'place' | 'remove' | 'paint' | 'select'
  targetColour: string
  /** Regions the compiler complains about. */
  problems: Region[]
  mirror: { x: boolean; z: boolean }
  showMerged: boolean
}

/** One plate layer of the design seen from above. */
export function LayerView({ design, layer, bricks, marks }: { design: EditorDesign; layer: number; bricks: readonly BrickBox[]; marks: LayerMarks }) {
  const [W, D] = design.footprint
  const cs = cellSize(design)
  const here: Array<[number, number, Cell]> = []
  const below = new Map<string, [number, Cell]>()
  for (const [k, c] of design.cells) {
    const [x, z, y] = unkey(k)
    if (y === layer) here.push([x, z, c])
    else if (y < layer) {
      const col = `${x},${z}`
      const b = below.get(col)
      if (!b || b[0] < y) below.set(col, [y, c])
    }
  }
  const at = (r: Region) => r.at[2] <= layer && layer < r.at[2] + r.size[2]
  const rect = (r: Region) => ({ x: r.at[0] * cs, y: r.at[1] * cs, width: r.size[0] * cs, height: r.size[1] * cs })
  const studs: Array<[number, number, string]> = []
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) studs.push([x, z, ''])
  return (
    <svg class="de-layer" viewBox={`-1 -1 ${W * cs + 2} ${D * cs + 2}`} width={W * cs + 2} height={D * cs + 2} aria-hidden="true" focusable="false">
      <rect x={0} y={0} width={W * cs} height={D * cs} class="de-plate" rx={3} />
      {studs.map(([x, z]) => (
        <circle key={`s${x},${z}`} cx={(x + 0.5) * cs} cy={(z + 0.5) * cs} r={cs * 0.26} class="de-plate-stud" />
      ))}
      {[...below].map(([col, [, c]]) => {
        const [x, z] = col.split(',').map(Number)
        return <rect key={`g${col}`} x={x * cs + 0.5} y={z * cs + 0.5} width={cs - 1} height={cs - 1} fill={hexOf(c.c)} opacity={0.3} />
      })}
      {here.map(([x, z, c]) => {
        const hex = hexOf(c.c)
        const top = !design.cells.has(key(x, z, layer + 1)) && c.m !== 'tile'
        return (
          <g key={`c${x},${z}`}>
            <rect x={x * cs} y={z * cs} width={cs} height={cs} fill={hex} class="de-cell" />
            {top && <circle cx={(x + 0.5) * cs} cy={(z + 0.5) * cs} r={cs * 0.28} fill={shade(hex, 1.12)} stroke={shade(hex, 0.75)} stroke-width={1} />}
          </g>
        )
      })}
      {design.parts.map((p, i) => {
        const r = partRegion(p)
        if (!at(r)) return null
        return (
          <g key={`p${i}`}>
            <rect {...rect(r)} fill={hexOf(p.colour)} class="de-special" />
            <title>{p.part}</title>
          </g>
        )
      })}
      {marks.showMerged &&
        bricks.filter((b) => at({ at: b.at, size: b.size })).map((b, i) => <rect key={`b${i}`} {...rect({ at: b.at, size: b.size })} class="de-merged" rx={1.5} />)}
      {marks.problems.filter(at).map((r, i) => (
        <rect key={`x${i}`} {...rect(r)} class="de-problem" />
      ))}
      {marks.mirror.x && <line x1={(W * cs) / 2} y1={0} x2={(W * cs) / 2} y2={D * cs} class="de-axis" />}
      {marks.mirror.z && <line x1={0} y1={(D * cs) / 2} x2={W * cs} y2={(D * cs) / 2} class="de-axis" />}
      {marks.target && (
        <rect
          {...rect(marks.target)}
          class={`de-target is-${marks.targetKind}`}
          fill={marks.targetKind === 'place' ? hexOf(marks.targetColour) : 'none'}
          fill-opacity={marks.targetKind === 'place' ? 0.55 : 0}
        />
      )}
    </svg>
  )
}

/** A box seen in the preview: grid units, a palette id. */
interface IsoBox {
  at: [number, number, number]
  size: [number, number, number]
  colour: string
}

/**
 * The design in a small isometric view from the south-east: the kit's
 * compiled bricks when it compiles, else the editor's own boxes.
 */
export function IsoPreview({ design, boxes, label }: { design: EditorDesign; boxes: readonly IsoBox[]; label: string }) {
  const [W, D] = design.footprint
  const H = design.height * 0.4
  const c30 = Math.cos(Math.PI / 6)
  const px = (x: number, z: number) => (x - z) * c30
  const py = (x: number, z: number, y: number) => (x + z) * 0.5 - y * 0.4
  const minX = px(0, D)
  const maxX = px(W, 0)
  const minY = -H
  const maxY = py(W, D, 0)
  const span = Math.max(maxX - minX, maxY - minY, 1)
  const s = 240 / span
  const pt = (x: number, z: number, y: number) => `${((px(x, z) - minX) * s + 10).toFixed(1)},${((py(x, z, y) - minY) * s + 10).toFixed(1)}`
  // Painter's order: bottom layers first, then back to front within a layer.
  const sorted = [...boxes].sort((a, b) => a.at[2] - b.at[2] || a.at[0] + a.size[0] / 2 + a.at[1] + a.size[1] / 2 - (b.at[0] + b.size[0] / 2 + b.at[1] + b.size[1] / 2))
  const w = (maxX - minX) * s + 20
  const h = (maxY - minY) * s + 20
  const ground = [pt(0, 0, 0), pt(W, 0, 0), pt(W, D, 0), pt(0, D, 0)].join(' ')
  return (
    <svg class="de-iso" viewBox={`0 0 ${w.toFixed(0)} ${h.toFixed(0)}`} role="img" aria-label={label}>
      <polygon points={ground} class="de-iso-ground" />
      {sorted.map((b, i) => {
        const [x0, z0, y0] = b.at
        const [x1, z1, y1] = [x0 + b.size[0], z0 + b.size[1], y0 + b.size[2]]
        const hex = hexOf(b.colour)
        return (
          <g key={i}>
            <polygon points={[pt(x0, z1, y0), pt(x1, z1, y0), pt(x1, z1, y1), pt(x0, z1, y1)].join(' ')} fill={shade(hex, 0.8)} />
            <polygon points={[pt(x1, z0, y0), pt(x1, z1, y0), pt(x1, z1, y1), pt(x1, z0, y1)].join(' ')} fill={shade(hex, 0.64)} />
            <polygon points={[pt(x0, z0, y1), pt(x1, z0, y1), pt(x1, z1, y1), pt(x0, z1, y1)].join(' ')} fill={hex} stroke={shade(hex, 0.7)} stroke-width={0.4} />
          </g>
        )
      })}
    </svg>
  )
}

/** A part of the palette from above: its studs on a w × d plate. */
export function BrushGlyph({ w, d, colour, tile }: { w: number; d: number; colour: string; tile: boolean }) {
  const u = 9
  const hex = hexOf(colour)
  return (
    <svg width={4 * u + 2} height={4 * u + 2} viewBox={`-1 -1 ${4 * u + 2} ${4 * u + 2}`} aria-hidden="true" focusable="false">
      <rect x={((4 - w) * u) / 2} y={((4 - d) * u) / 2} width={w * u} height={d * u} rx={2} fill={hex} stroke={shade(hex, 0.6)} />
      {!tile &&
        Array.from({ length: w * d }, (_, i) => (
          <circle key={i} cx={((4 - w) * u) / 2 + ((i % w) + 0.5) * u} cy={((4 - d) * u) / 2 + (Math.floor(i / w) + 0.5) * u} r={u * 0.3} fill={shade(hex, 1.12)} stroke={shade(hex, 0.7)} stroke-width={0.8} />
        ))}
    </svg>
  )
}
