/**
 * Undo and redo over the Studio's draft (FEAT-100): every committed edit is a
 * new present; undo steps back, redo forward, a new edit drops the redo
 * branch. Pure values, so the Studio keeps one in state.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

/** Edits kept for undo. */
export const HISTORY_LIMIT = 100

export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [] })

export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] }
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}
