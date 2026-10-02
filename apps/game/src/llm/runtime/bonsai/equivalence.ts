/**
 * Upstream equivalence (ADR-0057): the worker adapter must produce exactly
 * the token ids the unmodified upstream engine produces on the main thread,
 * for fixed prompts and greedy decoding. It gates every bump of the pinned
 * engine or model (runtime.lock.json) and is run by
 * e2e/bonsai-equivalence.spec.ts on a real GPU.
 *
 * Kernel variants differ per GPU and feature set (f16, subgroups), so recorded
 * goldens are keyed by adapter and features and are only comparable for the
 * same engine build and model revision.
 */
import type { ChatMessage } from '../../types'
import type { UpstreamDeviceInfo } from './upstream'

/** Five fixed prompts: short, with a system message, multi-turn, JSON-shaped, and non-ASCII. */
export const EQUIVALENCE_PROMPTS: ChatMessage[][] = [
  [{ role: 'user', content: 'Name the five villages of the Cinque Terre, from north to south.' }],
  [
    { role: 'system', content: 'You are Giulia, a travel writer for a small newsroom. Write plainly.' },
    { role: 'user', content: 'Write one sentence about the harvest on the terraces above Manarola.' },
  ],
  [
    { role: 'user', content: 'Which train line connects the villages?' },
    { role: 'assistant', content: 'The regional line between La Spezia and Levanto.' },
    { role: 'user', content: 'How long does the ride from Riomaggiore to Monterosso take?' },
  ],
  [
    { role: 'system', content: 'Answer with a single JSON object and nothing else.' },
    { role: 'user', content: 'Give {"title": string, "words": integer} for a short article about Vernazza harbour.' },
  ],
  [{ role: 'user', content: 'Übersetze ins Deutsche: «Il sentiero è chiuso per frana fino a venerdì.»' }],
]

export const EQUIVALENCE_TOKENS = 64

export interface Mismatch {
  prompt: number
  /** First differing position, or the shorter length when one is a prefix of the other. */
  index: number
  expected: number | null
  actual: number | null
}

/** Position-by-position comparison of token id lists; empty when identical. */
export function compareIds(expected: number[][], actual: number[][]): Mismatch[] {
  const out: Mismatch[] = []
  for (let p = 0; p < Math.max(expected.length, actual.length); p++) {
    const e = expected[p] ?? []
    const a = actual[p] ?? []
    const n = Math.max(e.length, a.length)
    for (let i = 0; i < n; i++) {
      if (e[i] !== a[i]) {
        out.push({ prompt: p, index: i, expected: e[i] ?? null, actual: a[i] ?? null })
        break
      }
    }
  }
  return out
}

/** Adapter and feature set: what selects the kernel variants. */
export function goldenKey(device: UpstreamDeviceInfo): string {
  const f = device.features
  return [
    device.vendor || 'unknown',
    device.architecture || 'unknown',
    device.device || device.description || 'unknown',
    f.shaderF16 ? 'f16' : 'no-f16',
    f.subgroups ? 'sg' : 'no-sg',
    f.subgroupMatrix ? 'sgmat' : 'no-sgmat',
  ].join('|')
}

export interface EquivalenceGolden {
  engineSha256: string
  modelRevision: string
  maxNewTokens: number
  /** Generated token ids per prompt, in EQUIVALENCE_PROMPTS order. */
  ids: number[][]
}

export type Goldens = Record<string, EquivalenceGolden>

export type GoldenCheck =
  | { status: 'missing' }
  /** Recorded for another engine build or model revision: not comparable. */
  | { status: 'stale'; golden: EquivalenceGolden }
  | { status: 'match' }
  | { status: 'mismatch'; mismatches: Mismatch[] }

/** Compare a run against the golden recorded for the same device, engine and model. */
export function checkGolden(goldens: Goldens, key: string, current: EquivalenceGolden): GoldenCheck {
  const golden = goldens[key]
  if (!golden) return { status: 'missing' }
  if (golden.engineSha256 !== current.engineSha256 || golden.modelRevision !== current.modelRevision || golden.maxNewTokens !== current.maxNewTokens) {
    return { status: 'stale', golden }
  }
  const mismatches = compareIds(golden.ids, current.ids)
  return mismatches.length ? { status: 'mismatch', mismatches } : { status: 'match' }
}
