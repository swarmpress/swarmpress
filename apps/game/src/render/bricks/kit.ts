/**
 * The construction kit's wasm facade (`crates/kit-wasm`, ADR-0065) as the
 * brick office uses it. Only the subset the renderer calls is typed here, so
 * tests can hand in the real module (`initSync` under Node) and the page loads
 * it lazily (`loadKit`), only behind `?office=bricks`: the default bundle
 * never contains the kit's glue or fetches its wasm.
 */

/** A compiled design (`KitBuild`): instance buffers per colour and geometry template. */
export interface KitBuildLike {
  ok(): boolean
  hash(): string
  issuesJson(): string
  infoJson(): string
  summaryJson(): string
  instanceCount(): number
  studCount(): number
  groupCount(): number
  groupColour(i: number): string
  groupTemplate(i: number): string
  /** 7 floats per instance: centre x, y, z (m); size x, y, z (m, unturned); turn. */
  groupTransforms(i: number): Float32Array
  /** 3 u32 per instance: build order, object id, part index. */
  groupMeta(i: number): Uint32Array
  studGroupCount(): number
  studColour(i: number): string
  /** 3 floats per stud: x, y (the top it stands on), z (m). */
  studPositions(i: number): Float32Array
  free(): void
}

export interface KitApi {
  kitInfo(): string
  catalogueJson(): string
  mappingJson(): string
  compile(designJson: string, paramsJson: string): KitBuildLike
  compileShipped(id: string, paramsJson: string): KitBuildLike
  /** `{"room-1": [{at, offset, hash, design}, …], …}`; throws the issues as JSON. */
  roomShells(layoutJson: string): string
}

/** `kit/mapping.json` as `mappingJson()` returns it. */
export interface KitMapping {
  equipment: Record<string, string>
  desk_ports: Record<string, string>
  desk_seat: string
  table: string
  table_seat: string
}

export interface PaletteColour {
  id: string
  name: string
  hex: string
  class: 'solid' | 'metal' | 'transparent' | 'emissive' | string
  metal?: number
  rough?: number
  alpha?: number
  emissive?: string
  glow?: number
}

let loading: Promise<KitApi> | null = null

/**
 * The kit module for the page, loaded once. `import('kit-wasm')` is a
 * separate chunk (a Vite alias of `crates/kit-wasm/pkg`), and the wasm is
 * fetched by the glue's own `new URL(…, import.meta.url)`.
 */
export function loadKit(): Promise<KitApi> {
  loading ??= (async () => {
    const mod = await import('kit-wasm')
    await mod.default()
    return mod as unknown as KitApi
  })()
  return loading
}

/** The palette of the kit's catalogue. */
export function paletteOf(kit: KitApi): PaletteColour[] {
  const c = JSON.parse(kit.catalogueJson()) as { palette: PaletteColour[] }
  return c.palette
}

export function mappingOf(kit: KitApi): KitMapping {
  return JSON.parse(kit.mappingJson()) as KitMapping
}
