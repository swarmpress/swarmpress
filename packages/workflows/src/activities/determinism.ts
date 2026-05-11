/**
 * Determinism Helper Activities
 *
 * Workflow code in Temporal must be deterministic — it cannot call
 * Date.now(), Math.random(), or other non-deterministic APIs directly.
 *
 * These helper activities encapsulate non-deterministic operations
 * (ID generation, wall-clock duration measurement) so that workflows
 * can call them as activities, which Temporal records in workflow
 * history and replays deterministically.
 */

import { randomUUID } from 'crypto'

/**
 * Generate a unique ID with the given prefix.
 *
 * Use this from workflow code instead of inline `${prefix}-${Date.now()}`
 * or `${prefix}-${Math.random()}` patterns, which break determinism.
 */
export async function generateId(prefix: string): Promise<string> {
  return `${prefix}-${randomUUID()}`
}

/**
 * Compute the duration in milliseconds since the given start timestamp.
 *
 * Use this from workflow code instead of `Date.now() - startMs`. The
 * caller must supply a startMs value that itself originated from an
 * activity (e.g. a previous call to `getCurrentTimestamp`) — never from
 * an inline Date.now() call inside workflow code.
 */
export async function measureDuration(startMs: number): Promise<number> {
  return Date.now() - startMs
}

/**
 * Get the current wall-clock timestamp in milliseconds.
 *
 * Use this from workflow code instead of inline `Date.now()`.
 */
export async function getCurrentTimestamp(): Promise<number> {
  return Date.now()
}
