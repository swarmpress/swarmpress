/**
 * wordpress.html: a company's WordPress in the game, without the rest of the game (FEAT-105,
 * FEAT-107). Built only with `vite build --mode harness`. The page starts the storage worker,
 * embeds the sandbox from its own origin through `openWordPress`, and exposes both channels the
 * game has (and nothing else) on `window.__wp`:
 *   request(req)  an HTTP-shaped request to WordPress → {status, headers, text}
 *   repo(msg)     one governed-API message (branches, sessions, change requests, merges)
 *   records()     how many repository records the worker has handed back for the company store
 *   channel()     the storage messages answered so far and each one's round trip in µs (FEAT-107's
 *                 boundary benchmark, measured where WordPress waits for it)
 *
 * URL parameters: `sandbox=<url>` (default: `sandboxUrl()`).
 */
import { StorageClient, type StorageEndpoint } from '../php/storage-client'
import { openWordPress } from '../php/wordpress'
import type { PhpRequest } from '../php/types'

const status = document.getElementById('status') as HTMLElement
const params = new URLSearchParams(location.search)
const log = (line: string) => {
  status.textContent = status.textContent === 'loading' ? line : `${status.textContent}\n${line}`
}

let records = 0
const storage = StorageClient.start((r) => {
  records += r.length
})

const micros: number[] = []
const timed: StorageEndpoint = {
  async storage(payload) {
    const t0 = performance.now()
    const reply = await storage.storage(payload)
    micros.push(Math.round((performance.now() - t0) * 1000))
    return reply
  },
  repo: (msg) => storage.repo(msg),
}

async function main() {
  const t0 = performance.now()
  const branches = await storage.init([])
  log(`storage worker ready: ${branches.length} branch(es)`)
  const wp = await openWordPress({ backend: 'php-wasm', storage: timed, sandboxUrl: params.get('sandbox') ?? undefined })
  log(`WordPress ready: PHP ${wp.boot.php}, ${wp.boot.files} files, sandbox boot ${Math.round(wp.boot.ms)} ms, ${Math.round(performance.now() - t0)} ms in all`)
  const w = window as unknown as { __wp: unknown }
  w.__wp = {
    boot: wp.boot,
    async request(req: PhpRequest) {
      const r = await wp.php.request(req)
      return { status: r.status, headers: r.headers, text: r.text() }
    },
    repo: (msg: Record<string, unknown>) => storage.repo(msg),
    records: () => records,
    channel: () => ({ messages: micros.length, micros: [...micros] }),
  }
  document.body.dataset.wp = 'ready'
}

main().catch((e: unknown) => {
  log(`failed: ${String((e as Error)?.message ?? e)}`)
  document.body.dataset.wp = 'failed'
})
