// The engine cut (ADR-0057) on synthetic pages shaped like the upstream demo:
// a landing script, then one module script holding the engine, its export
// statement and the demo UI. The real page is never part of the repository.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cutEngine, ExtractError, exportPattern, extractEngine, pinnedPageUrl, sha256Hex, type RuntimeLock } from './extract'

const ENGINE = 'var Ri="repo",Cl="file.gguf",zl=class{static load(){return import("./lazy.js")}},mx=zl;'
const EXPORT = 'export{Cl as DEFAULT_GGUF_FILE,Ri as DEFAULT_MODEL_ID,zl as TernaryBonsai2,mx as default};'
const UI = 'const Dm=zl;await window.PrismBootReady;document.getElementById("app");'

const page = (engine = ENGINE, exp = EXPORT, ui = UI) =>
  `<!doctype html><html><head><script>window.PrismBootReady=Promise.resolve()</script></head><body><script type="module">${engine}${exp}${ui}</script></body></html>`

async function lockFor(html: string, code: string): Promise<RuntimeLock> {
  const enc = new TextEncoder()
  return {
    format: 'swarmpress.bonsai-runtime-lock.v1',
    space: { id: 'org/space', sha: 'a'.repeat(40), file: 'index.html', bytes: enc.encode(html).length, sha256: await sha256Hex(html) },
    engine: { exportName: 'TernaryBonsai2', bytes: enc.encode(code).length, sha256: await sha256Hex(code), output: 'engine.mjs' },
    model: { repo: 'org/model', revision: 'b'.repeat(40), file: 'm.gguf', bytes: 1, sha256: 'c'.repeat(64) },
  }
}

async function code(e: unknown): Promise<string> {
  return e instanceof ExtractError ? e.code : `not an ExtractError: ${String(e)}`
}

describe('cutEngine', () => {
  it('keeps the module script up to and including the export statement', () => {
    const { code, exportStatement } = cutEngine(page(), 'TernaryBonsai2')
    expect(code).toBe(ENGINE + EXPORT)
    expect(exportStatement).toBe(EXPORT)
    expect(code).not.toContain('PrismBootReady')
    // A dynamic import is not a static one.
    expect(code).toContain('import("./lazy.js")')
  })

  it('fails when no export statement names the engine', () => {
    expect(() => cutEngine(page(ENGINE, 'export{zl as SomethingElse};'), 'TernaryBonsai2')).toThrowError(/no export statement/)
  })

  it('fails when two export statements name it', () => {
    expect(() => cutEngine(page(ENGINE, EXPORT + EXPORT), 'TernaryBonsai2')).toThrowError(/2 export statements/)
  })

  it('refuses an engine with a static import', async () => {
    for (const imp of ['import{a}from"./dep.js";', 'import x from "./dep.js";', 'import"./side-effect.js";', 'import * as d from "./dep.js";']) {
      const err = await Promise.resolve()
        .then(() => cutEngine(page(imp + ENGINE), 'TernaryBonsai2'))
        .catch((e) => e)
      expect(await code(err), imp).toBe('static-import')
    }
  })

  it('refuses a cut that still reaches the demo UI', () => {
    expect(() => cutEngine(page(`await window.PrismBootReady;${ENGINE}`), 'TernaryBonsai2')).toThrowError(/PrismBootReady/)
  })

  it('anchors on the exported name, not on a minified identifier', () => {
    const renamed = 'export{a1 as DEFAULT_GGUF_FILE,b2 as TernaryBonsai2,c3 as default};'
    expect(cutEngine(page('var b2=class{};', renamed), 'TernaryBonsai2').exportStatement).toBe(renamed)
    expect(exportPattern('TernaryBonsai2').test('export{x as TernaryBonsai2Extra};')).toBe(false)
    expect(() => exportPattern('not a name')).toThrow()
  })
})

describe('extractEngine', () => {
  it('returns the engine when the page and the engine match the lock', async () => {
    const html = page()
    const lock = await lockFor(html, ENGINE + EXPORT)
    const out = await extractEngine(html, lock)
    expect(out.code).toBe(ENGINE + EXPORT)
    expect(out.sha256).toBe(lock.engine.sha256)
    // Bytes in, same result.
    expect((await extractEngine(new TextEncoder().encode(html), lock)).sha256).toBe(lock.engine.sha256)
  })

  it('rejects a page that is not the pinned one', async () => {
    const lock = await lockFor(page(), ENGINE + EXPORT)
    expect(await code(await extractEngine(page(ENGINE, EXPORT, `${UI}//changed`), lock).catch((e) => e))).toBe('page-hash')
  })

  it('rejects an engine that is not the pinned one', async () => {
    const html = page()
    const lock = await lockFor(html, ENGINE + EXPORT)
    lock.engine.sha256 = 'f'.repeat(64)
    expect(await code(await extractEngine(html, lock).catch((e) => e))).toBe('engine-hash')
  })
})

describe('runtime.lock.json', () => {
  const lock = JSON.parse(readFileSync(fileURLToPath(new URL('./runtime.lock.json', import.meta.url)), 'utf8')) as RuntimeLock

  it('pins a Space commit, an engine hash and a model revision', () => {
    expect(lock.space.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(lock.model.revision).toMatch(/^[0-9a-f]{40}$/)
    for (const h of [lock.space.sha256, lock.engine.sha256, lock.model.sha256]) expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(lock.engine.exportName).toBe('TernaryBonsai2')
    expect(pinnedPageUrl(lock)).toBe(`https://huggingface.co/spaces/${lock.space.id}/resolve/${lock.space.sha}/index.html`)
  })
})
