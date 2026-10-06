/**
 * The one module that names `blueprint-wasm` (a Vite alias of
 * `crates/blueprint-wasm/pkg`): imported only when the checker is first
 * needed, so neither the default bundle nor a test that hands in its own
 * module (`setBlueprintWasm`) ever resolves the pkg.
 */
import type { BlueprintApi } from './wasm'

export async function importBlueprintWasm(): Promise<BlueprintApi> {
  const mod = await import('blueprint-wasm')
  await mod.default()
  return mod as unknown as BlueprintApi
}
