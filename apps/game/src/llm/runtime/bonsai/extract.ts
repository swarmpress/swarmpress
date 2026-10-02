/**
 * Cuts the WebGPU engine out of the pinned upstream demo page (ADR-0057).
 *
 * The demo (webml-community/ternary-bonsai-2-webgpu-kernels) ships one
 * `index.html` whose second inline module script is the engine followed by
 * the demo UI. The engine ends in one ES `export{…}` statement that names
 * `TernaryBonsai2`; everything after it is UI that needs a DOM. The cut is the
 * script text up to and including that statement, unmodified.
 *
 * The engine has no licence upstream, so it is never committed: this module,
 * the hash lock (`runtime.lock.json`) and `scripts/bonsai-runtime.mjs` are
 * what the repository holds. Isomorphic (browser, Node >= 23.6, Bun): erasable
 * TypeScript only, hashing through WebCrypto.
 */

export interface RuntimeLock {
  format: string
  space: { id: string; sha: string; file: string; bytes: number; sha256: string }
  engine: { exportName: string; bytes: number; sha256: string; output: string }
  model: { repo: string; revision: string; file: string; bytes: number; sha256: string }
}

export class ExtractError extends Error {
  readonly code: ExtractErrorCode
  constructor(code: ExtractErrorCode, message: string) {
    super(message)
    this.name = 'ExtractError'
    this.code = code
  }
}

export type ExtractErrorCode =
  | 'page-hash'
  | 'no-export'
  | 'ambiguous-export'
  | 'static-import'
  | 'ui-leak'
  | 'engine-hash'

export interface Extracted {
  /** The engine as an ES module (UTF-8 text). */
  code: string
  bytes: number
  sha256: string
  /** The export statement the cut is anchored on. */
  exportStatement: string
}

const enc = new TextEncoder()

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The pinned page URL (`resolve/<sha>`, which answers with CORS headers). */
export function pinnedPageUrl(lock: RuntimeLock): string {
  return `https://huggingface.co/spaces/${lock.space.id}/resolve/${lock.space.sha}/${lock.space.file}`
}

/** The export statement that names `exportName`: `export{…as TernaryBonsai2…};`. */
export function exportPattern(exportName: string): RegExp {
  if (!/^[A-Za-z_$][\w$]*$/.test(exportName)) throw new Error(`bad export name ${JSON.stringify(exportName)}`)
  return new RegExp(`export\\{[^}]*\\bas ${exportName}\\b[^}]*\\};?`, 'g')
}

/** A static `import … from '…'` or `import '…'` at statement position (dynamic `import(` is fine). */
const STATIC_IMPORT = /(?:^|[;\n}])\s*import\s*(?:[\w$*{][^;'"]*?\bfrom\s*)?['"][^'"]+['"]/

/**
 * Cut the engine out of `html` without checking any hash. Throws
 * `ExtractError` when the anchor is missing or ambiguous, or when the cut
 * would need a DOM or a module resolver.
 */
export function cutEngine(html: string, exportName: string): { code: string; exportStatement: string } {
  const matches = [...html.matchAll(exportPattern(exportName))]
  if (matches.length === 0) throw new ExtractError('no-export', `no export statement names ${exportName}`)
  if (matches.length > 1) throw new ExtractError('ambiguous-export', `${matches.length} export statements name ${exportName}`)
  const m = matches[0]
  const end = (m.index ?? 0) + m[0].length
  // The inline module script the statement lives in: from the last <script …> before it.
  const open = html.lastIndexOf('<script', end)
  const start = open < 0 ? -1 : html.indexOf('>', open) + 1
  if (open < 0 || start <= 0) throw new ExtractError('no-export', 'the export statement is not inside a <script>')
  const code = html.slice(start, end)
  if (STATIC_IMPORT.test(code)) throw new ExtractError('static-import', 'the engine slice has a static import')
  if (code.includes('PrismBootReady')) throw new ExtractError('ui-leak', 'the engine slice reaches the demo UI (PrismBootReady)')
  return { code, exportStatement: m[0] }
}

/**
 * Verify the page against the lock, cut the engine, verify the engine.
 * Every mismatch is fatal: a different engine is a different runtime
 * (equivalence test and benchmark must be re-run before the lock moves).
 */
export async function extractEngine(html: string | Uint8Array, lock: RuntimeLock): Promise<Extracted> {
  const pageBytes = typeof html === 'string' ? enc.encode(html) : html
  const pageSha = await sha256Hex(pageBytes)
  if (pageBytes.length !== lock.space.bytes || pageSha !== lock.space.sha256) {
    throw new ExtractError(
      'page-hash',
      `page does not match the lock: ${pageBytes.length} bytes sha256 ${pageSha}, expected ${lock.space.bytes} bytes sha256 ${lock.space.sha256}`,
    )
  }
  const text = typeof html === 'string' ? html : new TextDecoder('utf-8', { fatal: true }).decode(html)
  const { code, exportStatement } = cutEngine(text, lock.engine.exportName)
  const bytes = enc.encode(code).length
  const sha256 = await sha256Hex(code)
  if (bytes !== lock.engine.bytes || sha256 !== lock.engine.sha256) {
    throw new ExtractError(
      'engine-hash',
      `engine does not match the lock: ${bytes} bytes sha256 ${sha256}, expected ${lock.engine.bytes} bytes sha256 ${lock.engine.sha256}`,
    )
  }
  return { code, bytes, sha256, exportStatement }
}
