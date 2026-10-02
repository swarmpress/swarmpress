/**
 * Opening the company store (ADR-0041): Turso wasm on OPFS when the page is
 * cross-origin isolated and Turso opens; otherwise sqlite-wasm (OPFS SAH
 * pool, in-memory if OPFS is unavailable). `?store=turso|sqlite|memory`
 * forces an engine (a forced engine that fails to open is an error, not a
 * silent fallback).
 */
import { CompanyStore } from './company-store'
import type { StoreEngine } from './driver'
import { MemorySqliteDriver, SqliteWorkerDriver } from './sqlite-driver'

export * from './company-store'
export * from './driver'
export { MIGRATIONS, SCHEMA_VERSION } from './schema'

export type StoreChoice = StoreEngine | 'auto'

export interface OpenStoreOptions {
  /** Database file name in OPFS. Default `swarmpress.db`. */
  name?: string
  /** Default: `?store=` from the page URL, else `auto`. */
  engine?: StoreChoice
}

/** `?store=` from a query string (`auto` when absent or unknown). */
export function storeChoiceFromQuery(search: string): StoreChoice {
  const v = new URLSearchParams(search).get('store')
  return v === 'turso' || v === 'sqlite' || v === 'memory' ? v : 'auto'
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function openTurso(name: string) {
  const { TursoDriver } = await import('./turso-driver')
  return TursoDriver.open(name)
}

export async function openCompanyStore(opts: OpenStoreOptions = {}): Promise<CompanyStore> {
  const name = opts.name ?? 'swarmpress.db'
  const choice =
    opts.engine ?? (typeof location !== 'undefined' ? storeChoiceFromQuery(location.search) : ('auto' as StoreChoice))
  switch (choice) {
    case 'turso':
      return CompanyStore.open(await openTurso(name))
    case 'sqlite': {
      const d = await SqliteWorkerDriver.open(name)
      return CompanyStore.open(d, d.reason)
    }
    case 'memory':
      return CompanyStore.open(await MemorySqliteDriver.open())
    case 'auto': {
      let reason: string
      if (globalThis.crossOriginIsolated) {
        try {
          return await CompanyStore.open(await openTurso(name))
        } catch (e) {
          reason = `turso failed to open: ${message(e)}`
        }
      } else {
        reason = 'page is not cross-origin isolated (turso needs SharedArrayBuffer)'
      }
      try {
        const d = await SqliteWorkerDriver.open(name)
        return await CompanyStore.open(d, d.reason ? `${reason}; ${d.reason}` : reason)
      } catch (e) {
        return CompanyStore.open(await MemorySqliteDriver.open(), `${reason}; sqlite worker failed: ${message(e)}`)
      }
    }
  }
}
