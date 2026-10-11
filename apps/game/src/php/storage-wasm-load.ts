/**
 * The one module that names `storage-api-wasm` (a Vite alias of `crates/storage-api-wasm/pkg`):
 * imported only when a company runs WordPress, so the default bundle never fetches it.
 */
import type { StorageWasm } from './storage-host'

export async function importStorageWasm(): Promise<StorageWasm> {
  const mod = await import('storage-api-wasm')
  await mod.default()
  return mod as unknown as StorageWasm
}
