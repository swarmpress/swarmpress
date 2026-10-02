#!/usr/bin/env node
// Fetches the pinned upstream demo page and cuts the Bonsai WebGPU engine into
// public/vendor/bonsai/ (git-ignored; the engine has no upstream licence and is
// never committed, ADR-0057). It imports a TypeScript module, so it needs a
// Node that strips types by default (>= 22.18 or >= 23.6) or Bun:
//
//   pnpm --filter @swarm-press/game bonsai:runtime            # fetch + verify + write
//   pnpm --filter @swarm-press/game bonsai:runtime -- --check # verify what is on disk
//   … -- --from <index.html>                                  # cut a local copy of the page
//
// Every hash is checked against src/llm/runtime/bonsai/runtime.lock.json; a
// mismatch writes nothing.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractEngine, pinnedPageUrl, sha256Hex } from '../src/llm/runtime/bonsai/extract.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const lockPath = join(root, 'src/llm/runtime/bonsai/runtime.lock.json')
const outDir = join(root, 'public/vendor/bonsai')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main() {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  const out = join(outDir, lock.engine.output)

  if (flag('--check')) {
    const code = await readFile(out)
    const sha = await sha256Hex(new Uint8Array(code))
    if (code.length !== lock.engine.bytes || sha !== lock.engine.sha256) {
      throw new Error(`${out}: ${code.length} bytes sha256 ${sha} does not match the lock`)
    }
    console.log(`ok ${out} (${code.length} bytes, sha256 ${sha})`)
    return
  }

  const from = value('--from')
  let page
  if (from) {
    page = new Uint8Array(await readFile(from))
  } else {
    const url = pinnedPageUrl(lock)
    console.log(`fetching ${url}`)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    page = new Uint8Array(await res.arrayBuffer())
  }
  const engine = await extractEngine(page, lock)
  await mkdir(outDir, { recursive: true })
  await writeFile(out, engine.code)
  await writeFile(
    join(outDir, 'engine.json'),
    `${JSON.stringify({ space: lock.space.id, spaceSha: lock.space.sha, bytes: engine.bytes, sha256: engine.sha256, model: lock.model }, null, 2)}\n`,
  )
  console.log(`wrote ${out} (${engine.bytes} bytes, sha256 ${engine.sha256})`)
  console.log('The engine is unlicensed upstream: it stays untracked (public/vendor/ is git-ignored).')
}

main().catch((e) => {
  console.error(`bonsai-runtime: ${e.message}`)
  process.exit(1)
})
