/**
 * Findings (errors / warnings) and the ratcheting baseline.
 *
 * A baseline file lists finding keys (`file#path:code`) that are tolerated
 * because they predate the rule. New findings fail; baselined findings that
 * disappear are reported as fixed so the baseline only ever shrinks.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  severity: Severity
  /** Machine-readable code (`schema`, `unknown_block`, `broken_link`, …). */
  code: string
  /** Repo-relative file the finding is about. */
  file: string
  /** JSON pointer into the file (`/body/3/title`) or `line:col` for source files. */
  path: string
  message: string
}

export function findingKey(f: Pick<Finding, 'file' | 'path' | 'code'>): string {
  return `${f.file}#${f.path}:${f.code}`
}

export function formatFinding(f: Finding): string {
  const where = f.path ? `${f.file} ${f.path}` : f.file
  return `${f.severity.toUpperCase().padEnd(7)} ${where} [${f.code}] ${f.message}`
}

export interface BaselineFile {
  version: 1
  generatedAt?: string
  note?: string
  entries: string[]
}

export function readBaseline(path: string): Set<string> {
  if (!existsSync(path)) return new Set()
  const v = JSON.parse(readFileSync(path, 'utf8')) as BaselineFile | string[]
  const entries = Array.isArray(v) ? v : v.entries ?? []
  return new Set(entries)
}

export function writeBaseline(path: string, findings: Finding[]): BaselineFile {
  const entries = [...new Set(findings.filter((f) => f.severity === 'error').map(findingKey))].sort()
  const file: BaselineFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    note: 'Ratchet: kit check tolerates these existing violations; new ones fail. Remove entries as they are fixed.',
    entries,
  }
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n')
  return file
}

export interface BaselineResult {
  /** Errors not covered by the baseline. */
  newErrors: Finding[]
  /** Errors covered by the baseline. */
  baselined: Finding[]
  /** Baseline keys that no longer occur (fixed). */
  fixed: string[]
}

export function applyBaseline(findings: Finding[], baseline: Set<string>): BaselineResult {
  const seen = new Set<string>()
  const newErrors: Finding[] = []
  const baselined: Finding[] = []
  for (const f of findings) {
    if (f.severity !== 'error') continue
    const k = findingKey(f)
    seen.add(k)
    if (baseline.has(k)) baselined.push(f)
    else newErrors.push(f)
  }
  const fixed = [...baseline].filter((k) => !seen.has(k)).sort()
  return { newErrors, baselined, fixed }
}

/** Counts by code, for summaries. */
export function countByCode(findings: Finding[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of findings) out[f.code] = (out[f.code] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}
