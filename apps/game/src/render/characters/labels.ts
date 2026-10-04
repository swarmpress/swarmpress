/**
 * Name labels (FEAT-024): the person's name and role above their head, and
 * beneath it what they are working on while the sim has them on a work item.
 *
 * How they are drawn: each label is a rectangle in one text atlas
 * (`atlas.ts`, repainted only when a text changes) and a camera-facing quad
 * that samples it; all quads share one unlit material. The quads live in a
 * utility layer scene that Babylon renders after the main scene's
 * post-processing, so labels are not tone-mapped, bloomed, blurred by FXAA or
 * darkened by SSAO, and they are never hidden by walls. That is the same few
 * alpha-blended triangles on WebGPU and on the WebGL2 fallback, at every
 * quality tier, with no texture upload per frame (a fullscreen GUI texture
 * would be re-uploaded whenever anyone moves).
 *
 * Labels are part of the picture, so they are deterministic: a fixed font,
 * sizes in whole pixels, positions on whole pixels, stacking that depends only
 * on positions, and an opacity that depends only on the zoom.
 */
import { Color3, Mesh, StandardMaterial, UtilityLayerRenderer, Vector3, VertexData, type ArcRotateCamera, type Scene, type TransformNode } from '@babylonjs/core'
import type { StaffRender } from '../../state/render-state'
import { createAtlas, type Atlas } from './atlas'
import {
  createLabelSlots,
  LABEL,
  LABEL_FONT,
  labelAlpha,
  labelAt,
  labelSize,
  labelText,
  offsetToCss,
  onWorkLine,
  projectOffset,
  ROLE_ZOOM,
  sameText,
  stackLabels,
  type LabelSlots,
  type LabelText,
  type SceneLookups,
  type ViewBasis,
} from './label-layout'

/** Clear space between a head and its label, CSS pixels. */
export const HEAD_GAP = 4

/** A screen rectangle in CSS pixels from the canvas' top-left (the HUD, toolbars, panels). */
export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface LabelHit {
  staff: string
  /** The work line was hit and the person has a work item. */
  workItem: string | null
}

export interface Labels {
  /** The scene the labels are drawn in (Babylon's utility layer over the main scene). */
  scene: Scene
  capacity: number
  setLookups(lookups: SceneLookups): void
  /** New sim state: who is on site and what their labels say. Repaints only changed labels. */
  sync(staff: readonly StaffRender[]): void
  /**
   * Per frame: put each person's label above their head. `anchor` is the node
   * at their feet, `headHeight` the top of their head above it; labels over
   * `occluders` are hidden.
   */
  place(camera: ArcRotateCamera, anchor: (staffId: string) => TransformNode | undefined, headHeight: (staffId: string) => number, occluders: readonly ScreenRect[]): void
  /** The label under a point of the canvas (CSS pixels from its top-left), if any. */
  hit(x: number, y: number): LabelHit | null
  textOf(staffId: string): LabelText | undefined
  /** A label's rectangle on the canvas (CSS pixels), if it is shown. */
  rectOf(staffId: string): ScreenRect | null
  /** The top of a person's head on the canvas (CSS pixels from its top-left), when labels are drawn; for speech bubbles. */
  headOf(staffId: string): { x: number; y: number } | null
  /** Every label shown (CSS pixels). */
  rects(): ScreenRect[]
  painted: boolean
  dispose(): void
}

interface Entry {
  staff: string
  workItem: string | null
  color: string
  text: LabelText
  /** Size in CSS pixels. */
  w: number
  h: number
  mesh: Mesh
  present: boolean
}

function billboard(scene: Scene, name: string): Mesh {
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]
  data.indices = [0, 1, 2, 0, 2, 3]
  data.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]
  data.uvs = [0, 1, 1, 1, 1, 0, 0, 0]
  data.applyToMesh(mesh, true)
  mesh.isPickable = false
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL
  mesh.alwaysSelectAsActiveMesh = true
  return mesh
}

function roundRect(ctx: CanvasRenderingContext2D, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.arcTo(w, 0, w, h, r)
  ctx.arcTo(w, h, 0, h, r)
  ctx.arcTo(0, h, 0, 0, r)
  ctx.arcTo(0, 0, w, 0, r)
  ctx.closePath()
}

const nameFont = `600 ${LABEL.nameFont}px ${LABEL_FONT}`
const roleFont = `400 ${LABEL.roleFont}px ${LABEL_FONT}`
const workFont = `400 ${LABEL.workFont}px ${LABEL_FONT}`

