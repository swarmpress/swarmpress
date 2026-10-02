/**
 * A slow tick from a dedicated worker (ADR-0060 decision 6, FEAT-080).
 * Timers on a hidden page are throttled, a worker's are not: this one keeps
 * the game clock ticking while the tab is hidden, so work in flight can
 * finish. It posts one message per period and knows nothing else.
 */
/// <reference lib="webworker" />

let timer: ReturnType<typeof setInterval> | undefined

self.onmessage = (e: MessageEvent<{ periodMs?: number; stop?: boolean }>) => {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  if (e.data?.stop) return
  const period = Math.max(250, Number(e.data?.periodMs) || 1000)
  timer = setInterval(() => self.postMessage(0), period)
}
