/**
 * A texture atlas of text, painted with the 2D canvas and uploaded as raw
 * RGBA pixels when something changed (never per frame). Raw pixels rather
 * than a canvas-backed texture: SwiftShader's WebGPU cannot copy from a
 * canvas (`copyExternalImageToTexture`), and both renderers take raw data.
 *
 * Without a 2D canvas (node, NullEngine tests) nothing is painted: `ctx` is
 * null, texts are measured by an estimate, and the meshes and their UVs are
 * still built, so the scene's structure is the same.
 */
import { Constants, RawTexture, Texture, VertexBuffer, type Mesh, type Scene } from '@babylonjs/core'

export interface AtlasOptions {
  /** Cell size in CSS pixels; the texture holds `cols × rows` cells at `scale` texels per CSS pixel. */
  cellW: number
  cellH: number
  cols: number
  rows: number
  /** Clear CSS pixels around each cell's content, so neighbours do not bleed into mip levels. */
  margin: number
  scale: number
}

export interface Atlas extends AtlasOptions {
  ctx: CanvasRenderingContext2D | null
  texture: RawTexture | null
  /** Texture size in texels. */
  width: number
  height: number
  /** Start painting cell `i` in CSS pixels from the top-left of its content area; returns false without a canvas. */
  begin(i: number): boolean
  end(): void
  /** Point a quad's UVs (bottom-left, bottom-right, top-right, top-left) at a `w × h` CSS-pixel rectangle of cell `i`. */
  map(mesh: Mesh, i: number, w: number, h: number): void
  /** Text width in CSS pixels in `font` (a CSS font at CSS pixel size). */
  measure(text: string, font: string, px: number): number
  /** Upload the canvas if anything was painted since the last upload. */
  flush(): void
  dispose(): void
}

export function createAtlas(scene: Scene, name: string, opts: AtlasOptions): Atlas {
  const width = opts.cellW * opts.cols * opts.scale
  const height = opts.cellH * opts.rows * opts.scale
  const real = typeof document !== 'undefined' && scene.getEngine().name !== 'NullEngine'
  let ctx: CanvasRenderingContext2D | null = null
  if (real) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }
  let texture: RawTexture | null = null
  if (ctx) {
    texture = new RawTexture(new Uint8Array(width * height * 4), width, height, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
    texture.name = name
    texture.hasAlpha = true
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE
  }
  let dirty = false
  const uv = new Float32Array(8)
  const origin = (i: number) => ({ x: (i % opts.cols) * opts.cellW, y: Math.floor(i / opts.cols) * opts.cellH })

  return {
    ...opts,
    ctx,
    texture,
    width,
    height,
    begin(i) {
      if (!ctx) return false
      const o = origin(i)
      ctx.save()
      ctx.setTransform(opts.scale, 0, 0, opts.scale, 0, 0)
      ctx.clearRect(o.x, o.y, opts.cellW, opts.cellH)
      ctx.translate(o.x + opts.margin, o.y + opts.margin)
      dirty = true
      return true
    },
    end() {
      ctx?.restore()
    },
    map(mesh, i, w, h) {
      const o = origin(i)
      const u0 = (o.x + opts.margin) / (opts.cellW * opts.cols)
      const u1 = (o.x + opts.margin + w) / (opts.cellW * opts.cols)
      // Texture row 0 is the canvas' top row and v = 0 (the raw upload is not flipped).
      const top = (o.y + opts.margin) / (opts.cellH * opts.rows)
      const bottom = (o.y + opts.margin + h) / (opts.cellH * opts.rows)
      uv[0] = u0
      uv[1] = bottom
      uv[2] = u1
      uv[3] = bottom
      uv[4] = u1
      uv[5] = top
      uv[6] = u0
      uv[7] = top
      mesh.updateVerticesData(VertexBuffer.UVKind, uv)
    },
    measure(text, font, px) {
      if (!ctx) return Math.ceil(text.length * px * 0.56)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.font = font
      const w = ctx.measureText(text).width
      ctx.restore()
      return Math.ceil(w)
    },
    flush() {
      if (!dirty || !ctx || !texture) return
      dirty = false
      const pixels = ctx.getImageData(0, 0, width, height)
      texture.update(new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength))
    },
    dispose() {
      texture?.dispose()
    },
  }
}