function paint(atlas: Atlas, cell: number, e: Entry, nameW: number) {
  if (!atlas.begin(cell)) return
  const ctx = atlas.ctx!
  roundRect(ctx, e.w, e.h, LABEL.radius)
  ctx.fillStyle = 'rgba(16, 19, 27, 0.88)'
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = e.color
  ctx.beginPath()
  ctx.arc(LABEL.padX + LABEL.chip / 2, LABEL.line / 2, LABEL.chip / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const x = LABEL.padX + LABEL.chip + LABEL.chipGap
  ctx.font = nameFont
  ctx.fillStyle = '#f4f2ee'
  ctx.fillText(e.text.name, x, LABEL.nameBaseline)
  if (e.text.role) {
    ctx.font = roleFont
    ctx.fillStyle = '#aab1bf'
    ctx.fillText(e.text.role, x + nameW + LABEL.roleGap, LABEL.nameBaseline)
  }
  if (e.text.work !== null) {
    ctx.font = workFont
    ctx.fillStyle = '#e9bf6e'
    ctx.fillText(e.text.work, LABEL.padX, LABEL.workBaseline)
  }
  ctx.restore()
  atlas.end()
}

/** Texels per CSS pixel: 2 on high-density displays, else 1 (labels then map 1:1 to the screen). */
export function atlasScale(devicePixelRatio: number): number {
  return devicePixelRatio >= 1.5 ? 2 : 1
}

export function createLabels(main: Scene, capacity = 64): Labels {
  const layer = new UtilityLayerRenderer(main, false)
  const scene = layer.utilityLayerScene
  const engine = main.getEngine()
  const scale = atlasScale(typeof window === 'undefined' ? 1 : (window.devicePixelRatio ?? 1))
  const cols = 8
  const rows = Math.ceil(capacity / cols)
  const atlas = createAtlas(scene, 'labels', { cellW: LABEL.maxWidth + 8, cellH: 36, cols, rows, margin: 4, scale })

  const material = new StandardMaterial('labels', scene)
  material.disableLighting = true
  material.diffuseColor = Color3.Black()
  material.specularColor = Color3.Black()
  material.emissiveColor = atlas.texture ? Color3.Black() : new Color3(0.07, 0.08, 0.11)
  material.emissiveTexture = atlas.texture
  material.opacityTexture = atlas.texture
  material.backFaceCulling = false
  material.disableDepthWrite = true

  let lookups: SceneLookups = {}
  /** Roles show when zoomed in (`ROLE_ZOOM`); the texts are redone when that changes. */
  let withRole = false
  let lastStaff: readonly StaffRender[] = []
  const entries: Array<Entry | undefined> = new Array(capacity).fill(undefined)
  const byStaff = new Map<string, number>()
  const slots: LabelSlots = createLabelSlots(capacity)
  const right = new Vector3()
  const up = new Vector3()
  const basis: ViewBasis = { rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0, tx: 0, ty: 0, tz: 0, ppm: 1, viewW: 1, viewH: 1 }
  const offset = { ax: 0, ay: 0 }
  /** The head of slot i was projected this frame (its label may still be hidden under the HUD). */
  const headShown = new Uint8Array(capacity)
  let viewW = 1
  let viewH = 1
  /** Render pixels per CSS pixel. */
  let px = 1

  const layoutEntry = (cell: number, e: Entry) => {
    const nameW = atlas.measure(e.text.name, nameFont, LABEL.nameFont)
    const roleW = e.text.role ? atlas.measure(e.text.role, roleFont, LABEL.roleFont) : 0
    const workW = e.text.work === null ? null : atlas.measure(e.text.work, workFont, LABEL.workFont)
    const size = labelSize(nameW, roleW, workW)
    e.w = size.w
    e.h = size.h
    atlas.map(e.mesh, cell, e.w, e.h)
    paint(atlas, cell, e, nameW)
  }

  const freeCell = (): number => {
    for (let i = 0; i < capacity; i++) if (!entries[i]) return i
    for (let i = 0; i < capacity; i++) if (!entries[i]!.present) return i
    return -1
  }

  const labels: Labels = {
    scene,
    capacity,
    painted: atlas.ctx !== null,
    setLookups(next) {
      lookups = next
    },
    sync(staff) {
      lastStaff = staff
      for (const e of entries) if (e) e.present = false
      for (const s of staff) {
        const text = labelText(s, lookups, withRole)
        let cell = byStaff.get(s.id)
        if (cell === undefined) {
          cell = freeCell()
          if (cell < 0) continue
          const old = entries[cell]
          if (old) {
            byStaff.delete(old.staff)
            old.mesh.dispose()
          }
          const mesh = billboard(scene, `label-${s.id}`)
          mesh.material = material
          mesh.setEnabled(false)
          const e: Entry = { staff: s.id, workItem: s.workItem, color: s.color, text, w: 0, h: 0, mesh, present: true }
          entries[cell] = e
          byStaff.set(s.id, cell)
          layoutEntry(cell, e)
          continue
        }
        const e = entries[cell]!
        e.present = true
        e.workItem = s.workItem
        if (!sameText(e.text, text) || e.color !== s.color) {
          e.text = text
          e.color = s.color
          layoutEntry(cell, e)
        }
      }
      for (const e of entries) if (e && !e.present && e.mesh.isEnabled()) e.mesh.setEnabled(false)
      atlas.flush()
    },
    place(camera, anchor, headHeight, occluders) {
      viewW = engine.getRenderWidth()
      viewH = engine.getRenderHeight()
      px = 1 / engine.getHardwareScalingLevel()
      const zoom = camera.orthoTop ?? 10
      if (zoom <= ROLE_ZOOM !== withRole) {
        withRole = zoom <= ROLE_ZOOM
        labels.sync(lastStaff)
      }
      const ppm = viewH / (2 * zoom)
      const alpha = labelAlpha(zoom)
      material.alpha = alpha
      camera.getDirectionToRef(Vector3.RightReadOnly, right)
      camera.getDirectionToRef(Vector3.UpReadOnly, up)
      const t = camera.target
      basis.rx = right.x
      basis.ry = right.y
      basis.rz = right.z
      basis.ux = up.x
      basis.uy = up.y
      basis.uz = up.z
      basis.tx = t.x
      basis.ty = t.y
      basis.tz = t.z
      basis.ppm = ppm
      basis.viewW = viewW
      basis.viewH = viewH
      for (let i = 0; i < capacity; i++) {
        const e = entries[i]
        const node = e && e.present && alpha > 0.01 ? anchor(e.staff) : undefined
        if (!e || !node || !node.isEnabled()) {
          slots.visible[i] = 0
          headShown[i] = 0
          if (e && e.mesh.isEnabled()) e.mesh.setEnabled(false)
          continue
        }
        const p = node.position
        slots.visible[i] = 1
        headShown[i] = 1
        slots.w[i] = e.w * px
        slots.h[i] = e.h * px
        // Screen pixels from the canvas centre, y up; snapped so the label's edges fall on the pixel grid.
        projectOffset(basis, p.x, p.y + headHeight(e.staff), p.z, HEAD_GAP * px, offset)
        slots.ax[i] = offset.ax
        slots.ay[i] = offset.ay
      }
      stackLabels(slots, 2 * px)
      for (let i = 0; i < capacity; i++) {
        if (!slots.visible[i]) continue
        const e = entries[i]!
        // Hidden under the HUD and panels (CSS pixels from the top-left).
        const left = (viewW / 2 + slots.ax[i] - slots.w[i] / 2) / px
        const top = (viewH / 2 - slots.y[i] - slots.h[i]) / px
        const r = left + e.w
        const b = top + e.h
        let covered = false
        for (const o of occluders) if (left < o.right && r > o.left && top < o.bottom && b > o.top) covered = true
        if (covered) {
          slots.visible[i] = 0
          if (e.mesh.isEnabled()) e.mesh.setEnabled(false)
          continue
        }
        const cx = slots.ax[i] / ppm
        const cy = (slots.y[i] + slots.h[i] / 2) / ppm
        // Back to the world: in the plane through the camera's target, facing the camera.
        e.mesh.position.set(t.x + right.x * cx + up.x * cy, t.y + right.y * cx + up.y * cy, t.z + right.z * cx + up.z * cy)
        e.mesh.scaling.set(slots.w[i] / ppm, slots.h[i] / ppm, 1)
        if (!e.mesh.isEnabled()) e.mesh.setEnabled(true)
      }
    },
    hit(x, y) {
      const i = labelAt(slots, x * px - viewW / 2, viewH / 2 - y * px)
      if (i < 0) return null
      const e = entries[i]!
      const above = (viewH / 2 - y * px - slots.y[i]) / px
      return { staff: e.staff, workItem: e.workItem && onWorkLine(e.text, above) ? e.workItem : null }
    },
    textOf: (staffId) => {
      const cell = byStaff.get(staffId)
      return cell === undefined ? undefined : entries[cell]?.text
    },
    rectOf(staffId) {
      const i = byStaff.get(staffId)
      if (i === undefined || !slots.visible[i]) return null
      const left = (viewW / 2 + slots.ax[i] - slots.w[i] / 2) / px
      const top = (viewH / 2 - slots.y[i] - slots.h[i]) / px
      return { left, top, right: left + slots.w[i] / px, bottom: top + slots.h[i] / px }
    },
    headOf(staffId) {
      const i = byStaff.get(staffId)
      if (i === undefined || !headShown[i]) return null
      // The label's anchor less the gap: the top of the head (CSS pixels from the top-left).
      return offsetToCss(basis, slots.ax[i], slots.ay[i] - HEAD_GAP * px, px)
    },
    rects() {
      const out: ScreenRect[] = []
      for (const id of byStaff.keys()) {
        const r = labels.rectOf(id)
        if (r) out.push(r)
      }
      return out
    },
    dispose() {
      for (const e of entries) e?.mesh.dispose()
      material.dispose()
      atlas.dispose()
      layer.dispose()
    },
  }
  return labels
}
